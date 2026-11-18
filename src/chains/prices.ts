// Spot USD prices for native coins and major stablecoins (CoinGecko, keyless).
// Used so flows on different chains can be compared and ranked in one currency.

import { getJSON } from './http'

const IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  WETH: 'ethereum',
  TRX: 'tron',
  LTC: 'litecoin',
  DOGE: 'dogecoin',
  BCH: 'bitcoin-cash',
  BNB: 'binancecoin',
  AVAX: 'avalanche-2',
  POL: 'polygon-ecosystem-token',
  USDT: 'tether',
  USDC: 'usd-coin',
  DAI: 'dai',
  WBTC: 'wrapped-bitcoin',
  SOL: 'solana',
  TON: 'the-open-network',
  XRP: 'ripple',
  XLM: 'stellar',
  DASH: 'dash',
  ZEC: 'zcash',
  RBTC: 'rootstock',
}

let cache: { at: number; prices: Record<string, number> } | null = null
let inflight: Promise<Record<string, number>> | null = null

export async function spotPrices(): Promise<Record<string, number>> {
  if (cache && Date.now() - cache.at < 10 * 60000) return cache.prices
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const ids = [...new Set(Object.values(IDS))].join(',')
      const r = await getJSON<Record<string, { usd: number }>>(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`, 6000)
      const prices: Record<string, number> = {}
      for (const [sym, id] of Object.entries(IDS)) if (r[id]?.usd) prices[sym] = r[id].usd
      cache = { at: Date.now(), prices }
      return prices
    } catch {
      return cache?.prices ?? {}
    } finally {
      inflight = null
    }
  })()
  return inflight
}
