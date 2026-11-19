// Node bindings for the CVE engine: system DNS, an on-disk cache and the NVD
// key from the environment.

import { createHash } from 'node:crypto'
import { promises as dns } from 'node:dns'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { connect as tlsConnect } from 'node:tls'
import { connect as netConnect } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setCveEnv, type DnsAnswer, type DnsType, type HttpOptions, type HttpResult, type TlsInfo } from '../src/cve/env'

const UA = 'ChainGraph-CVE/1.1 (+authorized security assessment)'

async function httpProbe(url: string, opts: HttpOptions = {}): Promise<HttpResult> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 12000)
  const started = Date.now()
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { 'user-agent': UA, accept: '*/*', ...opts.headers },
      redirect: opts.redirect === false ? 'manual' : 'follow',
      signal: ctl.signal,
    })
    const headers: Record<string, string> = {}
    res.headers.forEach((v, k) => (headers[k] = v))
    const max = opts.maxBytes ?? 65536
    let body = ''
    if (max > 0 && res.body) {
      const buf = await res.arrayBuffer()
      body = Buffer.from(buf.slice(0, max)).toString('utf8')
    } else if (max > 0) {
      body = (await res.text().catch(() => '')).slice(0, max)
    }
    return { status: res.status, finalUrl: res.url || url, redirects: res.redirected ? 1 : 0, headers, body, timeMs: Date.now() - started }
  } finally {
    clearTimeout(timer)
  }
}

function tlsProbe(host: string, port: number): Promise<TlsInfo> {
  return new Promise((resolve) => {
    const socket = tlsConnect({ host, port, servername: host, rejectUnauthorized: false, timeout: 8000 }, () => {
      const cert = socket.getPeerCertificate()
      const validTo = cert.valid_to ? new Date(cert.valid_to) : undefined
      const name = (o: Record<string, string> | undefined) => (o ? [o.CN, o.O].filter(Boolean).join(', ') : undefined)
      resolve({
        protocol: socket.getProtocol() ?? undefined,
        cipher: socket.getCipher()?.name,
        subject: name(cert.subject as never),
        issuer: name(cert.issuer as never),
        altNames: cert.subjectaltname?.split(',').map((s) => s.trim().replace(/^DNS:/, '')),
        validFrom: cert.valid_from,
        validTo: cert.valid_to,
        daysLeft: validTo ? Math.round((validTo.getTime() - Date.now()) / 86400000) : undefined,
        selfSigned: !!cert.issuer && !!cert.subject && JSON.stringify(cert.issuer) === JSON.stringify(cert.subject),
        authorized: socket.authorized,
        authError: socket.authorized ? undefined : (socket.authorizationError as unknown as string)?.toString(),
      })
      socket.end()
    })
    socket.on('error', (e) => resolve({ authError: e.message }))
    socket.on('timeout', () => {
      socket.destroy()
      resolve({ authError: 'timeout' })
    })
  })
}

function tcpProbe(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = netConnect({ host, port })
    socket.setTimeout(timeoutMs)
    socket.on('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.on('error', () => resolve(false))
    socket.on('timeout', () => {
      socket.destroy()
      resolve(false)
    })
  })
}

const CACHE_DIR = process.env.CHAINGRAPH_CACHE_DIR ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'chaingraph-mcp')
const mem = new Map<string, { t: number; v: unknown }>()
const file = (key: string) => join(CACHE_DIR, createHash('sha1').update(key).digest('hex') + '.json')
let dirReady: Promise<unknown> | null = null

const TYPE_NUM: Record<DnsType, number> = { A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, CAA: 257 }

async function resolve(name: string, type: DnsType): Promise<DnsAnswer[]> {
  const n = TYPE_NUM[type]
  const a = (data: string, ttl = 0): DnsAnswer => ({ name, type: n, TTL: ttl, data })
  try {
    switch (type) {
      case 'A':
        return (await dns.resolve4(name, { ttl: true })).map((r) => a(r.address, r.ttl))
      case 'AAAA':
        return (await dns.resolve6(name, { ttl: true })).map((r) => a(r.address, r.ttl))
      case 'CNAME':
        return (await dns.resolveCname(name)).map((r) => a(r + '.'))
      case 'NS':
        return (await dns.resolveNs(name)).map((r) => a(r + '.'))
      case 'PTR':
        return (await dns.resolvePtr(name)).map((r) => a(r + '.'))
      case 'MX':
        return (await dns.resolveMx(name)).map((r) => a(`${r.priority} ${r.exchange}.`))
      case 'TXT':
        return (await dns.resolveTxt(name)).map((r) => a(`"${r.join('')}"`))
      case 'SOA': {
        const s = await dns.resolveSoa(name)
        return [a(`${s.nsname}. ${s.hostmaster}.`)]
      }
      case 'CAA':
        return (await dns.resolveCaa(name)).map((r) => a(`${r.critical} ${Object.keys(r).find((k) => k !== 'critical')} "${Object.values(r).find((v) => typeof v === 'string')}"`))
    }
  } catch (e) {
    // "No such record" is an empty answer, not a failure.
    if (['ENODATA', 'ENOTFOUND', 'NXDOMAIN'].includes((e as NodeJS.ErrnoException).code ?? '')) return []
    throw e
  }
  return []
}

setCveEnv({
  browser: false,
  nvdKey: () => (process.env.NVD_API_KEY ?? '').trim(),
  active: { http: httpProbe, tls: tlsProbe, tcp: tcpProbe },
  dns: resolve,
  cacheGet: async <T,>(key: string) => {
    const hit = mem.get(key)
    if (hit) return hit as { t: number; v: T }
    try {
      const v = JSON.parse(await readFile(file(key), 'utf8')) as { t: number; v: T }
      mem.set(key, v)
      return v
    } catch {
      return undefined
    }
  },
  cacheSet: async (key, value) => {
    mem.set(key, value)
    dirReady ??= mkdir(CACHE_DIR, { recursive: true }).catch(() => {})
    await dirReady
    await writeFile(file(key), JSON.stringify(value)).catch(() => {})
  },
})
