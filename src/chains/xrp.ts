// XRP Ledger via the public xrplcluster.com JSON-RPC (keyless). Destination tags
// are kept as memos: on XRP they usually identify an exchange customer account.

import type { FetchResult, Transfer } from '../types'
import { HttpError } from './http'

const RPC = 'https://xrplcluster.com/'
const RIPPLE_EPOCH = 946684800
const PAGE = 50

async function call(method: string, params: Record<string, unknown>) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 20000)
  try {
    const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params: [params] }), signal: ctl.signal })
    if (!res.ok) throw new HttpError(res.status, `XRPL responded ${res.status}`)
    const j = await res.json()
    if (j.result?.status === 'error') throw new Error(`XRPL: ${j.result.error_message || j.result.error}`)
    return j.result
  } catch (e) {
    if (e instanceof Error && !(e.name === 'AbortError')) throw e
    throw new HttpError(0, 'XRPL node timed out')
  } finally {
    clearTimeout(timer)
  }
}

function currency(code: string): string {
  if (code.length !== 40) return code
  const txt = code.replace(/(00)+$/, '').match(/../g)?.map((h) => String.fromCharCode(parseInt(h, 16))).join('') ?? code
  return /^[\x20-\x7e]+$/.test(txt) ? txt : code.slice(0, 6)
}

function amountOf(a: any): { asset: string; amount: number } | null {
  if (a == null) return null
  if (typeof a === 'string') return { asset: 'XRP', amount: Number(a) / 1e6 }
  return { asset: currency(a.currency), amount: Number(a.value) }
}

export async function fetchXrp(address: string, cursor?: string): Promise<FetchResult> {
  const [txr, info] = await Promise.all([
    call('account_tx', { account: address, limit: PAGE, ...(cursor ? { marker: JSON.parse(cursor) } : {}) }),
    cursor ? null : call('account_info', { account: address, ledger_index: 'validated' }).catch(() => null),
  ])
  const transfers: Transfer[] = []
  for (const row of txr.transactions ?? []) {
    const tx = row.tx ?? row.tx_json
    if (!tx || row.meta?.TransactionResult !== 'tesSUCCESS') continue
    if (tx.TransactionType !== 'Payment') continue
    const amt = amountOf(row.meta.delivered_amount ?? tx.DeliverMax ?? tx.Amount)
    if (!amt || !amt.amount) continue
    transfers.push({
      hash: tx.hash ?? row.hash,
      time: ((tx.date ?? 0) + RIPPLE_EPOCH) * 1000,
      from: tx.Account,
      to: tx.Destination,
      asset: amt.asset,
      amount: amt.amount,
      ...(tx.DestinationTag != null ? { memo: `tag ${tx.DestinationTag}` } : {}),
    })
  }
  return {
    transfers,
    cursor: txr.marker ? JSON.stringify(txr.marker) : undefined,
    info: info
      ? { balance: Number(info.account_data?.Balance ?? 0) / 1e6, balanceAsset: 'XRP', apiTags: [] }
      : cursor
        ? undefined
        : { apiTags: ['Account not found or not activated'] },
  }
}
