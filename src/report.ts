// Reports: a single Markdown report, and an Obsidian vault (one note per address).

import type { RiskResult } from './analysis'
import { CHAINS } from './chains'
import type { Attribution } from './entities'
import { amt, iso, short } from './format'
import type { Case, CaseEdge, CaseNode } from './types'
import { KIND_META, type Finding } from './obfuscation'
import { zip } from './zip'

interface Ctx {
  c: Case
  edges: CaseEdge[]
  attr: Map<string, Attribution>
  risk: Map<string, RiskResult>
  findings?: Finding[]
}

const nameOf = (n: CaseNode) => n.alias || n.info?.name || short(n.address, 8, 6)
const fileName = (n: CaseNode) => (n.alias || n.info?.name || n.address).replace(/[\\/:*?"<>|#^[\]]/g, '_').slice(0, 80)

/** Nodes worth reporting: investigated, annotated, traced or risky. */
function keyNodes({ c, risk }: Ctx): CaseNode[] {
  const traced = new Set(c.traced.flatMap((e) => e.split('|')[0].split('>')))
  return Object.values(c.nodes)
    .filter((n) => n.expanded || n.tags.length || n.note || n.alias || n.starred || traced.has(n.id) || (risk.get(n.id)?.score ?? 0) >= 55)
    .sort((a, b) => (risk.get(b.id)?.score ?? 0) - (risk.get(a.id)?.score ?? 0))
}

export function markdownReport(ctx: Ctx): string {
  const { c, edges, attr, risk } = ctx
  const nodes = keyNodes(ctx)
  const L: string[] = []
  L.push(`# ${c.title}`, '', `Generated ${iso(Date.now())} with ChainGraph. On-chain data from public explorers; figures reflect loaded history only.`, '')
  L.push('## Summary', '')
  L.push(`- Addresses in case: ${Object.keys(c.nodes).length} (${Object.values(c.nodes).filter((n) => n.expanded).length} investigated)`)
  L.push(`- Flows: ${edges.length}`)
  const chains = [...new Set(Object.values(c.nodes).map((n) => CHAINS[n.chain].name))]
  L.push(`- Networks: ${chains.join(', ')}`)
  const high = nodes.filter((n) => (risk.get(n.id)?.score ?? 0) >= 55)
  L.push(`- High-risk addresses: ${high.length}`, '')

  L.push('## Key addresses', '', '| Address | Network | Attribution | Risk | Tags |', '|---|---|---|---|---|')
  for (const n of nodes) {
    const a = attr.get(n.id)
    const r = risk.get(n.id)
    L.push(`| ${nameOf(n)}<br>\`${n.address}\` | ${CHAINS[n.chain].name} | ${a?.category ?? 'unknown'}${a?.label ? ` (${a.label})` : ''} | ${r?.score ?? 0} ${r?.level ?? ''} | ${n.tags.map((t) => '#' + t).join(' ')} |`)
  }
  L.push('')

  if (c.traced.length) {
    L.push('## Traced flows (chronological)', '', '| # | From | To | Amount | First seen | Txs |', '|---|---|---|---|---|---|')
    const set = new Set(c.traced)
    for (const e of edges.filter((e) => set.has(e.id)).sort((a, b) => a.first - b.first)) {
      L.push(`| ${e.order} | ${nameOf(c.nodes[e.source])} | ${nameOf(c.nodes[e.target])} | ${amt(e.amount)} ${e.asset}${e.usd ? ` (≈$${amt(e.usd)})` : ''} | ${iso(e.first)} | ${e.count} |`)
    }
    L.push('')
  }

  L.push('## Largest flows', '', '| From | To | Amount | Period |', '|---|---|---|---|')
  for (const e of [...edges].sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0)).slice(0, 25)) {
    L.push(`| ${nameOf(c.nodes[e.source])} | ${nameOf(c.nodes[e.target])} | ${amt(e.amount)} ${e.asset}${e.usd ? ` (≈$${amt(e.usd)})` : ''} | ${iso(e.first)} → ${iso(e.last)} |`)
  }
  L.push('')

  const fs = ctx.findings ?? []
  if (fs.length) {
    L.push('## Obfuscation & laundering patterns', '', '| Severity | Technique | Finding | Confidence |', '|---|---|---|---|')
    const order = ['high', 'medium', 'low', 'info']
    for (const f of [...fs].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity)).slice(0, 80)) {
      L.push(`| ${f.severity} | ${KIND_META[f.kind].label} | ${f.title.replace(/\|/g, '/')}: ${f.detail.replace(/\|/g, '/')} | ${f.confidence != null ? Math.round(f.confidence * 100) + '%' : ''} |`)
    }
    L.push('')
  }
  if (c.links.length) {
    L.push('## Investigator links', '')
    for (const l of c.links) L.push(`- ${l.kind}: ${nameOf(c.nodes[l.a])} ↔ ${nameOf(c.nodes[l.b])}${l.note ? ` — ${l.note}` : ''}`)
    L.push('')
  }
  if (c.note.trim()) L.push('## Case notes', '', c.note.trim(), '')

  L.push('## Risk findings', '')
  for (const n of high) {
    L.push(`### ${nameOf(n)} — ${risk.get(n.id)!.score}/100`, '')
    for (const r of risk.get(n.id)!.reasons) L.push(`- (+${r.points}) ${r.text}`)
    L.push('')
  }

  const noted = nodes.filter((n) => n.note.trim())
  if (noted.length) {
    L.push('## Investigator notes', '')
    for (const n of noted) L.push(`### ${nameOf(n)}`, '', n.note.trim(), '')
  }
  L.push('---', 'Disclaimer: attribution is heuristic. Owner identity can only be established through the relevant service (e.g. exchange KYC) via lawful process.')
  return L.join('\n')
}

/** Obsidian vault: Case index + one note per key address, linked with [[wikilinks]]. */
export function obsidianVault(ctx: Ctx): Blob {
  const { c, edges, attr, risk } = ctx
  const nodes = keyNodes(ctx)
  const inVault = new Map(nodes.map((n) => [n.id, fileName(n)]))
  const files: { name: string; content: string }[] = []
  const root = c.title.replace(/[\\/:*?"<>|]/g, '_')

  for (const n of nodes) {
    const a = attr.get(n.id)
    const r = risk.get(n.id)
    const lines = [
      '---',
      `address: "${n.address}"`,
      `chain: ${n.chain}`,
      `category: ${a?.category ?? 'unknown'}`,
      `risk: ${r?.score ?? 0}`,
      `tags: [${['chaingraph', ...n.tags].join(', ')}]`,
      '---',
      '',
      `# ${nameOf(n)}`,
      '',
      `[Open in explorer](${CHAINS[n.chain].explorer(n.address)})`,
      '',
    ]
    if (n.info?.balance != null) lines.push(`Balance: ${amt(n.info.balance)} ${n.info.balanceAsset}`, '')
    if (r?.reasons.length) lines.push('## Risk', '', ...r.reasons.map((x) => `- (+${x.points}) ${x.text}`), '')
    const rel = edges.filter((e) => e.source === n.id || e.target === n.id)
    const links = rel
      .map((e) => {
        const other = e.source === n.id ? e.target : e.source
        const dir = e.source === n.id ? '→' : '←'
        const ref = inVault.has(other) ? `[[${inVault.get(other)}]]` : `\`${short(c.nodes[other]?.address ?? other, 10, 6)}\``
        return { line: `- ${dir} ${ref} ${amt(e.amount)} ${e.asset} (${e.count} tx, ${iso(e.first)})`, linked: inVault.has(other) }
      })
      .sort((x, y) => Number(y.linked) - Number(x.linked))
      .slice(0, 60)
    if (links.length) lines.push('## Flows', '', ...links.map((l) => l.line), '')
    if (n.note.trim()) lines.push('## Notes', '', n.note.trim(), '')
    files.push({ name: `${root}/Addresses/${inVault.get(n.id)}.md`, content: lines.join('\n') })
  }
  files.push({ name: `${root}/${root}.md`, content: markdownReport(ctx).replace(/^\| (.+?)<br>/gm, (_m, label) => `| [[${label}]]<br>`) })
  files.push({ name: `${root}/transfers.csv`, content: transfersCsv(c) })
  return zip(files)
}

export function transfersCsv(c: Case): string {
  const rows = [['chain', 'time_utc', 'tx_hash', 'from', 'from_label', 'to', 'to_label', 'asset', 'amount', 'usd_now', 'change', 'coinjoin']]
  const lbl = (chain: string, a: string) => {
    const n = c.nodes[`${chain}:${a}`]
    return n?.alias || n?.info?.name || ''
  }
  const seen = new Set<string>()
  const all = Object.entries(c.transfers).flatMap(([id, ts]) => ts.map((t) => ({ ...t, chain: c.nodes[id]?.chain ?? '' })))
  for (const t of all.sort((a, b) => a.time - b.time)) {
    const k = `${t.chain}|${t.hash}|${t.from}|${t.to}|${t.asset}|${t.amount}`
    if (seen.has(k)) continue
    seen.add(k)
    const usd = c.prices[t.asset] ? (c.prices[t.asset] * t.amount).toFixed(2) : ''
    rows.push([t.chain, new Date(t.time).toISOString(), t.hash, t.from, lbl(t.chain, t.from), t.to, lbl(t.chain, t.to), t.asset, String(t.amount), usd, t.change ? '1' : '', t.coinjoin ? '1' : ''])
  }
  return rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
}
