// Polite fetch: per-host spacing, timeouts, retry on rate limits. Free keyless
// APIs throttle aggressively, so every request goes through here.

const MIN_GAP_MS: Record<string, number> = {
  'api.trongrid.io': 450,
  'mempool.space': 250,
  'litecoinspace.org': 300,
  'api.blockchair.com': 2200, // keyless Blockchair allows ~30 req/min
  'api.etherscan.io': 380, // free key: 3 req/s
  'toncenter.com': 1100, // keyless toncenter: 1 req/s
  'horizon.stellar.org': 150,
  'apilist.tronscanapi.com': 400,
  'api.coingecko.com': 1500,
  'cve.circl.lu': 400, // Vulnerability-Lookup rate-limits bursts
  'api.github.com': 1000,
}
const DEFAULT_GAP = 200
const nextSlot = new Map<string, number>()

let defaultTimeout = 20000
export function setDefaultTimeout(ms: number) {
  defaultTimeout = ms
}

async function waitTurn(host: string) {
  const gap = MIN_GAP_MS[host] ?? DEFAULT_GAP
  const now = Date.now()
  const slot = Math.max(now, nextSlot.get(host) ?? 0)
  nextSlot.set(host, slot + gap)
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now))
}

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function getJSON<T = any>(url: string, timeoutMs?: number, attempt = 0): Promise<T> {
  const host = new URL(url).host
  const limit = timeoutMs ?? defaultTimeout
  await waitTurn(host)
  let res: Response
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), limit)
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctl.signal })
  } catch {
    clearTimeout(timer)
    if (ctl.signal.aborted) throw new HttpError(0, `${host} did not respond within ${limit / 1000}s`)
    throw new HttpError(0, `Network error or request blocked (${host})`)
  }
  clearTimeout(timer)
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
    return getJSON<T>(url, timeoutMs, attempt + 1)
  }
  if (!res.ok) {
    if (res.status === 429) throw new HttpError(429, `${host} rate limit reached, wait a minute`)
    if (res.status === 404) throw new HttpError(404, 'Address not found on this network')
    if (res.status === 430) throw new HttpError(430, `${host} temporarily blocked this IP for exceeding the free limit. Try again later.`)
    if (res.status === 402) throw new HttpError(402, `${host} requires a paid plan for this request`)
    throw new HttpError(res.status, `${host} responded ${res.status}`)
  }
  return res.json() as Promise<T>
}
