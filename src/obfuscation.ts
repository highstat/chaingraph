// Obfuscation & laundering-pattern detection. Each detector reads the loaded
// case and returns findings with evidence (nodes, edges), a confidence where it
// applies, and optional actions (accept a probable link, apply a cluster).
//
// These are investigative leads, not proof. Thresholds follow common practice
// in chain-analysis literature and vendor typologies (see docs/RESEARCH.md).

import type { Attribution } from './entities'
import { KNOWN } from './entities'
import { isSpamAsset, type CTransfer } from './model'
import type { Case, CaseEdge, Category, ChainId } from './types'

export type FindingKind =
  | 'mixer'
  | 'demix'
  | 'coinjoin'
  | 'peel'
  | 'fanout'
  | 'fanin'
  | 'structuring'
  | 'passthrough'
  | 'cycle'
  | 'chainhop'
  | 'crosschain-address'
  | 'swap'
  | 'instant'
  | 'dusting'
  | 'poisoning'
  | 'fake-token'
  | 'deposit-cluster'
  | 'common-funder'

export type Severity = 'info' | 'low' | 'medium' | 'high'

export interface Finding {
  id: string
  kind: FindingKind
  severity: Severity
  title: string
  detail: string
  nodes: string[]
  edges: string[]
  confidence?: number
  link?: { a: string; b: string; kind: 'demix' | 'chain-hop' | 'same-owner' }
  cluster?: string[]
  risk?: { node: string; points: number; text: string }[]
}

export const KIND_META: Record<FindingKind, { label: string; technique: string }> = {
  mixer: { label: 'Mixer interaction', technique: 'Custodial mixers and smart-contract pools (Tornado Cash, Railgun, Sinbad…) pool deposits from many users and pay out to fresh addresses, breaking the direct link.' },
  demix: { label: 'Mixer deposit ↔ withdrawal match', technique: 'Demixing heuristics: same address deposits and withdraws, matching denomination/amount minus fee, short time gap, unique amount in the window, shared counterparties after withdrawal.' },
  coinjoin: { label: 'CoinJoin', technique: 'Several users merge inputs into one transaction with equal-value outputs (Wasabi, Whirlpool, JoinMarket), breaking common-input ownership.' },
  peel: { label: 'Peel chain', technique: 'A large balance is repeatedly split into a small payment and a large change output sent to a new address. Follow the change to stay on the funds.' },
  fanout: { label: 'Fan-out distribution', technique: 'Smurfing/layering: one address splits funds across many fresh addresses in a short window, often in similar amounts.' },
  fanin: { label: 'Fan-in aggregation', technique: 'Many addresses consolidate into one, typical after smurfing or when a service sweeps deposits.' },
  structuring: { label: 'Structuring', technique: 'Repeated transfers just below reporting thresholds (e.g. $10,000 or $3,000 travel-rule limits) to avoid scrutiny.' },
  passthrough: { label: 'Pass-through wallet', technique: 'Transit address that forwards almost everything it receives within hours. Used to add hops (layering).' },
  cycle: { label: 'Round-tripping', technique: 'Funds leave and return to the origin through intermediaries, creating fake volume or confusing tracers.' },
  chainhop: { label: 'Chain hopping', technique: 'Value bridged to another blockchain to break single-chain tracing. Matched by amount (USD) and time across bridge contracts.' },
  'crosschain-address': { label: 'Same address on several chains', technique: 'An EVM key controls the same address on every EVM chain, so activity across chains belongs to one owner.' },
  swap: { label: 'Asset swap', technique: 'Converting to another token through a DEX/aggregator to change the asset being tracked.' },
  instant: { label: 'Instant exchanger', technique: 'Low- or no-KYC swap services used to convert and cash out quickly, often across chains.' },
  dusting: { label: 'Dusting', technique: 'Tiny amounts sent to many addresses to track spending (UTXO) or to plant lookalike history (account chains).' },
  poisoning: { label: 'Address poisoning', technique: 'A lookalike address (same first/last characters) seeds the victim history so the victim copies it by mistake.' },
  'fake-token': { label: 'Fake / spam tokens', technique: 'Tokens impersonating USDT/TRX or carrying URLs in the name: phishing lures and history pollution.' },
  'deposit-cluster': { label: 'Shared exchange deposit address', technique: 'Exchange deposit addresses are unique per customer: different addresses sending to the same deposit address likely belong to one person.' },
  'common-funder': { label: 'Common funder', technique: 'Addresses whose first gas/activation came from the same funder are often controlled by the same operator.' },
}

export const SEVERITY_COLOR: Record<Severity, string> = { info: '#60a5fa', low: '#a3e635', medium: '#fbbf24', high: '#f43f5e' }

const SERVICES = new Set<Category>(['exchange', 'defi', 'bridge', 'service', 'instant'])
const HOUR = 3600000
const DAY = 24 * HOUR

interface Ctx {
  c: Case
  transfers: CTransfer[]
  edges: CaseEdge[]
  attr: Map<string, Attribution>
  lookalikes: [string, string][]
}

const sid = (t: CTransfer) => `${t.chain}:${t.from}`
const did = (t: CTransfer) => `${t.chain}:${t.to}`
const eid = (t: CTransfer) => `${sid(t)}>${did(t)}|${t.asset}`

export function analyzeObfuscation(ctx: Ctx): Finding[] {
  const { c, attr } = ctx
  const live = ctx.transfers.filter((t) => !isSpamAsset(t.asset) && c.nodes[sid(t)] && c.nodes[did(t)])
  const usd = (t: { asset: string; amount: number }) => (c.prices[t.asset] ? c.prices[t.asset] * t.amount : undefined)
  const cat = (id: string) => attr.get(id)?.category ?? 'unknown'
  const name = (id: string) => {
    const n = c.nodes[id]
    if (!n) return id.slice(id.indexOf(':') + 1, id.indexOf(':') + 9) + '…'
    return n.alias || n.info?.name || attr.get(id)?.label || `${n.address.slice(0, 6)}…${n.address.slice(-4)}`
  }
  const fmt = (n: number) => (n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : n.toPrecision(3).replace(/\.?0+$/, ''))
  const out: Finding[] = []
  const byNodeOut = new Map<string, CTransfer[]>()
  const byNodeIn = new Map<string, CTransfer[]>()
  for (const t of live) {
    ;(byNodeOut.get(sid(t)) ?? byNodeOut.set(sid(t), []).get(sid(t))!).push(t)
    ;(byNodeIn.get(did(t)) ?? byNodeIn.set(did(t), []).get(did(t))!).push(t)
  }
  const neighbors = (id: string) => new Set([...(byNodeOut.get(id) ?? []).map(did), ...(byNodeIn.get(id) ?? []).map(sid)])

  // 1. Mixer interaction. Mixer contracts that transact with each other
  //    (e.g. Tornado Router → pool) are treated as one mixing entity.
  // Sanctioned mixers (e.g. OFAC-listed Tornado pools) are still mixers functionally.
  const MIXER_RE = /tornado|mixer|blender|sinbad|railgun|chipmixer|wasabi|whirlpool|samourai|cryptomixer|yomix|privacy ?pool/i
  const isMixer = (id: string) => cat(id) === 'mixer' || (cat(id) === 'sanctioned' && MIXER_RE.test(name(id)))
  const mixerIds = Object.keys(c.nodes).filter(isMixer)
  const parent = new Map(mixerIds.map((id) => [id, id]))
  const root = (x: string): string => (parent.get(x) === x ? x : root(parent.get(x)!))
  for (const t of live) if (parent.has(sid(t)) && parent.has(did(t))) parent.set(root(did(t)), root(sid(t)))
  const groups = new Map<string, string[]>()
  for (const id of mixerIds) (groups.get(root(id)) ?? groups.set(root(id), []).get(root(id))!).push(id)

  for (const members of groups.values()) {
    const inGroup = new Set(members)
    const label = members.map(name).sort((a, b) => a.length - b.length)[0]
    const denoms = members.map((m) => KNOWN[c.nodes[m].address.toLowerCase()]?.denom).filter((x): x is number => x != null)
    // Exclude flows between mixer contracts (router ↔ pools, other pools).
    // Priced assets only: mixers pool real value; unpriced junk tokens are noise.
    const dep = members.flatMap((m) => byNodeIn.get(m) ?? []).filter((t) => !isMixer(sid(t)) && usd(t) != null)
    const wd = members.flatMap((m) => byNodeOut.get(m) ?? []).filter((t) => !isMixer(did(t)) && usd(t) != null)
    const depTotal = dep.reduce((s, t) => s + (usd(t) ?? 0), 0)
    const wdTotal = wd.reduce((s, t) => s + (usd(t) ?? 0), 0)
    if (dep.length || wd.length) {
      out.push({
        id: `mixersum:${members[0]}`,
        kind: 'mixer',
        severity: 'high',
        title: `${label}: ${new Set(dep.map(sid)).size} depositor(s), ${new Set(wd.map(did)).size} recipient(s) in loaded data`,
        detail: `Deposits ≈ $${fmt(depTotal)}, withdrawals ≈ $${fmt(wdTotal)} (current prices). Use “Load mixers for demixing” for a wider window.`,
        nodes: [...members, ...new Set(dep.map(sid)), ...new Set(wd.map(did))].slice(0, 300),
        edges: [...new Set([...dep, ...wd].map(eid))],
      })
    }
    const depositors = new Map<string, CTransfer[]>()
    for (const t of dep) (depositors.get(sid(t)) ?? depositors.set(sid(t), []).get(sid(t))!).push(t)
    const byValue = (x: [string, CTransfer[]], y: [string, CTransfer[]]) =>
      y[1].reduce((s, t) => s + (usd(t) ?? t.amount), 0) - x[1].reduce((s, t) => s + (usd(t) ?? t.amount), 0)
    for (const [a, ts] of [...depositors].sort(byValue).slice(0, 20)) {
      const total = ts.reduce((s, t) => s + t.amount, 0)
      out.push({
        id: `mixer:${a}:${members[0]}`,
        kind: 'mixer',
        severity: 'high',
        title: `${name(a)} deposited into ${label}`,
        detail: `${ts.length} deposit(s), ${fmt(total)} ${ts[0].asset}${denoms.length ? ` (pool denomination${denoms.length > 1 ? 's' : ''} ${denoms.join(', ')} ETH)` : ''}.`,
        nodes: [a, ...members],
        edges: [...new Set(ts.map(eid))],
      })
    }
    // Risk for every depositor/recipient, even those not listed individually.
    const riskAll: Finding['risk'] = [
      ...[...depositors.keys()].map((a) => ({ node: a, points: 60, text: `Deposited funds into a mixer (${label})` })),
      ...[...new Set(wd.map(did))].map((b) => ({ node: b, points: 65, text: `Received funds directly from a mixer (${label})` })),
    ]
    out.push({ id: `mixerrisk:${members[0]}`, kind: 'mixer', severity: 'info', title: '', detail: '', nodes: [], edges: [], risk: riskAll })
    const recipients = new Map<string, CTransfer[]>()
    for (const t of wd) (recipients.get(did(t)) ?? recipients.set(did(t), []).get(did(t))!).push(t)
    for (const [b, ts] of [...recipients].sort(byValue).slice(0, 20)) {
      out.push({
        id: `mixerout:${b}:${members[0]}`,
        kind: 'mixer',
        severity: 'high',
        title: `${name(b)} received from ${label}`,
        detail: `${ts.length} withdrawal(s), ${fmt(ts.reduce((s, t) => s + t.amount, 0))} ${ts[0].asset}${ts.some((t) => t.internal) ? ' (contract payout)' : ''}.`,
        nodes: [...members, b],
        edges: [...new Set(ts.map(eid))],
      })
    }

    // 2. Demixing: pair deposits with later withdrawals of a compatible amount.
    const fits = (x: CTransfer, w: CTransfer) => x.asset === w.asset && x.hash !== w.hash && x.time < w.time && w.time - x.time <= 30 * DAY && w.amount / x.amount >= 0.9 && w.amount / x.amount <= 1.0005
    const cands: Finding[] = []
    for (const d of dep) {
      const A = sid(d)
      for (const w of wd.filter((w) => fits(d, w))) {
        const B = did(w)
        if (inGroup.has(A) || inGroup.has(B) || isMixer(A) || isMixer(B)) continue
        const dt = w.time - d.time
        let score = 0.3
        const why: string[] = []
        if (A === B) (score += 0.5), why.push('same address deposited and withdrew')
        if (dt < HOUR) (score += 0.25), why.push('withdrawn within 1 h')
        else if (dt < DAY) (score += 0.15), why.push('withdrawn within 24 h')
        else if (dt < 7 * DAY) (score += 0.05), why.push('withdrawn within 7 days')
        const k = dep.filter((x) => fits(x, w)).length
        // Larger anonymity sets make any single match less likely.
        score += 0.2 / Math.max(1, k) - Math.min(0.3, 0.06 * Math.log2(Math.max(1, k)))
        if (k === 1) why.push('only matching deposit in window')
        else why.push(`anonymity set of ${k} matching deposits`)
        const nA = neighbors(A)
        const shared = [...neighbors(B)].filter((x) => !inGroup.has(x) && nA.has(x) && !SERVICES.has(cat(x)))
        if (shared.length) (score += 0.2), why.push(`shares counterparty ${name(shared[0])}`)
        const confidence = Math.min(0.99, score)
        if (confidence < 0.45) continue
        cands.push({
          id: `demix:${d.hash}:${w.hash}`,
          kind: 'demix',
          severity: confidence >= 0.75 ? 'high' : 'medium',
          title: `${name(A)} → ${label} → ${name(B)}`,
          detail: `Deposit ${fmt(d.amount)} ${d.asset} matched to withdrawal ${fmt(w.amount)} ${w.asset} ${(dt / HOUR).toFixed(1)} h later: ${why.join('; ')}.`,
          nodes: [A, ...members, B],
          edges: [eid(d), eid(w)],
          confidence,
          link: { a: A, b: B, kind: 'demix' },
          risk: [{ node: B, points: Math.round(55 * confidence), text: `Probable mixer withdrawal linked to ${name(A)} (${Math.round(confidence * 100)}%)` }],
        })
      }
    }
    // Keep the best candidate per withdrawal and per deposit.
    const usedW = new Set<string>()
    const usedD = new Set<string>()
    const best: Finding[] = []
    for (const f of cands.sort((x, y) => y.confidence! - x.confidence!)) {
      const [, dHash, wHash] = f.id.split(':')
      if (usedW.has(wHash) || usedD.has(dHash)) continue
      usedW.add(wHash)
      usedD.add(dHash)
      best.push(f)
      if (best.length >= 25) break
    }
    out.push(...best)
  }

  // 3. CoinJoin transactions (UTXO)
  const cj = new Map<string, CTransfer[]>()
  for (const t of ctx.transfers) if (t.coinjoin) (cj.get(t.hash) ?? cj.set(t.hash, []).get(t.hash)!).push(t)
  for (const [hash, ts] of [...cj].slice(0, 30)) {
    const nodes = [...new Set(ts.flatMap((t) => [sid(t), did(t)]))].filter((id) => c.nodes[id])
    const kind = ts[0].cjKind ?? 'generic'
    const label = { whirlpool: 'Whirlpool (Samourai)', wasabi: 'Wasabi 1.x', wasabi2: 'Wasabi 2 (WabiSabi)', joinmarket: 'JoinMarket', generic: 'CoinJoin' }[kind] ?? kind
    out.push({
      id: `cj:${hash}`,
      kind: 'coinjoin',
      severity: 'medium',
      title: `${label} transaction ${hash.slice(0, 10)}…`,
      detail: `Equal-value outputs detected. ${nodes.length} case address(es) involved; common-input clustering is disabled for this transaction.`,
      nodes,
      edges: [...new Set(ts.map(eid))],
    })
  }

  // 4. Peel chains (follow change edges)
  const changeNext = new Map<string, CaseEdge>()
  const changeTargets = new Set<string>()
  for (const e of ctx.edges) if (e.change) (changeNext.set(e.source, e), changeTargets.add(e.target))
  for (const start of changeNext.keys()) {
    if (changeTargets.has(start)) continue
    const path = [start]
    const es: string[] = []
    let cur = start
    while (changeNext.has(cur) && path.length < 50) {
      const e = changeNext.get(cur)!
      if (path.includes(e.target)) break
      es.push(e.id)
      path.push(e.target)
      cur = e.target
    }
    if (es.length >= 3) {
      const peels = ctx.edges.filter((e) => path.includes(e.source) && !e.change)
      const peeled = peels.reduce((s, e) => s + (e.usd ?? 0), 0)
      out.push({
        id: `peel:${start}`,
        kind: 'peel',
        severity: 'medium',
        title: `Peel chain of ${es.length} hops from ${name(start)}`,
        detail: `${peels.length} peeled payment(s)${peeled ? ` worth ≈ $${fmt(peeled)}` : ''}. The change output carries the remaining balance forward.`,
        nodes: path,
        edges: [...es, ...peels.map((e) => e.id)],
        risk: path.map((n) => ({ node: n, points: 20, text: 'Part of a peel chain' })),
      })
    }
  }

  // 5/6. Fan-out & fan-in within 24 h windows
  const windowed = (list: CTransfer[], key: (t: CTransfer) => string) => {
    const s = [...list].sort((a, b) => a.time - b.time)
    let best: CTransfer[] = []
    let j = 0
    for (let i = 0; i < s.length; i++) {
      while (s[i].time - s[j].time > DAY) j++
      const win = s.slice(j, i + 1)
      if (new Set(win.map(key)).size > new Set(best.map(key)).size) best = win
    }
    return best
  }
  for (const [id, list] of byNodeOut) {
    if (SERVICES.has(cat(id)) || list.length < 8) continue
    const win = windowed(list, did)
    const recips = new Set(win.map(did))
    if (recips.size < 8) continue
    const amts = win.map((t) => usd(t) ?? t.amount)
    const mean = amts.reduce((a, b) => a + b, 0) / amts.length
    const cv = Math.sqrt(amts.reduce((a, b) => a + (b - mean) ** 2, 0) / amts.length) / (mean || 1)
    out.push({
      id: `fanout:${id}`,
      kind: 'fanout',
      severity: cv < 0.5 ? 'medium' : 'low',
      title: `${name(id)} split funds to ${recips.size} addresses in 24 h`,
      detail: `Amounts ${cv < 0.5 ? 'are similar' : 'vary'} (coefficient of variation ${cv.toFixed(2)}). Typical of smurfing/layering when recipients are fresh addresses.`,
      nodes: [id, ...recips],
      edges: [...new Set(win.map(eid))],
      risk: [{ node: id, points: cv < 0.5 ? 25 : 10, text: `Fan-out to ${recips.size} addresses within 24 h` }],
    })
  }
  for (const [id, list] of byNodeIn) {
    if (SERVICES.has(cat(id)) || list.length < 8) continue
    const win = windowed(list, sid)
    const senders = new Set(win.map(sid))
    if (senders.size < 8) continue
    out.push({
      id: `fanin:${id}`,
      kind: 'fanin',
      severity: 'low',
      title: `${senders.size} addresses consolidated into ${name(id)} within 24 h`,
      detail: 'Aggregation pattern: collection point after distribution, or a service sweeping deposits.',
      nodes: [id, ...senders],
      edges: [...new Set(win.map(eid))],
    })
  }

  // 7. Structuring below thresholds
  for (const id of new Set([...byNodeOut.keys(), ...byNodeIn.keys()])) {
    if (SERVICES.has(cat(id))) continue
    const all = [...(byNodeOut.get(id) ?? []), ...(byNodeIn.get(id) ?? [])]
    for (const T of [10000, 3000]) {
      const near = all.filter((t) => {
        const v = usd(t)
        return v != null && v >= 0.85 * T && v < T
      })
      if (near.length >= 3 && near.length >= all.length * 0.2) {
        out.push({
          id: `struct:${id}:${T}`,
          kind: 'structuring',
          severity: 'medium',
          title: `${near.length} transfers just below $${T.toLocaleString('en-US')} at ${name(id)}`,
          detail: `Values between $${(0.85 * T).toLocaleString('en-US')} and $${T.toLocaleString('en-US')} (current prices). Possible structuring to stay under reporting thresholds.`,
          nodes: [id],
          edges: [...new Set(near.map(eid))],
          risk: [{ node: id, points: 35, text: `Repeated transfers just below $${T.toLocaleString('en-US')}` }],
        })
        break
      }
    }
  }

  // 8. Pass-through / transit wallets
  for (const n of Object.values(c.nodes)) {
    if (!n.expanded || SERVICES.has(cat(n.id))) continue
    const ins = byNodeIn.get(n.id) ?? []
    const outs = byNodeOut.get(n.id) ?? []
    if (ins.length < 2 || outs.length < 2) continue
    const vin = ins.reduce((s, t) => s + (usd(t) ?? 0), 0)
    const vout = outs.reduce((s, t) => s + (usd(t) ?? 0), 0)
    if (!vin || Math.abs(vout - vin) / vin > 0.1) continue
    const sortedIn = [...ins].sort((a, b) => a.time - b.time)
    const dwell = outs
      .map((o) => {
        const prev = sortedIn.filter((i) => i.time <= o.time).pop()
        return prev ? o.time - prev.time : Infinity
      })
      .filter(Number.isFinite)
      .sort((a, b) => a - b)
    const med = dwell[Math.floor(dwell.length / 2)]
    if (med == null || med > 6 * HOUR) continue
    out.push({
      id: `pass:${n.id}`,
      kind: 'passthrough',
      severity: 'medium',
      title: `${name(n.id)} forwards ~${Math.round((vout / vin) * 100)}% of inflow`,
      detail: `In ≈ $${fmt(vin)}, out ≈ $${fmt(vout)}; median holding time ${(med / 60000).toFixed(0)} min. Transit hop typical of layering.`,
      nodes: [n.id],
      edges: [...new Set([...ins, ...outs].map(eid))],
      risk: [{ node: n.id, points: 25, text: 'Pass-through wallet (forwards almost all funds within hours)' }],
    })
  }

  // 9. Round-tripping (directed cycles up to 4 hops starting at investigated nodes)
  const adj = new Map<string, CaseEdge[]>()
  for (const e of ctx.edges) if (!e.change && !isSpamAsset(e.asset)) (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e)
  const seenCycles = new Set<string>()
  for (const n of Object.values(c.nodes)) {
    if (!n.expanded || SERVICES.has(cat(n.id))) continue
    const stack: { node: string; path: string[]; edges: string[] }[] = [{ node: n.id, path: [n.id], edges: [] }]
    while (stack.length && seenCycles.size < 12) {
      const { node, path, edges } = stack.pop()!
      for (const e of adj.get(node) ?? []) {
        if (e.target === n.id && path.length >= 2) {
          const key = [...path].sort().join('|')
          if (seenCycles.has(key)) continue
          seenCycles.add(key)
          out.push({
            id: `cycle:${key}`,
            kind: 'cycle',
            severity: 'medium',
            title: `Funds returned to ${name(n.id)} via ${path.length - 1} intermediar${path.length > 2 ? 'ies' : 'y'}`,
            detail: path.map(name).join(' → ') + ` → ${name(n.id)}`,
            nodes: path,
            edges: [...edges, e.id],
            risk: path.map((p) => ({ node: p, points: 20, text: 'Participates in a round-trip cycle' })),
          })
        } else if (path.length < 4 && !path.includes(e.target) && !SERVICES.has(cat(e.target))) {
          stack.push({ node: e.target, path: [...path, e.target], edges: [...edges, e.id] })
        }
      }
    }
  }

  // 10. Chain hopping through bridges (amount + time match across chains)
  const bridgeIn = live.filter((t) => cat(did(t)) === 'bridge' && usd(t))
  const bridgeOut = live.filter((t) => cat(sid(t)) === 'bridge' && usd(t))
  for (const a of bridgeIn) {
    const va = usd(a)!
    const matches = bridgeOut.filter((b) => b.chain !== a.chain && b.time > a.time && b.time - a.time <= 4 * HOUR && usd(b)! >= va * 0.9 && usd(b)! <= va * 1.02)
    for (const b of matches.slice(0, 2)) {
      const confidence = Math.min(0.95, 0.5 + (matches.length === 1 ? 0.25 : 0) + (b.time - a.time < 30 * 60000 ? 0.15 : 0))
      out.push({
        id: `hop:${a.hash}:${b.hash}`,
        kind: 'chainhop',
        severity: 'medium',
        title: `${name(sid(a))} (${a.chain}) → ${name(did(b))} (${b.chain})`,
        detail: `Bridged ≈ $${fmt(va)} in, ≈ $${fmt(usd(b)!)} out ${((b.time - a.time) / 60000).toFixed(0)} min later on another chain.`,
        nodes: [sid(a), did(a), sid(b), did(b)],
        edges: [eid(a), eid(b)],
        confidence,
        link: { a: sid(a), b: did(b), kind: 'chain-hop' },
        risk: [{ node: did(b), points: 10, text: 'Received bridged funds (chain hop)' }],
      })
    }
  }

  // 11. Same EVM address on several chains
  const evmAddr = new Map<string, string[]>()
  for (const n of Object.values(c.nodes)) if (/^0x[0-9a-f]{40}$/.test(n.address)) (evmAddr.get(n.address) ?? evmAddr.set(n.address, []).get(n.address)!).push(n.id)
  for (const [addr, ids] of evmAddr) {
    if (ids.length < 2) continue
    out.push({
      id: `xaddr:${addr}`,
      kind: 'crosschain-address',
      severity: 'info',
      title: `${addr.slice(0, 8)}… is active on ${ids.length} chains`,
      detail: `Networks: ${ids.map((i) => i.split(':')[0]).join(', ')}. One private key controls an EOA on every EVM chain.`,
      nodes: ids,
      edges: [],
      cluster: ids,
    })
  }

  // 12. Asset swaps via DEX (asset changes within 10 minutes)
  for (const [id, outs] of byNodeOut) {
    if (SERVICES.has(cat(id))) continue
    const ins = byNodeIn.get(id) ?? []
    const pairs = new Map<string, CTransfer[]>()
    for (const o of outs) {
      if (cat(did(o)) !== 'defi') continue
      const back = ins.find((i) => i.asset !== o.asset && Math.abs(i.time - o.time) <= 10 * 60000)
      if (back) {
        const k = `${o.asset}→${back.asset}`
        ;(pairs.get(k) ?? pairs.set(k, []).get(k)!).push(o, back)
      }
    }
    if (pairs.size) {
      const all = [...pairs.values()].flat()
      out.push({
        id: `swap:${id}`,
        kind: 'swap',
        severity: 'low',
        title: `${name(id)} swapped ${[...pairs.keys()].slice(0, 3).join(', ')}`,
        detail: `${all.length / 2} swap(s) through DEX/aggregator contracts. Continue tracing in the new asset.`,
        nodes: [id, ...new Set(all.flatMap((t) => [sid(t), did(t)]))],
        edges: [...new Set(all.map(eid))],
        risk: [{ node: id, points: 5, text: 'Converted assets through a DEX' }],
      })
    }
  }

  // 13. Instant exchangers
  for (const e of ctx.edges) {
    const sCat = cat(e.source)
    const tCat = cat(e.target)
    if (sCat !== 'instant' && tCat !== 'instant') continue
    const user = tCat === 'instant' ? e.source : e.target
    out.push({
      id: `instant:${e.id}`,
      kind: 'instant',
      severity: 'high',
      title: `${name(user)} ${tCat === 'instant' ? 'sent to' : 'received from'} ${name(tCat === 'instant' ? e.target : e.source)}`,
      detail: `${fmt(e.amount)} ${e.asset} in ${e.count} transfer(s). Instant exchangers are common cash-out and chain-hop points.`,
      nodes: [e.source, e.target],
      edges: [e.id],
    })
  }

  // 14. Dusting
  for (const [id, ins] of byNodeIn) {
    const dust = ins.filter((t) => {
      const v = usd(t)
      return v != null ? v < 0.05 : t.amount < 0.00001
    })
    const senders = new Set(dust.map(sid))
    if (dust.length >= 5 && senders.size >= 3) {
      out.push({
        id: `dust:${id}`,
        kind: 'dusting',
        severity: 'info',
        title: `${name(id)} received ${dust.length} dust transfers`,
        detail: `From ${senders.size} distinct senders. Treat these senders as noise (tracking or poisoning), not as counterparties.`,
        nodes: [id, ...senders],
        edges: [...new Set(dust.map(eid))],
      })
    }
  }

  // 15. Address poisoning (lookalikes)
  for (const [a, b] of ctx.lookalikes) {
    out.push({
      id: `poison:${a}:${b}`,
      kind: 'poisoning',
      severity: 'high',
      title: `Lookalike addresses: ${name(a)} / ${name(b)}`,
      detail: 'Same first and last 4 characters. Check which one the victim intended; the other is likely a poisoning address.',
      nodes: [a, b],
      edges: [],
    })
  }

  // 16. Fake / spam tokens
  const spamBy = new Map<string, Set<string>>()
  for (const t of ctx.transfers) if (isSpamAsset(t.asset)) (spamBy.get(did(t)) ?? spamBy.set(did(t), new Set()).get(did(t))!).add(t.asset)
  for (const [id, assets] of spamBy) {
    if (!c.nodes[id]?.expanded) continue
    out.push({
      id: `spam:${id}`,
      kind: 'fake-token',
      severity: [...assets].some((a) => a.endsWith('(fake)')) ? 'medium' : 'low',
      title: `${name(id)} received ${assets.size} spam/fake token(s)`,
      detail: [...assets].slice(0, 6).join(', '),
      nodes: [id],
      edges: [],
    })
  }

  // 17. Shared exchange deposit addresses (account-model clustering)
  for (const [id, outs] of byNodeOut) {
    if (SERVICES.has(cat(id)) || outs.length < 1) continue
    const toEx = outs.filter((t) => cat(did(t)) === 'exchange')
    const share = toEx.length / outs.length
    if (share < 0.9) continue
    const senders = [...new Set((byNodeIn.get(id) ?? []).map(sid))].filter((s) => !SERVICES.has(cat(s)) && s !== id)
    if (senders.length < 2) continue
    out.push({
      id: `deposit:${id}`,
      kind: 'deposit-cluster',
      severity: 'info',
      title: `${name(id)} looks like an exchange deposit address`,
      detail: `Forwards ${Math.round(share * 100)}% of transfers to ${name(did(toEx[0]))}. Its ${senders.length} senders likely belong to the same exchange customer.`,
      nodes: [id, ...senders],
      edges: [...new Set([...toEx.map(eid), ...(byNodeIn.get(id) ?? []).map(eid)])],
      cluster: senders,
    })
  }

  // 18. Common funder
  const byFunder = new Map<string, string[]>()
  for (const n of Object.values(c.nodes)) {
    if (!n.funder) continue
    const key = `${n.chain}:${n.funder.address}`
    ;(byFunder.get(key) ?? byFunder.set(key, []).get(key)!).push(n.id)
  }
  for (const [f, ids] of byFunder) {
    if (ids.length < 2 || SERVICES.has(cat(f))) continue
    out.push({
      id: `funder:${f}`,
      kind: 'common-funder',
      severity: 'info',
      title: `${ids.length} addresses first funded by ${name(f)}`,
      detail: `${ids.map(name).join(', ')}. Shared first funder suggests a common operator.`,
      nodes: [f, ...ids],
      edges: [],
      cluster: ids,
    })
  }

  return out
}

/** Risk contributions from findings, keyed by node. */
export function findingRisk(findings: Finding[], dismissed: Set<string>): Map<string, { points: number; text: string }[]> {
  const m = new Map<string, { points: number; text: string }[]>()
  for (const f of findings) {
    if (dismissed.has(f.id)) continue
    for (const r of f.risk ?? []) (m.get(r.node) ?? m.set(r.node, []).get(r.node)!).push({ points: r.points, text: r.text })
  }
  return m
}

export type { ChainId }
