// Shared UTXO logic (BTC, LTC, DOGE, BCH): converts raw transactions into
// address-to-address transfers and applies the classic chain-analysis heuristics.

import type { Transfer } from '../types'

export interface UtxoTx {
  txid: string
  time: number // ms
  inputs: { address?: string; value: number }[] // value in base units (sats)
  outputs: { address?: string; value: number }[]
}

export interface UtxoOptions {
  detectChange: boolean
  detectCoinjoin: boolean
}

/** Output script family, inferred from the address format. */
function scriptType(a: string): string {
  if (/^(bc1p|ltc1p)/i.test(a)) return 'p2tr'
  if (/^(bc1q|ltc1q)/i.test(a)) return a.length > 50 ? 'p2wsh' : 'p2wpkh'
  if (/^[3M]/.test(a)) return 'p2sh'
  if (/^[1LD]/.test(a)) return 'p2pkh'
  if (/^(bitcoincash:)?q/.test(a)) return 'p2pkh'
  return 'other'
}

/**
 * CoinJoin: several inputs and a large set of outputs with identical value
 * (Wasabi, Whirlpool, JoinMarket all produce this shape).
 */
export function isCoinjoin(tx: UtxoTx): boolean {
  const owners = new Set(tx.inputs.map((i) => i.address).filter(Boolean))
  // Several independent inputs, and outputs not wildly outnumbering them:
  // excludes exchange batch payouts (1–2 inputs, many outputs).
  if (owners.size < 3 || tx.outputs.length < 3 || tx.outputs.length > tx.inputs.length * 3) return false
  const freq = new Map<number, number>()
  for (const o of tx.outputs) freq.set(o.value, (freq.get(o.value) ?? 0) + 1)
  const top = Math.max(...freq.values())
  return top >= 3 && top >= tx.outputs.length * 0.3
}

const WHIRLPOOL = new Set([100000, 1000000, 5000000, 50000000])

/** Best guess of the CoinJoin implementation from the transaction shape. */
export function coinjoinKind(tx: UtxoTx): string {
  const freq = new Map<number, number>()
  for (const o of tx.outputs) freq.set(o.value, (freq.get(o.value) ?? 0) + 1)
  const [topVal, top] = [...freq.entries()].sort((a, b) => b[1] - a[1])[0]
  if (tx.inputs.length === 5 && tx.outputs.length === 5 && top === 5 && WHIRLPOOL.has(topVal)) return 'whirlpool'
  if (tx.inputs.length >= 20 && tx.outputs.length >= 20 && freq.size >= 8) return 'wasabi2'
  if (top >= 10 && Math.abs(topVal - 10_000_000) < 1_500_000) return 'wasabi'
  if (top >= 3 && top <= 15 && tx.outputs.length >= 2 * top - 1 && tx.outputs.length <= 2 * top + 1) return 'joinmarket'
  return 'generic'
}

const isRound = (sats: number) => sats % 100000 === 0 // multiple of 0.001 coin

/**
 * Change heuristic for a 2+ output payment: prefer an output that pays back to
 * an input address; otherwise the single output whose script type matches the
 * inputs; otherwise the single non-round output when the others are round.
 */
function findChange(tx: UtxoTx, inputAddrs: Set<string>): string | undefined {
  const outs = tx.outputs.filter((o) => o.address)
  if (outs.length < 2) return undefined
  const reuse = outs.filter((o) => inputAddrs.has(o.address!))
  if (reuse.length === 1) return reuse[0].address
  const inTypes = new Set([...inputAddrs].map(scriptType))
  if (inTypes.size === 1) {
    const t = [...inTypes][0]
    const same = outs.filter((o) => scriptType(o.address!) === t)
    if (same.length === 1) return same[0].address
  }
  const nonRound = outs.filter((o) => !isRound(o.value))
  if (nonRound.length === 1 && outs.length - 1 === outs.filter((o) => isRound(o.value)).length) return nonRound[0].address
  return undefined
}

export function toTransfers(
  tx: UtxoTx,
  me: string,
  asset: string,
  unit: number,
  opt: UtxoOptions,
): { transfers: Transfer[]; coSpend?: string[] } {
  const ins = tx.inputs.filter((v) => v.address)
  const totalIn = ins.reduce((s, v) => s + v.value, 0)
  const myIn = ins.filter((v) => v.address === me).reduce((s, v) => s + v.value, 0)
  const inputAddrs = new Set(ins.map((v) => v.address!))
  const cj = opt.detectCoinjoin && isCoinjoin(tx)
  const base = { hash: tx.txid, time: tx.time, asset, ...(cj ? { coinjoin: true as const, cjKind: coinjoinKind(tx) } : {}) }
  const out: Transfer[] = []

  if (myIn > 0) {
    const share = totalIn ? myIn / totalIn : 1
    const change = !cj && opt.detectChange ? findChange(tx, inputAddrs) : undefined
    for (const o of tx.outputs) {
      if (!o.address || o.address === me || o.value === 0) continue
      const t: Transfer = { ...base, from: me, to: o.address, amount: (o.value * share) / unit }
      if (o.address === change) t.change = true
      out.push(t)
    }
  } else {
    const received = tx.outputs.filter((o) => o.address === me).reduce((s, o) => s + o.value, 0)
    if (received > 0) {
      if (!ins.length) {
        out.push({ ...base, from: 'coinbase', to: me, amount: received / unit })
      } else {
        const byAddr = new Map<string, number>()
        for (const v of ins) byAddr.set(v.address!, (byAddr.get(v.address!) ?? 0) + v.value)
        for (const [a, val] of byAddr) out.push({ ...base, from: a, to: me, amount: (received * (val / totalIn)) / unit })
      }
    }
  }
  // Common-input ownership: every input address of a non-CoinJoin tx shares an owner.
  const coSpend = !cj && inputAddrs.size > 1 ? [...inputAddrs] : undefined
  return { transfers: out, coSpend }
}
