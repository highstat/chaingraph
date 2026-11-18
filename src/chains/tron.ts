import type { FetchResult, Transfer } from '../types'
import { tronHexToBase58 } from './base58'
import { getJSON } from './http'

const API = 'https://api.trongrid.io/v1/accounts'
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
// Official Tether contract on TRON. Anything else calling itself USDT is a fake.
// TRX is the native coin and never a TRC-20; USDC on TRON was discontinued
// (its contract is now "USDCOLD"), so TRC-20s using these symbols are impersonations.
const OFFICIAL: Record<string, string | null> = { USDT, TRX: null, USDC: null }

interface Cursor {
  trc20: string | null
  native: string | null
}

export async function fetchTron(address: string, cursorStr?: string): Promise<FetchResult> {
  const cursor: Cursor | null = cursorStr ? JSON.parse(cursorStr) : null
  const first = !cursor
  const fp = (f: string | null | undefined) => (f ? `&fingerprint=${encodeURIComponent(f)}` : '')

  // Sequential on purpose: TronGrid without a key allows only a few requests per second.
  const acct = first ? await getJSON(`${API}/${address}`) : null
  const trc20 =
    first || cursor?.trc20
      ? await getJSON(`${API}/${address}/transactions/trc20?limit=50${fp(cursor?.trc20)}`)
      : null
  const native =
    first || cursor?.native
      ? await getJSON(`${API}/${address}/transactions?limit=50${fp(cursor?.native)}`)
      : null

  const transfers: Transfer[] = []
  for (const t of trc20?.data ?? []) {
    const dec = Number(t.token_info?.decimals ?? 6)
    const amount = Number(t.value) / 10 ** dec
    // Zero/dust transfers are the classic address-poisoning pattern; drop them.
    if (!amount || t.type !== 'Transfer') continue
    transfers.push({
      hash: t.transaction_id,
      time: t.block_timestamp,
      from: t.from,
      to: t.to,
      asset: assetName(t.token_info?.symbol ?? 'TRC20', t.token_info?.address),
      amount,
    })
  }
  for (const t of native?.data ?? []) {
    const c = t.raw_data?.contract?.[0]
    if (c?.type !== 'TransferContract' || t.ret?.[0]?.contractRet !== 'SUCCESS') continue
    const v = c.parameter.value
    if (!v.amount) continue
    transfers.push({
      hash: t.txID,
      time: t.block_timestamp,
      from: await tronHexToBase58(v.owner_address),
      to: await tronHexToBase58(v.to_address),
      asset: 'TRX',
      amount: v.amount / 1e6,
    })
  }

  const next: Cursor = {
    trc20: first || cursor?.trc20 ? (trc20?.meta?.fingerprint ?? null) : null,
    native: first || cursor?.native ? (native?.meta?.fingerprint ?? null) : null,
  }

  let info: FetchResult['info']
  if (acct) {
    const a = acct.data?.[0]
    const usdtRaw = (a?.trc20 ?? []).find((x: Record<string, string>) => x[USDT])?.[USDT]
    info = {
      balance: a ? (a.balance ?? 0) / 1e6 : 0,
      balanceAsset: 'TRX',
      apiTags: a ? [] : ['Account not activated'],
      tokens: usdtRaw ? [{ symbol: 'USDT', amount: Number(usdtRaw) / 1e6 }] : [],
    }
  }

  return {
    info,
    transfers,
    prices: { USDT: 1 },
    cursor: next.trc20 || next.native ? JSON.stringify(next) : undefined,
  }
}

/** Tokens that copy a stablecoin symbol from a non-official contract are scams. */
function assetName(symbol: string, contract?: string): string {
  const key = symbol.toUpperCase()
  if (!(key in OFFICIAL)) return symbol
  const official = OFFICIAL[key]
  if (official === null || (contract && contract !== official)) return `${symbol} (fake)`
  return symbol
}
