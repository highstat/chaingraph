// One hook that turns the raw case + settings + UI filters into everything the
// views need. Heavy computations are memoized per input.

import { createContext, useContext, useMemo } from 'react'
import { computeAttributions, computeClusters, computeRisk, groupColor, localNeighborhood } from './analysis'
import { CHAINS } from './chains'
import { CATEGORY_META, libraryIndex, type Attribution } from './entities'
import { allTransfers, buildEdges, findLookalikes, isSpamAsset } from './model'
import { useSettings } from './settings'
import { useCases, useUI } from './store'
import { LEVEL_COLOR, type RiskResult } from './analysis'
import { analyzeObfuscation, findingRisk, type Finding } from './obfuscation'
import { TAGS, type CaseEdge, type CaseNode } from './types'

export function useDerived() {
  const c = useCases((s) => s.cases[s.activeId])
  const s = useSettings()
  const ui = useUI()

  const transfers = useMemo(() => (c ? allTransfers(c) : []), [c?.transfers, c?.nodes])
  const edgesAll = useMemo(() => (c ? buildEdges(c, transfers) : []), [c, transfers])
  const edgesInRange = useMemo(() => (c && ui.timeRange ? buildEdges(c, transfers, ui.timeRange) : edgesAll), [c, transfers, ui.timeRange, edgesAll])
  const lib = useMemo(() => libraryIndex(s.labels), [s.labels])
  const attr = useMemo(() => (c ? computeAttributions(c, lib) : new Map<string, Attribution>()), [c?.nodes, lib])
  const lookalikes = useMemo(() => (c && s.poisoning ? findLookalikes(c) : []), [c?.nodes, s.poisoning])
  const flagged = useMemo(() => new Set(lookalikes.flat()), [lookalikes])
  const clusters = useMemo(
    () =>
      computeClusters([
        ...(s.btcCluster && c ? c.coSpends : []),
        ...(c?.links ?? []).filter((l) => l.kind === 'same-owner').map((l) => [l.a, l.b]),
      ]),
    [c?.coSpends, c?.links, s.btcCluster],
  )
  const coinjoinNodes = useMemo(() => {
    const set = new Set<string>()
    for (const t of transfers) if (t.coinjoin) set.add(`${t.chain}:${t.from}`).add(`${t.chain}:${t.to}`)
    return set
  }, [transfers])
  const findings = useMemo(
    () => (c ? analyzeObfuscation({ c, transfers, edges: edgesAll, attr, lookalikes }) : ([] as Finding[])),
    [c, transfers, edgesAll, attr, lookalikes],
  )
  const dismissed = useMemo(() => new Set(c?.dismissed ?? []), [c?.dismissed])
  const extraRisk = useMemo(() => findingRisk(findings, dismissed), [findings, dismissed])
  const risk = useMemo(
    () => (c ? computeRisk(c, edgesAll, attr, s.riskWeights, flagged, coinjoinNodes, extraRisk) : new Map<string, RiskResult>()),
    [c, edgesAll, attr, s.riskWeights, flagged, coinjoinNodes, extraRisk],
  )
  // Investigator links rendered as dashed virtual edges.
  const linkEdges = useMemo<CaseEdge[]>(
    () =>
      (c?.links ?? [])
        .filter((l) => c!.nodes[l.a] && c!.nodes[l.b])
        .map((l) => ({ id: `link:${l.id}`, source: l.a, target: l.b, asset: l.kind, amount: 0, count: 0, first: 0, last: 0, txs: [], change: false, order: 0, virtual: true, linkKind: l.kind })),
    [c?.links, c?.nodes],
  )
  const assets = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of edgesAll) if (!s.hideSpam || !isSpamAsset(e.asset)) m.set(e.asset, (m.get(e.asset) ?? 0) + e.count)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a)
  }, [edgesAll, s.hideSpam])

  const { vNodes, vEdges } = useMemo(() => {
    if (!c) return { vNodes: [] as CaseNode[], vEdges: [] as typeof edgesAll }
    let edges = edgesInRange.filter(
      (e) =>
        (ui.assetFilter === 'all' || e.asset === ui.assetFilter) &&
        e.amount >= s.minAmount &&
        (!s.minUsd || (e.usd ?? 0) >= s.minUsd) &&
        (!s.hideSpam || !isSpamAsset(e.asset)) &&
        (!s.hideChange || !e.change),
    )
    const hidden = (id: string) => !ui.showHidden && c.nodes[id]?.hidden
    edges = edges.filter((e) => !hidden(e.source) && !hidden(e.target))
    const keep = (n: CaseNode) => !hidden(n.id) && (n.expanded || n.tags.length > 0 || !!n.alias || !!n.starred || n.id === ui.selected)
    if (s.hideOrphans) {
      const deg = new Map<string, number>()
      for (const e of edges) deg.set(e.source, (deg.get(e.source) ?? 0) + 1).set(e.target, (deg.get(e.target) ?? 0) + 1)
      edges = edges.filter((e) => (keep(c.nodes[e.source]) || deg.get(e.source)! > 1) && (keep(c.nodes[e.target]) || deg.get(e.target)! > 1))
    }
    if (ui.localGraph && ui.selected) {
      const near = localNeighborhood(edges, ui.selected, ui.localDepth)
      edges = edges.filter((e) => near.has(e.source) && near.has(e.target))
      const ids = new Set<string>([ui.selected])
      for (const e of edges) ids.add(e.source).add(e.target)
      return { vNodes: Object.values(c.nodes).filter((n) => ids.has(n.id)), vEdges: edges }
    }
    const ids = new Set<string>()
    for (const e of edges) ids.add(e.source).add(e.target)
    const nodes = Object.values(c.nodes).filter((n) => ids.has(n.id) || keep(n))
    const shown = new Set(nodes.map((n) => n.id))
    return { vNodes: nodes, vEdges: [...edges, ...linkEdges.filter((e) => shown.has(e.source) && shown.has(e.target))] }
  }, [c, edgesInRange, linkEdges, ui.assetFilter, ui.selected, ui.localGraph, ui.localDepth, ui.showHidden, s.minAmount, s.minUsd, s.hideSpam, s.hideChange, s.hideOrphans])

  /** Fill color per node: groups first, then the chosen color mode. */
  const colors = useMemo(() => {
    const m = new Map<string, string>()
    if (!c) return m
    for (const n of vNodes) {
      const a = attr.get(n.id)
      const r = risk.get(n.id)
      const g = groupColor(s.groups, n, a, r?.score)
      let col = g
      if (!col && n.tags.length) col = TAGS[n.tags[0]].color
      if (!col) {
        if (s.colorBy === 'category') col = CATEGORY_META[a?.category ?? 'unknown'].color
        else if (s.colorBy === 'risk') col = LEVEL_COLOR[r?.level ?? 'low']
        else col = CHAINS[n.chain].color
      }
      m.set(n.id, col ?? '#888')
    }
    return m
  }, [c, vNodes, attr, risk, s.groups, s.colorBy])

  const activeFindings = useMemo(() => findings.filter((f) => f.title && !dismissed.has(f.id)), [findings, dismissed])

  return { c, transfers, edgesAll, edgesInRange, vNodes, vEdges, attr, risk, lookalikes, flagged, clusters, coinjoinNodes, assets, colors, lib, findings: activeFindings, allFindings: findings.filter((f) => f.title) }
}

export type Derived = ReturnType<typeof useDerived>

/** Computed once in <App/> and shared, so memoized work is not repeated per component. */
export const DerivedContext = createContext<Derived | null>(null)
export const useD = () => useContext(DerivedContext)!
