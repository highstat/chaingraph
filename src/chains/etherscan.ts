// Etherscan API V2: one free key covers many EVM chains via `chainid`.
// Some chains may require a paid plan; the API's own error message is surfaced.

import type { FetchResult, Transfer } from '../types'
import { getJSON } from './http'

const PAGE = 100

interface Cursor {
  page: number
  tx: boolean
  tt: boolean
}

async function call(chainid: number, key: string, params: Record<string, string>) {
  const q = new URLSearchParams({ chainid: String(chainid), apikey: key, ...params })
  const r = await getJSON(`https://api.etherscan.io/v2/api?${q}`)
  if (r.status === '1') return r.result
  const msg = String(r.message ?? '')
  if (/no transactions found|no records found/i.test(msg) || (Array.isArray(r.result) && !r.result.length)) return []
  throw new Error(`Etherscan: ${typeof r.result === 'string' ? r.result : msg}`)
}

export async function fetchEtherscan(
  chainid: number,
  native: string,
  key: string,
  address: string,
  cursorStr?: string,
): Promise<FetchResult> {
  if (!key) throw new Error('This network needs a free Etherscan API key. Add one in Settings → Data sources.')
  const cur: Cursor = cursorStr ? JSON.parse(cursorStr) : { page: 1, tx: true, tt: true }
  const base = { module: 'account', address, page: String(cur.page), offset: String(PAGE), sort: 'desc' }

  // Sequential: free keys allow 3 req/s.
  const balance = cur.page === 1 ? await call(chainid, key, { module: 'account', action: 'balance', address }) : null
  const txs = cur.tx ? await call(chainid, key, { ...base, action: 'txlist' }) : []
  const tts = cur.tt ? await call(chainid, key, { ...base, action: 'tokentx' }) : []

  const transfers: Transfer[] = []
  for (const t of txs) {
    if (t.isError === '1' || t.value === '0' || !t.to) continue
    transfers.push({
      hash: t.hash,
      time: Number(t.timeStamp) * 1000,
      from: t.from.toLowerCase(),
      to: t.to.toLowerCase(),
      asset: native,
      amount: Number(t.value) / 1e18,
    })
  }
  for (const t of tts) {
    const amount = Number(t.value) / 10 ** Number(t.tokenDecimal || 18)
    if (!amount) continue
    transfers.push({
      hash: t.hash,
      time: Number(t.timeStamp) * 1000,
      from: t.from.toLowerCase(),
      to: t.to.toLowerCase(),
      asset: t.tokenSymbol || 'TOKEN',
      amount,
    })
  }
  const next: Cursor = { page: cur.page + 1, tx: txs.length === PAGE, tt: tts.length === PAGE }
  return {
    transfers,
    cursor: next.tx || next.tt ? JSON.stringify(next) : undefined,
    info:
      balance != null
        ? { balance: Number(balance) / 1e18, balanceAsset: native, apiTags: [] }
        : undefined,
  }
}
