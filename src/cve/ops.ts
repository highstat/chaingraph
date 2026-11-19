// High-level operations on top of the engine, shared by the MCP server:
// CVE lookup, CVE search, dependency audit and the KEV feed.

import { parseManifest } from './manifest'
import { cvePriority, priorityBucket } from './rules'
import {
  bestCpe,
  circlCve,
  epss,
  epssSeries,
  githubPocCount,
  kevCatalog,
  kevInfo,
  nucleiTemplates,
  nvdByCpe,
  nvdCpeSearch,
  nvdCve,
  nvdSearch,
  osvBatch,
  osvVuln,
  pool,
} from './sources'
import type { CveRecord } from './types'

/** Add EPSS, KEV and Nuclei flags to NVD records. */
export async function decorate(items: CveRecord[]): Promise<CveRecord[]> {
  const [ep, kev, nuclei] = await Promise.all([epss(items.map((c) => c.id)).catch(() => ({}) as Record<string, { epss: number; pct: number }>), kevCatalog(), nucleiTemplates()])
  return items.map((c) => {
    const k = kev.get(c.id)
    return { ...c, epss: ep[c.id]?.epss, epssPct: ep[c.id]?.pct, kev: c.kev ?? (k ? kevInfo(k) : undefined), nuclei: nuclei.has(c.id) || undefined }
  })
}

export function compactCve(c: CveRecord) {
  return {
    id: c.id,
    priority: cvePriority(c),
    bucket: priorityBucket(c).label,
    cvss: c.cvss ?? null,
    severity: c.severity ?? null,
    epss: c.epss ?? null,
    epss_percentile: c.epssPct ?? null,
    kev: c.kev ? { added: c.kev.added, ransomware: !!c.kev.ransomware, name: c.kev.name } : null,
    ssvc: c.ssvc ?? null,
    nuclei_template: !!c.nuclei,
    published: c.published ?? null,
    summary: c.summary ? c.summary.slice(0, 400) : null,
  }
}

export async function lookupCve(idRaw: string) {
  const id = idRaw.trim().toUpperCase()
  if (!/^CVE-\d{4}-\d{4,}$/.test(id)) throw new Error('Expected a CVE id like CVE-2024-3400')
  const [nvd, circl, series, poc] = await Promise.all([
    nvdCve(id).catch(() => null),
    circlCve(id).catch(() => null),
    epssSeries(id).catch(() => []),
    githubPocCount(id).catch(() => null),
  ])
  const base: CveRecord = nvd ?? circl ?? { id, detail: 'none' }
  const [rec] = await decorate([{ ...base, ssvc: circl?.ssvc ?? base.ssvc, refs: base.refs ?? circl?.refs }])
  const refs = [...new Map((rec.refs ?? []).map((r) => [r.url, r])).values()]
  return {
    ...compactCve(rec),
    summary: rec.summary ?? null,
    vector: rec.vector ?? null,
    cvss_version: rec.cvssVersion ?? null,
    cwe: rec.cwe ?? [],
    kev: rec.kev ?? null,
    epss_trend_30d: series,
    public_github_repos: poc,
    references: {
      fixes: refs.filter((r) => r.tags?.some((t) => /patch|vendor advisory|mitigation|release notes/i.test(t))).map((r) => r.url),
      exploits_reported: refs.filter((r) => r.tags?.some((t) => /exploit/i.test(t))).map((r) => r.url),
      other: refs.filter((r) => !r.tags?.some((t) => /patch|vendor advisory|mitigation|release notes|exploit/i.test(t))).slice(0, 15).map((r) => r.url),
    },
    links: { nvd: `https://nvd.nist.gov/vuln/detail/${id}`, cve_org: `https://www.cve.org/CVERecord?id=${id}`, osv: `https://osv.dev/vulnerability/${id}` },
  }
}

export async function searchCves(query: string, opts: { recentDays?: number; limit?: number } = {}) {
  const q = query.trim()
  const limit = opts.limit ?? 25
  let title = `keyword "${q}"`
  let items: CveRecord[]
  let total: number | undefined
  if (q.startsWith('cpe:')) {
    items = await nvdByCpe(q.startsWith('cpe:2.3:') ? q : q.replace(/^cpe:\//, 'cpe:2.3:'))
    title = q
  } else if (/\d+\.\d+/.test(q)) {
    const cpes = await nvdCpeSearch(q)
    const best = bestCpe(cpes, q)
    if (best) {
      items = await nvdByCpe(best.name)
      title = `${best.title} (${best.name})`
    } else {
      const r = await nvdSearch(q, opts.recentDays)
      items = r.items
      total = r.total
    }
  } else {
    const r = await nvdSearch(q, opts.recentDays)
    items = r.items
    total = r.total
  }
  const ranked = (await decorate(items)).sort((a, b) => cvePriority(b) - cvePriority(a))
  return { matched: title, total: total ?? ranked.length, returned: Math.min(limit, ranked.length), cves: ranked.slice(0, limit).map(compactCve) }
}

export async function auditDependencies(manifest: string) {
  const parsed = parseManifest(manifest)
  const out: {
    format: string
    packages_checked: number
    vulnerable_packages: { package: string; ecosystem: string; version: string; advisories: { id: string; aliases: string[]; summary: string; fixed_in: string | null }[] }[]
    products: { product: string; cpe: string | null; cves: ReturnType<typeof compactCve>[] }[]
  } = { format: parsed.format, packages_checked: parsed.queries.length, vulnerable_packages: [], products: [] }
  if (parsed.queries.length) {
    const ids = await osvBatch(parsed.queries)
    const uniq = [...new Set(ids.flat())].slice(0, 200)
    const details = new Map<string, any>()
    await pool(uniq, 6, async (id) => details.set(id, await osvVuln(id).catch(() => null)))
    parsed.queries.forEach((q, i) => {
      const adv = (ids[i] ?? [])
        .map((id) => details.get(id))
        .filter(Boolean)
        .map((d: any) => {
          const aff = (d.affected ?? []).find((a: any) => a.package?.name === q.name) ?? d.affected?.[0]
          const fixed = (aff?.ranges ?? []).flatMap((r: any) => r.events ?? []).map((e: any) => e.fixed).filter(Boolean).pop() ?? null
          return { id: d.id as string, aliases: (d.aliases ?? []).filter((a: string) => a.startsWith('CVE-')), summary: (d.summary ?? d.details ?? '').slice(0, 240), fixed_in: fixed }
        })
      if (adv.length) out.vulnerable_packages.push({ package: q.name, ecosystem: q.ecosystem, version: q.version, advisories: adv })
    })
  }
  for (const p of parsed.products.slice(0, 15)) {
    const best = bestCpe(await nvdCpeSearch(p).catch(() => []), p)
    const items = best ? await decorate(await nvdByCpe(best.name).catch(() => [])) : []
    out.products.push({ product: p, cpe: best?.name ?? null, cves: items.sort((a, b) => cvePriority(b) - cvePriority(a)).slice(0, 20).map(compactCve) })
  }
  return out
}

export async function latestKev(limit = 20, vendor?: string) {
  const kev = await kevCatalog()
  const list = [...kev.values()]
    .filter((k) => !vendor || `${k.vendorProject} ${k.product}`.toLowerCase().includes(vendor.toLowerCase()))
    .sort((a, b) => b.dateAdded.localeCompare(a.dateAdded))
    .slice(0, limit)
  return {
    catalog_size: kev.size,
    entries: list.map((k) => ({
      cve: k.cveID,
      vendor: k.vendorProject,
      product: k.product,
      name: k.vulnerabilityName,
      added: k.dateAdded,
      due: k.dueDate,
      ransomware: k.knownRansomwareCampaignUse === 'Known',
      required_action: k.requiredAction,
      description: k.shortDescription,
    })),
  }
}
