// ChainGraph CVE & attack-surface MCP server.
//
// Gives any MCP-capable AI client (Claude Desktop, Claude Code, Cursor,
// LM Studio, Open WebUI via mcpo, …) the same passive reconnaissance and
// vulnerability intelligence as the /cve page: surface scans, deep IP intel,
// CVE lookup and search, dependency audits and the CISA KEV feed.
//
//   npm run mcp:build && node mcp/dist/chaingraph-mcp.mjs     (stdio)

import './node-env'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { runActive } from '../src/cve/active'
import { countryName, ipIntel } from '../src/cve/intel'
import { auditDependencies, compactCve, latestKev, lookupCve, searchCves } from '../src/cve/ops'
import { hostsFor, rankedCves, scanMarkdown } from '../src/cve/report'
import { cpeLabel } from '../src/cve/rules'
import { parseTarget, runScan } from '../src/cve/scan'
import { internetDb, ripeAs, ripePrefixes } from '../src/cve/sources'
import type { ScanResult } from '../src/cve/types'

const server = new McpServer(
  { name: 'chaingraph-cve', version: '1.1.0' },
  {
    instructions:
      'Passive attack-surface and vulnerability intelligence. Nothing is sent to the target: data comes from DNS, certificate transparency, Shodan InternetDB, RIPEstat, NVD, FIRST EPSS, CISA KEV, CIRCL, OSV and FireHOL. CVEs on hosts are inferred from service banners and can be false positives (backported fixes). Use only on systems the user owns or is authorized to assess. Start with scan_target for a domain/IP/range/ASN, lookup_cve for a single CVE, ip_intel for one address.',
  },
)

const json = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 2) }] })
const fail = (e: unknown) => ({ content: [{ type: 'text' as const, text: `Error: ${(e as Error).message}` }], isError: true })

function summarize(r: ScanResult, topN: number) {
  const cves = rankedCves(r)
  return {
    target: r.target,
    kind: r.kind,
    exposure_score: r.score,
    grade: r.grade,
    incomplete: !!r.degraded,
    counts: {
      domains: r.domains.length,
      hosts: r.hosts.length,
      open_ports: r.hosts.reduce((a, h) => a + h.ports.length, 0),
      cves: cves.length,
      kev: cves.filter((c) => c.kev).length,
      countries: [...new Set(r.hosts.map((h) => h.country).filter(Boolean))],
      blocklisted_hosts: r.hosts.filter((h) => h.lists?.length).length,
    },
    hosts: r.hosts.map((h) => ({
      ip: h.ip,
      domains: h.via,
      ports: h.ports,
      software: h.cpes.map(cpeLabel),
      tags: h.tags,
      asn: h.asn ? `AS${h.asn}` : null,
      network_holder: h.holder ?? null,
      registered_to: h.org ?? null,
      registered_country: h.regCountry ? `${h.regCountry} (${countryName(h.regCountry)})` : null,
      located: h.country ? `${h.city ? h.city + ', ' : ''}${countryName(h.country)}` : null,
      rir: h.rir ?? null,
      rpki: h.rpki ?? null,
      reverse_dns: h.ptr ?? [],
      abuse_contact: h.abuse ?? [],
      blocklists: h.lists ?? [],
      cve_count: h.vulns.length,
      kev_cves: h.vulns.filter((id) => r.cves[id]?.kev),
    })),
    top_cves: cves.slice(0, topN).map((c) => ({ ...compactCve(c), hosts: hostsFor(r, c.id) })),
    findings: r.findings.map((f) => ({ severity: f.severity, category: f.category, title: f.title, detail: f.detail, host: f.host ?? null, confidence: f.confidence })),
    email: r.email ?? null,
    technologies: r.tech.map((t) => `${t.name}${t.version ? ' ' + t.version : ''}`),
    asn: r.asnInfo ? { ...r.asnInfo, prefixes: r.prefixes.length, sample: r.prefixes.slice(0, 50) } : null,
    active: r.active
      ? {
          full: r.active.full,
          http: r.active.http.map((x) => ({ url: x.url, status: x.status, final_url: x.finalUrl, server: x.server ?? null, powered_by: x.poweredBy ?? null, title: x.title ?? null, opaque: !!x.opaque })),
          tls: r.active.tls ?? null,
          cors: r.active.cors ?? null,
          methods: r.active.methods ?? null,
          open_ports: r.active.ports?.open ?? null,
          reachable_paths: r.active.paths.map((p) => ({ path: p.path, status: p.status, kind: p.kind, note: p.note })),
          notes: r.active.notes,
        }
      : null,
    notes: r.notes,
  }
}

server.registerTool(
  'scan_target',
  {
    title: 'Attack-surface scan',
    description:
      'Passive scan of a domain, IPv4/IPv6 address, CIDR range (up to /24) or ASN: DNS and subdomains (certificate transparency), every resolved IP with open ports, software, CVEs ranked by CVSS+EPSS+KEV+SSVC, IP registry/geolocation/RPKI/blocklists, email authentication, and prioritized findings with an exposure score. Takes 20–90 s (NVD is rate-limited without NVD_API_KEY).',
    inputSchema: {
      target: z.string().describe('example.com, 203.0.113.10, 203.0.113.0/26 or AS13335'),
      subdomains: z.boolean().default(true).describe('Discover subdomains from certificate transparency'),
      max_subdomains: z.number().int().min(0).max(300).default(60),
      nvd_lookups: z.number().int().min(0).max(60).default(10).describe('Distinct software versions to match against NVD'),
      deep_cves: z.number().int().min(0).max(100).default(30).describe('Top CVEs to enrich with the CVE 5 record (CISA SSVC)'),
      top_cves: z.number().int().min(1).max(200).default(25).describe('How many ranked CVEs to return'),
      active: z.boolean().default(false).describe('Also run active probing (direct HTTP/TLS/port/exposed-file checks against the target). Non-destructive.'),
      i_am_authorized: z.boolean().default(false).describe('Required with active=true: confirm you own or are explicitly authorized to test this target.'),
      format: z.enum(['json', 'markdown', 'both']).default('both'),
    },
  },
  async (a, extra) => {
    if (!parseTarget(a.target)) return fail(new Error('Unrecognized target: use a domain, IP, CIDR or ASN'))
    if (a.active && !a.i_am_authorized) return fail(new Error('active=true requires i_am_authorized=true (you must own or be authorized to actively test the target).'))
    const token = extra._meta?.progressToken
    let n = 0
    try {
      const r = await runScan(
        a.target,
        { subdomains: a.subdomains, maxSubdomains: a.max_subdomains, headers: false, reverseIp: false, nvdCpeLimit: a.nvd_lookups, deepCves: a.deep_cves, active: a.active, authorized: a.i_am_authorized },
        {
          cancelled: () => extra.signal.aborted,
          progress: (p) => {
            if (token === undefined) return
            void extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress: ++n, message: p.total ? `${p.step} (${p.done}/${p.total})` : p.step } }).catch(() => {})
          },
        },
      )
      const content: { type: 'text'; text: string }[] = []
      if (a.format !== 'markdown') content.push({ type: 'text', text: JSON.stringify(summarize(r, a.top_cves), null, 2) })
      if (a.format !== 'json') content.push({ type: 'text', text: scanMarkdown(r) })
      return { content }
    } catch (e) {
      return fail(e)
    }
  },
)

server.registerTool(
  'ip_intel',
  {
    title: 'Deep IP intelligence',
    description:
      'Everything known about one IP: who the block is registered to and in which country (whois via RIPEstat, all RIRs), geolocated city/country and coordinates, ASN and holder, announced prefix and RPKI validity, reverse DNS, abuse contact, FireHOL/Spamhaus/C2/Tor blocklist membership, plus Shodan InternetDB open ports, software, tags and banner-inferred CVEs.',
    inputSchema: { ip: z.string().describe('IPv4 or IPv6 address') },
  },
  async ({ ip }) => {
    if (parseTarget(ip)?.kind !== 'ip') return fail(new Error('Expected a single IPv4 or IPv6 address'))
    try {
      const [intel, idb] = await Promise.all([ipIntel(ip.trim()), internetDb(ip.trim()).catch(() => null)])
      const { failed, ...rest } = intel
      return json({
        ip,
        ...rest,
        unavailable_sources: failed,
        registered_country_name: intel.regCountry ? countryName(intel.regCountry) : null,
        located_country_name: intel.country ? countryName(intel.country) : null,
        exposure: idb ? { ports: idb.ports, software: idb.cpes.map(cpeLabel), hostnames: idb.hostnames, tags: idb.tags, cve_count: idb.vulns.length, cves: idb.vulns.slice(0, 60) } : 'no InternetDB data (not exposed or not recently scanned)',
        hint: 'Use scan_target for ranked CVEs with EPSS/KEV, or lookup_cve for one CVE.',
      })
    } catch (e) {
      return fail(e)
    }
  },
)

server.registerTool(
  'active_probe',
  {
    title: 'Active probe (authorized only)',
    description:
      'Send real, non-destructive requests to one domain or IP: live HTTP(S) with header and redirect analysis, TLS certificate and protocol, CORS policy, allowed HTTP methods (TRACE/PUT), a live TCP connect check of common ports, and a GET check for exposed files and endpoints (.git, .env, server-status, directory listings, security.txt). No fuzzing, writes, exploitation or load testing. Only for targets you own or are explicitly authorized to test.',
    inputSchema: {
      target: z.string().describe('A single domain or IP you are authorized to assess'),
      i_am_authorized: z.literal(true).describe('You must confirm you own or are authorized to actively test this target.'),
    },
  },
  async ({ target }, extra) => {
    const t = parseTarget(target)
    if (!t || (t.kind !== 'domain' && t.kind !== 'ip')) return fail(new Error('Active probing takes a single domain or IP (not a range or ASN).'))
    try {
      const a = await runActive(t.value, { cancelled: () => extra.signal.aborted })
      return json(a)
    } catch (e) {
      return fail(e)
    }
  },
)

server.registerTool(
  'lookup_cve',
  {
    title: 'CVE lookup',
    description:
      'Full intelligence for one CVE: description, CVSS and vector, CWE, EPSS probability with a 30-day trend, CISA KEV status (date, ransomware use, required action), CISA SSVC (exploitation none/poc/active, automatable, technical impact), whether a Nuclei detection template exists, number of public GitHub repositories, fixes and references, and a 0–100 priority.',
    inputSchema: { cve_id: z.string().describe('e.g. CVE-2024-3400') },
  },
  async ({ cve_id }) => {
    try {
      return json(await lookupCve(cve_id))
    } catch (e) {
      return fail(e)
    }
  },
)

server.registerTool(
  'search_cves',
  {
    title: 'CVE search',
    description: 'Search NVD by keyword ("fortinet ssl vpn"), product and version ("nginx 1.18.0", resolved to a CPE) or a CPE 2.3 string. Results are ranked by priority (CVSS + EPSS + KEV).',
    inputSchema: {
      query: z.string(),
      recent_days: z.number().int().min(1).max(120).optional().describe('Only CVEs published in the last N days (keyword searches)'),
      limit: z.number().int().min(1).max(100).default(25),
    },
  },
  async ({ query, recent_days, limit }) => {
    try {
      return json(await searchCves(query, { recentDays: recent_days, limit }))
    } catch (e) {
      return fail(e)
    }
  },
)

server.registerTool(
  'audit_dependencies',
  {
    title: 'Dependency / stack audit',
    description:
      'Find known vulnerabilities in a dependency manifest or product list. Accepts package-lock.json, package.json, requirements.txt, composer.lock, go.mod, Cargo.lock, Gemfile.lock, lines like "npm:lodash@4.17.15", or products like "nginx 1.18.0". Packages are checked against OSV.dev, products against NVD.',
    inputSchema: { manifest: z.string().describe('The file contents or the list') },
  },
  async ({ manifest }) => {
    try {
      return json(await auditDependencies(manifest))
    } catch (e) {
      return fail(e)
    }
  },
)

server.registerTool(
  'kev_latest',
  {
    title: 'Known exploited vulnerabilities',
    description: 'Latest additions to the CISA Known Exploited Vulnerabilities catalog, optionally filtered by vendor or product.',
    inputSchema: { limit: z.number().int().min(1).max(200).default(20), vendor: z.string().optional().describe('e.g. "microsoft", "fortinet", "ivanti"') },
  },
  async ({ limit, vendor }) => {
    try {
      return json(await latestKev(limit, vendor))
    } catch (e) {
      return fail(e)
    }
  },
)

server.registerTool(
  'asn_overview',
  {
    title: 'ASN overview',
    description: 'Holder and announced IPv4/IPv6 prefixes of an autonomous system. Scan a prefix with scan_target.',
    inputSchema: { asn: z.string().describe('AS13335 or 13335') },
  },
  async ({ asn }) => {
    const n = asn.replace(/^as/i, '').trim()
    try {
      const [h, p] = await Promise.all([ripeAs(n).catch(() => ({}) as { holder?: string }), ripePrefixes(n)])
      return json({ asn: `AS${n}`, holder: h.holder ?? null, ipv4: p.filter((x) => !x.includes(':')), ipv6: p.filter((x) => x.includes(':')) })
    } catch (e) {
      return fail(e)
    }
  },
)

server.registerPrompt(
  'threat_assessment',
  {
    title: 'Threat assessment',
    description: 'Scan a target and write a predictive threat assessment with a remediation plan.',
    argsSchema: { target: z.string().describe('Domain, IP, range or ASN you are authorized to assess') },
  },
  ({ target }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Run scan_target on ${target}. Then write a threat assessment: (1) overall posture and exposure grade, (2) the 3–5 most likely attack scenarios (entry point → impact) weighted by KEV, SSVC and EPSS, (3) jurisdiction and hosting (registered vs located countries, providers, blocklists, RPKI), (4) a prioritized remediation table (action, hosts, effort, risk reduced) split into today / this week / this quarter. Flag CVEs that are only version-inferred and say how to verify them (e.g. Nuclei templates, package versions).`,
        },
      },
    ],
  }),
)

const transport = new StdioServerTransport()
await server.connect(transport)
process.stderr.write('chaingraph-cve MCP server ready (stdio)\n')
