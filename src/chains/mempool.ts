// mempool.space-compatible explorers: Bitcoin (mempool.space), Litecoin (litecoinspace.org).

import type { FetchResult } from '../types'
import { getJSON } from './http'
import { toTransfers, type UtxoOptions, type UtxoTx } from './utxo'

interface MTx {
  txid: string
  vin: { prevout?: { scriptpubkey_address?: string; value: number } }[]
  vout: { scriptpubkey_address?: string; value: number }[]
  status: { confirmed: boolean; block_time?: number }
}

const norm = (t: MTx): UtxoTx => ({
  txid: t.txid,
  time: t.status.block_time ? t.status.block_time * 1000 : Date.now(),
  inputs: t.vin.map((v) => ({ address: v.prevout?.scriptpubkey_address, value: v.prevout?.value ?? 0 })),
  outputs: t.vout.map((o) => ({ address: o.scriptpubkey_address, value: o.value })),
})

export async function fetchMempool(
  host: string,
  asset: string,
  address: string,
  cursor: string | undefined,
  opt: UtxoOptions,
): Promise<FetchResult> {
  const api = `https://${host}/api`
  const txsUrl = cursor ? `${api}/address/${address}/txs/chain/${cursor}` : `${api}/address/${address}/txs`
  const [info, txs, prices] = await Promise.all([
    cursor ? null : getJSON(`${api}/address/${address}`),
    getJSON<MTx[]>(txsUrl),
    cursor ? null : getJSON(`${api}/v1/prices`, 5000).catch(() => null),
  ])
  const transfers = []
  const coSpends: string[][] = []
  for (const t of txs) {
    const r = toTransfers(norm(t), address, asset, 1e8, opt)
    transfers.push(...r.transfers)
    if (r.coSpend) coSpends.push(r.coSpend)
  }
  const confirmed = txs.filter((t) => t.status.confirmed)
  const s = info?.chain_stats
  const m = info?.mempool_stats
  return {
    transfers,
    coSpends,
    cursor: confirmed.length >= 25 ? confirmed[confirmed.length - 1].txid : undefined,
    prices: prices?.USD ? { [asset]: prices.USD } : undefined,
    info: info
      ? {
          balance: (s.funded_txo_sum - s.spent_txo_sum + m.funded_txo_sum - m.spent_txo_sum) / 1e8,
          balanceAsset: asset,
          txCount: s.tx_count + m.tx_count,
          apiTags: [],
        }
      : undefined,
  }
}
