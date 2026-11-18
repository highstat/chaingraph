// Graph analytics: clustering, risk scoring, exposure, pathfinding, local graph,
// color-group queries. All pure functions over the case model.

import { attribute, type Attribution } from './entities'
import { isSpamAsset } from './model'
import type { ColorGroup } from './settings'
import type { Case, CaseEdge, CaseNode, Category, LabelEntry } from './types'

// ---------- clustering (common-input ownership) ----------

export interface Clusters {
  of: Map<string, string> // node id -> cluster id (only clusters of size > 1)
  members: Map<string, string[]>
}

export function computeClusters(coSpends: string[][]): Clusters {
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!
    // path compression
    let y = x
    while (parent.get(y) && parent.get(y) !== r) {
      const n = parent.get(y)!
      parent.set(y, r)
      y = n
    }
    return r
  }
  for (const g of coSpends) {
    for (const a of g) if (!parent.has(a)) parent.set(a, a)
    for (let i = 1; i < g.length; i++) {
      const ra = find(g[0])
      const rb = find(g[i])
      if (ra !== rb) parent.set(rb, ra)
    }
  }
  const members = new Map<string, string[]>()
  for (const a of parent.keys()) {
    const r = find(a)
    const list = members.get(r)
    if (list) list.push(a)
    else members.set(r, [a])
  }
  const of = new Map<string, string>()
  for (const [r, list] of members) {
    if (list.length < 2) {
      members.delete(r)
      continue
    }
    for (const a of list) of.set(a, r)
  }
  return { of, members }
}

// ---------- risk & exposure ----------

export interface RiskResult {
  score: number
  level: 'low' | 'medium' | 'high' | 'severe'
  reasons: { points: number; text: string }[]
  exposure: { in: Partial<Record<Category, number>>; out: Partial<Record<Category, number>> } // share 0..1
  measure: 'usd' | 'transfers'
}

export function level(score: number): RiskResult['level'] {
  return score >= 80 ? 'severe' : score >= 55 ? 'high' : score >= 25 ? 'medium' : 'low'
}

export const LEVEL_COLOR: Record<RiskResult['level'], string> = {
  low: '#4ade80',
  medium: '#fbbf24',
  high: '#fb923c',
  severe: '#f43f5e',
}

export function computeAttributions(c: Case, lib: Map<string, LabelEntry>): Map<string, Attribution> {
  const m = new Map<string, Attribution>()
  for (const n of Object.values(c.nodes)) m.set(n.id, attribute(n, lib))
  return m
}

/**
 * Transparent risk model (TRM-style "glass box"): each contribution is listed.
 * score = max(own risk, direct exposure, ½ · indirect exposure)
 */
export function computeRisk(
  c: Case,
  edges: CaseEdge[],
  attr: Map<string, Attribution>,
  weights: Record<Category, number>,
  flagged: Set<string>,
  coinjoinNodes: Set<string>,
  extra: Map<string, { points: number; text: string }[]> = new Map(),
): Map<string, RiskResult> {
  const own = new Map<string, { score: number; reasons: { points: number; text: string }[] }>()
  for (const n of Object.values(c.nodes)) {
    const reasons: { points: number; text: string }[] = []
    const a = attr.get(n.id)!
    const w = weights[a.category] ?? 0
    if (w > 0) reasons.push({ points: w, text: `Attributed as ${a.category}${a.label ? ` (${a.label})` : ''} via ${a.source}` })
    if (n.tags.includes('suspect')) reasons.push({ points: 80, text: 'Tagged as suspect by investigator' })
    if (n.info?.isScam) reasons.push({ points: 90, text: 'Explorer flags this address as scam' })
    if (flagged.has(n.id)) reasons.push({ points: 35, text: 'Lookalike of another address in this case (possible address poisoning)' })
    if (coinjoinNodes.has(n.id)) reasons.push({ points: 40, text: 'Participated in CoinJoin transactions' })
    const seen = new Set(reasons.map((r) => r.text))
    for (const r of extra.get(n.id) ?? []) if (!seen.has(r.text)) (seen.add(r.text), reasons.push(r))
    own.set(n.id, { score: Math.max(0, ...reasons.map((r) => r.points)), reasons })
  }

  // Volume per node per counterparty category. USD when priced, otherwise transfer counts.
  const anyUsd = edges.some((e) => e.usd != null)
  const measure: RiskResult['measure'] = anyUsd ? 'usd' : 'transfers'
  const val = (e: CaseEdge) => (anyUsd ? (e.usd ?? 0) : e.count)
  const byNode = new Map<string, { in: Map<string, number>; out: Map<string, number>; spam: number }>()
  const slot = (id: string) => {
    let s = byNode.get(id)
    if (!s) byNode.set(id, (s = { in: new Map(), out: new Map(), spam: 0 }))
    return s
  }
  for (const e of edges) {
    if (e.virtual) continue
    if (isSpamAsset(e.asset)) {
      slot(e.source).spam++
      slot(e.target).spam++
      continue
    }
    const v = val(e)
    if (!v) continue
    const so = slot(e.source).out
    so.set(e.target, (so.get(e.target) ?? 0) + v)
    const ti = slot(e.target).in
    ti.set(e.source, (ti.get(e.source) ?? 0) + v)
  }

  const out = new Map<string, RiskResult>()
  for (const n of Object.values(c.nodes)) {
    const o = own.get(n.id)!
    const reasons = [...o.reasons]
    const s = byNode.get(n.id)
    const exposure: RiskResult['exposure'] = { in: {}, out: {} }
    let direct = 0
    let indirect = 0
    if (s) {
      if (s.spam > 0) reasons.push({ points: 15, text: `Received or sent ${s.spam} spam/fake token flow(s)` })
      for (const dir of ['in', 'out'] as const) {
        const m = s[dir]
        const total = [...m.values()].reduce((a, b) => a + b, 0)
        if (!total) continue
        for (const [cp, v] of m) {
          const cat = attr.get(cp)?.category ?? 'unknown'
          const share = v / total
          exposure[dir][cat] = (exposure[dir][cat] ?? 0) + share
          indirect += share * (own.get(cp)?.score ?? 0) * 0.5
        }
        for (const [cat, share] of Object.entries(exposure[dir]) as [Category, number][]) {
          const pts = share * (weights[cat] ?? 0)
          if (pts >= 5 && cat !== 'unknown') {
            reasons.push({ points: Math.round(pts), text: `${Math.round(share * 100)}% of ${dir === 'in' ? 'inflow' : 'outflow'} ${dir === 'in' ? 'from' : 'to'} ${cat} (direct)` })
          }
          direct = Math.max(direct, pts)
        }
      }
      indirect = Math.min(indirect, 100)
      if (indirect >= 10) reasons.push({ points: Math.round(indirect * 0.5), text: 'Counterparties carry risk (indirect exposure, 1 hop)' })
    }
    const score = Math.round(Math.min(100, Math.max(o.score, direct, indirect * 0.5)))
    reasons.sort((a, b) => b.points - a.points)
    out.set(n.id, { score, level: level(score), reasons, exposure, measure })
  }
  return out
}

// ---------- pathfinding ----------

type Adj = Map<string, { to: string; edge: string }[]>

function adjacency(edges: CaseEdge[], directed: boolean): Adj {
  const adj: Adj = new Map()
  const add = (a: string, b: string, e: string) => {
    const l = adj.get(a)
    if (l) l.push({ to: b, edge: e })
    else adj.set(a, [{ to: b, edge: e }])
  }
  for (const e of edges) {
    add(e.source, e.target, e.id)
    if (!directed) add(e.target, e.source, e.id)
  }
  return adj
}

export interface PathResult {
  from: string
  to: string
  directed: boolean
  paths: { nodes: string[]; edges: string[] }[]
}

/** All shortest paths (up to `k`) from → to. Falls back to undirected if no directed path. */
export function findPaths(edges: CaseEdge[], from: string, to: string, k = 5, maxDepth = 10): PathResult {
  for (const directed of [true, false]) {
    const adj = adjacency(edges, directed)
    const dist = new Map<string, number>([[from, 0]])
    const preds = new Map<string, { from: string; edge: string }[]>()
    const queue = [from]
    while (queue.length) {
      const u = queue.shift()!
      const d = dist.get(u)!
      if (d >= maxDepth) continue
      if (dist.has(to) && d >= dist.get(to)!) break
      for (const { to: v, edge } of adj.get(u) ?? []) {
        if (!dist.has(v)) {
          dist.set(v, d + 1)
          queue.push(v)
        }
        if (dist.get(v) === d + 1) {
          const p = preds.get(v)
          if (p) p.push({ from: u, edge })
          else preds.set(v, [{ from: u, edge }])
        }
      }
    }
    if (!dist.has(to)) continue
    const paths: PathResult['paths'] = []
    const walk = (v: string, nodes: string[], es: string[]) => {
      if (paths.length >= k) return
      if (v === from) {
        paths.push({ nodes: [from, ...nodes], edges: es })
        return
      }
      for (const p of preds.get(v) ?? []) walk(p.from, [v, ...nodes], [p.edge, ...es])
    }
    walk(to, [], [])
    return { from, to, directed, paths }
  }
  return { from, to, directed: false, paths: [] }
}

/** Obsidian local graph: nodes within `depth` hops of `center`. */
export function localNeighborhood(edges: CaseEdge[], center: string, depth: number): Set<string> {
  const adj = adjacency(edges, false)
  const seen = new Set([center])
  let frontier = [center]
  for (let i = 0; i < depth; i++) {
    const next: string[] = []
    for (const u of frontier) for (const { to } of adj.get(u) ?? []) if (!seen.has(to)) (seen.add(to), next.push(to))
    frontier = next
  }
  return seen
}

// ---------- color groups ----------

/**
 * Obsidian-style group queries:
 *   tag:suspect  chain:btc  cat:exchange  risk>70  risk<20  starred  expanded  free text
 */
export function matchGroup(q: string, n: CaseNode, a: Attribution | undefined, risk: number | undefined): boolean {
  const query = q.trim().toLowerCase()
  if (!query) return false
  return query.split(/\s+/).every((term) => {
    const neg = term.startsWith('-')
    const t = neg ? term.slice(1) : term
    let ok: boolean
    const m = t.match(/^(tag|chain|cat|risk)([:<>])(.+)$/)
    if (m) {
      const [, key, op, v] = m
      if (key === 'tag') ok = n.tags.some((x) => x.includes(v))
      else if (key === 'chain') ok = n.chain === v
      else if (key === 'cat') ok = a?.category === v
      else ok = risk != null && (op === '>' ? risk > Number(v) : op === '<' ? risk < Number(v) : risk === Number(v))
    } else if (t === 'starred') ok = !!n.starred
    else if (t === 'expanded') ok = n.expanded
    else if (t === 'watched') ok = !!n.watch
    else ok = [n.address, n.alias, n.info?.name, n.note, ...(n.info?.apiTags ?? [])].some((s) => s?.toLowerCase().includes(t))
    return neg ? !ok : ok
  })
}

export function groupColor(groups: ColorGroup[], n: CaseNode, a: Attribution | undefined, risk: number | undefined): string | undefined {
  for (const g of groups) if (matchGroup(g.query, n, a, risk)) return g.color
  return undefined
}

// ---------- behavioral fingerprint ----------

export interface ActivityProfile {
  grid: number[][] // [weekday 0=Mon][hour UTC]
  total: number
  sleepStartUtc: number | null // first hour of the quietest 6-hour window
  utcOffset: number | null // inferred, assuming the owner sleeps ~01:00–07:00 local
  confidence: 'none' | 'low' | 'medium' | 'high'
  botLike: boolean
  peakHourUtc: number
}

/**
 * Time-of-day fingerprint from outgoing transactions (sent by the owner, unlike
 * incoming ones). The quietest 6-hour window is assumed to be night-time, which
 * gives a rough time-zone estimate. Bots and services show no quiet window.
 */
export function activityProfile(times: number[]): ActivityProfile {
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0))
  const hours = new Array(24).fill(0)
  for (const t of times) {
    const d = new Date(t)
    grid[(d.getUTCDay() + 6) % 7][d.getUTCHours()]++
    hours[d.getUTCHours()]++
  }
  const total = times.length
  const peakHourUtc = hours.indexOf(Math.max(...hours))
  if (total < 8) return { grid, total, sleepStartUtc: null, utcOffset: null, confidence: 'none', botLike: false, peakHourUtc }
  let best = 0
  let bestSum = Infinity
  for (let h = 0; h < 24; h++) {
    let sum = 0
    for (let k = 0; k < 6; k++) sum += hours[(h + k) % 24]
    if (sum < bestSum) (bestSum = sum), (best = h)
  }
  const expected = (total * 6) / 24
  const ratio = bestSum / expected
  const botLike = ratio > 0.6
  let offset = (1 - best + 24) % 24
  if (offset > 12) offset -= 24
  const confidence = botLike ? 'none' : total >= 60 && ratio < 0.15 ? 'high' : total >= 25 && ratio < 0.3 ? 'medium' : 'low'
  return { grid, total, sleepStartUtc: botLike ? null : best, utcOffset: botLike ? null : offset, confidence, botLike, peakHourUtc }
}
