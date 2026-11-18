// Entity attribution: map explorer labels, user tags and the label library to a
// category. Keyword rules run against names and tags only, never raw addresses.

import type { Category, CaseNode, LabelEntry } from './types'

const RULES: [Category, RegExp][] = [
  ['sanctioned', /sanction|ofac|lazarus|garantex|suex|chatex/i],
  ['mixer', /tornado|mixer|mixing|blender|sinbad|chipmixer|wasabi|whirlpool|samourai|railgun|coinjoin|cyclone|typhoon|tumbler|yomix|mixero|cryptomixer|anonymixer|privacy ?pools?|aztec|umbra|noir|zkbob|incognito|elusiv|light ?protocol|hinkal|tonmixer|whirl/i],
  ['instant', /changenow|change now|fixedfloat|fixed float|simpleswap|sideshift|stealthex|changelly|exch\.cx|godex|letsexchange|swapzone|trocador|majesticbank|exolix|swapuz|quickex|alfacash|easybit|bitxchange|instant ?exchange|no.?kyc/i],
  ['scam', /scam|phish|fake|exploit|hacker|\bhack\b|drainer|ponzi|fraud|heist|attacker|rug ?pull|impersonat/i],
  ['darknet', /darknet|darkweb|hydra|silk ?road|alphabay|market ?place.*(dark|onion)/i],
  ['gambling', /casino|gambl|\bbet\b|stake\.com|roobet|bc\.game|dice|lottery|poker/i],
  ['bridge', /bridge|wormhole|stargate|layerzero|across|hop protocol|synapse|portal|multichain|orbiter|celer|axelar|thorchain|debridge|relay: solver/i],
  ['exchange', /binance|coinbase|kraken|\bokx\b|okex|bybit|kucoin|huobi|\bhtx\b|bitfinex|gate\.io|mexc|bitget|bitstamp|gemini|crypto\.com|upbit|bithumb|bitmex|deribit|poloniex|exchange|hot ?wallet|deposit address|\bcex\b/i],
  ['defi', /uniswap|sushi|curve|balancer|1inch|cow ?swap|gpv2|aave|compound|maker|lido|router|liquidity|vault|swap|\bdex\b|permit2|weth|pancake|settler|pool ?manager|aggregator/i],
  ['service', /disperse|multisig|gnosis safe|\bsafe\b|opensea|blur|\bnft\b|payment|merchant|faucet|ens:|registrar/i],
]

export const CATEGORY_META: Record<Category, { label: string; color: string }> = {
  sanctioned: { label: 'Sanctioned', color: '#ff2d55' },
  darknet: { label: 'Darknet', color: '#c2185b' },
  scam: { label: 'Scam / Hack', color: '#e5484d' },
  mixer: { label: 'Mixer', color: '#a855f7' },
  gambling: { label: 'Gambling', color: '#f97316' },
  instant: { label: 'Instant exchanger', color: '#eab308' },
  bridge: { label: 'Bridge', color: '#06b6d4' },
  exchange: { label: 'Exchange', color: '#3e8ed0' },
  defi: { label: 'DeFi', color: '#22c55e' },
  service: { label: 'Service', color: '#d6a03a' },
  individual: { label: 'Individual', color: '#94a3b8' },
  unknown: { label: 'Unattributed', color: '#6b7280' },
}

export const CATEGORIES = Object.keys(CATEGORY_META) as Category[]

/**
 * Built-in attribution for well-known obfuscation infrastructure. Every entry
 * below was verified against explorer contract names (Blockscout).
 */
export const KNOWN: Record<string, { label: string; category: Category; denom?: number; chain?: string }> = {
  '0xd90e2f925da726b50c4ed8d0fb90ad053324f31b': { label: 'Tornado Cash: Router', category: 'mixer', chain: 'eth' },
  '0x12d66f87a04a9e220743712ce6d9bb1b5616b8fc': { label: 'Tornado Cash: 0.1 ETH pool', category: 'mixer', denom: 0.1, chain: 'eth' },
  '0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936': { label: 'Tornado Cash: 1 ETH pool', category: 'mixer', denom: 1, chain: 'eth' },
  '0x910cbd523d972eb0a6f4cae4618ad62622b39dbf': { label: 'Tornado Cash: 10 ETH pool', category: 'mixer', denom: 10, chain: 'eth' },
  '0xa160cdab225685da1d56aa342ad8841c3b53f291': { label: 'Tornado Cash: 100 ETH pool', category: 'mixer', denom: 100, chain: 'eth' },
}

export interface Attribution {
  category: Category
  label?: string
  source: 'manual' | 'tag' | 'library' | 'explorer' | 'none'
}

export function libraryIndex(labels: LabelEntry[]): Map<string, LabelEntry> {
  const m = new Map<string, LabelEntry>()
  for (const l of labels) m.set(l.address.toLowerCase(), l)
  return m
}

export function classifyText(text: string): Category | null {
  for (const [cat, re] of RULES) if (re.test(text)) return cat
  return null
}

export function attribute(n: CaseNode, lib: Map<string, LabelEntry>): Attribution {
  if (n.category) return { category: n.category, source: 'manual' }
  const known = KNOWN[n.address.toLowerCase()]
  if (known && (!known.chain || known.chain === n.chain)) return { category: known.category, label: known.label, source: 'library' }
  const entry = lib.get(n.address.toLowerCase())
  if (entry && (!entry.chain || entry.chain === n.chain)) return { category: entry.category, label: entry.label, source: 'library' }
  if (n.tags.includes('mixer')) return { category: 'mixer', source: 'tag' }
  if (n.tags.includes('exchange')) return { category: 'exchange', source: 'tag' }
  if (n.info?.isScam) return { category: 'scam', label: n.info.name, source: 'explorer' }
  const text = [n.info?.name, ...(n.info?.apiTags ?? [])].filter(Boolean).join(' | ')
  if (text) {
    const cat = classifyText(text)
    if (cat) return { category: cat, label: n.info?.name || n.info?.apiTags?.[0], source: 'explorer' }
  }
  return { category: 'unknown', source: 'none' }
}

/** Parse a CSV label pack: address,label,category[,chain]. Header row optional. */
export function parseLabelCsv(text: string): LabelEntry[] {
  const out: LabelEntry[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
    if (/^address$/i.test(cols[0])) continue
    const [address, label, cat, chain] = cols
    if (!address || !label) continue
    const category = (CATEGORIES as string[]).includes(cat?.toLowerCase()) ? (cat.toLowerCase() as Category) : classifyText(label) ?? 'unknown'
    out.push({ address, label, category, ...(chain ? { chain: chain as LabelEntry['chain'] } : {}) })
  }
  return out
}
