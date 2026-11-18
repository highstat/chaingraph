// Blockchair (keyless, ~30 req/min): Dogecoin, Bitcoin Cash.

import type { FetchResult } from '../types'
import { getJSON } from './http'
import { toTransfers, type UtxoOptions, type UtxoTx } from './utxo'

const PAGE = 10 // the transactions dashboard accepts up to 10 hashes per call

export async function fetchBlockchair(
  slug: string, // 'dogecoin' | 'bitcoin-cash'
  asset: string,
  address: string,
  cursor: string | undefined,
  opt: UtxoOptions,
): Promise<FetchResult> {
  const offset = cursor ? Number(cursor) : 0
  const dash = await getJSON(`https://api.blockchair.com/${slug}/dashboards/address/${address}?limit=${PAGE}&offset=${offset}`)
  const row = Object.values(dash.data ?? {})[0] as any
  if (!row) throw new Error('Address not found on this network')
  const hashes: string[] = row.transactions ?? []
  const price = Number(dash.context?.market_price_usd) || undefined

  const transfers = []
  const coSpends: string[][] = []
  if (hashes.length) {
    const txd = await getJSON(`https://api.blockchair.com/${slug}/dashboards/transactions/${hashes.join(',')}`)
    for (const h of hashes) {
      const t = txd.data?.[h]
      if (!t) continue
      const tx: UtxoTx = {
        txid: h,
        time: Date.parse(t.transaction.time.replace(' ', 'T') + 'Z'),
        inputs: t.inputs.map((i: any) => ({ address: i.recipient, value: Number(i.value) })),
        outputs: t.outputs.map((o: any) => ({ address: o.recipient, value: Number(o.value) })),
      }
      const r = toTransfers(tx, address, asset, 1e8, opt)
      transfers.push(...r.transfers)
      if (r.coSpend) coSpends.push(r.coSpend)
    }
  }
  const a = row.address
  const total = Number(a.transaction_count ?? 0)
  return {
    transfers,
    coSpends,
    cursor: offset + PAGE < total ? String(offset + PAGE) : undefined,
    prices: price ? { [asset]: price } : undefined,
    info: cursor
      ? undefined
      : { balance: Number(a.balance) / 1e8, balanceAsset: asset, txCount: total, apiTags: [] },
  }
}
