// Runtime environment of the CVE engine. The engine itself (sources, scan,
// rules, intel) is plain TypeScript that runs in the browser and in Node (the
// MCP server). Each host plugs in its cache, DNS resolver and keys here.

export interface DnsAnswer {
  name: string
  type: number
  TTL: number
  data: string
}

export type DnsType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'NS' | 'TXT' | 'PTR' | 'SOA' | 'CAA'

export interface HttpResult {
  /** HTTP status of the final response, or 0 if the body/status could not be read (browser CORS). */
  status: number
  finalUrl: string
  redirects: number
  headers: Record<string, string>
  /** Up to the first ~64 KB of the body, when readable. */
  body: string
  timeMs: number
  /** The browser could reach the URL but could not read the response (opaque / CORS). */
  opaque?: boolean
}

export interface HttpOptions {
  method?: string
  /** Extra request headers (e.g. a probe Origin for the CORS check). */
  headers?: Record<string, string>
  /** Follow redirects (default true). */
  redirect?: boolean
  timeoutMs?: number
  /** Cap the body read; 0 means headers only. */
  maxBytes?: number
}

export interface TlsInfo {
  protocol?: string
  cipher?: string
  subject?: string
  issuer?: string
  altNames?: string[]
  validFrom?: string
  validTo?: string
  daysLeft?: number
  selfSigned?: boolean
  authorized?: boolean
  authError?: string
}

/** Active-probe capabilities. Present and complete in Node; partial in the browser. */
export interface CveActive {
  /** A real HTTP(S) request to the target. Node: full. Browser: full only for CORS-permissive or same-origin hosts, otherwise liveness-only (opaque). */
  http?(url: string, opts?: HttpOptions): Promise<HttpResult>
  /** TLS certificate and negotiated protocol. Node only. */
  tls?(host: string, port: number): Promise<TlsInfo>
  /** TCP connect check (is the port open right now). Node only. */
  tcp?(host: string, port: number, timeoutMs?: number): Promise<boolean>
}

export interface CveEnv {
  cacheGet<T>(key: string): Promise<{ t: number; v: T } | undefined>
  cacheSet<T>(key: string, value: { t: number; v: T }): Promise<void>
  dns(name: string, type: DnsType): Promise<DnsAnswer[]>
  nvdKey(): string
  /** True in browsers: some sources (HackerTarget quota, CORS-less endpoints) behave differently. */
  browser: boolean
  /** Active probing (direct requests to the target). Only used with explicit authorization. */
  active: CveActive
}

const mem = new Map<string, { t: number; v: unknown }>()

let env: CveEnv = {
  cacheGet: async <T,>(k: string) => mem.get(k) as { t: number; v: T } | undefined,
  cacheSet: async (k, v) => void mem.set(k, v),
  dns: async () => {
    throw new Error('No DNS resolver configured')
  },
  nvdKey: () => '',
  browser: typeof window !== 'undefined',
  active: {},
}

export const cveEnv = () => env
export function setCveEnv(p: Partial<CveEnv>) {
  env = { ...env, ...p }
}
