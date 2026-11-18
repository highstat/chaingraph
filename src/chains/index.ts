import type { ChainId, FetchResult, Transfer } from '../types'
import { tronHexToBase58 } from './base58'
import { fetchBlockchair } from './blockchair'
import { fetchEtherscan } from './etherscan'
import { fetchEvm } from './evm'
import { getJSON } from './http'
import { fetchMempool } from './mempool'
import { spotPrices } from './prices'
import { fetchSolana, fetchSolTx } from './solana'
import { fetchStellar } from './stellar'
import { fetchTon, tonFriendly } from './ton'
import { fetchTron } from './tron'
import type { UtxoOptions } from './utxo'
import { fetchXrp } from './xrp'

export type Family = 'utxo' | 'evm' | 'tron' | 'sol' | 'ton' | 'xrp' | 'xlm'

export interface ChainMeta {
  id: ChainId
  name: string
  symbol: string
  color: string
  family: Family
  keyless: boolean
  blockscout?: string // host, for Blockscout-backed EVM chains
  explorer: (addr: string) => string
  txExplorer: (hash: string) => string
}

const scan = (host: string) => ({
  explorer: (a: string) => `https://${host}/address/${a}`,
  txExplorer: (h: string) => `https://${host}/tx/${h}`,
})
const bs = (host: string) => ({ blockscout: host, ...scan(host) })
const chair = (slug: string) => ({
  explorer: (a: string) => `https://blockchair.com/${slug}/address/${a}`,
  txExplorer: (h: string) => `https://blockchair.com/${slug}/transaction/${h}`,
})

export const CHAINS: Record<ChainId, ChainMeta> = {
  btc: { id: 'btc', name: 'Bitcoin', symbol: 'BTC', color: '#f7931a', family: 'utxo', keyless: true, explorer: (a) => `https://mempool.space/address/${a}`, txExplorer: (h) => `https://mempool.space/tx/${h}` },
  ltc: { id: 'ltc', name: 'Litecoin', symbol: 'LTC', color: '#a6b8d4', family: 'utxo', keyless: true, explorer: (a) => `https://litecoinspace.org/address/${a}`, txExplorer: (h) => `https://litecoinspace.org/tx/${h}` },
  doge: { id: 'doge', name: 'Dogecoin', symbol: 'DOGE', color: '#c2a633', family: 'utxo', keyless: true, ...chair('dogecoin') },
  bch: { id: 'bch', name: 'Bitcoin Cash', symbol: 'BCH', color: '#4cc947', family: 'utxo', keyless: true, ...chair('bitcoin-cash') },
  dash: { id: 'dash', name: 'Dash', symbol: 'DASH', color: '#1c75bc', family: 'utxo', keyless: true, ...chair('dash') },
  zec: { id: 'zec', name: 'Zcash (transparent)', symbol: 'ZEC', color: '#ecb244', family: 'utxo', keyless: true, ...chair('zcash') },
  eth: { id: 'eth', name: 'Ethereum', symbol: 'ETH', color: '#8c8dfc', family: 'evm', keyless: true, ...bs('eth.blockscout.com') },
  op: { id: 'op', name: 'Optimism', symbol: 'ETH', color: '#ff5a6a', family: 'evm', keyless: true, ...bs('explorer.optimism.io') },
  zksync: { id: 'zksync', name: 'zkSync Era', symbol: 'ETH', color: '#8b8dfc', family: 'evm', keyless: true, ...bs('zksync.blockscout.com') },
  unichain: { id: 'unichain', name: 'Unichain', symbol: 'ETH', color: '#f50db4', family: 'evm', keyless: true, ...bs('unichain.blockscout.com') },
  rsk: { id: 'rsk', name: 'Rootstock', symbol: 'RBTC', color: '#ff9931', family: 'evm', keyless: true, ...bs('rootstock.blockscout.com') },
  mode: { id: 'mode', name: 'Mode', symbol: 'ETH', color: '#dffe00', family: 'evm', keyless: true, ...bs('explorer.mode.network') },
  soneium: { id: 'soneium', name: 'Soneium', symbol: 'ETH', color: '#e6e6e6', family: 'evm', keyless: true, ...bs('soneium.blockscout.com') },
  lisk: { id: 'lisk', name: 'Lisk', symbol: 'ETH', color: '#4070f4', family: 'evm', keyless: true, ...bs('blockscout.lisk.com') },
  ink: { id: 'ink', name: 'Ink', symbol: 'ETH', color: '#7132f5', family: 'evm', keyless: true, ...bs('explorer.inkonchain.com') },
  tron: { id: 'tron', name: 'TRON', symbol: 'TRX', color: '#26c6a6', family: 'tron', keyless: true, explorer: (a) => `https://tronscan.org/#/address/${a}`, txExplorer: (h) => `https://tronscan.org/#/transaction/${h}` },
  sol: { id: 'sol', name: 'Solana', symbol: 'SOL', color: '#14f195', family: 'sol', keyless: true, explorer: (a) => `https://solscan.io/account/${a}`, txExplorer: (h) => `https://solscan.io/tx/${h}` },
  ton: { id: 'ton', name: 'TON', symbol: 'TON', color: '#0098ea', family: 'ton', keyless: true, explorer: (a) => `https://tonviewer.com/${a}`, txExplorer: (h) => `https://tonviewer.com/transaction/${encodeURIComponent(h)}` },
  xrp: { id: 'xrp', name: 'XRP Ledger', symbol: 'XRP', color: '#c7ccd6', family: 'xrp', keyless: true, explorer: (a) => `https://livenet.xrpl.org/accounts/${a}`, txExplorer: (h) => `https://livenet.xrpl.org/transactions/${h}` },
  xlm: { id: 'xlm', name: 'Stellar', symbol: 'XLM', color: '#7d8cff', family: 'xlm', keyless: true, explorer: (a) => `https://stellar.expert/explorer/public/account/${a}`, txExplorer: (h) => `https://stellar.expert/explorer/public/tx/${h}` },
  bsc: { id: 'bsc', name: 'BNB Chain', symbol: 'BNB', color: '#f0b90b', family: 'evm', keyless: false, ...scan('bscscan.com') },
  polygon: { id: 'polygon', name: 'Polygon', symbol: 'POL', color: '#8247e5', family: 'evm', keyless: false, ...scan('polygonscan.com') },
  arb: { id: 'arb', name: 'Arbitrum', symbol: 'ETH', color: '#28a0f0', family: 'evm', keyless: false, ...scan('arbiscan.io') },
  base: { id: 'base', name: 'Base', symbol: 'ETH', color: '#2f6bff', family: 'evm', keyless: false, ...scan('basescan.org') },
  avax: { id: 'avax', name: 'Avalanche C', symbol: 'AVAX', color: '#e84142', family: 'evm', keyless: false, ...scan('snowtrace.io') },
  linea: { id: 'linea', name: 'Linea', symbol: 'ETH', color: '#61dfff', family: 'evm', keyless: false, ...scan('lineascan.build') },
  scroll: { id: 'scroll', name: 'Scroll', symbol: 'ETH', color: '#ffdbb0', family: 'evm', keyless: false, ...scan('scrollscan.com') },
}

const ETHERSCAN_IDS: Partial<Record<ChainId, number>> = { bsc: 56, polygon: 137, arb: 42161, base: 8453, avax: 43114, linea: 59144, scroll: 534352 }

export const EVM_CHAINS = (Object.values(CHAINS) as ChainMeta[]).filter((c) => c.family === 'evm').map((c) => c.id)

const B58 = '[1-9A-HJ-NP-Za-km-z]'

/** Privacy-coin formats: recognized so the UI can explain why they cannot be traced. */
export function detectPrivacy(raw: string): string | null {
  const a = raw.trim()
  if (new RegExp(`^[48][0-9AB]${B58}{93}$`).test(a) || new RegExp(`^4${B58}{105}$`).test(a)) {
    return 'Monero address. Monero hides senders, receivers and amounts (ring signatures, stealth addresses, RingCT), so flows cannot be traced on-chain. Investigate the entry and exit points instead: the exchange or swap service where XMR was bought or sold.'
  }
  if (/^(zs1|zc)[0-9a-z]{60,}$/i.test(a) || /^u1[0-9a-z]{100,}$/i.test(a)) {
    return 'Zcash shielded / unified address. Shielded transactions hide amounts and parties. Only transparent (t1/t3) addresses can be traced; look for t→z (shielding) and z→t (deshielding) boundary transactions.'
  }
  return null
}

/** Guess the chain from address format. `evmDefault` resolves the 0x ambiguity. */
export function detectChain(raw: string, evmDefault: ChainId = 'eth'): ChainId | null {
  const a = raw.trim()
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) return evmDefault
  if (new RegExp(`^T${B58}{33}$`).test(a)) return 'tron'
  if (/^(bc1|tb1)[02-9ac-hj-np-z]{11,87}$/i.test(a)) return 'btc'
  if (/^ltc1[02-9ac-hj-np-z]{11,87}$/i.test(a)) return 'ltc'
  if (/^(EQ|UQ|kQ|0Q)[A-Za-z0-9_-]{46}$/.test(a) || /^-?\d:[0-9a-fA-F]{64}$/.test(a)) return 'ton'
  if (/^G[A-Z2-7]{55}$/.test(a)) return 'xlm'
  if (/^t[13][1-9A-HJ-NP-Za-km-z]{33}$/.test(a)) return 'zec'
  if (new RegExp(`^X${B58}{33}$`).test(a)) return 'dash'
  if (new RegExp(`^r${B58}{24,34}$`).test(a)) return 'xrp'
  if (new RegExp(`^[LM]${B58}{26,33}$`).test(a)) return 'ltc'
  if (new RegExp(`^[DA9]${B58}{33}$`).test(a)) return 'doge'
  if (/^(bitcoincash:)?[qp][02-9ac-hj-np-z]{41}$/i.test(a)) return 'bch'
  if (new RegExp(`^[13]${B58}{25,34}$`).test(a)) return 'btc'
  if (new RegExp(`^${B58}{32,44}$`).test(a)) return 'sol'
  return null
}

export function normalize(chain: ChainId, addr: string): string {
  const a = addr.trim()
  const fam = CHAINS[chain].family
  if (fam === 'evm') return a.toLowerCase()
  if (fam === 'ton') return tonFriendly(a)
  if (chain === 'bch') return a.toLowerCase().replace(/^bitcoincash:/, '')
  if (/^(bc1|ltc1)/i.test(a)) return a.toLowerCase()
  return a
}

export interface FetchContext {
  etherscanKey: string
  utxo: UtxoOptions
}

export async function fetchAddress(chain: ChainId, address: string, cursor: string | undefined, ctx: FetchContext): Promise<FetchResult> {
  const [res, spot] = await Promise.all([fetchRaw(chain, address, cursor, ctx), spotPrices()])
  // Explorer-provided prices (token rates) win; spot prices fill native coins.
  return { ...res, prices: { ...spot, ...(res.prices ?? {}) } }
}

function fetchRaw(chain: ChainId, address: string, cursor: string | undefined, ctx: FetchContext): Promise<FetchResult> {
  const meta = CHAINS[chain]
  if (meta.blockscout) return fetchEvm(meta.blockscout, meta.symbol, address, cursor)
  switch (chain) {
    case 'btc':
      return fetchMempool('mempool.space', 'BTC', address, cursor, ctx.utxo)
    case 'ltc':
      return fetchMempool('litecoinspace.org', 'LTC', address, cursor, ctx.utxo)
    case 'doge':
      return fetchBlockchair('dogecoin', 'DOGE', address, cursor, ctx.utxo)
    case 'bch':
      return fetchBlockchair('bitcoin-cash', 'BCH', address, cursor, ctx.utxo)
    case 'dash':
      return fetchBlockchair('dash', 'DASH', address, cursor, ctx.utxo)
    case 'zec':
      return fetchBlockchair('zcash', 'ZEC', address, cursor, ctx.utxo)
    case 'tron':
      return fetchTron(address, cursor)
    case 'sol':
      return fetchSolana(address, cursor)
    case 'ton':
      return fetchTon(address, cursor)
    case 'xrp':
      return fetchXrp(address, cursor)
    case 'xlm':
      return fetchStellar(address, cursor)
    default:
      return fetchEtherscan(ETHERSCAN_IDS[chain]!, meta.symbol, ctx.etherscanKey, address, cursor)
  }
}

// ---------- transaction lookup ----------

export interface TxLookup {
  chain: ChainId
  transfers: Transfer[]
}

/** What kind of identifier was pasted: a transaction hash on which chains. */
export function detectTxHash(raw: string): ChainId[] | null {
  const h = raw.trim()
  if (/^0x[0-9a-fA-F]{64}$/.test(h)) return ['eth', 'op', 'zksync', 'unichain', 'rsk', 'mode', 'soneium', 'lisk', 'ink']
  if (/^[0-9a-fA-F]{64}$/.test(h)) return ['btc', 'tron', 'ltc', 'xrp']
  if (new RegExp(`^${B58}{86,90}$`).test(h)) return ['sol']
  return null
}

/** Load one transaction and return its transfers (tries candidate chains in order). */
export async function lookupTx(hash: string, chains: ChainId[]): Promise<TxLookup | null> {
  const h = hash.trim()
  for (const chain of chains) {
    try {
      const meta = CHAINS[chain]
      if (meta.blockscout) {
        const t = await getJSON(`https://${meta.blockscout}/api/v2/transactions/${h}`, 8000)
        const time = Date.parse(t.timestamp)
        const out: Transfer[] = []
        if (t.to && t.value !== '0') out.push({ hash: h, time, from: t.from.hash.toLowerCase(), to: t.to.hash.toLowerCase(), asset: meta.symbol, amount: Number(t.value) / 1e18 })
        for (const x of t.token_transfers ?? []) {
          const amount = Number(x.total?.value ?? 0) / 10 ** Number(x.total?.decimals ?? 18)
          if (amount) out.push({ hash: h, time, from: x.from.hash.toLowerCase(), to: x.to.hash.toLowerCase(), asset: x.token?.symbol ?? 'TOKEN', amount })
        }
        if (!out.length && t.from && t.to) out.push({ hash: h, time, from: t.from.hash.toLowerCase(), to: t.to.hash.toLowerCase(), asset: meta.symbol, amount: 0 })
        return { chain, transfers: out }
      }
      if (chain === 'btc' || chain === 'ltc') {
        const host = chain === 'btc' ? 'mempool.space' : 'litecoinspace.org'
        const t = await getJSON(`https://${host}/api/tx/${h}`, 8000)
        const time = t.status?.block_time ? t.status.block_time * 1000 : Date.now()
        const ins = t.vin.filter((v: any) => v.prevout?.scriptpubkey_address)
        const total = ins.reduce((s: number, v: any) => s + v.prevout.value, 0) || 1
        const out: Transfer[] = []
        for (const v of ins.slice(0, 25))
          for (const o of t.vout.slice(0, 25))
            if (o.scriptpubkey_address && o.scriptpubkey_address !== v.prevout.scriptpubkey_address)
              out.push({ hash: h, time, from: v.prevout.scriptpubkey_address, to: o.scriptpubkey_address, asset: meta.symbol, amount: (o.value * (v.prevout.value / total)) / 1e8 })
        return { chain, transfers: out }
      }
      if (chain === 'tron') {
        const t = await getJSON(`https://apilist.tronscanapi.com/api/transaction-info?hash=${h}`, 8000)
        if (!t.hash) continue
        const out: Transfer[] = []
        for (const x of t.trc20TransferInfo ?? []) {
          const amount = Number(x.amount_str) / 10 ** Number(x.decimals ?? 6)
          if (amount) out.push({ hash: h, time: t.timestamp, from: x.from_address, to: x.to_address, asset: x.symbol, amount })
        }
        if (t.contractType === 1 && t.contractData?.amount) {
          out.push({ hash: h, time: t.timestamp, from: t.ownerAddress, to: t.toAddress, asset: 'TRX', amount: t.contractData.amount / 1e6 })
        }
        return { chain, transfers: out }
      }
      if (chain === 'sol') return { chain, transfers: await fetchSolTx(h) }
    } catch {
      /* try next chain */
    }
  }
  return null
}

// ---------- first funder (who paid for the first gas) ----------

/** The earliest incoming native transfer of an account. Strong link for account-model chains. */
export async function firstFunder(chain: ChainId, address: string): Promise<Transfer | null> {
  const meta = CHAINS[chain]
  if (meta.blockscout) {
    // Blockscout's Etherscan-compatible API supports ascending order.
    const r = await getJSON(`https://${meta.blockscout}/api?module=account&action=txlist&address=${address}&sort=asc&page=1&offset=25`)
    const t = (r.result ?? []).find((x: any) => x.to?.toLowerCase() === address && x.value !== '0' && x.isError !== '1')
    if (t) return { hash: t.hash, time: Number(t.timeStamp) * 1000, from: t.from.toLowerCase(), to: address, asset: meta.symbol, amount: Number(t.value) / 1e18 }
    const it = await getJSON(`https://${meta.blockscout}/api?module=account&action=txlistinternal&address=${address}&sort=asc&page=1&offset=25`).catch(() => null)
    const i = (it?.result ?? []).find((x: any) => x.to?.toLowerCase() === address && x.value !== '0')
    return i ? { hash: i.transactionHash ?? i.hash, time: Number(i.timeStamp) * 1000, from: i.from.toLowerCase(), to: address, asset: meta.symbol, amount: Number(i.value) / 1e18, internal: true } : null
  }
  if (chain === 'tron') {
    const r = await getJSON(`https://api.trongrid.io/v1/accounts/${address}/transactions?only_to=true&order_by=block_timestamp,asc&limit=20`)
    for (const t of r.data ?? []) {
      const c = t.raw_data?.contract?.[0]
      if (c?.type === 'TransferContract' && c.parameter.value.amount > 0) {
        return { hash: t.txID, time: t.block_timestamp, from: await tronHexToBase58(c.parameter.value.owner_address), to: address, asset: 'TRX', amount: c.parameter.value.amount / 1e6 }
      }
    }
    return null
  }
  if (chain === 'xlm') {
    const r = await getJSON(`https://horizon.stellar.org/accounts/${address}/operations?order=asc&limit=5`)
    const op = (r._embedded?.records ?? []).find((o: any) => o.type === 'create_account')
    return op ? { hash: op.transaction_hash, time: Date.parse(op.created_at), from: op.funder, to: address, asset: 'XLM', amount: Number(op.starting_balance) } : null
  }
  throw new Error(`First-funder lookup is not available for ${meta.name}`)
}

/** Resolve an ENS name (e.g. vitalik.eth) through Blockscout search. */
export async function resolveEns(name: string): Promise<string | null> {
  const r = await getJSON(`https://eth.blockscout.com/api/v2/search?q=${encodeURIComponent(name)}`, 8000)
  const hit = (r.items ?? []).find((x: any) => x.ens_info?.name?.toLowerCase() === name.toLowerCase() || x.name?.toLowerCase() === name.toLowerCase())
  return hit?.address_hash ?? hit?.address ?? null
}
