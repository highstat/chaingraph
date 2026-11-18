export type ChainId =
  | 'btc'
  | 'ltc'
  | 'doge'
  | 'bch'
  | 'eth'
  | 'op'
  | 'tron'
  | 'bsc'
  | 'polygon'
  | 'arb'
  | 'base'
  | 'avax'
  | 'linea'
  | 'scroll'
  | 'dash'
  | 'zec'
  | 'sol'
  | 'ton'
  | 'xrp'
  | 'xlm'
  | 'rsk'
  | 'zksync'
  | 'unichain'
  | 'mode'
  | 'soneium'
  | 'lisk'
  | 'ink'

/** One value movement between two addresses, normalized across chains. */
export interface Transfer {
  hash: string
  time: number // unix ms
  from: string
  to: string
  asset: string // symbol, e.g. BTC, ETH, USDT
  amount: number
  change?: boolean // UTXO heuristic: likely change back to the sender
  coinjoin?: boolean // UTXO heuristic: equal-output CoinJoin transaction
  cjKind?: string // CoinJoin implementation guess: whirlpool | wasabi | wasabi2 | joinmarket | generic
  memo?: string // destination tag / memo (XRP, Stellar), often an exchange deposit identifier
  internal?: boolean // EVM internal (contract) transfer
}

export interface AddressInfo {
  balance?: number
  balanceAsset?: string
  txCount?: number
  name?: string // contract name / ENS
  apiTags: string[] // tags supplied by the data source
  isContract?: boolean
  isScam?: boolean
  tokens?: { symbol: string; amount: number }[]
}

export interface FetchResult {
  info?: AddressInfo
  transfers: Transfer[]
  cursor?: string // opaque continuation token, undefined = no more pages
  labels?: Record<string, Partial<AddressInfo>>
  prices?: Record<string, number> // asset -> current USD
  coSpends?: string[][] // UTXO: address groups that co-signed inputs (non-CoinJoin)
}

export type Category =
  | 'exchange'
  | 'mixer'
  | 'bridge'
  | 'defi'
  | 'gambling'
  | 'instant'
  | 'scam'
  | 'sanctioned'
  | 'darknet'
  | 'service'
  | 'individual'
  | 'unknown'

/** User tags, Obsidian-tag style. */
export const TAGS = {
  suspect: { label: 'Suspect', color: '#e5484d' },
  victim: { label: 'Victim', color: '#46a758' },
  exchange: { label: 'Exchange', color: '#3e8ed0' },
  mixer: { label: 'Mixer', color: '#a855f7' },
  service: { label: 'Service', color: '#d6a03a' },
  watch: { label: 'Watch', color: '#12a594' },
} as const
export type TagId = keyof typeof TAGS

export interface CaseNode {
  id: string // `${chain}:${address}`
  chain: ChainId
  address: string
  alias?: string
  tags: TagId[]
  note: string
  info?: AddressInfo
  expanded: boolean
  cursor?: string
  loadedTx: number
  pinned?: { x: number; y: number }
  starred?: boolean
  watch?: boolean
  hidden?: boolean
  category?: Category // manual override
  funder?: { address: string; time: number; amount: number; asset: string; hash: string }
}

/** Investigator-confirmed link between two addresses (shown as a dashed edge). */
export interface ManualLink {
  id: string
  a: string // node id
  b: string // node id
  kind: 'same-owner' | 'demix' | 'chain-hop' | 'note'
  note?: string
  confidence?: number
}

export interface CaseEdge {
  id: string // `${from}>${to}|${asset}`
  source: string
  target: string
  asset: string
  amount: number
  usd?: number
  count: number
  first: number
  last: number
  txs: string[]
  change: boolean
  order: number // chronological rank of first transfer (MetaSleuth-style)
  virtual?: boolean // investigator link, not an on-chain transfer
  linkKind?: string
}

export interface Case {
  id: string
  title: string
  created: number
  updated: number
  nodes: Record<string, CaseNode>
  transfers: Record<string, Transfer[]> // raw transfers per node id
  coSpends: string[][] // node-id groups proven to share an owner (common-input)
  prices: Record<string, number>
  traced: string[] // edge ids highlighted by auto-trace / pathfinding
  links: ManualLink[]
  note: string // case-level notes (Markdown)
  dismissed: string[] // finding ids the investigator dismissed
}

export interface LabelEntry {
  address: string
  label: string
  category: Category
  chain?: ChainId
}
