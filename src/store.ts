import { get as idbGet, set as idbSet } from 'idb-keyval'
import { create } from 'zustand'
import type { PathResult } from './analysis'
import { migrateCase, newCase } from './model'
import type { Case } from './types'

// ---------- cases (persisted to IndexedDB) ----------

interface CaseStore {
  hydrated: boolean
  cases: Record<string, Case>
  order: string[] // vault order
  tabs: string[] // open tabs
  activeId: string
  update: (id: string, fn: (c: Case) => Case) => void
  create: (title?: string) => string
  open: (id: string) => void
  closeTab: (id: string) => void
  remove: (id: string) => void
  importCase: (c: Case) => void
}

const DB_KEY = 'chaingraph.db.v2'

// Undo history per case. Rapid edits (typing) coalesce into one step.
const past = new Map<string, Case[]>()
const future = new Map<string, Case[]>()
const lastPush = new Map<string, number>()

export const useCases = create<CaseStore>()((set, get) => ({
  hydrated: false,
  cases: {},
  order: [],
  tabs: [],
  activeId: '',
  update: (id, fn) =>
    set((s) => {
      const cur = s.cases[id]
      if (!cur) return s
      const next = fn(cur)
      if (next === cur) return s
      const now = Date.now()
      if (now - (lastPush.get(id) ?? 0) > 700) {
        const p = past.get(id) ?? []
        p.push(cur)
        if (p.length > 60) p.shift()
        past.set(id, p)
        future.set(id, [])
      }
      lastPush.set(id, now)
      return { cases: { ...s.cases, [id]: next } }
    }),
  create: (title) => {
    const c = newCase(title ?? `Case ${get().order.length + 1}`)
    set((s) => ({ cases: { ...s.cases, [c.id]: c }, order: [c.id, ...s.order], tabs: [...s.tabs, c.id], activeId: c.id }))
    return c.id
  },
  open: (id) => set((s) => ({ activeId: id, tabs: s.tabs.includes(id) ? s.tabs : [...s.tabs, id] })),
  closeTab: (id) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t !== id)
      if (!tabs.length) return s // keep at least one tab open
      const i = s.tabs.indexOf(id)
      return { tabs, activeId: s.activeId === id ? tabs[Math.max(0, i - 1)] : s.activeId }
    }),
  remove: (id) =>
    set((s) => {
      const cases = { ...s.cases }
      delete cases[id]
      let order = s.order.filter((x) => x !== id)
      let tabs = s.tabs.filter((x) => x !== id)
      if (!order.length) {
        const c = newCase('Untitled case')
        cases[c.id] = c
        order = [c.id]
      }
      if (!tabs.length) tabs = [order[0]]
      return { cases, order, tabs, activeId: tabs.includes(s.activeId) ? s.activeId : tabs[0] }
    }),
  importCase: (c) => {
    const m = migrateCase({ ...c, id: crypto.randomUUID() })
    set((s) => ({ cases: { ...s.cases, [m.id]: m }, order: [m.id, ...s.order], tabs: [...s.tabs, m.id], activeId: m.id }))
  },
}))

export function undo() {
  const s = useCases.getState()
  const p = past.get(s.activeId)
  const cur = s.cases[s.activeId]
  if (!p?.length || !cur) return toast('Nothing to undo', 'info')
  const prev = p.pop()!
  ;(future.get(s.activeId) ?? future.set(s.activeId, []).get(s.activeId)!).push(cur)
  lastPush.set(s.activeId, 0)
  useCases.setState({ cases: { ...s.cases, [s.activeId]: prev } })
}

export function redo() {
  const s = useCases.getState()
  const f = future.get(s.activeId)
  const cur = s.cases[s.activeId]
  if (!f?.length || !cur) return toast('Nothing to redo', 'info')
  const next = f.pop()!
  ;(past.get(s.activeId) ?? past.set(s.activeId, []).get(s.activeId)!).push(cur)
  lastPush.set(s.activeId, 0)
  useCases.setState({ cases: { ...s.cases, [s.activeId]: next } })
}

export const activeCase = () => {
  const s = useCases.getState()
  return s.cases[s.activeId]
}

export async function hydrateCases() {
  type Saved = Pick<CaseStore, 'cases' | 'order' | 'tabs' | 'activeId'>
  let saved = (await idbGet<Saved>(DB_KEY).catch(() => undefined)) ?? null
  if (!saved) {
    // Migrate from v1 (localStorage).
    try {
      const raw = localStorage.getItem('chaingraph.v1')
      if (raw) {
        const v1 = JSON.parse(raw) as { cases: Case[]; activeId: string }
        const cases = Object.fromEntries(v1.cases.map((c) => [c.id, migrateCase(c)]))
        saved = { cases, order: v1.cases.map((c) => c.id), tabs: [v1.activeId], activeId: v1.activeId }
      }
    } catch {
      /* ignore */
    }
  }
  if (saved && Object.keys(saved.cases).length) {
    const cases = Object.fromEntries(Object.entries(saved.cases).map(([k, c]) => [k, migrateCase(c)]))
    const order = saved.order.filter((id) => cases[id])
    const tabs = saved.tabs.filter((id) => cases[id])
    const activeId = cases[saved.activeId] ? saved.activeId : order[0]
    useCases.setState({ hydrated: true, cases, order, tabs: tabs.length ? tabs : [activeId], activeId })
  } else {
    const c = newCase('First case')
    useCases.setState({ hydrated: true, cases: { [c.id]: c }, order: [c.id], tabs: [c.id], activeId: c.id })
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  useCases.subscribe((s) => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      const { cases, order, tabs, activeId } = s
      idbSet(DB_KEY, { cases, order, tabs, activeId }).catch(() => toast('Could not save to browser storage'))
    }, 500)
  })
}

// ---------- UI state (not persisted) ----------

export interface Toast {
  id: number
  text: string
  kind: 'error' | 'info' | 'success'
}

export type LeftPane = 'files' | 'search' | 'starred' | 'tags'
export type RightPane = 'inspector' | 'insights' | 'overview' | 'paths' | 'watch'
export type OsintTab = 'phone' | 'username' | 'email' | 'geo' | 'image' | 'domain' | 'ip' | 'dork' | 'directory'
export type Modal = null | 'settings' | 'palette' | 'switcher' | 'help' | 'bulk'

interface UIStore {
  selected: string | null
  selectedEdge: string | null
  pathFrom: string | null
  path: PathResult | null
  loading: Set<string>
  toasts: Toast[]
  timeRange: [number, number] | null
  localGraph: boolean
  localDepth: number
  leftPane: LeftPane
  rightPane: RightPane
  leftOpen: boolean
  rightOpen: boolean
  timelineOpen: boolean
  graphControlsOpen: boolean
  modal: Modal
  settingsTab: string
  trace: { running: boolean; step: string; cancel?: boolean } | null
  assetFilter: string
  showHidden: boolean
  spotlight: { nodes: string[]; edges: string[]; id: string } | null
  linkFrom: string | null
  view: 'graph' | 'osint'
  osintTab: OsintTab
  osintSeed: string
  set: (p: Partial<UIStore>) => void
}

export const useUI = create<UIStore>()((set) => ({
  selected: null,
  selectedEdge: null,
  pathFrom: null,
  path: null,
  loading: new Set(),
  toasts: [],
  timeRange: null,
  localGraph: false,
  localDepth: 1,
  leftPane: 'files',
  rightPane: 'overview',
  leftOpen: true,
  rightOpen: true,
  timelineOpen: false,
  graphControlsOpen: false,
  modal: null,
  settingsTab: 'appearance',
  trace: null,
  assetFilter: 'all',
  showHidden: false,
  spotlight: null,
  linkFrom: null,
  view: 'graph',
  osintTab: 'phone',
  osintSeed: '',
  set: (p) => set(p),
}))

export function toast(text: string, kind: Toast['kind'] = 'error') {
  const id = Date.now() + Math.random()
  useUI.setState((s) => ({ toasts: [...s.toasts, { id, text, kind }] }))
  setTimeout(() => useUI.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 5000)
}

export function select(id: string | null) {
  useUI.setState({ selected: id, selectedEdge: null, ...(id ? { rightPane: 'inspector' as RightPane } : {}) })
}
