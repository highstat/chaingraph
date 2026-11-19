// Active probing: unlike the rest of the engine, this sends requests directly
// to the target, so it runs ONLY with the caller's explicit authorization.
// Everything here is non-destructive reconnaissance — GET/HEAD/OPTIONS, a TLS
// handshake and TCP connect checks. No fuzzing payloads, no writes, no
// exploitation, no load testing.

import { cveEnv, type TlsInfo } from './env'
import { SECURITY_HEADERS } from './rules'
import { pool } from './sources'
import type { Finding, Severity } from './types'

export interface ActiveHttp {
  url: string
  scheme: string
  status: number
  finalUrl: string
  redirected: boolean
  server?: string
  poweredBy?: string
  title?: string
  timeMs: number
  headers: Record<string, string>
  opaque?: boolean
  error?: string
}

export interface ActivePath {
  path: string
  status: number
  size: number
  kind: string
  note: string
  severity: Severity
}

export interface ActivePortCheck {
  open: number[]
  checked: number[]
}

export interface ActiveResult {
  target: string
  full: boolean // true on the MCP server (Node): TLS, ports and header reads work
  http: ActiveHttp[]
  tls?: TlsInfo & { port: number }
  cors?: { origin: string; allowOrigin?: string; allowCredentials?: string; open: boolean }
  methods?: { allowed: string[]; trace: boolean; risky: string[] }
  ports?: ActivePortCheck
  paths: ActivePath[]
  findings: Finding[]
  notes: string[]
}

// Non-destructive paths worth a look. GET only; a 200 (or a revealing 403) is a finding.
const PATHS: { path: string; kind: string; severity: Severity; note: string }[] = [
  { path: '/.well-known/security.txt', kind: 'security.txt', severity: 'info', note: 'Published security contact (good practice).' },
  { path: '/robots.txt', kind: 'robots', severity: 'info', note: 'May reveal hidden paths.' },
  { path: '/.git/config', kind: 'source leak', severity: 'critical', note: 'Exposed Git repository: full source and history can be downloaded.' },
  { path: '/.git/HEAD', kind: 'source leak', severity: 'critical', note: 'Exposed Git repository.' },
  { path: '/.svn/entries', kind: 'source leak', severity: 'high', note: 'Exposed Subversion metadata.' },
  { path: '/.env', kind: 'secrets', severity: 'critical', note: 'Environment file often holds database and API credentials.' },
  { path: '/.aws/credentials', kind: 'secrets', severity: 'critical', note: 'Cloud credentials.' },
  { path: '/config.json', kind: 'config', severity: 'medium', note: 'Configuration file may expose internals.' },
  { path: '/.htaccess', kind: 'config', severity: 'medium', note: 'Server config should not be served.' },
  { path: '/.DS_Store', kind: 'info leak', severity: 'low', note: 'macOS directory index: leaks file names.' },
  { path: '/server-status', kind: 'status page', severity: 'high', note: 'Apache mod_status: live requests, client IPs and URLs.' },
  { path: '/server-info', kind: 'status page', severity: 'medium', note: 'Apache mod_info: server configuration.' },
  { path: '/actuator/health', kind: 'management', severity: 'medium', note: 'Spring Boot Actuator exposed; check /actuator/env for secrets.' },
  { path: '/metrics', kind: 'management', severity: 'low', note: 'Prometheus metrics may leak internals.' },
  { path: '/phpinfo.php', kind: 'info leak', severity: 'high', note: 'phpinfo() exposes environment, paths and modules.' },
  { path: '/info.php', kind: 'info leak', severity: 'high', note: 'phpinfo() exposes environment and paths.' },
  { path: '/.well-known/change-password', kind: 'well-known', severity: 'info', note: 'Password-change endpoint.' },
  { path: '/wp-login.php', kind: 'admin panel', severity: 'low', note: 'WordPress login reachable.' },
  { path: '/administrator/', kind: 'admin panel', severity: 'low', note: 'Admin panel reachable.' },
  { path: '/.well-known/openid-configuration', kind: 'well-known', severity: 'info', note: 'OpenID configuration.' },
]

const PROBE_ORIGIN = 'https://chaingraph-cors-probe.example'
const PORTS = [21, 22, 23, 25, 53, 80, 110, 143, 443, 445, 3306, 3389, 5432, 6379, 8080, 8443, 9200, 27017]

let fid = 0
const F = (f: Omit<Finding, 'id'>): Finding => ({ ...f, id: `a${++fid}` })

function host(target: string): string {
  return target.replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '')
}

async function probe(url: string): Promise<ActiveHttp> {
  const scheme = url.split(':')[0]
  const a = cveEnv().active
  try {
    const r = await a.http!(url, { maxBytes: 65536, timeoutMs: 12000 })
    const title = r.body.match(/<title[^>]*>([^<]{1,160})/i)?.[1]?.trim()
    return { url, scheme, status: r.status, finalUrl: r.finalUrl, redirected: r.redirects > 0 || r.finalUrl !== url, server: r.headers.server, poweredBy: r.headers['x-powered-by'], title, timeMs: r.timeMs, headers: r.headers, opaque: r.opaque }
  } catch (e) {
    return { url, scheme, status: -1, finalUrl: url, redirected: false, timeMs: 0, headers: {}, error: (e as Error).message }
  }
}

/** Run active checks against a single authorized target (domain or IP). */
export async function runActive(target: string, hooks?: { progress?: (s: string) => void; cancelled?: () => boolean }): Promise<ActiveResult> {
  const h = host(target)
  const a = cveEnv().active
  const full = !!a.tls // Node (MCP server) can read responses, TLS and ports
  const res: ActiveResult = { target: h, full, http: [], paths: [], findings: [], notes: [] }
  const step = (s: string) => hooks?.progress?.(s)
  if (!a.http) {
    res.notes.push('Active probing is not available in this environment.')
    return res
  }

  // ---- HTTP(S) on the host
  step('Active: HTTP/HTTPS request')
  const bases = [`https://${h}`, `http://${h}`]
  res.http = await pool(bases, 2, (u) => probe(u))
  const live = res.http.find((x) => x.status > 0) ?? res.http.find((x) => x.opaque)
  const readable = res.http.find((x) => x.status > 0 && !x.opaque)

  for (const x of res.http) {
    if (x.scheme === 'http' && x.status >= 200 && x.status < 400 && !/^https:/.test(x.finalUrl))
      res.findings.push(F({ severity: 'medium', category: 'Transport security', title: `${h}: HTTP is served without redirecting to HTTPS`, detail: 'Plain-text HTTP lets attackers on the path read or modify traffic.', host: h, confidence: 0.85 }))
  }
  if (readable?.server || readable?.poweredBy)
    res.findings.push(
      F({ severity: 'low', category: 'Information disclosure', title: `${h}: software version in HTTP headers`, detail: [readable.server && `Server: ${readable.server}`, readable.poweredBy && `X-Powered-By: ${readable.poweredBy}`].filter(Boolean).join(' · '), host: h, confidence: 0.9 }),
    )

  if (!full) {
    if (live?.opaque) res.notes.push('The target answered, but the browser’s same-origin policy blocks reading its response. Run the MCP server for full active checks (headers, TLS, open ports, exposed files).')
    else if (!live) res.notes.push('The target did not answer an HTTP request from the browser (it may block cross-origin requests). Run the MCP server for full active checks.')
    else res.notes.push('Browser active checks are limited to what CORS allows. The MCP server adds TLS, open-port and exposed-file checks.')
    // A CORS-permissive or same-origin target still yields readable headers → security-header findings.
    if (readable) res.findings.push(...headerFindings(h, readable.headers))
    return res
  }
  if (!readable) {
    res.notes.push('The target did not answer an HTTP(S) request. TLS and port checks still ran below.')
  }

  const reqHeaders = readable?.headers ?? {}
  if (readable) res.findings.push(...headerFindings(h, reqHeaders))

  // ---- TLS certificate
  if (!hooks?.cancelled?.()) {
    step('Active: TLS certificate')
    const tls = await a.tls!(h, 443).catch(() => null)
    if (tls && (tls.validTo || tls.protocol)) {
      res.tls = { ...tls, port: 443 }
      if (tls.daysLeft != null && tls.daysLeft < 0) res.findings.push(F({ severity: 'high', category: 'Transport security', title: `${h}: TLS certificate expired`, detail: `Expired ${tls.validTo} (${-tls.daysLeft} days ago).`, host: h, confidence: 0.95 }))
      else if (tls.daysLeft != null && tls.daysLeft < 21) res.findings.push(F({ severity: 'medium', category: 'Transport security', title: `${h}: TLS certificate expires in ${tls.daysLeft} days`, detail: `Valid until ${tls.validTo}.`, host: h, confidence: 0.9 }))
      if (tls.selfSigned) res.findings.push(F({ severity: 'medium', category: 'Transport security', title: `${h}: self-signed TLS certificate`, detail: 'Not issued by a trusted CA; clients cannot verify the server.', host: h, confidence: 0.85 }))
      else if (tls.authorized === false && tls.authError) res.findings.push(F({ severity: 'medium', category: 'Transport security', title: `${h}: TLS certificate not trusted`, detail: `${tls.authError} (issuer: ${tls.issuer ?? '?'}).`, host: h, confidence: 0.8 }))
      if (tls.protocol && /TLSv1(\.1)?$|SSLv/.test(tls.protocol)) res.findings.push(F({ severity: 'high', category: 'Transport security', title: `${h}: obsolete TLS protocol ${tls.protocol}`, detail: 'TLS 1.0/1.1 and SSL are deprecated and breakable; require TLS 1.2+.', host: h, confidence: 0.9 }))
    }
  }

  // ---- CORS misconfiguration
  if (readable && !hooks?.cancelled?.()) {
    step('Active: CORS policy')
    const c = await a.http!(readable.finalUrl, { headers: { origin: PROBE_ORIGIN }, maxBytes: 0, timeoutMs: 10000 }).catch(() => null)
    if (c) {
      const allowOrigin = c.headers['access-control-allow-origin']
      const allowCredentials = c.headers['access-control-allow-credentials']
      const open = allowOrigin === PROBE_ORIGIN || (allowOrigin === '*' && allowCredentials === 'true')
      res.cors = { origin: PROBE_ORIGIN, allowOrigin, allowCredentials, open }
      if (allowOrigin === PROBE_ORIGIN && allowCredentials === 'true')
        res.findings.push(F({ severity: 'high', category: 'CORS', title: `${h}: reflects any Origin with credentials`, detail: 'The server echoes an arbitrary Origin and allows credentials: any site can read authenticated responses.', host: h, confidence: 0.85 }))
      else if (allowOrigin === PROBE_ORIGIN) res.findings.push(F({ severity: 'medium', category: 'CORS', title: `${h}: reflects any Origin`, detail: 'Access-Control-Allow-Origin echoes the request Origin, weakening cross-origin protections.', host: h, confidence: 0.75 }))
    }
  }

  // ---- HTTP methods
  if (readable && !hooks?.cancelled?.()) {
    step('Active: allowed HTTP methods')
    const o = await a.http!(readable.finalUrl, { method: 'OPTIONS', maxBytes: 0, timeoutMs: 10000 }).catch(() => null)
    const allow = (o?.headers.allow ?? '').split(',').map((m) => m.trim().toUpperCase()).filter(Boolean)
    if (allow.length) {
      const risky = allow.filter((m) => ['PUT', 'DELETE', 'TRACE', 'CONNECT', 'PATCH'].includes(m))
      res.methods = { allowed: allow, trace: allow.includes('TRACE'), risky }
      if (allow.includes('TRACE')) res.findings.push(F({ severity: 'medium', category: 'HTTP methods', title: `${h}: HTTP TRACE enabled`, detail: 'TRACE can enable Cross-Site Tracing (XST). Disable it.', host: h, confidence: 0.8 }))
      if (risky.some((m) => m === 'PUT' || m === 'DELETE')) res.findings.push(F({ severity: 'medium', category: 'HTTP methods', title: `${h}: write methods advertised (${risky.join(', ')})`, detail: 'PUT/DELETE on the web root can allow file upload or deletion if not restricted.', host: h, confidence: 0.6 }))
    }
  }

  // ---- Sensitive paths
  if (readable && !hooks?.cancelled?.()) {
    step('Active: exposed files & endpoints')
    const base = new URL(readable.finalUrl).origin
    res.paths = (
      await pool(
        PATHS,
        4,
        async (p) => {
          if (hooks?.cancelled?.()) return null
          const r = await a.http!(base + p.path, { maxBytes: 4096, timeoutMs: 8000 }).catch(() => null)
          if (!r || r.status < 200 || r.status === 404 || r.status >= 500) return null
          const size = Number(r.headers['content-length'] ?? r.body.length)
          const listing = /<title>\s*Index of\s*\//i.test(r.body) || /Directory listing for/i.test(r.body)
          return { path: p.path, status: r.status, size, kind: listing ? 'directory listing' : p.kind, note: listing ? 'Open directory listing: files are browsable.' : p.note, severity: listing ? ('high' as Severity) : r.status === 403 && p.severity !== 'critical' ? ('low' as Severity) : p.severity }
        },
        hooks?.cancelled,
      )
    ).filter((x): x is ActivePath => !!x)
    for (const p of res.paths) {
      if (p.severity === 'info' || (p.status === 403 && p.severity === 'low')) continue
      res.findings.push(F({ severity: p.severity, category: 'Exposed files', title: `${h}: ${p.path} is reachable (HTTP ${p.status})`, detail: p.note, host: h, confidence: p.status === 200 ? 0.8 : 0.5 }))
    }
  }

  // ---- Live port check (confirms what is actually open now, vs passive InternetDB)
  if (a.tcp && !hooks?.cancelled?.()) {
    step('Active: TCP port check')
    const open: number[] = []
    await pool(PORTS, 8, async (port) => {
      if (hooks?.cancelled?.()) return
      if (await a.tcp!(h, port, 1500)) open.push(port)
    })
    res.ports = { open: open.sort((x, y) => x - y), checked: PORTS }
  }

  return res
}

function headerFindings(h: string, headers: Record<string, string>): Finding[] {
  const out: Finding[] = []
  const csp = headers['content-security-policy'] ?? ''
  for (const s of SECURITY_HEADERS) {
    if (headers[s.key]) continue
    if (s.key === 'x-frame-options' && /frame-ancestors/i.test(csp)) continue
    out.push(F({ severity: s.severity, category: 'HTTP security headers', title: `${h}: missing ${s.label}`, detail: s.why + ' (confirmed on the live response).', host: h, confidence: 0.92 }))
  }
  return out
}

