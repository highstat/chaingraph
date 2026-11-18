// Solana via a public JSON-RPC (PublicNode, keyless). Native SOL and SPL token
// transfers are read from parsed instructions; token accounts are mapped to
// their owners through pre/post token balances.

import type { FetchResult, Transfer } from '../types'
import { HttpError } from './http'

const RPC = 'https://solana-rpc.publicnode.com'
const PAGE = 15

export const KNOWN_MINTS: Record<string, { symbol: string; decimals: number }> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', decimals: 6 },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: 'USDT', decimals: 6 },
  So11111111111111111111111111111111111111112: { symbol: 'SOL', decimals: 9 },
}

let nextSlot = 0
async function rpc<T = any>(body: unknown): Promise<T> {
  const now = Date.now()
  const slot = Math.max(now, nextSlot)
  nextSlot = slot + 250
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now))
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 25000)
  try {
    const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal })
    if (res.status === 429) throw new HttpError(429, 'Solana RPC rate limit, wait a moment')
    if (!res.ok) throw new HttpError(res.status, `Solana RPC responded ${res.status}`)
    return (await res.json()) as T
  } catch (e) {
    if (e instanceof HttpError) throw e
    throw new HttpError(0, ctl.signal.aborted ? 'Solana RPC timed out' : 'Solana RPC unreachable')
  } finally {
    clearTimeout(timer)
  }
}

interface ParsedIx {
  program?: string
  parsed?: { type?: string; info?: Record<string, any> }
}

/** Extract every SOL / SPL transfer from one jsonParsed transaction. */
export function parseSolanaTx(tx: any): Transfer[] {
  if (!tx || tx.meta?.err) return []
  const keys: string[] = tx.transaction.message.accountKeys.map((k: any) => (typeof k === 'string' ? k : k.pubkey))
  const owners = new Map<string, { owner: string; mint: string; decimals: number }>()
  for (const b of [...(tx.meta.preTokenBalances ?? []), ...(tx.meta.postTokenBalances ?? [])]) {
    owners.set(keys[b.accountIndex], { owner: b.owner, mint: b.mint, decimals: b.uiTokenAmount?.decimals ?? 0 })
  }
  const ixs: ParsedIx[] = [
    ...tx.transaction.message.instructions,
    ...(tx.meta.innerInstructions ?? []).flatMap((x: any) => x.instructions),
  ]
  const hash = tx.transaction.signatures[0]
  const time = (tx.blockTime ?? 0) * 1000
  const out: Transfer[] = []
  for (const ix of ixs) {
    const t = ix.parsed?.type
    const info = ix.parsed?.info
    if (!info) continue
    if (ix.program === 'system' && (t === 'transfer' || t === 'transferWithSeed') && info.lamports > 0) {
      out.push({ hash, time, from: info.source, to: info.destination, asset: 'SOL', amount: info.lamports / 1e9 })
    } else if ((ix.program === 'spl-token' || ix.program === 'spl-token-2022') && (t === 'transfer' || t === 'transferChecked')) {
      const src = owners.get(info.source)
      const dst = owners.get(info.destination)
      const mint: string = info.mint ?? src?.mint ?? dst?.mint ?? ''
      const known = KNOWN_MINTS[mint]
      const decimals = info.tokenAmount?.decimals ?? known?.decimals ?? src?.decimals ?? dst?.decimals ?? 0
      const raw = info.tokenAmount?.amount ?? info.amount
      const amount = Number(raw) / 10 ** decimals
      const from = info.authority ?? info.multisigAuthority ?? src?.owner
      const to = dst?.owner
      if (!amount || !from || !to) continue
      out.push({ hash, time, from, to, asset: known?.symbol ?? `SPL:${mint.slice(0, 4)}`, amount })
    }
  }
  return out
}

export async function fetchSolTx(sig: string): Promise<Transfer[]> {
  const r = await rpc({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }] })
  return parseSolanaTx(r.result)
}

export async function fetchSolana(address: string, cursor?: string): Promise<FetchResult> {
  const sigReq = { jsonrpc: '2.0', id: 1, method: 'getSignaturesForAddress', params: [address, { limit: PAGE, ...(cursor ? { before: cursor } : {}) }] }
  const [sigRes, balRes] = await Promise.all([
    rpc(sigReq),
    cursor ? null : rpc({ jsonrpc: '2.0', id: 2, method: 'getBalance', params: [address] }),
  ])
  if (sigRes.error) throw new Error(`Solana: ${sigRes.error.message}`)
  const sigs: { signature: string; err: unknown }[] = sigRes.result ?? []
  const ok = sigs.filter((s) => !s.err)
  let transfers: Transfer[] = []
  if (ok.length) {
    // PublicNode allows a single getTransaction per request, so fetch them one by one (rate-spaced by rpc()).
    for (const s of ok) {
      const r = await rpc({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }] }).catch(() => null)
      if (r?.result) transfers.push(...parseSolanaTx(r.result))
    }
    transfers = transfers.filter((t) => t.from === address || t.to === address)
  }
  return {
    transfers,
    cursor: sigs.length === PAGE ? sigs[sigs.length - 1].signature : undefined,
    prices: { USDC: 1, USDT: 1 },
    info: balRes ? { balance: (balRes.result?.value ?? 0) / 1e9, balanceAsset: 'SOL', apiTags: [] } : undefined,
  }
}
