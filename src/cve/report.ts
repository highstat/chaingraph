// Markdown report and the compact context handed to the AI analyst.

import { cpeLabel, cvePriority, isVersioned, priorityBucket } from './rules'
import type { CveRecord, ScanResult } from './types'

export function rankedCves(r: ScanResult): CveRecord[] {
  const ids = new Set(r.hosts.flatMap((h) => h.vulns))
  return [...ids].map((id) => r.cves[id]).filter(Boolean).sort((a, b) => cvePriority(b) - cvePriority(a))
}

export function hostsFor(r: ScanResult, id: string): string[] {
  return r.hosts.filter((h) => h.vulns.includes(id)).map((h) => h.ip)
}

export const pct = (x?: number) => (x == null ? '–' : `${(x * 100).toFixed(x < 0.01 ? 2 : 1)}%`)

export function scanMarkdown(r: ScanResult): string {
  const cves = rankedCves(r)
  const kev = cves.filter((c) => c.kev)
  const lines: string[] = []
  lines.push(`# Attack surface report: ${r.target}`, '')
  lines.push(`- Scanned: ${new Date(r.started).toISOString().slice(0, 16).replace('T', ' ')} UTC (${r.kind})`)
  lines.push(`- Exposure score: **${r.score}/100 (grade ${r.grade})**`)
  lines.push(`- Domains: ${r.domains.length} · Hosts: ${r.hosts.length} · Open ports: ${r.hosts.reduce((a, h) => a + h.ports.length, 0)}`)
  lines.push(`- CVEs (version-inferred): ${cves.length} · In CISA KEV: ${kev.length}`, '')
  lines.push('> Method: passive only (DNS-over-HTTPS, certificate transparency, Shodan InternetDB, NVD, FIRST EPSS, CISA KEV). CVEs are inferred from service banners and must be confirmed against installed builds.', '')
  if (r.findings.length) {
    lines.push('## Findings', '', '| Severity | Category | Finding | Confidence |', '|---|---|---|---|')
    for (const f of r.findings) lines.push(`| ${f.severity} | ${f.category} | ${f.title.replace(/\|/g, '\\|')} | ${Math.round(f.confidence * 100)}% |`)
    lines.push('')
  }
  if (cves.length) {
    lines.push('## Priority CVEs', '', '| CVE | Priority | CVSS | EPSS | KEV | SSVC exploitation | Nuclei | Hosts |', '|---|---|---|---|---|---|---|---|')
    for (const c of cves.slice(0, 40))
      lines.push(`| ${c.id} | ${priorityBucket(c).label} (${cvePriority(c)}) | ${c.cvss ?? '–'} | ${pct(c.epss)} | ${c.kev ? `yes (${c.kev.added})` : ''} | ${c.ssvc?.exploitation ?? ''} | ${c.nuclei ? 'yes' : ''} | ${hostsFor(r, c.id).join(', ')} |`)
    lines.push('')
  }
  lines.push('## Hosts', '', '| IP | ASN / holder | Registered to (country) | Located | Ports | Software | Tags / lists | RPKI | Abuse |', '|---|---|---|---|---|---|---|---|---|')
  for (const h of r.hosts)
    lines.push(
      `| ${h.ip} | ${h.asn ? `AS${h.asn} ` : ''}${h.holder ?? ''} | ${h.org ?? ''} (${h.regCountry ?? '?'}) | ${[h.city, h.country].filter(Boolean).join(', ')} | ${h.ports.join(', ')} | ${h.cpes.map(cpeLabel).join(', ')} | ${[...h.tags, ...(h.lists ?? [])].join(', ')} | ${h.rpki ?? ''} | ${(h.abuse ?? []).join(', ')} |`,
    )
  lines.push('')
  if (r.domains.length > 1) {
    lines.push('## Domains', '')
    for (const d of r.domains) lines.push(`- ${d.name}${d.cname ? ` → ${d.cname}` : ''}: ${d.ips.join(', ') || 'no A/AAAA'}`)
    lines.push('')
  }
  if (r.email) lines.push('## Email security', '', `- MX: ${r.email.mx.join(', ') || 'none'}`, `- SPF: ${r.email.spf ?? 'missing'}`, `- DMARC: ${r.email.dmarc ?? 'missing'}`, '')
  if (r.notes.length) lines.push('## Notes', '', ...r.notes.map((n) => `- ${n}`), '')
  return lines.join('\n')
}

/** Short, token-cheap summary that also fits small local models. */
export function aiContext(r: ScanResult, maxCves: number): string {
  const cves = rankedCves(r).slice(0, maxCves)
  const out: string[] = []
  out.push(`TARGET: ${r.target} (${r.kind}); exposure score ${r.score}/100 grade ${r.grade}; scanned ${new Date(r.started).toISOString().slice(0, 10)}`)
  out.push(`HOSTS (${r.hosts.length}):`)
  for (const h of r.hosts.slice(0, 40))
    out.push(
      `- ${h.ip}${h.via.length ? ` [${h.via.slice(0, 3).join(', ')}]` : ''} AS${h.asn ?? '?'} ${h.holder ?? ''} | registered ${h.org ?? '?'} (${h.regCountry ?? '?'}, ${h.rir ?? '?'}) located ${h.country ?? '?'}${h.city ? '/' + h.city : ''} | RPKI ${h.rpki ?? '?'} | blocklists ${h.lists?.join(',') || 'none'} | ports ${h.ports.join(',') || 'none'} | software ${h.cpes.filter(isVersioned).map(cpeLabel).join(', ') || h.cpes.map(cpeLabel).join(', ') || '?'} | tags ${h.tags.join(',') || '-'} | ${h.vulns.length} CVEs`,
    )
  if (r.hosts.length > 40) out.push(`- …and ${r.hosts.length - 40} more hosts`)
  if (r.tech.length) out.push(`TECH: ${r.tech.map((t) => `${t.name}${t.version ? ' ' + t.version : ''}`).join(', ')}`)
  if (r.email) out.push(`EMAIL: SPF ${r.email.spf ? 'present' : 'missing'}; DMARC ${r.email.dmarc ?? 'missing'}`)
  if (r.headers) out.push(`HTTP HEADERS: ${Object.entries(r.headers).filter(([k]) => !/^(date|content-length|set-cookie|etag|expires|age)$/.test(k)).slice(0, 25).map(([k, v]) => `${k}: ${v.slice(0, 120)}`).join(' | ')}`)
  out.push(`TOP ${cves.length} CVES (version-inferred; priority = CVSS + EPSS + KEV):`)
  for (const c of cves)
    out.push(
      `- ${c.id} prio ${cvePriority(c)} | CVSS ${c.cvss ?? '?'} | EPSS ${pct(c.epss)} | ${c.kev ? `KEV since ${c.kev.added}${c.kev.ransomware ? ' (ransomware)' : ''}` : 'not KEV'}${c.ssvc ? ` | SSVC ${c.ssvc.exploitation}/${c.ssvc.automatable}/${c.ssvc.impact}` : ''}${c.nuclei ? ' | nuclei' : ''} | hosts ${hostsFor(r, c.id).slice(0, 4).join(',')} | ${(c.summary ?? '').slice(0, 220)}`,
    )
  out.push('FINDINGS:')
  for (const f of r.findings.slice(0, 40)) out.push(`- [${f.severity}] ${f.category}: ${f.title} (confidence ${Math.round(f.confidence * 100)}%)`)
  if (r.notes.length) out.push(`NOTES: ${r.notes.join(' ')}`)
  return out.join('\n')
}

export function cveLinks(id: string): { label: string; url: string }[] {
  return [
    { label: 'NVD', url: `https://nvd.nist.gov/vuln/detail/${id}` },
    { label: 'CVE.org', url: `https://www.cve.org/CVERecord?id=${id}` },
    { label: 'CISA KEV', url: `https://www.cisa.gov/known-exploited-vulnerabilities-catalog?search_api_fulltext=${id}` },
    { label: 'GitHub advisories', url: `https://github.com/advisories?query=${id}` },
    { label: 'OSV', url: `https://osv.dev/vulnerability/${id}` },
    { label: 'Vulners', url: `https://vulners.com/cve/${id}` },
    { label: 'EPSS history', url: `https://api.first.org/data/v1/epss?cve=${id}&scope=time-series` },
  ]
}
