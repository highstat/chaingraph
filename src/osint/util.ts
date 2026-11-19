// Shared helpers for the OSINT toolkit: DNS over HTTPS, hashing, crypto-address
// extraction (pivot into the graph), and saving results into the active case.

import { detectChain } from '../chains'
import { toast, useCases } from '../store'
import type { ChainId } from '../types'

export interface DnsAnswer {
  name: string
  type: number
  TTL: number
  data: string
}

export const DNS_TYPES: Record<string, number> = { A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, SRV: 33, CAA: 257 }

/**
 * Resolvers in order of preference. JSON APIs first, then RFC 8484 wire-format
 * endpoints, which many more resolvers support (and which survive networks that
 * block the big public JSON resolvers). The last resolver that answered is
 * tried first next time.
 */
const DOH: { id: string; kind: 'json' | 'wire'; url: string }[] = [
  { id: 'google', kind: 'json', url: 'https://dns.google/resolve' },
  { id: 'cloudflare', kind: 'json', url: 'https://cloudflare-dns.com/dns-query' },
  { id: 'controld', kind: 'wire', url: 'https://freedns.controld.com/p0' },
  { id: 'alidns', kind: 'json', url: 'https://dns.alidns.com/resolve' },
  { id: 'quad9', kind: 'wire', url: 'https://dns.quad9.net/dns-query' },
  { id: 'adguard', kind: 'wire', url: 'https://unfiltered.adguard-dns.com/dns-query' },
  { id: 'mullvad', kind: 'wire', url: 'https://dns.mullvad.net/dns-query' },
]
let preferred = 0
let dohDownUntil = 0

export const dohAvailable = () => Date.now() > dohDownUntil

function wireQuery(name: string, type: number): string {
  const labels = name.replace(/\.$/, '').split('.')
  const bytes: number[] = [0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0]
  for (const l of labels) {
    const enc = new TextEncoder().encode(l)
    bytes.push(enc.length, ...enc)
  }
  bytes.push(0, type >> 8, type & 255, 0, 1)
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function wireParse(buf: ArrayBuffer): DnsAnswer[] {
  const b = new Uint8Array(buf)
  const v = new DataView(buf)
  const readName = (off: number): [string, number] => {
    const parts: string[] = []
    let end = -1
    for (let guard = 0; guard < 128; guard++) {
      const len = b[off]
      if (len === 0) {
        off++
        break
      }
      if ((len & 0xc0) === 0xc0) {
        if (end < 0) end = off + 2
        off = ((len & 0x3f) << 8) | b[off + 1]
        continue
      }
      parts.push(new TextDecoder().decode(b.subarray(off + 1, off + 1 + len)))
      off += len + 1
    }
    return [parts.join('.') + '.', end < 0 ? off : end]
  }
  const qd = v.getUint16(4)
  const an = v.getUint16(6)
  let off = 12
  for (let i = 0; i < qd; i++) off = readName(off)[1] + 4
  const out: DnsAnswer[] = []
  for (let i = 0; i < an && off < b.length; i++) {
    const [name, o] = readName(off)
    const type = v.getUint16(o)
    const ttl = v.getUint32(o + 4)
    const len = v.getUint16(o + 8)
    const rd = o + 10
    let data = ''
    if (type === 1) data = [...b.subarray(rd, rd + 4)].join('.')
    else if (type === 28) {
      const g: string[] = []
      for (let k = 0; k < 16; k += 2) g.push(v.getUint16(rd + k).toString(16))
      // Compress the longest run of zero groups (RFC 5952).
      let best = [-1, 0]
      for (let k = 0, run = 0; k <= 8; k++) {
        if (k < 8 && g[k] === '0') run++
        else {
          if (run > 1 && run > best[1]) best = [k - run, run]
          run = 0
        }
      }
      data = best[0] < 0 ? g.join(':') : `${g.slice(0, best[0]).join(':')}::${g.slice(best[0] + best[1]).join(':')}`
    } else if (type === 5 || type === 2 || type === 12) data = readName(rd)[0]
    else if (type === 15) data = `${v.getUint16(rd)} ${readName(rd + 2)[0]}`
    else if (type === 16) {
      const chunks: string[] = []
      for (let k = rd; k < rd + len; ) {
        const l = b[k]
        chunks.push(new TextDecoder().decode(b.subarray(k + 1, k + 1 + l)))
        k += l + 1
      }
      data = `"${chunks.join('')}"`
    } else if (type === 6) {
      const [mname, o2] = readName(rd)
      const [rname] = readName(o2)
      data = `${mname} ${rname}`
    } else if (type === 257) {
      const tl = b[rd + 1]
      data = `${b[rd]} ${new TextDecoder().decode(b.subarray(rd + 2, rd + 2 + tl))} "${new TextDecoder().decode(b.subarray(rd + 2 + tl, rd + len))}"`
    } else data = [...b.subarray(rd, rd + len)].map((x) => x.toString(16).padStart(2, '0')).join('')
    out.push({ name, type, TTL: ttl, data })
    off = rd + len
  }
  return out
}

async function ask(p: (typeof DOH)[number], name: string, type: keyof typeof DNS_TYPES): Promise<DnsAnswer[]> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 4000)
  try {
    if (p.kind === 'json') {
      const res = await fetch(`${p.url}?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' }, signal: ctl.signal })
      if (!res.ok) throw new Error(String(res.status))
      const r = await res.json()
      return r.Answer ?? []
    }
    const res = await fetch(`${p.url}?dns=${wireQuery(name, DNS_TYPES[type])}`, { headers: { accept: 'application/dns-message' }, signal: ctl.signal })
    if (!res.ok) throw new Error(String(res.status))
    return wireParse(await res.arrayBuffer())
  } finally {
    clearTimeout(timer)
  }
}

/**
 * DNS over HTTPS across several providers (4 s timeout each), starting with the
 * one that last worked. If every provider fails, DNS is skipped for 2 minutes
 * so the tools stay responsive.
 */
export async function doh(name: string, type: keyof typeof DNS_TYPES): Promise<DnsAnswer[]> {
  if (!dohAvailable()) throw new Error('DNS-over-HTTPS unavailable on this network')
  for (let k = 0; k < DOH.length; k++) {
    const i = (preferred + k) % DOH.length
    try {
      const r = await ask(DOH[i], name, type)
      preferred = i
      return r
    } catch {
      /* next provider */
    }
  }
  dohDownUntil = Date.now() + 120000
  throw new Error('DNS-over-HTTPS unavailable on this network')
}

/** Fallback DNS via HackerTarget (plain text, ~50 free queries/day). */
export async function dnsFallback(domain: string): Promise<{ type: string; data: string }[]> {
  const res = await fetch(`https://api.hackertarget.com/dnslookup/?q=${encodeURIComponent(domain)}`)
  const text = await res.text()
  if (/error|API count exceeded/i.test(text)) return []
  return text
    .split('\n')
    .map((l) => l.match(/^(A|AAAA|MX|NS|TXT|CNAME|SOA|CAA)\s*:\s*(.+)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ type: m[1], data: m[2].trim() }))
}

export async function sha256Hex(text: string | ArrayBuffer): Promise<string> {
  const data = typeof text === 'string' ? new TextEncoder().encode(text) : new Uint8Array(text)
  const buf = await crypto.subtle.digest('SHA-256', data as BufferSource)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Find crypto addresses in free text (profile bios, TXT records, EXIF comments…). */
export function extractCrypto(text: string): { address: string; chain: ChainId }[] {
  const out = new Map<string, ChainId>()
  for (const tok of text.split(/[^A-Za-z0-9:_-]+/)) {
    if (tok.length < 26 || tok.length > 110) continue
    const chain = detectChain(tok)
    // Solana's format is a generic base58 string: only accept it with letters and digits mixed.
    if (!chain || (chain === 'sol' && !(/[0-9]/.test(tok) && /[a-z]/.test(tok) && /[A-Z]/.test(tok)))) continue
    out.set(tok, chain)
  }
  return [...out].map(([address, chain]) => ({ address, chain }))
}

/** Append a Markdown block to the active case's notes. */
export function saveToCase(title: string, markdown: string) {
  const st = useCases.getState()
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  st.update(st.activeId, (c) => ({ ...c, note: `${c.note ? c.note.trimEnd() + '\n\n' : ''}## ${title} (${stamp})\n\n${markdown.trim()}\n` }))
  toast('Saved to case notes', 'success')
}

export const enc = encodeURIComponent

export function ago(ms: number): string {
  const d = (Date.now() - ms) / 86400000
  if (d < 1) return 'today'
  if (d < 31) return `${Math.floor(d)} d ago`
  if (d < 365) return `${Math.floor(d / 30)} mo ago`
  return `${(d / 365).toFixed(1)} y ago`
}
