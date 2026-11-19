// Runtime state of the CVE page: the active scan, scan history (IndexedDB),
// the AI conversation and the Radar watchlist.

import './browser'
import { createStore, get as idbGet, set as idbSet } from 'idb-keyval'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { toast } from '../store'
import type { ChatMsg } from './ai'
import { rankedCves } from './report'
import { runScan } from './scan'
import { useCveSettings } from './settings'
import type { Progress, ScanResult } from './types'

export type CveTab = 'scan' | 'graph' | 'intel' | 'stack' | 'ai' | 'radar' | 'mcp' | 'settings'

const hist = createStore('chaingraph-cve-history', 'scans')
const HISTORY_KEY = 'list'

interface CveState {
  tab: CveTab
  result: ScanResult | null
  history: { id: string; target: string; at: number; score: number; grade: string }[]
  progress: Progress | null
  cancel: boolean
  chat: ChatMsg[]
  intelSeed: string
  set: (p: Partial<CveState>) => void
}

export const useCve = create<CveState>()((set) => ({
  tab: 'scan',
  result: null,
  history: [],
  progress: null,
  cancel: false,
  chat: [],
  intelSeed: '',
  set: (p) => set(p),
}))

let hydrated = false
export async function hydrateCveHistory() {
  if (hydrated) return
  hydrated = true
  const list = (await idbGet<CveState['history']>(HISTORY_KEY, hist).catch(() => undefined)) ?? []
  useCve.setState({ history: list })
  if (list[0] && !useCve.getState().result) {
    const last = await idbGet<ScanResult>(list[0].id, hist).catch(() => undefined)
    if (last) useCve.setState({ result: last })
  }
}

export async function openScan(id: string) {
  const r = await idbGet<ScanResult>(id, hist).catch(() => undefined)
  if (r) useCve.setState({ result: r, tab: 'scan', chat: [] })
}

async function saveScan(r: ScanResult) {
  await idbSet(r.id, r, hist).catch(() => {})
  const list = [{ id: r.id, target: r.target, at: r.started, score: r.score, grade: r.grade }, ...useCve.getState().history.filter((h) => h.id !== r.id)].slice(0, 40)
  useCve.setState({ history: list })
  await idbSet(HISTORY_KEY, list, hist).catch(() => {})
}

/** Run a scan in the foreground (with progress) and make it the active result. */
export async function startScan(target: string) {
  if (useCve.getState().progress) return
  useCve.setState({ progress: { step: 'Starting', done: 0, total: 0 }, cancel: false })
  try {
    const scan = useCveSettings.getState().scan
    const r = await runScan(target, { ...scan, authorized: !!scan.active }, {
      progress: (p) => useCve.setState({ progress: p }),
      cancelled: () => useCve.getState().cancel,
    })
    useCve.setState({ result: r, chat: [] })
    await saveScan(r)
    if (useCve.getState().cancel) toast('Scan stopped: results are partial', 'info')
    return r
  } catch (e) {
    toast((e as Error).message)
  } finally {
    useCve.setState({ progress: null, cancel: false })
  }
}

// ---------------------------------------------------------------- Radar

export interface RadarSnapshot {
  ports: Record<string, number[]>
  cves: string[]
  kev: string[]
  domains: string[]
  score: number
}

export interface RadarItem {
  target: string
  intervalH: number
  lastRun?: number
  baseline?: RadarSnapshot
  running?: boolean
  error?: string
}

export interface RadarEvent {
  at: number
  target: string
  text: string
  level: 'new' | 'gone' | 'info'
}

interface RadarState {
  items: RadarItem[]
  events: RadarEvent[]
  add: (target: string, intervalH: number) => void
  remove: (target: string) => void
  patch: (target: string, p: Partial<RadarItem>) => void
  log: (e: RadarEvent[]) => void
  clearLog: () => void
}

export const useRadar = create<RadarState>()(
  persist(
    (set) => ({
      items: [],
      events: [],
      add: (target, intervalH) => set((s) => (s.items.some((i) => i.target === target) ? s : { items: [...s.items, { target, intervalH }] })),
      remove: (target) => set((s) => ({ items: s.items.filter((i) => i.target !== target) })),
      patch: (target, p) => set((s) => ({ items: s.items.map((i) => (i.target === target ? { ...i, ...p } : i)) })),
      log: (e) => set((s) => ({ events: [...e, ...s.events].slice(0, 300) })),
      clearLog: () => set({ events: [] }),
    }),
    { name: 'chaingraph-cve-radar', version: 1, partialize: (s) => ({ items: s.items.map((i) => ({ ...i, running: false })), events: s.events }) },
  ),
)

export function snapshot(r: ScanResult): RadarSnapshot {
  const cves = rankedCves(r)
  return {
    ports: Object.fromEntries(r.hosts.map((h) => [h.ip, h.ports])),
    cves: cves.map((c) => c.id),
    kev: cves.filter((c) => c.kev).map((c) => c.id),
    domains: r.domains.filter((d) => d.ips.length).map((d) => d.name),
    score: r.score,
  }
}

export function diffSnapshots(target: string, a: RadarSnapshot, b: RadarSnapshot): RadarEvent[] {
  const at = Date.now()
  const ev: RadarEvent[] = []
  const add = (text: string, level: RadarEvent['level']) => ev.push({ at, target, text, level })
  for (const [ip, ports] of Object.entries(b.ports)) {
    const before = a.ports[ip]
    if (!before) add(`New host ${ip} (ports ${ports.join(', ') || 'none'})`, 'new')
    else {
      const opened = ports.filter((p) => !before.includes(p))
      const closed = before.filter((p) => !ports.includes(p))
      if (opened.length) add(`${ip}: port(s) opened ${opened.join(', ')}`, 'new')
      if (closed.length) add(`${ip}: port(s) closed ${closed.join(', ')}`, 'gone')
    }
  }
  for (const ip of Object.keys(a.ports)) if (!b.ports[ip]) add(`Host ${ip} no longer seen`, 'gone')
  const newKev = b.kev.filter((x) => !a.kev.includes(x))
  if (newKev.length) add(`New known-exploited CVEs: ${newKev.join(', ')}`, 'new')
  const newCves = b.cves.filter((x) => !a.cves.includes(x))
  if (newCves.length) add(`${newCves.length} new CVE(s): ${newCves.slice(0, 8).join(', ')}${newCves.length > 8 ? '…' : ''}`, 'new')
  const fixed = a.cves.filter((x) => !b.cves.includes(x))
  if (fixed.length) add(`${fixed.length} CVE(s) no longer present`, 'gone')
  const newDomains = b.domains.filter((x) => !a.domains.includes(x))
  if (newDomains.length) add(`New subdomain(s): ${newDomains.slice(0, 10).join(', ')}`, 'new')
  if (Math.abs(b.score - a.score) >= 5) add(`Exposure score ${a.score} → ${b.score}`, b.score > a.score ? 'new' : 'gone')
  return ev
}

let radarBusy = false
/** Re-scan targets that are due. Called every minute while the app is open. */
export async function pollRadar(force?: string) {
  if (radarBusy || useCve.getState().progress) return
  radarBusy = true
  try {
    const st = useRadar.getState()
    for (const item of st.items) {
      const due = force ? item.target === force : !item.lastRun || Date.now() - item.lastRun >= item.intervalH * 3600000
      if (!due) continue
      st.patch(item.target, { running: true, error: undefined })
      try {
        const r = await runScan(item.target, useCveSettings.getState().scan, { progress: () => {}, cancelled: () => false })
        const snap = snapshot(r)
        if (r.degraded && item.baseline) {
          // A source failed: diffing would report outages as closed ports or fixed CVEs.
          st.log([{ at: Date.now(), target: item.target, text: 'Check incomplete (a data source did not answer); baseline kept', level: 'info' }])
          st.patch(item.target, { running: false, lastRun: Date.now() })
          continue
        }
        if (item.baseline) {
          const ev = diffSnapshots(item.target, item.baseline, snap)
          if (ev.length) {
            st.log(ev)
            const news = ev.filter((e) => e.level === 'new')
            if (news.length) {
              toast(`Radar · ${item.target}: ${news[0].text}`, 'info')
              if ('Notification' in window && Notification.permission === 'granted') new Notification(`ChainGraph Radar: ${item.target}`, { body: news.map((e) => e.text).join('\n') })
            }
          } else st.log([{ at: Date.now(), target: item.target, text: 'No changes', level: 'info' }])
        } else st.log([{ at: Date.now(), target: item.target, text: `Baseline recorded: ${r.hosts.length} hosts, ${snap.cves.length} CVEs, score ${r.score}`, level: 'info' }])
        await saveScan(r)
        st.patch(item.target, { running: false, lastRun: Date.now(), baseline: snap })
      } catch (e) {
        st.patch(item.target, { running: false, lastRun: Date.now(), error: (e as Error).message })
      }
    }
  } finally {
    radarBusy = false
  }
}
