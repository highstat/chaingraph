// Side-effecting operations (network + store). Kept outside React so async work
// always reads the latest state instead of a stale render closure.

import { computeAttributions, findPaths } from './analysis'
import { CHAINS, detectChain, detectPrivacy, detectTxHash, fetchAddress, firstFunder, lookupTx, normalize, resolveEns } from './chains'
import { setDefaultTimeout } from './chains/http'
import { libraryIndex } from './entities'
import { buildEdges, ensureNode, ingest, isSpamAsset, nodeId, patchNode, tKey } from './model'
import { useSettings } from './settings'
import { select, toast, useCases, useUI } from './store'
import type { Category, ChainId, ManualLink, Transfer } from './types'

function ctx() {
  const s = useSettings.getState()
  setDefaultTimeout(s.timeoutSec * 1000)
  return { etherscanKey: s.etherscanKey, utxo: { detectChange: s.btcChange, detectCoinjoin: s.btcCoinjoin } }
}

function setLoading(id: string, on: boolean) {
  useUI.setState((s) => {
    const l = new Set(s.loading)
    if (on) l.add(id)
    else l.delete(id)
    return { loading: l }
  })
}

/** Fetch the next page of history for a node. Returns number of new transfers. */
export async function expand(id: string, caseId = useCases.getState().activeId, quiet = false): Promise<number> {
  const c = useCases.getState().cases[caseId]
  const node = c?.nodes[id]
  if (!node || useUI.getState().loading.has(id) || node.address === 'coinbase') return 0
  if (node.expanded && !node.cursor) return 0
  setLoading(id, true)
  try {
    const res = await fetchAddress(node.chain, node.address, node.cursor, ctx())
    let fresh = 0
    useCases.getState().update(caseId, (x) => {
      const r = ingest(x, id, res)
      fresh = r.fresh.length
      return r.next
    })
    if (!quiet && !res.transfers.length && !node.expanded) toast('No transfers found', 'info')
    return fresh
  } catch (e) {
    toast((e as Error).message || 'Failed to load')
    return 0
  } finally {
    setLoading(id, false)
  }
}

/** Add an address, ENS name or transaction hash to the active case. */
export function investigate(raw: string) {
  const input = raw.trim()
  if (!input) return
  const s = useSettings.getState()
  const privacy = detectPrivacy(input)
  if (privacy) return toast(privacy, 'info')
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/i.test(input)) return void investigateEns(input)
  const chain = detectChain(input, s.defaultEvm)
  if (!chain) {
    const txChains = detectTxHash(input)
    if (txChains) return void addTransaction(input, txChains)
    return toast('Unrecognized format. Paste an address, a transaction hash or an ENS name.')
  }
  if (!CHAINS[chain].keyless && !s.etherscanKey) {
    toast(`${CHAINS[chain].name} needs a free Etherscan API key (Settings → Data sources)`)
  }
  const a = normalize(chain, input)
  const id = nodeId(chain, a)
  const st = useCases.getState()
  const exists = st.cases[st.activeId]?.nodes[id]
  st.update(st.activeId, (x) => ensureNode(x, chain, a))
  select(id)
  if (!exists?.expanded) void expand(id)
}

async function investigateEns(name: string) {
  try {
    const addr = await resolveEns(name)
    if (!addr) return toast(`Could not resolve ${name}`)
    toast(`${name} → ${addr}`, 'info')
    const st = useCases.getState()
    const id = nodeId('eth', addr.toLowerCase())
    st.update(st.activeId, (x) => ensureNode(x, 'eth', addr.toLowerCase()))
    st.update(st.activeId, (x) => (x.nodes[id].alias ? x : patchNode(x, id, { alias: name })))
    select(id)
    void expand(id)
  } catch (e) {
    toast((e as Error).message)
  }
}

/** Start from an incident transaction: add every party and the transfers between them. */
export async function addTransaction(hash: string, chains: ChainId[]) {
  toast('Looking up transaction…', 'info')
  const r = await lookupTx(hash, chains)
  if (!r || !r.transfers.length) return toast('Transaction not found on supported keyless networks')
  const caseId = useCases.getState().activeId
  addTransfers(caseId, r.chain, r.transfers)
  const first = r.transfers[0]
  select(nodeId(r.chain, first.from))
  toast(`Added ${r.transfers.length} transfer(s) from ${CHAINS[r.chain].name} transaction`, 'success')
}

/** Merge standalone transfers (tx lookup, funder) into the case without changing pagination. */
export function addTransfers(caseId: string, chain: ChainId, transfers: Transfer[]) {
  useCases.getState().update(caseId, (x) => {
    let next = x
    for (const t of transfers) {
      next = ensureNode(ensureNode(next, chain, t.from), chain, t.to)
      const id = nodeId(chain, t.from)
      const list = next.transfers[id] ?? []
      if (list.some((y) => tKey(y) === tKey(t))) continue
      next = { ...next, transfers: { ...next.transfers, [id]: [...list, t] } }
    }
    return next
  })
}

/** Investigate many addresses at once. Lines may be "address" or "address,label". */
export async function bulkInvestigate(text: string) {
  const s = useSettings.getState()
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const st = useCases.getState()
  const caseId = st.activeId
  const ids: string[] = []
  for (const line of lines) {
    const [addr, ...rest] = line.split(/[,;\t]/).map((x) => x.trim())
    const chain = detectChain(addr, s.defaultEvm)
    if (!chain) continue
    const a = normalize(chain, addr)
    const id = nodeId(chain, a)
    st.update(caseId, (x) => {
      const y = ensureNode(x, chain, a)
      return rest.length && rest[0] ? patchNode(y, id, { alias: rest.join(' ') }) : y
    })
    ids.push(id)
  }
  toast(`Added ${ids.length} of ${lines.length} line(s). Loading…`, 'info')
  for (const id of ids) await expand(id, caseId, true)
  toast(`Bulk import finished: ${ids.length} addresses`, 'success')
}

/** Look up who paid for the account's first gas / activation. */
export async function findFunder(id: string) {
  const st = useCases.getState()
  const c = st.cases[st.activeId]
  const n = c?.nodes[id]
  if (!n) return
  try {
    setLoading(id, true)
    const t = await firstFunder(n.chain, n.address)
    if (!t) return toast('No funding transfer found')
    addTransfers(c.id, n.chain, [t])
    st.update(c.id, (x) => patchNode(x, id, { funder: { address: t.from, time: t.time, amount: t.amount, asset: t.asset, hash: t.hash } }))
    toast(`First funder: ${t.from.slice(0, 10)}… (${t.amount} ${t.asset})`, 'success')
  } catch (e) {
    toast((e as Error).message)
  } finally {
    setLoading(id, false)
  }
}

/**
 * Follow a peel chain: from each address take the most recent outgoing
 * transaction and continue along its change output (or the largest output).
 */
export async function followPeelChain(start: string, hops = 8) {
  const caseId = useCases.getState().activeId
  useUI.setState({ trace: { running: true, step: 'Following peel chain…' } })
  const traced: string[] = []
  let cur = start
  try {
    for (let i = 0; i < hops; i++) {
      if (useUI.getState().trace?.cancel) break
      useUI.setState({ trace: { running: true, step: `Peel hop ${i + 1}/${hops}` } })
      const c0 = useCases.getState().cases[caseId]
      if (!c0.nodes[cur]?.expanded) await expand(cur, caseId, true)
      let c = useCases.getState().cases[caseId]
      const addr = c.nodes[cur].address
      let outs = (c.transfers[cur] ?? []).filter((t) => t.from === addr)
      // No spend in the loaded pages yet: page back a little further.
      for (let tries = 0; !outs.length && c.nodes[cur].cursor && tries < 3; tries++) {
        await expand(cur, caseId, true)
        c = useCases.getState().cases[caseId]
        outs = (c.transfers[cur] ?? []).filter((t) => t.from === addr)
      }
      if (!outs.length) {
        if (!traced.length) toast('No outgoing spend found in the loaded history of this address', 'info')
        break
      }
      const lastHash = outs.reduce((a, b) => (b.time > a.time ? b : a)).hash
      const txOuts = outs.filter((t) => t.hash === lastHash)
      const next = txOuts.find((t) => t.change) ?? txOuts.reduce((a, b) => (b.amount > a.amount ? b : a))
      const nextId = nodeId(c.nodes[cur].chain, next.to)
      traced.push(`${cur}>${nextId}|${next.asset}`)
      useCases.getState().update(caseId, (x) => ({ ...x, traced: [...new Set([...x.traced, ...traced])] }))
      if (nextId === cur) break
      cur = nextId
    }
    if (traced.length) toast(`Peel chain followed for ${traced.length} hop(s)`, 'success')
  } finally {
    useUI.setState({ trace: null })
  }
}

/** Expand the top-N counterparties of a node (one hop out). */
export async function expandNeighbors(id: string, n = 5) {
  const caseId = useCases.getState().activeId
  const c = useCases.getState().cases[caseId]
  const edges = buildEdges(c).filter((e) => (e.source === id || e.target === id) && !isSpamAsset(e.asset))
  const others = [...edges]
    .sort((a, b) => (b.usd ?? b.amount) - (a.usd ?? a.amount))
    .map((e) => (e.source === id ? e.target : e.source))
    .filter((x, i, arr) => arr.indexOf(x) === i && !c.nodes[x]?.expanded)
    .slice(0, n)
  for (const o of others) await expand(o, caseId, true)
  toast(`Expanded ${others.length} counterparties`, 'success')
}

/** Load the history of every mixer in the case so deposits and withdrawals can be matched. */
export async function expandMixers() {
  const st = useCases.getState()
  const c = st.cases[st.activeId]
  const lib = libraryIndex(useSettings.getState().labels)
  const attr = computeAttributions(c, lib)
  const mixers = Object.values(c.nodes).filter((n) => attr.get(n.id)?.category === 'mixer')
  if (!mixers.length) return toast('No mixers in this case yet', 'info')
  for (const m of mixers) {
    await expand(m.id, c.id, true)
    await expand(m.id, c.id, true) // two pages for a wider matching window
  }
  toast(`Loaded ${mixers.length} mixer(s) for deposit/withdrawal matching`, 'success')
}

export function addLink(a: string, b: string, kind: ManualLink['kind'], note?: string, confidence?: number) {
  const st = useCases.getState()
  st.update(st.activeId, (x) =>
    x.links.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a && l.kind === kind))
      ? x
      : { ...x, links: [...x.links, { id: crypto.randomUUID(), a, b, kind, note, confidence }] },
  )
}

export function removeLink(id: string) {
  const st = useCases.getState()
  st.update(st.activeId, (x) => ({ ...x, links: x.links.filter((l) => l.id !== id) }))
}

/** Mark a set of addresses as one owner (pairwise links to the first). */
export function applyCluster(ids: string[], note: string) {
  for (const id of ids.slice(1)) addLink(ids[0], id, 'same-owner', note)
  toast(`Linked ${ids.length} addresses as one owner`, 'success')
}

export function dismissFinding(id: string) {
  const st = useCases.getState()
  st.update(st.activeId, (x) => ({ ...x, dismissed: [...new Set([...x.dismissed, id])] }))
}

// ---------- auto-trace (follow the money) ----------

/**
 * Chronological follow-the-money, modeled on Reactor/Breadcrumbs pathfinding:
 * from `start`, repeatedly expand and follow the largest outflows that happened
 * after the funds arrived, until depth is exhausted or a stop category is hit.
 */
export async function autoTrace(start: string, direction: 'out' | 'in' = 'out') {
  const s = useSettings.getState()
  const caseId = useCases.getState().activeId
  useUI.setState({ trace: { running: true, step: 'Starting…' } })
  const traced = new Set<string>()
  const visited = new Set<string>([start])
  let frontier: { id: string; since: number; asset?: string }[] = [{ id: start, since: 0 }]
  const lib = libraryIndex(s.labels)
  const stop = new Set<Category>(s.traceStop)

  try {
    for (let hop = 1; hop <= s.traceDepth && frontier.length; hop++) {
      const next: { id: string; since: number; asset?: string }[] = []
      for (const f of frontier) {
        if (useUI.getState().trace?.cancel) throw new Error('cancelled')
        const c0 = useCases.getState().cases[caseId]
        const label = c0.nodes[f.id]?.alias || c0.nodes[f.id]?.address.slice(0, 10)
        useUI.setState({ trace: { running: true, step: `Hop ${hop}/${s.traceDepth}: ${label}` } })
        if (!c0.nodes[f.id]?.expanded) await expand(f.id, caseId, true)

        const c = useCases.getState().cases[caseId]
        const attr = computeAttributions(c, lib)
        // Candidate flows: right direction, not change outputs, not spam/fake tokens.
        const edges = buildEdges(c).filter(
          (e) => (direction === 'out' ? e.source === f.id : e.target === f.id) && !e.change && !isSpamAsset(e.asset),
        )
        // Chronological constraint: only flows after the funds arrived.
        const timely = s.traceChrono && direction === 'out' ? edges.filter((e) => e.last >= f.since) : edges
        // Rank in USD when prices exist; otherwise stay within the asset being followed
        // (nominal amounts of different tokens are not comparable).
        const priced = timely.filter((e) => e.usd != null)
        const pool = priced.length ? priced : timely.filter((e) => !f.asset || e.asset === f.asset)
        const value = (e: (typeof edges)[number]) => (priced.length ? e.usd! : e.amount)
        const total = pool.reduce((a, e) => a + value(e), 0)
        const picks = [...pool]
          .filter((e) => total && (value(e) / total) * 100 >= s.traceMinShare)
          .sort((a, b) => value(b) - value(a))
          .slice(0, s.traceBranches)
        for (const e of picks) {
          traced.add(e.id)
          const other = direction === 'out' ? e.target : e.source
          if (visited.has(other)) continue
          visited.add(other)
          const cat = attr.get(other)?.category
          if (cat && stop.has(cat)) continue // reached a service: stop this branch
          next.push({ id: other, since: e.first, asset: e.asset })
        }
        useCases.getState().update(caseId, (x) => ({ ...x, traced: [...new Set([...x.traced, ...traced])] }))
      }
      frontier = next
    }
    toast(`Trace finished: ${traced.size} flows followed across ${visited.size} addresses`, 'success')
  } catch (e) {
    if ((e as Error).message === 'cancelled') toast('Trace cancelled', 'info')
    else toast((e as Error).message)
  } finally {
    useUI.setState({ trace: null })
  }
}

export function clearTrace() {
  const st = useCases.getState()
  st.update(st.activeId, (x) => ({ ...x, traced: [] }))
  useUI.setState({ path: null, pathFrom: null })
}

export function runPathfinding(from: string, to: string) {
  const c = useCases.getState().cases[useCases.getState().activeId]
  const res = findPaths(buildEdges(c), from, to)
  useUI.setState({ path: res, pathFrom: null, rightPane: 'paths' })
  if (!res.paths.length) toast('No path between these addresses in the current graph', 'info')
}

// ---------- watchlist (alerts) ----------

export async function pollWatchlist() {
  const st = useCases.getState()
  const s = useSettings.getState()
  for (const c of Object.values(st.cases)) {
    for (const n of Object.values(c.nodes)) {
      if (!n.watch) continue
      try {
        const res = await fetchAddress(n.chain, n.address, undefined, ctx())
        let fresh = 0
        useCases.getState().update(c.id, (x) => {
          // Keep the existing cursor: polling only checks the newest page.
          const r = ingest(x, n.id, res)
          fresh = r.fresh.length
          return { ...r.next, nodes: { ...r.next.nodes, [n.id]: { ...r.next.nodes[n.id], cursor: x.nodes[n.id]?.cursor } } }
        })
        if (fresh > 0 && n.expanded) {
          const name = n.alias || n.info?.name || `${n.address.slice(0, 8)}…`
          const msg = `${name}: ${fresh} new transfer(s) in “${c.title}”`
          toast(msg, 'info')
          if (s.watchNotify && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('ChainGraph alert', { body: msg })
          }
        }
      } catch {
        /* transient errors are ignored during polling */
      }
    }
  }
}
