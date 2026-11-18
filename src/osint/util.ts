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

const DOH = [
  (q: string) => `https://dns.google/resolve?${q}`,
  (q: string) => `https://cloudflare-dns.com/dns-query?${q}`,
  (q: string) => `https://dns.alidns.com/resolve?${q}`,
]
let dohDownUntil = 0

export const dohAvailable = () => Date.now() > dohDownUntil

/**
 * DNS over HTTPS with provider fallback and a 5 s timeout each. If every
 * provider fails (some networks block DoH), DNS is skipped for 2 minutes so
 * the tools stay responsive.
 */
export async function doh(name: string, type: keyof typeof DNS_TYPES): Promise<DnsAnswer[]> {
  if (!dohAvailable()) throw new Error('DNS-over-HTTPS unavailable on this network')
  const q = `name=${encodeURIComponent(name)}&type=${type}`
  for (const url of DOH) {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 5000)
    try {
      const res = await fetch(url(q), { headers: { accept: 'application/dns-json' }, signal: ctl.signal })
      if (!res.ok) continue
      const r = await res.json()
      return r.Answer ?? []
    } catch {
      /* next provider */
    } finally {
      clearTimeout(timer)
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
