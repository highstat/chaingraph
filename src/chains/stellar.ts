// Stellar via Horizon (keyless). Payments, path payments and account creation
// (which reveals the funder of an account).

import type { FetchResult, Transfer } from '../types'
import { getJSON } from './http'

const API = 'https://horizon.stellar.org'

export async function fetchStellar(address: string, cursor?: string): Promise<FetchResult> {
  const [pay, acct] = await Promise.all([
    getJSON(`${API}/accounts/${address}/payments?limit=100&order=desc${cursor ? `&cursor=${cursor}` : ''}`),
    cursor ? null : getJSON(`${API}/accounts/${address}`).catch(() => null),
  ])
  const recs: any[] = pay._embedded?.records ?? []
  const transfers: Transfer[] = []
  for (const r of recs) {
    const time = Date.parse(r.created_at)
    const asset = r.asset_type === 'native' ? 'XLM' : r.asset_code ?? 'ASSET'
    if (r.type === 'create_account') {
      transfers.push({ hash: r.transaction_hash, time, from: r.funder, to: r.account, asset: 'XLM', amount: Number(r.starting_balance) })
    } else if (r.type === 'payment' || r.type?.startsWith('path_payment')) {
      const amount = Number(r.amount)
      if (amount) transfers.push({ hash: r.transaction_hash, time, from: r.from, to: r.to, asset, amount })
    }
  }
  const native = acct?.balances?.find((b: any) => b.asset_type === 'native')
  return {
    transfers,
    cursor: recs.length === 100 ? recs[recs.length - 1].paging_token : undefined,
    prices: { USDC: 1 },
    info: acct
      ? {
          balance: Number(native?.balance ?? 0),
          balanceAsset: 'XLM',
          apiTags: acct.home_domain ? [`home domain: ${acct.home_domain}`] : [],
          tokens: (acct.balances ?? []).filter((b: any) => b.asset_type !== 'native').slice(0, 8).map((b: any) => ({ symbol: b.asset_code, amount: Number(b.balance) })),
        }
      : cursor
        ? undefined
        : { apiTags: ['Account not found'] },
  }
}
