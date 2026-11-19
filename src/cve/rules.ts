// Exposure rules, fingerprints and the priority model. Each rule explains
// itself so a finding is never a black-box verdict.

import type { CveRecord, Finding, HostResult, Severity, Tech } from './types'

// ---------------------------------------------------------------- CPE

/** cpe:/a:apache:http_server:2.4.7 → cpe:2.3:a:apache:http_server:2.4.7 */
export function toCpe23(cpe: string): string {
  if (cpe.startsWith('cpe:2.3:')) return cpe
  const parts = cpe.replace(/^cpe:\//, '').split(':')
  while (parts.length < 11) parts.push('*')
  return 'cpe:2.3:' + parts.slice(0, 11).join(':')
}

export function cpeParts(cpe: string): { part: string; vendor: string; product: string; version?: string } {
  const p = cpe.startsWith('cpe:2.3:') ? cpe.slice(8).split(':') : cpe.replace(/^cpe:\//, '').split(':')
  const version = p[3] && p[3] !== '*' && p[3] !== '-' ? p[3] : undefined
  return { part: p[0], vendor: p[1] ?? '', product: p[2] ?? '', version }
}

export const isVersioned = (cpe: string) => !!cpeParts(cpe).version

export function cpeLabel(cpe: string): string {
  const { product, version } = cpeParts(cpe)
  const name = product.replace(/_/g, ' ')
  return version ? `${name} ${version}` : name
}

// ---------------------------------------------------------------- Ports

export interface PortRule {
  port: number
  service: string
  category: string
  severity: Severity
  why: string
}

const P = (port: number, service: string, category: string, severity: Severity, why: string): PortRule => ({ port, service, category, severity, why })

export const PORT_RULES: PortRule[] = [
  P(21, 'FTP', 'File transfer', 'medium', 'Clear-text credentials; anonymous login is common.'),
  P(23, 'Telnet', 'Remote access', 'high', 'Clear-text remote shell; a top target for IoT botnets.'),
  P(69, 'TFTP', 'File transfer', 'medium', 'Unauthenticated file transfer.'),
  P(111, 'RPCbind', 'Remote access', 'medium', 'Exposes RPC services; used for reflection DDoS.'),
  P(135, 'MS-RPC', 'Remote access', 'high', 'Windows RPC should never face the internet.'),
  P(137, 'NetBIOS', 'File sharing', 'high', 'Leaks host and domain names.'),
  P(139, 'NetBIOS/SMB', 'File sharing', 'high', 'Windows file sharing exposed.'),
  P(445, 'SMB', 'File sharing', 'critical', 'Wormable bugs (EternalBlue, SMBGhost); ransomware entry point.'),
  P(161, 'SNMP', 'Network devices', 'medium', 'Default communities leak device configuration.'),
  P(389, 'LDAP', 'Directory', 'high', 'Directory service exposed; reflection DDoS vector.'),
  P(1433, 'MS SQL', 'Databases', 'high', 'Database listener exposed to the internet.'),
  P(1521, 'Oracle DB', 'Databases', 'high', 'Database listener exposed to the internet.'),
  P(3306, 'MySQL', 'Databases', 'high', 'Database listener exposed to the internet.'),
  P(5432, 'PostgreSQL', 'Databases', 'high', 'Database listener exposed to the internet.'),
  P(6379, 'Redis', 'Databases', 'critical', 'Often runs without authentication; leads to remote code execution.'),
  P(9200, 'Elasticsearch', 'Databases', 'critical', 'Frequent source of mass data leaks when unauthenticated.'),
  P(27017, 'MongoDB', 'Databases', 'critical', 'Frequent source of data leaks and ransom wipes.'),
  P(5984, 'CouchDB', 'Databases', 'high', 'Admin party / unauthenticated instances are common.'),
  P(11211, 'Memcached', 'Databases', 'high', 'Amplification DDoS vector and data leakage.'),
  P(9042, 'Cassandra', 'Databases', 'high', 'Database listener exposed to the internet.'),
  P(3389, 'RDP', 'Remote access', 'critical', 'Most common ransomware initial-access vector (brute force, BlueKeep).'),
  P(5900, 'VNC', 'Remote access', 'critical', 'Often weak or no password; full desktop access.'),
  P(5901, 'VNC', 'Remote access', 'critical', 'Often weak or no password; full desktop access.'),
  P(5985, 'WinRM', 'Remote access', 'high', 'Windows remote management exposed.'),
  P(22, 'SSH', 'Remote access', 'low', 'Expected on servers; keep keys-only auth and rate limiting.'),
  P(2375, 'Docker API', 'Containers & cloud', 'critical', 'Unauthenticated Docker API = root on the host.'),
  P(2376, 'Docker API (TLS)', 'Containers & cloud', 'medium', 'Docker API; verify client-certificate auth.'),
  P(6443, 'Kubernetes API', 'Containers & cloud', 'high', 'Cluster control plane exposed.'),
  P(10250, 'Kubelet', 'Containers & cloud', 'critical', 'Kubelet API can allow command execution in pods.'),
  P(2379, 'etcd', 'Containers & cloud', 'critical', 'Cluster secrets store exposed.'),
  P(8500, 'Consul', 'Containers & cloud', 'high', 'Service mesh API; may allow remote execution.'),
  P(5555, 'Android ADB', 'IoT & devices', 'critical', 'Unauthenticated shell on Android devices.'),
  P(554, 'RTSP', 'Cameras', 'high', 'Video stream endpoint; cameras often keep default credentials.'),
  P(8554, 'RTSP', 'Cameras', 'high', 'Video stream endpoint.'),
  P(37777, 'Dahua DVR', 'Cameras', 'high', 'Dahua DVR service, history of auth bypass bugs.'),
  P(34567, 'DVR (XMEye)', 'Cameras', 'high', 'Cheap DVR protocol with hard-coded credentials.'),
  P(1883, 'MQTT', 'IoT & devices', 'high', 'IoT message broker; often unauthenticated.'),
  P(5683, 'CoAP', 'IoT & devices', 'medium', 'IoT protocol; amplification vector.'),
  P(502, 'Modbus', 'Industrial (ICS)', 'critical', 'Industrial control protocol with no authentication.'),
  P(102, 'Siemens S7', 'Industrial (ICS)', 'critical', 'PLC protocol exposed.'),
  P(20000, 'DNP3', 'Industrial (ICS)', 'critical', 'Utility SCADA protocol exposed.'),
  P(44818, 'EtherNet/IP', 'Industrial (ICS)', 'critical', 'Industrial protocol exposed.'),
  P(47808, 'BACnet', 'Industrial (ICS)', 'high', 'Building automation exposed.'),
  P(1911, 'Niagara Fox', 'Industrial (ICS)', 'high', 'Building automation exposed.'),
  P(9100, 'Printer (JetDirect)', 'Printers', 'medium', 'Raw printing; printers leak documents and pivot.'),
  P(631, 'IPP / CUPS', 'Printers', 'medium', 'Printing service; CUPS had remote code execution bugs in 2024.'),
  P(500, 'IKE (VPN)', 'VPN & gateways', 'info', 'VPN endpoint, keep firmware patched (frequent KEV entries).'),
  P(1194, 'OpenVPN', 'VPN & gateways', 'info', 'VPN endpoint.'),
  P(1723, 'PPTP', 'VPN & gateways', 'medium', 'Obsolete, cryptographically broken VPN protocol.'),
  P(4443, 'HTTPS-alt', 'Web & admin panels', 'info', 'Alternative HTTPS; often management interfaces.'),
  P(8080, 'HTTP-alt', 'Web & admin panels', 'low', 'Alternative HTTP; often proxies or admin panels.'),
  P(8443, 'HTTPS-alt', 'Web & admin panels', 'low', 'Alternative HTTPS; often appliance admin panels.'),
  P(10000, 'Webmin', 'Web & admin panels', 'high', 'Server admin panel exposed.'),
  P(2082, 'cPanel', 'Web & admin panels', 'medium', 'Hosting control panel exposed.'),
  P(2083, 'cPanel (TLS)', 'Web & admin panels', 'medium', 'Hosting control panel exposed.'),
  P(8291, 'MikroTik Winbox', 'Network devices', 'high', 'Router management; frequent botnet target.'),
  P(7547, 'TR-069', 'Network devices', 'high', 'ISP router management protocol; mass-exploited before.'),
  P(25565, 'Minecraft', 'Games', 'info', 'Game server.'),
  P(3000, 'Dev server / Grafana', 'Web & admin panels', 'low', 'Often a development server or dashboard.'),
  P(5601, 'Kibana', 'Web & admin panels', 'high', 'Log dashboard; exposes data when unauthenticated.'),
  P(9090, 'Prometheus / Cockpit', 'Web & admin panels', 'medium', 'Metrics or admin interface.'),
  P(15672, 'RabbitMQ admin', 'Web & admin panels', 'medium', 'Message broker admin panel.'),
  P(4369, 'Erlang EPMD', 'Remote access', 'medium', 'Erlang cluster port mapper; RCE with a leaked cookie.'),
]

const PORT_MAP = new Map(PORT_RULES.map((r) => [r.port, r]))
export const portRule = (p: number) => PORT_MAP.get(p)

// ---------------------------------------------------------------- InternetDB tags

export const TAG_RULES: Record<string, { label: string; severity: Severity; why: string }> = {
  compromised: { label: 'Compromised host', severity: 'critical', why: 'Shodan flags signs of compromise (implants, defacement, ransom notes).' },
  malware: { label: 'Malware', severity: 'critical', why: 'Malware-related service detected.' },
  c2: { label: 'Botnet / C2', severity: 'critical', why: 'Looks like command-and-control infrastructure.' },
  doublepulsar: { label: 'DoublePulsar implant', severity: 'critical', why: 'NSA-leaked SMB backdoor responded.' },
  ransomware: { label: 'Ransomware', severity: 'critical', why: 'Ransom note or ransomware artifacts observed.' },
  'eol-os': { label: 'End-of-life OS', severity: 'high', why: 'The operating system no longer receives security updates.' },
  'eol-product': { label: 'End-of-life software', severity: 'high', why: 'A detected product is past end of support.' },
  ics: { label: 'Industrial system', severity: 'high', why: 'Industrial control protocol exposed.' },
  medical: { label: 'Medical device', severity: 'high', why: 'Medical system exposed to the internet.' },
  database: { label: 'Database', severity: 'medium', why: 'Database service reachable from the internet.' },
  iot: { label: 'IoT device', severity: 'medium', why: 'Embedded device; often weak credentials and slow patching.' },
  'self-signed': { label: 'Self-signed certificate', severity: 'low', why: 'TLS certificate not issued by a public CA.' },
  starttls: { label: 'STARTTLS', severity: 'info', why: 'Mail service supporting STARTTLS.' },
  vpn: { label: 'VPN', severity: 'info', why: 'VPN gateway. These are frequent targets; keep firmware current.' },
  proxy: { label: 'Open proxy', severity: 'medium', why: 'Proxy service that may relay third-party traffic.' },
  tor: { label: 'Tor', severity: 'info', why: 'Tor relay or exit node.' },
  honeypot: { label: 'Honeypot', severity: 'info', why: 'Probably a honeypot: its banners and CVEs are deliberately fake.' },
  cdn: { label: 'CDN edge', severity: 'info', why: 'Shared CDN edge. Ports and CVEs belong to the CDN, not your origin.' },
  cloud: { label: 'Cloud', severity: 'info', why: 'Hosted at a cloud provider.' },
  scanner: { label: 'Scanner', severity: 'info', why: 'This IP scans the internet itself.' },
  videogame: { label: 'Game server', severity: 'info', why: 'Game server.' },
  cryptocurrency: { label: 'Crypto node', severity: 'info', why: 'Cryptocurrency node or mining service.' },
}

// Pure CDN / reverse-proxy operators only (Akamai also runs Linode cloud hosts, so it relies on the InternetDB "cdn" tag).
const CDN_HOLDERS = /cloudflare|fastly|cloudfront|incapsula|imperva|stackpath|edgecast|limelight|ddos-guard|sucuri/i
export const isCdn = (h: HostResult) => h.tags.includes('cdn') || CDN_HOLDERS.test(h.holder ?? '')

// ---------------------------------------------------------------- HTTP

export const SECURITY_HEADERS: { key: string; label: string; severity: Severity; why: string }[] = [
  { key: 'strict-transport-security', label: 'HSTS', severity: 'medium', why: 'Without HSTS, users can be downgraded to HTTP on hostile networks.' },
  { key: 'content-security-policy', label: 'Content-Security-Policy', severity: 'medium', why: 'No CSP: injected scripts (XSS) run freely.' },
  { key: 'x-frame-options', label: 'X-Frame-Options / frame-ancestors', severity: 'low', why: 'Page can be framed (clickjacking).' },
  { key: 'x-content-type-options', label: 'X-Content-Type-Options', severity: 'low', why: 'Browsers may MIME-sniff responses.' },
  { key: 'referrer-policy', label: 'Referrer-Policy', severity: 'info', why: 'Full URLs may leak to third parties.' },
  { key: 'permissions-policy', label: 'Permissions-Policy', severity: 'info', why: 'Browser features (camera, geolocation…) not restricted.' },
]

const TECH_HEADERS: [string, RegExp, string][] = [
  ['server', /^nginx(?:\/([\d.]+))?/i, 'nginx'],
  ['server', /^apache(?:\/([\d.]+))?/i, 'Apache HTTP Server'],
  ['server', /^microsoft-iis(?:\/([\d.]+))?/i, 'Microsoft IIS'],
  ['server', /^litespeed/i, 'LiteSpeed'],
  ['server', /^openresty(?:\/([\d.]+))?/i, 'OpenResty'],
  ['server', /^caddy/i, 'Caddy'],
  ['server', /^cloudflare/i, 'Cloudflare'],
  ['server', /^gws/i, 'Google Web Server'],
  ['server', /^envoy/i, 'Envoy'],
  ['server', /^lighttpd(?:\/([\d.]+))?/i, 'lighttpd'],
  ['server', /^jetty(?:\(([\d.]+))?/i, 'Jetty'],
  ['server', /^Apache-Coyote/i, 'Apache Tomcat'],
  ['server', /^AmazonS3/i, 'Amazon S3'],
  ['server', /^Vercel/i, 'Vercel'],
  ['server', /^Netlify/i, 'Netlify'],
  ['x-powered-by', /PHP\/([\d.]+)/i, 'PHP'],
  ['x-powered-by', /ASP\.NET/i, 'ASP.NET'],
  ['x-powered-by', /Express/i, 'Express'],
  ['x-powered-by', /Next\.js(?:\s([\d.]+))?/i, 'Next.js'],
  ['x-powered-by', /WordPress/i, 'WordPress'],
  ['x-powered-by', /PleskLin/i, 'Plesk'],
  ['x-aspnet-version', /([\d.]+)/, 'ASP.NET'],
  ['x-generator', /Drupal\s?([\d.]+)?/i, 'Drupal'],
  ['x-drupal-cache', /./, 'Drupal'],
  ['x-shopify-stage', /./, 'Shopify'],
  ['x-wix-request-id', /./, 'Wix'],
  ['x-varnish', /./, 'Varnish'],
  ['via', /varnish/i, 'Varnish'],
  ['x-amz-cf-id', /./, 'Amazon CloudFront'],
  ['cf-ray', /./, 'Cloudflare'],
  ['x-served-by', /cache-/i, 'Fastly'],
  ['x-akamai-transformed', /./, 'Akamai'],
  ['x-litespeed-cache', /./, 'LiteSpeed Cache'],
  ['x-turbo-charged-by', /LiteSpeed/i, 'LiteSpeed'],
  ['set-cookie', /PHPSESSID/i, 'PHP'],
  ['set-cookie', /JSESSIONID/i, 'Java servlet'],
  ['set-cookie', /laravel_session/i, 'Laravel'],
  ['set-cookie', /ci_session/i, 'CodeIgniter'],
  ['set-cookie', /wordpress_|wp-settings/i, 'WordPress'],
  ['set-cookie', /__cf_bm|cf_clearance/i, 'Cloudflare'],
  ['link', /wp-json/i, 'WordPress'],
]

export function techFromHeaders(h: Record<string, string>): Tech[] {
  const out = new Map<string, Tech>()
  for (const [key, re, name] of TECH_HEADERS) {
    const v = h[key]
    if (!v) continue
    const m = v.match(re)
    if (!m) continue
    const version = m[1]
    const prev = out.get(name)
    if (!prev || (!prev.version && version)) out.set(name, { name, version, source: `HTTP ${key}` })
  }
  return [...out.values()]
}

export function techFromCpes(cpes: string[]): Tech[] {
  return cpes.map((c) => {
    const p = cpeParts(c)
    return { name: p.product.replace(/_/g, ' '), version: p.version, source: 'InternetDB CPE', cpe: c }
  })
}

// ---------------------------------------------------------------- Priority model

/**
 * 0–100 priority for a CVE on an exposed service: CVSS gives impact, EPSS the
 * chance of exploitation in the next 30 days, and a CISA KEV listing means it
 * is being exploited now.
 */
export function cvePriority(c: CveRecord): number {
  const impact = (c.cvss ?? 5) / 10
  const likelihood = c.epssPct ?? 0.3
  let s = 100 * (0.45 * impact + 0.4 * likelihood + 0.15 * Math.min(1, (c.epss ?? 0) * 10))
  // CISA SSVC: "active" exploitation is nearly as strong a signal as KEV; a public PoC adds a little.
  if (c.ssvc?.exploitation === 'active') s = Math.max(s, 82)
  else if (c.ssvc?.exploitation === 'poc') s += 5
  if (c.ssvc?.automatable === 'yes') s += 3
  if (c.kev) s = Math.max(s, 90) + (c.kev.ransomware ? 5 : 0)
  return Math.round(Math.min(100, s))
}

export function priorityBucket(c: CveRecord): { label: string; cls: Severity } {
  const p = cvePriority(c)
  if (c.kev || p >= 85) return { label: 'Act now', cls: 'critical' }
  if (p >= 65) return { label: 'High', cls: 'high' }
  if (p >= 45) return { label: 'Plan', cls: 'medium' }
  return { label: 'Monitor', cls: 'low' }
}

export function severityOf(cvss?: number): Severity {
  if (cvss == null) return 'info'
  if (cvss >= 9) return 'critical'
  if (cvss >= 7) return 'high'
  if (cvss >= 4) return 'medium'
  return 'low'
}

const SEV_W: Record<Severity, number> = { critical: 25, high: 12, medium: 5, low: 1.5, info: 0 }

/** Overall exposure score (0 = clean, 100 = on fire) and a letter grade. */
export function overallScore(findings: Finding[]): { score: number; grade: string } {
  let raw = 0
  for (const f of findings) raw += SEV_W[f.severity] * (0.4 + 0.6 * f.confidence)
  const score = Math.round(100 * (1 - Math.exp(-raw / 60)))
  const grade = score < 10 ? 'A' : score < 25 ? 'B' : score < 45 ? 'C' : score < 65 ? 'D' : score < 85 ? 'E' : 'F'
  return { score, grade }
}

export const SEV_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info']
export const sevRank = (s: Severity) => SEV_ORDER.indexOf(s)
