// Keyless, CORS-enabled vulnerability and internet-exposure sources, with an
// IndexedDB cache so rescans and Radar checks barely touch the network.
//
//   NVD 2.0 ......... CVE details, CVSS, CWE, KEV fields, CPE matching (5 req / 30 s keyless)
//   FIRST EPSS ...... exploitation probability, batched
//   CISA KEV ........ known exploited vulnerabilities (GitHub mirror, daily)
//   CIRCL ........... CVE 5 records incl. CISA ADP scores, per CVE on demand
//   Shodan InternetDB open ports, CPEs, tags and banner-inferred CVEs per IP
//   RIPEstat ........ prefix, ASN, holder, geolocation
//   OSV.dev ......... package (npm, PyPI, Go…) advisories
//   HackerTarget .... HTTP headers / reverse IP, ~50 free calls a day (opt-in)

import { getJSON } from '../chains/http'
import { cveEnv } from './env'
import type { CveRecord, KevInfo } from './types'

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = await cveEnv().cacheGet<T>(key).catch(() => undefined)
  if (hit && Date.now() - hit.t < ttlMs) return hit.v
  const v = await load()
  void cveEnv().cacheSet(key, { t: Date.now(), v }).catch(() => {})
  return v
}

const HOUR = 3600000
const DAY = 24 * HOUR

/** Run tasks with bounded concurrency. */
export async function pool<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>, cancelled?: () => boolean): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length && !cancelled?.()) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

// ---------------------------------------------------------------- NVD queue

let nvdNext = 0
/** One global queue for NVD: ~6.5 s between calls keyless, ~0.7 s with a key. */
async function nvdFetch(path: string, attempt = 0): Promise<any> {
  const key = cveEnv().nvdKey()
  const gap = key ? 700 : 6500
  const now = Date.now()
  const slot = Math.max(now, nvdNext)
  nvdNext = slot + gap
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now))
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 30000)
  try {
    const res = await fetch(`https://services.nvd.nist.gov/rest/json/${path}`, { headers: key ? { apiKey: key } : {}, signal: ctl.signal })
    if ((res.status === 403 || res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 6000 * (attempt + 1)))
      return nvdFetch(path, attempt + 1)
    }
    if (!res.ok) throw new Error(`NVD responded ${res.status}`)
    return res.json()
  } catch (e) {
    if (ctl.signal.aborted) throw new Error('NVD did not respond within 30 s')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/** Seconds a batch of NVD calls will take, for progress messages. */
export const nvdEta = (calls: number) => Math.round((calls * (cveEnv().nvdKey() ? 0.7 : 6.5)))

function parseNvd(v: any): CveRecord {
  const c = v.cve ?? v
  const m = c.metrics ?? {}
  const metric = m.cvssMetricV40?.[0] ?? m.cvssMetricV31?.[0] ?? m.cvssMetricV30?.[0] ?? m.cvssMetricV2?.[0]
  const d = metric?.cvssData
  const kev: KevInfo | undefined = c.cisaExploitAdd
    ? { added: c.cisaExploitAdd, due: c.cisaActionDue, action: c.cisaRequiredAction, name: c.cisaVulnerabilityName }
    : undefined
  return {
    id: c.id,
    summary: (c.descriptions ?? []).find((x: any) => x.lang === 'en')?.value,
    cvss: d?.baseScore,
    cvssVersion: d?.version,
    vector: d?.vectorString,
    severity: (d?.baseSeverity ?? metric?.baseSeverity)?.toLowerCase(),
    cwe: [...new Set<string>((c.weaknesses ?? []).flatMap((w: any) => w.description.map((x: any) => x.value)).filter((x: string) => x.startsWith('CWE-')))],
    published: c.published?.slice(0, 10),
    kev,
    refs: (c.references ?? []).map((r: any) => ({ url: r.url, tags: r.tags })),
    detail: 'nvd',
  }
}

/** All CVEs NVD links to a versioned CPE 2.3 string. */
export async function nvdByCpe(cpe23In: string): Promise<CveRecord[]> {
  // NVD configurations use "*" for the update field; an explicit "-" (no update) matches nothing.
  const p = cpe23In.split(':')
  if (p[6] === '-') p[6] = '*'
  const cpe23 = p.join(':')
  return cached(`nvd:cpe:${cpe23}`, 3 * DAY, async () => {
    const r = await nvdFetch(`cves/2.0?virtualMatchString=${encodeURIComponent(cpe23)}&resultsPerPage=1000&noRejected`)
    return (r.vulnerabilities ?? []).map(parseNvd)
  })
}

export async function nvdCve(id: string): Promise<CveRecord | null> {
  return cached(`nvd:cve:${id}`, 3 * DAY, async () => {
    const r = await nvdFetch(`cves/2.0?cveId=${encodeURIComponent(id)}`)
    const v = r.vulnerabilities?.[0]
    return v ? parseNvd(v) : null
  })
}

export async function nvdSearch(keyword: string, recentDays?: number): Promise<{ total: number; items: CveRecord[] }> {
  let q = `keywordSearch=${encodeURIComponent(keyword)}&resultsPerPage=100&noRejected`
  if (recentDays) {
    const end = new Date()
    const start = new Date(Date.now() - recentDays * DAY)
    q += `&pubStartDate=${start.toISOString().slice(0, 19)}.000Z&pubEndDate=${end.toISOString().slice(0, 19)}.000Z`
  }
  return cached(`nvd:search:${q}`, 6 * HOUR, async () => {
    const r = await nvdFetch(`cves/2.0?${q}`)
    return { total: r.totalResults ?? 0, items: (r.vulnerabilities ?? []).map(parseNvd) }
  })
}

/** Resolve a free-text product ("nginx 1.18.0") to CPE names via the NVD CPE dictionary. */
export async function nvdCpeSearch(keyword: string): Promise<{ name: string; title: string }[]> {
  return cached(`nvd:cpes:${keyword.toLowerCase()}`, 7 * DAY, async () => {
    const r = await nvdFetch(`cpes/2.0?keywordSearch=${encodeURIComponent(keyword)}&resultsPerPage=20`)
    return (r.products ?? [])
      .map((p: any) => p.cpe)
      .filter((c: any) => !c.deprecated)
      .map((c: any) => ({ name: c.cpeName, title: c.titles?.find((t: any) => t.lang === 'en')?.title ?? c.cpeName }))
  })
}

// ---------------------------------------------------------------- EPSS / KEV / CIRCL

export async function epss(ids: string[]): Promise<Record<string, { epss: number; pct: number }>> {
  const out: Record<string, { epss: number; pct: number }> = {}
  const uniq = [...new Set(ids)]
  const missing: string[] = []
  for (const id of uniq) {
    const hit = await cveEnv().cacheGet<{ epss: number; pct: number } | null>(`epss:${id}`).catch(() => undefined)
    if (hit && Date.now() - hit.t < DAY) {
      if (hit.v) out[id] = hit.v
    } else missing.push(id)
  }
  for (let i = 0; i < missing.length; i += 80) {
    const chunk = missing.slice(i, i + 80)
    const r = await getJSON(`https://api.first.org/data/v1/epss?cve=${chunk.join(',')}&limit=100`, 20000).catch(() => null)
    if (!r) continue
    const seen = new Set<string>()
    for (const row of r.data ?? []) {
      const v = { epss: parseFloat(row.epss), pct: parseFloat(row.percentile) }
      out[row.cve] = v
      seen.add(row.cve)
      void cveEnv().cacheSet(`epss:${row.cve}`, { t: Date.now(), v }).catch(() => {})
    }
    for (const id of chunk) if (!seen.has(id)) void cveEnv().cacheSet(`epss:${id}`, { t: Date.now(), v: null }).catch(() => {})
  }
  return out
}

export interface KevEntry {
  cveID: string
  vendorProject: string
  product: string
  vulnerabilityName: string
  dateAdded: string
  shortDescription: string
  requiredAction: string
  dueDate: string
  knownRansomwareCampaignUse: string
}

let kevMem: Promise<Map<string, KevEntry>> | null = null
/** CISA Known Exploited Vulnerabilities catalog, refreshed at most once a day. */
export function kevCatalog(): Promise<Map<string, KevEntry>> {
  if (!kevMem) kevFailed = false
  kevMem ??= cached('kev:catalog', DAY, async () => {
    const r = await getJSON('https://raw.githubusercontent.com/cisagov/kev-data/main/known_exploited_vulnerabilities.json', 30000)
    return (r.vulnerabilities ?? []) as KevEntry[]
  })
    .then((list) => new Map(list.map((k) => [k.cveID, k])))
    .catch(() => {
      kevMem = null
      kevFailed = true
      return new Map<string, KevEntry>()
    })
  return kevMem
}
let kevFailed = false
/** True if the last KEV catalog load failed (the scan is then marked incomplete). */
export const kevUnavailable = () => kevFailed

export function kevInfo(k: KevEntry): KevInfo {
  return { added: k.dateAdded, due: k.dueDate, action: k.requiredAction, name: k.vulnerabilityName, ransomware: k.knownRansomwareCampaignUse === 'Known' }
}

/** CVE 5 record from CIRCL (CNA + CISA ADP container). Used when a row is opened. */
export async function circlCve(id: string): Promise<CveRecord | null> {
  return cached(`circl:${id}`, 3 * DAY, async () => {
    const r = await getJSON(`https://cve.circl.lu/api/cve/${id}`, 15000).catch((e) => {
      if ((e as { status?: number }).status === 404) return null
      throw e
    })
    if (!r?.containers) return null
    const cna = r.containers.cna ?? {}
    const all = [cna, ...(r.containers.adp ?? [])]
    let cvss: number | undefined
    let vector: string | undefined
    let severity: string | undefined
    let version: string | undefined
    for (const c of all)
      for (const m of c.metrics ?? []) {
        const d = m.cvssV4_0 ?? m.cvssV3_1 ?? m.cvssV3_0 ?? m.cvssV2_0
        if (d?.baseScore != null && cvss == null) {
          cvss = d.baseScore
          vector = d.vectorString
          severity = d.baseSeverity?.toLowerCase()
          version = d.version
        }
      }
    const cwe = all.flatMap((c: any) => (c.problemTypes ?? []).flatMap((p: any) => (p.descriptions ?? []).map((x: any) => x.cweId))).filter(Boolean)
    let ssvc: CveRecord['ssvc']
    for (const c of all)
      for (const m of c.metrics ?? [])
        if (m.other?.type === 'ssvc') {
          const o = Object.assign({}, ...(m.other.content?.options ?? []))
          ssvc = { exploitation: o.Exploitation?.toLowerCase(), automatable: o.Automatable?.toLowerCase(), impact: o['Technical Impact']?.toLowerCase() }
        }
    return {
      id,
      summary: (cna.descriptions ?? []).find((d: any) => d.lang?.startsWith('en'))?.value ?? cna.title,
      cvss,
      cvssVersion: version,
      vector,
      severity,
      cwe: [...new Set<string>(cwe)],
      published: r.cveMetadata?.datePublished?.slice(0, 10),
      refs: (cna.references ?? []).map((x: any) => ({ url: x.url, tags: x.tags })),
      ssvc,
      detail: 'circl',
    } satisfies CveRecord
  })
}

/** Number of public GitHub repositories mentioning the CVE (a prioritization signal). */
export async function githubPocCount(id: string): Promise<number | null> {
  return cached(`gh:${id}`, DAY, async () => {
    const r = await getJSON(`https://api.github.com/search/repositories?q=${encodeURIComponent(id)}&per_page=1`, 12000)
    return r.total_count as number
  })
}

// ---------------------------------------------------------------- Hosts

export interface IdbHost {
  ip: string
  ports: number[]
  cpes: string[]
  hostnames: string[]
  tags: string[]
  vulns: string[]
}

export async function internetDb(ip: string): Promise<IdbHost | null> {
  return cached(`idb:${ip}`, 12 * HOUR, async () => {
    // 404 means "no data for this IP" (cached); network errors and 429/5xx throw (not cached).
    const res = await fetch(`https://internetdb.shodan.io/${ip}`)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`InternetDB responded ${res.status}`)
    const j = await res.json()
    return j?.ip ? (j as IdbHost) : null
  })
}

export async function ripeNetwork(ip: string): Promise<{ asn?: string; prefix?: string }> {
  return cached(`ripe:net:${ip}`, DAY, async () => {
    const r = await getJSON(`https://stat.ripe.net/data/network-info/data.json?resource=${ip}`, 12000)
    return { asn: r?.data?.asns?.[0], prefix: r?.data?.prefix }
  })
}

export async function ripeAs(asn: string): Promise<{ holder?: string }> {
  return cached(`ripe:as:${asn}`, 7 * DAY, async () => {
    const r = await getJSON(`https://stat.ripe.net/data/as-overview/data.json?resource=AS${asn}`, 12000)
    return { holder: r?.data?.holder }
  })
}

export async function ripeGeo(ip: string): Promise<{ country?: string; city?: string }> {
  return cached(`ripe:geo:${ip}`, 7 * DAY, async () => {
    const r = await getJSON(`https://stat.ripe.net/data/maxmind-geo-lite/data.json?resource=${ip}`, 12000)
    const loc = r?.data?.located_resources?.[0]?.locations?.[0]
    return { country: loc?.country, city: loc?.city }
  })
}

export async function ripePrefixes(asn: string): Promise<string[]> {
  return cached(`ripe:pfx:${asn}`, DAY, async () => {
    const r = await getJSON(`https://stat.ripe.net/data/announced-prefixes/data.json?resource=AS${asn}`, 20000)
    return (r?.data?.prefixes ?? []).map((p: any) => p.prefix as string)
  })
}

/** Subdomains from certificate transparency: Cert Spotter first, crt.sh as a fallback. */
export async function ctSubdomains(domain: string): Promise<string[]> {
  return cached(`ct:${domain}`, DAY, async () => {
    const names = new Set<string>()
    const add = (n: string) => {
      const x = n.trim().toLowerCase().replace(/^\*\./, '')
      if (x.endsWith('.' + domain) || x === domain) names.add(x)
    }
    let ok = false
    const cs = await getJSON(`https://api.certspotter.com/v1/issuances?domain=${domain}&include_subdomains=true&expand=dns_names`, 20000).catch(() => null)
    if (cs) ok = true
    for (const i of cs ?? []) for (const n of i.dns_names ?? []) add(n)
    if (names.size < 3) {
      const ct = await getJSON(`https://crt.sh/?q=%25.${domain}&output=json`, 25000).catch(() => null)
      if (ct) ok = true
      for (const c of ct ?? []) for (const n of String(c.name_value).split('\n')) add(n)
    }
    // Neither log answered: throw so the empty result is not cached.
    if (!ok) throw new Error('Certificate transparency logs unavailable')
    return [...names].sort()
  })
}

// ---------------------------------------------------------------- HackerTarget (quota)

let htExhaustedUntil = 0
export const hackertargetAvailable = () => Date.now() > htExhaustedUntil

/** HackerTarget returns errors as HTTP 200 text, so every response is checked. */
async function hackertarget(path: string): Promise<string | null> {
  if (!hackertargetAvailable()) return null
  const text = await fetch(`https://api.hackertarget.com/${path}`)
    .then((r) => r.text())
    .catch(() => '')
  if (/API count exceeded|increase quota/i.test(text)) {
    htExhaustedUntil = Date.now() + 6 * HOUR
    return null
  }
  if (!text || /^error/i.test(text.trim())) return null
  return text
}

export async function httpHeaders(host: string): Promise<Record<string, string> | null> {
  return cached(`ht:hdr:${host}`, 6 * HOUR, async () => {
    const t = await hackertarget(`httpheaders/?q=${encodeURIComponent(host)}`)
    if (!t) return null
    const out: Record<string, string> = {}
    // The tool may follow redirects and print several header blocks: keep the last one.
    for (const line of t.split('\n')) {
      if (/^HTTP\//i.test(line)) for (const k of Object.keys(out)) delete out[k]
      const m = line.match(/^([A-Za-z0-9-]+):\s*(.*)$/)
      if (m) out[m[1].toLowerCase()] = m[2].trim()
    }
    return out
  })
}

export async function reverseIp(ip: string): Promise<string[]> {
  return cached(`ht:rev:${ip}`, DAY, async () => {
    const t = await hackertarget(`reverseiplookup/?q=${ip}`)
    if (!t || /no dns a records/i.test(t)) return []
    return t.split('\n').map((x) => x.trim()).filter((x) => x && !x.includes(' '))
  })
}

// ---------------------------------------------------------------- OSV

export interface OsvQuery {
  ecosystem: string
  name: string
  version: string
}

export async function osvBatch(queries: OsvQuery[]): Promise<string[][]> {
  const out: string[][] = []
  for (let i = 0; i < queries.length; i += 500) {
    const chunk = queries.slice(i, i + 500)
    const res = await fetch('https://api.osv.dev/v1/querybatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ queries: chunk.map((q) => ({ package: { ecosystem: q.ecosystem, name: q.name }, version: q.version })) }),
    })
    if (!res.ok) throw new Error(`OSV responded ${res.status}`)
    const j = await res.json()
    for (const r of j.results ?? []) out.push((r.vulns ?? []).map((v: any) => v.id as string))
  }
  return out
}

export async function osvVuln(id: string): Promise<any> {
  return cached(`osv:${id}`, 3 * DAY, () => getJSON(`https://api.osv.dev/v1/vulns/${id}`, 15000))
}

/** Pick the CPE whose version matches the one typed ("nginx 1.18.0"), preferring applications. */
export function bestCpe<T extends { name: string }>(cpes: T[], query: string): T | undefined {
  const ver = query.match(/\d+(?:\.\d+)+[\w.-]*/)?.[0]
  const words = query.toLowerCase().replace(ver ?? '', '').split(/\s+/).filter(Boolean)
  const score = (c: T) => {
    const p = c.name.split(':')
    let s = 0
    if (ver && p[5] === ver) s += 10
    if (p[2] === 'a') s += 2
    for (const w of words) if (p[4]?.includes(w)) s += 3
    if (p[6] && p[6] !== '*' && p[6] !== '-') s -= 1 // prefer base release over update builds
    return s
  }
  return [...cpes].sort((a, b) => score(b) - score(a))[0]
}

let nucleiMem: Promise<Set<string>> | null = null
/** CVE ids that have a ProjectDiscovery Nuclei detection template (refreshed daily). */
export function nucleiTemplates(): Promise<Set<string>> {
  nucleiMem ??= cached('nuclei:cves', DAY, async () => {
    const res = await fetch('https://raw.githubusercontent.com/projectdiscovery/nuclei-templates/main/cves.json')
    if (!res.ok) throw new Error(`nuclei-templates ${res.status}`)
    const ids: string[] = []
    for (const line of (await res.text()).split('\n')) {
      const m = line.match(/"ID":"(CVE-\d{4}-\d+)"/)
      if (m) ids.push(m[1])
    }
    return ids
  })
    .then((ids) => new Set(ids))
    .catch(() => {
      nucleiMem = null
      return new Set<string>()
    })
  return nucleiMem
}

/** Daily EPSS history (last ~30 days) for a sparkline. */
export async function epssSeries(id: string): Promise<{ date: string; epss: number }[]> {
  return cached(`epss:ts:${id}`, DAY, async () => {
    const r = await getJSON(`https://api.first.org/data/v1/epss?cve=${id}&scope=time-series`, 15000)
    const row = r?.data?.[0]
    if (!row) return []
    const pts = [{ date: row.date, epss: parseFloat(row.epss) }, ...(row['time-series'] ?? []).map((x: any) => ({ date: x.date, epss: parseFloat(x.epss) }))]
    return pts.sort((a, b) => a.date.localeCompare(b.date))
  })
}
