// Pure case-model operations. No React, no I/O.

import type { Case, CaseEdge, CaseNode, ChainId, FetchResult, Transfer } from './types'

export const nodeId = (chain: ChainId, address: string) => `${chain}:${address}`
const MAX_TX_PER_NODE = 5000
const MAX_COSPENDS = 3000

export function newCase(title = 'Untitled case'): Case {
  const now = Date.now()
  return { id: crypto.randomUUID(), title, created: now, updated: now, nodes: {}, transfers: {}, coSpends: [], prices: {}, traced: [], links: [], note: '', dismissed: [] }
}

/** Bring older saved cases up to the current shape. */
export function migrateCase(c: Partial<Case>): Case {
  return { ...newCase(), ...c, coSpends: c.coSpends ?? [], prices: c.prices ?? {}, traced: c.traced ?? [], links: c.links ?? [], note: c.note ?? '', dismissed: c.dismissed ?? [] } as Case
}

export function blankNode(chain: ChainId, address: string): CaseNode {
  return { id: nodeId(chain, address), chain, address, tags: [], note: '', expanded: false, loadedTx: 0 }
}

export function ensureNode(c: Case, chain: ChainId, address: string): Case {
  const id = nodeId(chain, address)
  if (c.nodes[id]) return c
  return { ...c, updated: Date.now(), nodes: { ...c.nodes, [id]: blankNode(chain, address) } }
}

export const tKey = (t: Transfer) => `${t.hash}|${t.from}|${t.to}|${t.asset}|${t.amount}`

/** Merge one page of fetched data for node `id`. Returns the case and new transfer count. */
export function ingest(c: Case, id: string, res: FetchResult): { next: Case; fresh: Transfer[] } {
  const self = c.nodes[id]
  if (!self) return { next: c, fresh: [] }
  const nodes = { ...c.nodes }
  const prev = c.transfers[id] ?? []
  const seen = new Set(prev.map(tKey))
  const fresh = res.transfers.filter((t) => !seen.has(tKey(t)))
  const merged = [...prev, ...fresh].slice(-MAX_TX_PER_NODE)

  for (const t of fresh) {
    for (const a of [t.from, t.to]) {
      const nid = nodeId(self.chain, a)
      if (!nodes[nid]) nodes[nid] = blankNode(self.chain, a)
    }
  }
  for (const [addr, label] of Object.entries(res.labels ?? {})) {
    const nid = nodeId(self.chain, addr)
    const n = nodes[nid]
    if (!n || n.info) continue
    if (!label.name && !label.apiTags?.length && !label.isScam && !label.isContract) continue
    nodes[nid] = { ...n, info: { apiTags: [], ...label } }
  }
  nodes[id] = { ...nodes[id], info: res.info ?? nodes[id].info, expanded: true, cursor: res.cursor, loadedTx: merged.length }

  let coSpends = c.coSpends
  if (res.coSpends?.length) {
    const keys = new Set(coSpends.map((g) => g.join(',')))
    const add = res.coSpends
      .map((g) => g.map((a) => nodeId(self.chain, a)).sort())
      .filter((g) => !keys.has(g.join(',')))
    coSpends = [...coSpends, ...add].slice(-MAX_COSPENDS)
  }
  return {
    next: {
      ...c,
      updated: Date.now(),
      nodes,
      transfers: { ...c.transfers, [id]: merged },
      coSpends,
      prices: { ...c.prices, ...(res.prices ?? {}) },
    },
    fresh,
  }
}

export function patchNode(c: Case, id: string, patch: Partial<CaseNode>): Case {
  if (!c.nodes[id]) return c
  return { ...c, updated: Date.now(), nodes: { ...c.nodes, [id]: { ...c.nodes[id], ...patch } } }
}

export function removeNode(c: Case, id: string): Case {
  const nodes = { ...c.nodes }
  const transfers = { ...c.transfers }
  delete nodes[id]
  delete transfers[id]
  const linked = new Set<string>()
  for (const e of buildEdges({ ...c, nodes, transfers })) linked.add(e.source).add(e.target)
  for (const n of Object.values(nodes)) {
    if (!n.expanded && !linked.has(n.id) && !n.tags.length && !n.note && !n.alias && !n.starred) delete nodes[n.id]
  }
  return { ...c, updated: Date.now(), nodes, transfers, traced: c.traced.filter((e) => !e.includes(id)) }
}

export type CTransfer = Transfer & { chain: ChainId }

export function allTransfers(c: Case): CTransfer[] {
  const seen = new Set<string>()
  const out: CTransfer[] = []
  for (const [id, list] of Object.entries(c.transfers)) {
    const chain = c.nodes[id]?.chain
    if (!chain) continue
    for (const t of list) {
      const k = chain + tKey(t)
      if (seen.has(k)) continue
      seen.add(k)
      out.push({ ...t, chain })
    }
  }
  return out
}

export function usdOf(c: Case, asset: string, amount: number): number | undefined {
  const p = c.prices[asset]
  return p ? p * amount : undefined
}

/** Aggregate transfers into one edge per (from, to, asset), optionally in a time window. */
export function buildEdges(c: Case, transfers = allTransfers(c), range?: [number, number] | null): CaseEdge[] {
  const map = new Map<string, CaseEdge>()
  for (const t of transfers) {
    if (range && (t.time < range[0] || t.time > range[1])) continue
    const s = nodeId(t.chain, t.from)
    const d = nodeId(t.chain, t.to)
    if (!c.nodes[s] || !c.nodes[d] || s === d) continue
    const id = `${s}>${d}|${t.asset}`
    const e = map.get(id)
    if (e) {
      e.amount += t.amount
      e.count++
      e.first = Math.min(e.first, t.time)
      e.last = Math.max(e.last, t.time)
      e.change = e.change && !!t.change
      if (e.txs.length < 300) e.txs.push(t.hash)
    } else {
      map.set(id, { id, source: s, target: d, asset: t.asset, amount: t.amount, count: 1, first: t.time, last: t.time, txs: [t.hash], change: !!t.change, order: 0 })
    }
  }
  const edges = [...map.values()]
  for (const e of edges) e.usd = usdOf(c, e.asset, e.amount)
  edges.sort((a, b) => a.first - b.first).forEach((e, i) => (e.order = i + 1))
  return edges
}

/**
 * Spam/phishing token heuristic: symbols with spaces, URLs, handles or
 * non-Latin characters ("US DT", "TG :@xyz", "Gas15 Com"), and fake stablecoins.
 */
export function isSpamAsset(symbol: string): boolean {
  if (symbol.endsWith('(fake)')) return true
  if (/[^\x21-\x7E]/.test(symbol)) return true
  return /[:@/|]|\.(com|net|org|io|xyz|bet|to|me|app)\b|https?|www|t\.me|telegram|claim|reward|airdrop|visit/i.test(symbol)
}

/**
 * Address-poisoning detector: different addresses on one chain whose first and
 * last 4 characters match. Scammers generate such lookalikes on purpose.
 */
export function findLookalikes(c: Case): [string, string][] {
  const groups = new Map<string, CaseNode[]>()
  for (const n of Object.values(c.nodes)) {
    const k = n.address.replace(/^(0x|bc1q|bc1p|bc1|ltc1q|ltc1|T)/i, '')
    if (k.length < 12) continue
    const key = `${n.chain}|${k.slice(0, 4).toLowerCase()}|${k.slice(-4).toLowerCase()}`
    const g = groups.get(key)
    if (g) g.push(n)
    else groups.set(key, [n])
  }
  const out: [string, string][] = []
  for (const g of groups.values()) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) out.push([g[i].id, g[j].id])
  return out
}
