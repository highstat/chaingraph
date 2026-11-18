import type { AddressInfo, FetchResult, Transfer } from '../types'
import { getJSON } from './http'

interface BsAddr {
  hash: string
  name?: string | null
  ens_domain_name?: string | null
  is_contract?: boolean
  is_scam?: boolean
  metadata?: { tags?: { name: string }[] } | null
  public_tags?: { display_name?: string; label?: string }[]
}

/** Labels Blockscout attaches to every address it returns. */
function labelOf(a: BsAddr): Partial<AddressInfo> {
  const tags = [
    ...(a.metadata?.tags ?? []).map((t) => t.name),
    ...(a.public_tags ?? []).map((t) => t.display_name ?? t.label ?? ''),
  ].filter(Boolean)
  return {
    name: a.ens_domain_name || a.name || undefined,
    apiTags: [...new Set(tags)],
    isContract: a.is_contract,
    isScam: a.is_scam,
  }
}

function units(value: string, decimals: number): number {
  if (!value) return 0
  return Number(value) / 10 ** decimals
}

interface Cursor {
  tx: Record<string, unknown> | null
  tt: Record<string, unknown> | null
  it?: Record<string, unknown> | null
}

function qs(p: Record<string, unknown> | null): string {
  if (!p) return ''
  return '&' + new URLSearchParams(Object.entries(p).map(([k, v]) => [k, String(v)])).toString()
}

export async function fetchEvm(
  host: string,
  nativeSymbol: string,
  address: string,
  cursorStr?: string,
): Promise<FetchResult> {
  const api = `https://${host}/api/v2/addresses/${address}`
  const cursor: Cursor | null = cursorStr ? JSON.parse(cursorStr) : null
  const first = !cursor

  const [info, counters, tokens, txs, tts, its] = await Promise.all([
    first ? getJSON(api) : null,
    first ? getJSON(`${api}/counters`, 6000).catch(() => null) : null,
    first ? getJSON(`${api}/tokens?type=ERC-20`, 6000).catch(() => null) : null,
    first || cursor?.tx ? getJSON(`${api}/transactions?${qs(cursor?.tx ?? null).slice(1)}`) : null,
    first || cursor?.tt
      ? getJSON(`${api}/token-transfers?type=ERC-20${qs(cursor?.tt ?? null)}`)
      : null,
    // Internal (contract-initiated) value transfers: mixer withdrawals, DEX payouts, bridge releases.
    first || cursor?.it ? getJSON(`${api}/internal-transactions?${qs(cursor?.it ?? null).slice(1)}`, 12000).catch(() => null) : null,
  ])

  const labels: Record<string, Partial<AddressInfo>> = {}
  const prices: Record<string, number> = {}
  const remember = (a?: BsAddr | null) => {
    if (a?.hash) labels[a.hash.toLowerCase()] = labelOf(a)
  }
  const transfers: Transfer[] = []

  for (const t of txs?.items ?? []) {
    remember(t.from)
    remember(t.to)
    if (t.exchange_rate) prices[nativeSymbol] = Number(t.exchange_rate)
    if (!t.to || t.status !== 'ok' || t.value === '0') continue
    transfers.push({
      hash: t.hash,
      time: Date.parse(t.timestamp),
      from: t.from.hash.toLowerCase(),
      to: t.to.hash.toLowerCase(),
      asset: nativeSymbol,
      amount: units(t.value, 18),
    })
  }
  for (const t of tts?.items ?? []) {
    remember(t.from)
    remember(t.to)
    // Skip tokens Blockscout flags as scam/spam: they are mostly address-poisoning noise.
    if (t.token?.reputation && t.token.reputation !== 'ok') continue
    const amount = units(t.total?.value, Number(t.total?.decimals ?? t.token?.decimals ?? 18))
    if (t.token?.symbol && t.token?.exchange_rate) prices[t.token.symbol] = Number(t.token.exchange_rate)
    if (!amount) continue
    transfers.push({
      hash: t.transaction_hash,
      time: Date.parse(t.timestamp),
      from: t.from.hash.toLowerCase(),
      to: t.to.hash.toLowerCase(),
      asset: t.token?.symbol || 'TOKEN',
      amount,
    })
  }

  for (const t of its?.items ?? []) {
    remember(t.from)
    remember(t.to)
    if (!t.success || !t.to || !t.value || t.value === '0') continue
    transfers.push({
      hash: t.transaction_hash,
      time: Date.parse(t.timestamp),
      from: t.from.hash.toLowerCase(),
      to: t.to.hash.toLowerCase(),
      asset: nativeSymbol,
      amount: units(t.value, 18),
      internal: true,
    })
  }

  const next: Cursor = {
    tx: first || cursor?.tx ? (txs?.next_page_params ?? null) : null,
    tt: first || cursor?.tt ? (tts?.next_page_params ?? null) : null,
    it: first || cursor?.it ? (its?.next_page_params ?? null) : null,
  }

  let addrInfo: AddressInfo | undefined
  if (info?.exchange_rate) prices[nativeSymbol] = Number(info.exchange_rate)
  if (info) {
    const l = labelOf(info)
    addrInfo = {
      ...l,
      apiTags: l.apiTags ?? [],
      balance: units(info.coin_balance ?? '0', 18),
      balanceAsset: nativeSymbol,
      txCount: counters ? Number(counters.transactions_count) : undefined,
      tokens: (Array.isArray(tokens?.items) ? tokens.items : [])
        .filter((x: any) => x.token?.reputation === 'ok' || !x.token?.reputation)
        .map((x: any) => ({
          symbol: x.token?.symbol ?? '?',
          amount: units(x.value, Number(x.token?.decimals ?? 18)),
          usd: Number(x.token?.exchange_rate ?? 0) * units(x.value, Number(x.token?.decimals ?? 18)),
        }))
        .sort((a: any, b: any) => b.usd - a.usd)
        .slice(0, 8)
        .map(({ symbol, amount }: any) => ({ symbol, amount })),
    }
  }

  return {
    info: addrInfo,
    transfers,
    labels,
    prices,
    cursor: next.tx || next.tt || next.it ? JSON.stringify(next) : undefined,
  }
}
