// Passive attack-surface scan. Nothing here touches the target directly: all
// data comes from DNS-over-HTTPS, certificate transparency and public internet
// scan datasets (Shodan InternetDB), then CVEs are enriched with NVD, EPSS and
// CISA KEV.

import { cveEnv } from './env'
import { BLOCKLISTS, ipIntel } from './intel'
import {
  circlCve,
  ctSubdomains,
  epss,
  httpHeaders,
  internetDb,
  kevCatalog,
  kevInfo,
  kevUnavailable,
  nvdByCpe,
  nvdEta,
  nucleiTemplates,
  pool,
  reverseIp,
  ripeAs,
  ripePrefixes,
} from './sources'
import {
  cpeLabel,
  cvePriority,
  isCdn,
  isVersioned,
  overallScore,
  portRule,
  SECURITY_HEADERS,
  sevRank,
  TAG_RULES,
  techFromCpes,
  techFromHeaders,
  toCpe23,
} from './rules'
import type { DomainRecord, Finding, HostResult, Progress, ScanOptions, ScanResult, TargetKind, Tech } from './types'

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/
const IPV6 = /^[0-9a-f:]+:[0-9a-f:]*$/i

export function parseTarget(raw: string): { kind: TargetKind; value: string } | null {
  const v = raw.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '')
  if (!v) return null
  if (/^as\d+$/i.test(v) || /^\d{1,10}$/.test(v)) return { kind: 'asn', value: v.replace(/^as/i, '') }
  const cidr = v.match(/^([\d.]+)\/(\d{1,2})$/)
  if (cidr && IPV4.test(cidr[1])) return Number(cidr[2]) >= 32 ? { kind: 'ip', value: cidr[1] } : { kind: 'cidr', value: v }
  if (IPV4.test(v) || IPV6.test(v)) return { kind: 'ip', value: v }
  const host = v.replace(/[/?#].*$/, '').replace(/:\d+$/, '').toLowerCase()
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) return { kind: 'domain', value: host.replace(/^www\./, '') }
  return null
}

export function cidrSize(cidr: string): number {
  const bits = Number(cidr.split('/')[1])
  return 2 ** (32 - bits)
}

export function expandCidr(cidr: string, max = 256): string[] {
  const [base, bitsS] = cidr.split('/')
  const bits = Math.max(Number(bitsS), 32 - Math.log2(max))
  const n = base.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
  const start = (n & mask) >>> 0
  const size = 2 ** (32 - bits)
  const out: string[] = []
  for (let i = 0; i < size; i++) {
    const x = (start + i) >>> 0
    out.push([x >>> 24, (x >>> 16) & 255, (x >>> 8) & 255, x & 255].join('.'))
  }
  return out
}

/** Subdomain names that usually deserve a look first. */
const INTERESTING = /(^|[.-])(admin|vpn|remote|rdp|citrix|owa|exchange|mail|webmail|sso|auth|login|portal|api|dev|test|stage|staging|uat|qa|beta|old|legacy|backup|bak|db|sql|jenkins|gitlab|git|jira|confluence|grafana|kibana|elastic|monitor|internal|intranet|ftp|sftp|cpanel|phpmyadmin)([.-]|$)/i

export interface ScanHooks {
  progress: (p: Progress) => void
  cancelled: () => boolean
}

export async function runScan(input: string, opts: ScanOptions, hooks: ScanHooks): Promise<ScanResult> {
  const t = parseTarget(input)
  if (!t) throw new Error('Enter a domain, IPv4/IPv6 address, CIDR range (e.g. 203.0.113.0/26) or ASN (AS13335)')
  const r: ScanResult = {
    id: `${Date.now().toString(36)}-${t.value}`,
    target: t.value,
    kind: t.kind,
    started: Date.now(),
    domains: [],
    hosts: [],
    prefixes: [],
    tech: [],
    coHosted: [],
    cves: {},
    cpe: {},
    findings: [],
    notes: [],
    score: 0,
    grade: 'A',
  }
  const step = (s: string, done = 0, total = 0) => hooks.progress({ step: s, done, total })
  const stop = () => hooks.cancelled()

  // ------------------------------------------------ 1. Discover IPs
  let ips: string[] = []
  if (t.kind === 'domain') {
    step('DNS records')
    let dnsFailed = 0
    const q = (name: string, type: 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT') => cveEnv().dns(name, type).catch(() => (dnsFailed++, []))
    // A first, alone: it finds a working resolver before the parallel burst.
    const a = await q(t.value, 'A')
    const [aaaa, cname, mx, txt, dmarc] = await Promise.all([q(t.value, 'AAAA'), q(t.value, 'CNAME'), q(t.value, 'MX'), q(t.value, 'TXT'), q(`_dmarc.${t.value}`, 'TXT')])
    const txts = txt.filter((x) => x.type === 16).map((x) => x.data.replace(/^"|"$/g, '').replace(/"\s*"/g, ''))
    if (dnsFailed) r.degraded = true
    if (dnsFailed) r.notes.push('Some DNS lookups failed (DNS-over-HTTPS resolvers unreachable from this network), so email-security checks were skipped.')
    if (!dnsFailed) r.email = {
      mx: mx.filter((x) => x.type === 15).map((x) => x.data.split(' ').pop()!.replace(/\.$/, '')),
      spf: txts.find((x) => /^v=spf1/i.test(x)),
      dmarc: dmarc.filter((x) => x.type === 16).map((x) => x.data.replace(/"/g, '')).find((x) => /^v=DMARC1/i.test(x)),
    }
    r.domains.push({
      name: t.value,
      ips: [...a.filter((x) => x.type === 1), ...aaaa.filter((x) => x.type === 28)].map((x) => x.data),
      cname: cname.find((x) => x.type === 5)?.data.replace(/\.$/, ''),
    })
    if (opts.subdomains && !stop()) {
      step('Certificate transparency (subdomains)')
      const subs = (
        await ctSubdomains(t.value).catch(() => {
          r.degraded = true
          r.notes.push('Certificate transparency logs did not answer: subdomains may be missing. Rescan later.')
          return [] as string[]
        })
      ).filter((s) => s !== t.value)
      if (!subs.includes(`www.${t.value}`)) subs.unshift(`www.${t.value}`)
      subs.sort((x, y) => Number(INTERESTING.test(y)) - Number(INTERESTING.test(x)) || x.length - y.length)
      const pick = subs.slice(0, opts.maxSubdomains)
      if (subs.length > pick.length) r.notes.push(`${subs.length} subdomains in certificate logs; resolved the first ${pick.length} (interesting names first). Raise the limit in scan options.`)
      let done = 0
      const recs = await pool(
        pick,
        6,
        async (name): Promise<DomainRecord> => {
          const [ans, ans6] = await Promise.all([cveEnv().dns(name, 'A').catch(() => []), cveEnv().dns(name, 'AAAA').catch(() => [])])
          step('Resolving subdomains', ++done, pick.length)
          return { name, ips: [...ans.filter((x) => x.type === 1), ...ans6.filter((x) => x.type === 28)].map((x) => x.data), cname: ans.find((x) => x.type === 5)?.data.replace(/\.$/, '') }
        },
        stop,
      )
      r.domains.push(...recs.filter(Boolean))
    }
    ips = [...new Set(r.domains.flatMap((d) => d.ips))]
    if (!ips.length) r.notes.push('The domain did not resolve to any IP address (or DNS-over-HTTPS is blocked on this network).')
  } else if (t.kind === 'ip') {
    ips = [t.value]
  } else if (t.kind === 'cidr') {
    ips = expandCidr(t.value)
    if (cidrSize(t.value) > ips.length) r.notes.push(`Range larger than /24: only the first ${ips.length} addresses were checked.`)
  } else {
    step('ASN prefixes')
    const [as, pfx] = await Promise.all([ripeAs(t.value).catch(() => ({}) as { holder?: string }), ripePrefixes(t.value).catch(() => null)])
    if (!pfx) throw new Error('RIPEstat did not answer: could not list the prefixes of this ASN. Try again shortly.')
    r.asnInfo = { asn: t.value, holder: as.holder }
    r.prefixes = pfx
    r.notes.push('ASN mode lists announced prefixes. Pick a prefix (up to /24) to scan its hosts.')
  }

  // ------------------------------------------------ 2. Hosts
  const via = new Map<string, string[]>()
  for (const d of r.domains) for (const ip of d.ips) via.set(ip, [...(via.get(ip) ?? []), d.name])
  let done = 0
  let idbFailed = 0
  const intelFailed = new Set<string>()
  let intelCount = 0 // ranges: deep intel for the first 30 exposed hosts only
  const hosts = await pool(
    ips,
    6,
    async (ip): Promise<HostResult | null> => {
      const idb = await internetDb(ip).catch(() => (idbFailed++, null))
      step('Exposure data (Shodan InternetDB)', ++done, ips.length)
      if (!idb && t.kind === 'cidr') return null
      const h: HostResult = {
        ip,
        hostnames: idb?.hostnames ?? [],
        ports: (idb?.ports ?? []).sort((a, b) => a - b),
        cpes: idb?.cpes ?? [],
        tags: idb?.tags ?? [],
        vulns: idb?.vulns ?? [],
        inIdb: !!idb,
        via: via.get(ip) ?? [],
      }
      // Deep intel only for addresses that matter (always for domain/IP targets, exposed hosts in ranges).
      if (t.kind !== 'cidr' || (idb && intelCount++ < 30)) {
        step(`IP intelligence: registry, geolocation, RPKI, blocklists (${ip})`, done, ips.length)
        const intel = await ipIntel(ip).catch(() => null)
        if (!intel) intelFailed.add('IP intelligence')
        else {
          const { failed, ...rest } = intel
          for (const f of failed) intelFailed.add(f)
          Object.assign(h, rest)
        }
      }
      return h
    },
    stop,
  )
  r.hosts = hosts.filter((h): h is HostResult => !!h)
  if (idbFailed) {
    r.degraded = true
    r.notes.push(`InternetDB did not answer for ${idbFailed} address(es): their ports and CVEs are missing. Rescan later.`)
  }
  for (const h of r.hosts) h.ptr = [...new Set([...(h.ptr ?? []), ...h.hostnames])].slice(0, 10)
  if (t.kind === 'cidr' && intelCount > 30) r.notes.push(`Deep IP intelligence (registry, RPKI, blocklists) was run for the first 30 of ${intelCount} exposed hosts.`)
  if (intelFailed.size) {
    r.degraded = true
    r.notes.push(`Some IP intelligence could not be loaded (${[...intelFailed].join(', ')}): those fields show as unknown / not checked. Rescan later.`)
  }
  if (t.kind === 'cidr' && !r.hosts.length) r.notes.push('No address in this range appears in InternetDB (nothing exposed, or not recently scanned).')

  // ------------------------------------------------ 3. Optional HackerTarget checks
  if (opts.headers && t.kind === 'domain' && !stop()) {
    step('HTTP headers (HackerTarget)')
    const hdr = (await httpHeaders(t.value).catch(() => null)) ?? (await httpHeaders(`www.${t.value}`).catch(() => null))
    if (hdr) r.headers = hdr
    else r.notes.push('HTTP headers unavailable (HackerTarget daily quota used up, or the site did not answer).')
  }
  if (opts.reverseIp && r.hosts[0] && !stop()) {
    step('Reverse IP (HackerTarget)')
    r.coHosted = (await reverseIp(r.hosts[0].ip).catch(() => [])).slice(0, 500)
  }

  // ------------------------------------------------ 4. Technologies
  const tech = new Map<string, Tech>()
  for (const h of r.hosts) for (const x of techFromCpes(h.cpes)) tech.set(x.name + (x.version ?? ''), x)
  if (r.headers) for (const x of techFromHeaders(r.headers)) tech.set(x.name + (x.version ?? ''), x)
  r.tech = [...tech.values()]

  // ------------------------------------------------ 5. CVE enrichment
  if (!stop()) await enrich(r, opts, step, stop)

  // ------------------------------------------------ 6. Active probing (authorized only)
  if (opts.active && opts.authorized && !stop()) {
    if (t.kind === 'cidr' || t.kind === 'asn') {
      r.notes.push('Active probing is skipped for ranges and ASNs: run it against a single domain or IP.')
    } else {
      const { runActive } = await import('./active')
      r.active = await runActive(t.value, { progress: (s) => step(s), cancelled: stop }).catch((e: unknown) => {
        r.notes.push(`Active probing failed: ${(e as Error).message}`)
        return undefined
      })
      // Active notes live in the Active panel; don't duplicate them in the scan-level notes.
    }
  }

  // ------------------------------------------------ 7. Findings & score
  r.findings = buildFindings(r)
  if (r.active) r.findings.push(...r.active.findings)
  Object.assign(r, overallScore(r.findings))
  r.finished = Date.now()
  return r
}

async function enrich(r: ScanResult, opts: ScanOptions, step: (s: string, d?: number, t?: number) => void, stop: () => boolean) {
  step('CISA KEV catalog')
  const kev = await kevCatalog()
  if (kevUnavailable() || !kev.size) {
    r.degraded = true
    r.notes.push('The CISA KEV catalog could not be loaded: known-exploited flags are missing.')
  }

  // NVD by CPE: one call per distinct versioned CPE, most widespread first.
  const cpeHosts = new Map<string, HostResult[]>()
  for (const h of r.hosts) {
    if (h.tags.includes('honeypot')) continue
    for (const c of h.cpes) {
      if (!isVersioned(c)) {
        r.cpe[c] = { status: 'unversioned', cves: [] }
        continue
      }
      cpeHosts.set(c, [...(cpeHosts.get(c) ?? []), h])
    }
  }
  const cpes = [...cpeHosts.keys()].sort((a, b) => cpeHosts.get(b)!.length - cpeHosts.get(a)!.length)
  const toQuery = cpes.slice(0, opts.nvdCpeLimit)
  for (const c of cpes.slice(opts.nvdCpeLimit)) r.cpe[c] = { status: 'pending', cves: [] }
  let i = 0
  for (const c of toQuery) {
    if (stop()) break
    step(`NVD: ${cpeLabel(c)} (~${nvdEta(toQuery.length - i)} s left)`, i++, toQuery.length)
    try {
      const recs = await nvdByCpe(toCpe23(c))
      r.cpe[c] = { status: recs.length ? 'matched' : 'unmatched', cves: recs.map((x) => x.id) }
      for (const rec of recs) r.cves[rec.id] = rec
      for (const h of cpeHosts.get(c)!) h.vulns = [...new Set([...h.vulns, ...recs.map((x) => x.id)])]
    } catch {
      r.cpe[c] = { status: 'error', cves: [] }
    }
  }

  const ids = [...new Set(r.hosts.filter((h) => !h.tags.includes('honeypot')).flatMap((h) => h.vulns))]
  for (const id of ids) r.cves[id] ??= { id, detail: 'none' }
  step('EPSS exploitation probabilities', 0, ids.length)
  const ep = await epss(ids).catch(() => ({}) as Record<string, { epss: number; pct: number }>)
  for (const id of ids) {
    const c = r.cves[id]
    if (ep[id]) {
      c.epss = ep[id].epss
      c.epssPct = ep[id].pct
    }
    const k = kev.get(id)
    if (k) c.kev = { ...kevInfo(k), ...c.kev, ransomware: k.knownRansomwareCampaignUse === 'Known' }
  }

  // Detection templates: a Nuclei template means the CVE can be verified safely with a scanner.
  step('Nuclei detection templates')
  const nuclei = await nucleiTemplates()
  if (!nuclei.size) r.notes.push('Nuclei template index unavailable: “check available” flags are missing.')
  for (const id of ids) if (nuclei.has(id)) r.cves[id].nuclei = true

  // Deep-dive the most important CVEs: CVE 5 record with CISA SSVC (exploitation
  // status, automatable, technical impact), and CVSS where NVD had none.
  const deep = ids
    .map((id) => r.cves[id])
    .sort((a, b) => cvePriority(b) - cvePriority(a))
    .slice(0, opts.deepCves ?? 30)
  let d = 0
  await pool(
    deep,
    2,
    async (c) => {
      const x = await circlCve(c.id).catch(() => null)
      step('CVE deep-dive (CISA SSVC, CVE records)', ++d, deep.length)
      if (!x) return
      const cur = r.cves[c.id]
      r.cves[c.id] =
        cur.cvss == null
          ? { ...x, kev: cur.kev, epss: cur.epss, epssPct: cur.epssPct, nuclei: cur.nuclei }
          : { ...cur, ssvc: x.ssvc ?? cur.ssvc, summary: cur.summary ?? x.summary }
    },
    stop,
  )
}

let fid = 0
const F = (f: Omit<Finding, 'id'>): Finding => ({ ...f, id: `f${++fid}` })

export function buildFindings(r: ScanResult): Finding[] {
  const out: Finding[] = []
  for (const h of r.hosts) {
    const cdn = isCdn(h)
    const honeypot = h.tags.includes('honeypot')
    for (const p of h.ports) {
      const rule = portRule(p)
      if (!rule || rule.severity === 'info') continue
      out.push(
        F({
          severity: cdn ? 'info' : rule.severity,
          category: rule.category,
          title: `${rule.service} (${p}) open on ${h.ip}`,
          detail: rule.why + (cdn ? ' The IP is a shared CDN edge, so this is the CDN’s port, not your server.' : ''),
          host: h.ip,
          confidence: honeypot ? 0.2 : 0.8,
        }),
      )
    }
    for (const tag of h.tags) {
      const rule = TAG_RULES[tag]
      if (!rule || rule.severity === 'info') continue
      out.push(F({ severity: rule.severity, category: rule.label, title: `${rule.label}: ${h.ip}`, detail: rule.why, host: h.ip, confidence: honeypot ? 0.2 : 0.85 }))
    }
    for (const id of h.lists ?? []) {
      const b = BLOCKLISTS.find((x) => x.id === id)
      if (!b) continue
      out.push(
        F({
          severity: id === 'tor' ? 'medium' : id === 'firehol1' || id === 'drop' || id === 'cybercrime' ? 'critical' : 'high',
          category: id === 'tor' ? 'Anonymity network' : 'Threat blocklists',
          title: `${h.ip} is on ${b.label}`,
          detail: `${b.why} Listed hosts are often compromised or abused; expect blocks by mail servers and firewalls.`,
          host: h.ip,
          confidence: 0.8,
        }),
      )
    }
    if (h.rpki === 'invalid')
      out.push(F({ severity: 'high', category: 'Routing (RPKI)', title: `Route for ${h.prefix} is RPKI-invalid`, detail: `AS${h.asn} announces ${h.prefix} without a matching ROA: a misconfiguration or a possible BGP hijack.`, host: h.ip, confidence: 0.7 }))
    if (honeypot) {
      out.push(F({ severity: 'info', category: 'Honeypot', title: `${h.ip} looks like a honeypot`, detail: TAG_RULES.honeypot.why, host: h.ip, confidence: 0.7 }))
      continue
    }
    const recs = h.vulns.map((id) => r.cves[id]).filter(Boolean)
    for (const c of recs.filter((x) => x.kev)) {
      out.push(
        F({
          severity: 'critical',
          category: 'Known exploited (KEV)',
          title: `${c.id} on ${h.ip}${c.kev?.name ? ` — ${c.kev.name}` : ''}`,
          detail: `Listed in CISA KEV since ${c.kev!.added}${c.kev!.ransomware ? ', used in ransomware campaigns' : ''}. Version-inferred from a service banner: confirm the installed build before acting; distributions often backport fixes.`,
          host: h.ip,
          confidence: 0.55,
        }),
      )
    }
    const crit = recs.filter((x) => !x.kev && (x.cvss ?? 0) >= 9)
    const likely = recs.filter((x) => !x.kev && (x.epss ?? 0) >= 0.1)
    if (crit.length || likely.length)
      out.push(
        F({
          severity: 'high',
          category: 'Vulnerable software',
          title: `${h.ip}: ${crit.length} critical-CVSS and ${likely.length} likely-exploited CVEs`,
          detail: `Inferred from ${h.cpes.filter(isVersioned).map(cpeLabel).join(', ') || 'service banners'}. Top: ${[...new Set([...likely, ...crit])].sort((a, b) => cvePriority(b) - cvePriority(a)).slice(0, 5).map((x) => x.id).join(', ')}.`,
          host: h.ip,
          confidence: 0.5,
        }),
      )
    else if (recs.length)
      out.push(F({ severity: 'medium', category: 'Vulnerable software', title: `${h.ip}: ${recs.length} CVEs inferred from banners`, detail: 'Lower-priority CVEs (no KEV listing, CVSS under 9, EPSS under 10%).', host: h.ip, confidence: 0.45 }))
  }

  if (r.headers) {
    const csp = r.headers['content-security-policy'] ?? ''
    for (const s of SECURITY_HEADERS) {
      if (r.headers[s.key]) continue
      if (s.key === 'x-frame-options' && /frame-ancestors/i.test(csp)) continue
      out.push(F({ severity: s.severity, category: 'HTTP security headers', title: `Missing ${s.label}`, detail: s.why, confidence: 0.9 }))
    }
    const leak = ['server', 'x-powered-by', 'x-aspnet-version'].filter((k) => /\d/.test(r.headers![k] ?? ''))
    if (leak.length) out.push(F({ severity: 'low', category: 'Information disclosure', title: 'Software versions in HTTP headers', detail: leak.map((k) => `${k}: ${r.headers![k]}`).join(' · ') + '. Versions help attackers match exploits.', confidence: 0.9 }))
  }

  if (r.email) {
    if (!r.email.spf) out.push(F({ severity: 'medium', category: 'Email security', title: 'No SPF record', detail: 'Anyone can send mail that appears to come from this domain.', confidence: 0.85 }))
    else if (/\+all/.test(r.email.spf)) out.push(F({ severity: 'high', category: 'Email security', title: 'SPF allows every sender (+all)', detail: r.email.spf, confidence: 0.9 }))
    if (!r.email.dmarc) out.push(F({ severity: 'medium', category: 'Email security', title: 'No DMARC policy', detail: 'Spoofed mail is not rejected and no reports are sent.', confidence: 0.85 }))
    else if (/p=none/i.test(r.email.dmarc)) out.push(F({ severity: 'low', category: 'Email security', title: 'DMARC policy is “none”', detail: 'Monitoring only: spoofed mail is still delivered.', confidence: 0.85 }))
  }

  // Jurisdiction: where the infrastructure is registered and where it physically sits.
  const regs = new Set(r.hosts.map((h) => h.regCountry).filter(Boolean))
  const geos = new Set(r.hosts.map((h) => h.country).filter(Boolean))
  const mismatch = r.hosts.filter((h) => h.regCountry && h.country && h.regCountry !== h.country)
  if (regs.size + geos.size > 0)
    out.push(
      F({
        severity: 'info',
        category: 'Jurisdiction',
        title: `Registered in ${[...regs].join(', ') || '?'} · located in ${[...geos].join(', ') || '?'}`,
        detail:
          (mismatch.length ? `${mismatch.length} host(s) are geolocated in a different country than their registration (typical for clouds and CDNs, worth noting for data-residency rules). ` : '') +
          `${geos.size} country/countries in use.`,
        confidence: 0.75,
      }),
    )
  const noAbuse = r.hosts.filter((h) => h.inIdb && h.abuse && !h.abuse.length)
  if (noAbuse.length) out.push(F({ severity: 'low', category: 'Jurisdiction', title: `${noAbuse.length} host(s) without a registered abuse contact`, detail: noAbuse.slice(0, 6).map((h) => h.ip).join(', '), confidence: 0.6 }))

  const interesting = r.domains.filter((d) => d.ips.length && INTERESTING.test(d.name) && !/^(www|mail)\./.test(d.name))
  if (interesting.length)
    out.push(
      F({
        severity: 'low',
        category: 'Attack surface',
        title: `${interesting.length} sensitive-looking subdomains resolve publicly`,
        detail: interesting.slice(0, 12).map((d) => d.name).join(', ') + '. Admin, VPN, dev and staging hosts should usually sit behind SSO or a VPN.',
        confidence: 0.4,
      }),
    )
  const dangling = r.domains.filter((d) => d.cname && !d.ips.length)
  if (dangling.length)
    out.push(
      F({
        severity: 'medium',
        category: 'Attack surface',
        title: `${dangling.length} CNAMEs that do not resolve`,
        detail: `${dangling.slice(0, 8).map((d) => `${d.name} → ${d.cname}`).join(', ')}. Dangling records can allow subdomain takeover if the target service can be claimed.`,
        confidence: 0.5,
      }),
    )
  return out.sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || b.confidence - a.confidence)
}
