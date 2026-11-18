// TON via toncenter API v3 (keyless, ~1 req/s). Addresses are normalized to the
// non-bounceable user-friendly form (UQ…) so raw and EQ forms map to one node.

import type { FetchResult, Transfer } from '../types'
import { getJSON } from './http'

const API = 'https://toncenter.com/api/v3'
const PAGE = 40
const USDT_MASTER = '0:B113A994B5024A16719F69139328EB759596C38A25F59028B146FECDC3621DFE'

function crc16(data: Uint8Array): number {
  let crc = 0
  for (const b of data) {
    crc ^= b << 8
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_')
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

/** raw "wc:hex" or EQ/UQ/kQ/0Q → UQ… (mainnet, non-bounceable). */
export function tonFriendly(addr: string): string {
  let wc: number
  let hash: Uint8Array
  const raw = addr.match(/^(-?\d+):([0-9a-fA-F]{64})$/)
  if (raw) {
    wc = Number(raw[1])
    hash = Uint8Array.from(raw[2].match(/../g)!.map((h) => parseInt(h, 16)))
  } else {
    const b = fromB64url(addr)
    if (b.length !== 36) return addr
    wc = b[1] === 0xff ? -1 : b[1]
    hash = b.slice(2, 34)
  }
  const body = new Uint8Array(34)
  body[0] = 0x51
  body[1] = wc & 0xff
  body.set(hash, 2)
  const c = crc16(body)
  const full = new Uint8Array(36)
  full.set(body)
  full[34] = c >> 8
  full[35] = c & 0xff
  return b64url(full)
}

export async function fetchTon(address: string, cursor?: string): Promise<FetchResult> {
  const off = cursor ? JSON.parse(cursor) : { tx: 0, jt: 0, txDone: false, jtDone: false }
  const acct = !cursor ? await getJSON(`${API}/account?address=${address}`).catch(() => null) : null
  const txs = !off.txDone ? await getJSON(`${API}/transactions?account=${address}&limit=${PAGE}&offset=${off.tx}&sort=desc`) : { transactions: [] }
  const jts = !off.jtDone ? await getJSON(`${API}/jetton/transfers?owner_address=${address}&limit=${PAGE}&offset=${off.jt}&sort=desc`).catch(() => ({ jetton_transfers: [] })) : { jetton_transfers: [] }

  const transfers: Transfer[] = []
  for (const t of txs.transactions ?? []) {
    const time = t.now * 1000
    const im = t.in_msg
    if (im?.source && Number(im.value) > 0) {
      transfers.push({ hash: t.hash, time, from: tonFriendly(im.source), to: address, asset: 'TON', amount: Number(im.value) / 1e9 })
    }
    for (const om of t.out_msgs ?? []) {
      if (om.destination && Number(om.value) > 0) {
        transfers.push({ hash: t.hash, time, from: address, to: tonFriendly(om.destination), asset: 'TON', amount: Number(om.value) / 1e9 })
      }
    }
  }
  for (const j of jts.jetton_transfers ?? []) {
    if (j.transaction_aborted || !j.source || !j.destination) continue
    const usdt = j.jetton_master === USDT_MASTER
    const amount = Number(j.amount) / 10 ** (usdt ? 6 : 9)
    if (!amount) continue
    transfers.push({
      hash: j.transaction_hash,
      time: j.transaction_now * 1000,
      from: tonFriendly(j.source),
      to: tonFriendly(j.destination),
      asset: usdt ? 'USDT' : `JET:${j.jetton_master.slice(2, 6)}`,
      amount,
    })
  }
  const n1 = (txs.transactions ?? []).length
  const n2 = (jts.jetton_transfers ?? []).length
  const next = { tx: off.tx + n1, jt: off.jt + n2, txDone: off.txDone || n1 < PAGE, jtDone: off.jtDone || n2 < PAGE }
  return {
    transfers,
    cursor: next.txDone && next.jtDone ? undefined : JSON.stringify(next),
    prices: { USDT: 1 },
    info: acct ? { balance: Number(acct.balance ?? 0) / 1e9, balanceAsset: 'TON', apiTags: acct.status === 'uninit' ? ['Uninitialized wallet'] : [] } : cursor ? undefined : { apiTags: [] },
  }
}
