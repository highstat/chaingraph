// Data model for the CVE & attack-surface intelligence page (/cve).

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export interface KevInfo {
  added: string
  due?: string
  action?: string
  name?: string
  ransomware?: boolean
}

export interface CveRecord {
  id: string
  summary?: string
  cvss?: number
  cvssVersion?: string
  vector?: string
  severity?: string
  cwe?: string[]
  published?: string
  kev?: KevInfo
  epss?: number
  epssPct?: number
  refs?: { url: string; tags?: string[] }[]
  /** CISA SSVC decision points (from the CVE record's ADP container). */
  ssvc?: { exploitation?: string; automatable?: string; impact?: string }
  /** A ProjectDiscovery Nuclei detection template exists (the CVE can be verified safely). */
  nuclei?: boolean
  /** Where the details came from. */
  detail: 'nvd' | 'circl' | 'none'
}

export interface HostResult {
  ip: string
  hostnames: string[]
  ports: number[]
  cpes: string[]
  tags: string[]
  /** CVE ids attributed to this host (version-inferred from service banners). */
  vulns: string[]
  inIdb: boolean
  asn?: string
  holder?: string
  prefix?: string
  country?: string
  city?: string
  lat?: number
  lon?: number
  /** Registry (whois) data: who the block is registered to, and where. */
  rir?: string
  regCountry?: string
  org?: string
  netname?: string
  netRange?: string
  regDate?: string
  abuse?: string[]
  rpki?: string
  ptr?: string[]
  /** Public blocklists this IP appears on (ids from intel.BLOCKLISTS). */
  lists?: string[]
  /** Domains that resolve to this IP. */
  via: string[]
}

export interface DomainRecord {
  name: string
  ips: string[]
  cname?: string
}

export interface Tech {
  name: string
  version?: string
  source: string
  cpe?: string
}

export interface Finding {
  id: string
  severity: Severity
  category: string
  title: string
  detail: string
  host?: string
  /** 0..1, how sure the rule is. Version-inferred CVEs stay below 0.6. */
  confidence: number
}

export type CpeStatus = 'matched' | 'unmatched' | 'unversioned' | 'pending' | 'error'

export type TargetKind = 'domain' | 'ip' | 'cidr' | 'asn'

export interface ScanOptions {
  subdomains: boolean
  maxSubdomains: number
  headers: boolean // HackerTarget, uses the free daily quota
  reverseIp: boolean // HackerTarget
  nvdCpeLimit: number
  /** How many top CVEs get the deep-dive (CVE 5 record, SSVC). */
  deepCves?: number
  /** Active probing (direct requests to the target). Requires `authorized`. */
  active?: boolean
  /** The caller confirmed they own or are authorized to test the target. */
  authorized?: boolean
}

export interface ScanResult {
  id: string
  target: string
  kind: TargetKind
  started: number
  finished?: number
  domains: DomainRecord[]
  hosts: HostResult[]
  prefixes: string[]
  asnInfo?: { asn: string; holder?: string }
  headers?: Record<string, string>
  tech: Tech[]
  email?: { spf?: string; dmarc?: string; mx: string[] }
  coHosted: string[]
  cves: Record<string, CveRecord>
  cpe: Record<string, { status: CpeStatus; cves: string[] }>
  findings: Finding[]
  notes: string[]
  /** Some source failed: results are incomplete (Radar keeps its baseline). */
  degraded?: boolean
  /** Results of active probing, when it was authorized and run. */
  active?: import('./active').ActiveResult
  score: number
  grade: string
}

export interface Progress {
  step: string
  done: number
  total: number
}
