// Deep IP intelligence: who registered the address and where, where it is
// geolocated, the abuse contact, route-origin (RPKI) validity, reverse DNS,
// and membership in public threat blocklists (FireHOL, Spamhaus DROP, Tor).
// Runs in the browser and in the MCP server.

import { getJSON } from '../chains/http'
import { cveEnv } from './env'
import { cached } from './sources'

const HOUR = 3600000
const DAY = 24 * HOUR

export interface IpIntel {
  rir?: string
  regCountry?: string
  org?: string
  netname?: string
  netRange?: string
  regDate?: string
  abuse?: string[]
  asn?: string
  prefix?: string
  holder?: string
  country?: string
  city?: string
  lat?: number
  lon?: number
  rpki?: string
  ptr: string[]
  lists?: string[]
  /** Parts that could not be loaded (whois, abuse, network, geo, blocklists). */
  failed: string[]
}

/** RIPEstat whois works for every RIR (ARIN, RIPE, APNIC, LACNIC, AFRINIC). */
async function whois(ip: string) {
  return cached(`ripe:whois:${ip}`, 3 * DAY, async () => {
    const r = await getJSON(`https://stat.ripe.net/data/whois/data.json?resource=${ip}`, 15000)
    const kv: [string, string][] = (r?.data?.records ?? []).flat().map((x: { key: string; value: string }) => [x.key.toLowerCase(), x.value])
    const first = (...keys: string[]) => kv.find(([k]) => keys.includes(k))?.[1]
    return {
      rir: (r?.data?.authorities ?? [])[0]?.toUpperCase() as string | undefined,
      regCountry: first('country')?.toUpperCase().slice(0, 2),
      org: first('orgname', 'org-name', 'organization', 'owner', 'descr'),
      netname: first('netname', 'ownerid'),
      netRange: first('netrange', 'inetnum', 'inet6num', 'cidr'),
      regDate: first('regdate', 'created')?.slice(0, 10),
    }
  })
}

async function abuse(ip: string): Promise<string[]> {
  return cached(`ripe:abuse:${ip}`, 3 * DAY, async () => {
    const r = await getJSON(`https://stat.ripe.net/data/abuse-contact-finder/data.json?resource=${ip}`, 12000)
    return (r?.data?.abuse_contacts ?? []) as string[]
  })
}

async function network(ip: string): Promise<{ asn?: string; prefix?: string }> {
  return cached(`ripe:net:${ip}`, DAY, async () => {
    const r = await getJSON(`https://stat.ripe.net/data/network-info/data.json?resource=${ip}`, 12000)
    return { asn: r?.data?.asns?.[0], prefix: r?.data?.prefix }
  })
}

async function geo(ip: string): Promise<{ country?: string; city?: string; lat?: number; lon?: number }> {
  return cached(`ripe:geo2:${ip}`, 7 * DAY, async () => {
    const r = await getJSON(`https://stat.ripe.net/data/maxmind-geo-lite/data.json?resource=${ip}`, 12000)
    const loc = r?.data?.located_resources?.[0]?.locations?.[0]
    return { country: loc?.country, city: loc?.city || undefined, lat: loc?.latitude, lon: loc?.longitude }
  })
}

async function holder(asn: string): Promise<string | undefined> {
  return cached(`ripe:as:${asn}`, 7 * DAY, async () => {
    const r = await getJSON(`https://stat.ripe.net/data/as-overview/data.json?resource=AS${asn}`, 12000)
    return { holder: r?.data?.holder as string | undefined }
  }).then((x) => x.holder)
}

async function rpki(asn: string, prefix: string): Promise<string | undefined> {
  return cached(`ripe:rpki:${asn}:${prefix}`, DAY, async () => {
    const r = await getJSON(`https://stat.ripe.net/data/rpki-validation/data.json?resource=AS${asn}&prefix=${encodeURIComponent(prefix)}`, 12000)
    return { status: r?.data?.status as string | undefined }
  }).then((x) => x.status)
}

async function ptr(ip: string): Promise<string[]> {
  const name = ip.includes(':')
    ? ip
        .split(':')
        .reduce<string[]>((acc, g, i, all) => {
          if (g === '' && i > 0 && i < all.length - 1) acc.push(...Array(8 - all.filter(Boolean).length).fill('0000'))
          else if (g !== '') acc.push(g.padStart(4, '0'))
          return acc
        }, [])
        .join('')
        .split('')
        .reverse()
        .join('.') + '.ip6.arpa'
    : ip.split('.').reverse().join('.') + '.in-addr.arpa'
  const ans = await cveEnv().dns(name, 'PTR').catch(() => [])
  return ans.filter((a) => a.type === 12).map((a) => a.data.replace(/\.$/, ''))
}

// ---------------------------------------------------------------- Blocklists

export const BLOCKLISTS: { id: string; label: string; file: string; why: string }[] = [
  { id: 'firehol1', label: 'FireHOL level 1', file: 'firehol_level1.netset', why: 'Bogons, hijacked ranges and the worst known attackers. Should never be reachable.' },
  { id: 'firehol2', label: 'FireHOL level 2', file: 'firehol_level2.netset', why: 'Attacks and abuse reported in the last ~48 hours.' },
  { id: 'firehol3', label: 'FireHOL level 3', file: 'firehol_level3.netset', why: 'Attacks, spyware and malware reported in the last ~30 days.' },
  { id: 'drop', label: 'Spamhaus DROP', file: 'spamhaus_drop.netset', why: 'Netblocks controlled by spammers or cyber-criminals.' },
  { id: 'cybercrime', label: 'Cybercrime tracker', file: 'cybercrime.ipset', why: 'Botnet command-and-control servers.' },
  { id: 'tor', label: 'Tor exit node', file: 'tor_exits.ipset', why: 'Tor exit relay: traffic from here is anonymized.' },
]

const ipToInt = (ip: string) => ip.split('.').reduce((a, o) => a * 256 + Number(o), 0)

let listsMem: Promise<Record<string, [number, number][] | null>> | null = null
function loadLists(): Promise<Record<string, [number, number][] | null>> {
  listsMem ??= Promise.all(
    BLOCKLISTS.map(async (b) => {
      const ranges = await cached(`bl:${b.id}`, 12 * HOUR, async () => {
        const res = await fetch(`https://raw.githubusercontent.com/firehol/blocklist-ipsets/master/${b.file}`)
        if (!res.ok) throw new Error(`${b.file} ${res.status}`)
        const out: [number, number][] = []
        for (const line of (await res.text()).split('\n')) {
          const l = line.trim()
          if (!l || l.startsWith('#')) continue
          const [base, bits] = l.split('/')
          const start = ipToInt(base)
          const size = bits ? 2 ** (32 - Number(bits)) : 1
          out.push([start, start + size - 1])
        }
        return out.sort((a, b) => a[0] - b[0])
      }).catch(() => null)
      return [b.id, ranges] as const
    }),
  ).then((x) => {
    // A failed list is retried on the next call instead of reading as "not listed" all session.
    if (x.some(([, r]) => !r)) listsMem = null
    return Object.fromEntries(x)
  })
  return listsMem
}

function inRanges(ranges: [number, number][], n: number): boolean {
  let lo = 0
  let hi = ranges.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (ranges[mid][0] > n) hi = mid - 1
    else if (ranges[mid][1] < n) lo = mid + 1
    else return true
  }
  // Sorted by start, so an enclosing wide range may sit before `hi`: check a few.
  for (let i = Math.max(0, hi - 64); i <= hi; i++) if (ranges[i] && ranges[i][0] <= n && ranges[i][1] >= n) return true
  return false
}

/** Lists the IP is on; undefined when the lists could not be loaded (not checked). */
export async function blocklisted(ip: string): Promise<string[] | undefined> {
  if (ip.includes(':')) return undefined
  const lists = await loadLists()
  if (Object.values(lists).some((r) => !r)) return undefined
  const n = ipToInt(ip)
  return BLOCKLISTS.filter((b) => inRanges(lists[b.id]!, n)).map((b) => b.id)
}

// ---------------------------------------------------------------- All together

export async function ipIntel(ip: string): Promise<IpIntel> {
  const failed: string[] = []
  const soft = <T,>(part: string, p: Promise<T>, fallback: T) =>
    p.catch(() => {
      failed.push(part)
      return fallback
    })
  const [w, ab, net, g, p, lists] = await Promise.all([
    soft('whois', whois(ip), {} as Awaited<ReturnType<typeof whois>>),
    soft('abuse', abuse(ip), undefined as string[] | undefined),
    soft('network', network(ip), {} as { asn?: string; prefix?: string }),
    soft('geo', geo(ip), {} as Awaited<ReturnType<typeof geo>>),
    ptr(ip),
    blocklisted(ip).catch(() => undefined),
  ])
  if (!lists && !ip.includes(':')) failed.push('blocklists')
  const [h, rp] = await Promise.all([
    net.asn ? holder(net.asn).catch(() => undefined) : undefined,
    net.asn && net.prefix ? rpki(net.asn, net.prefix).catch(() => undefined) : undefined,
  ])
  return { ...w, abuse: ab, ...net, holder: h, ...g, rpki: rp, ptr: p, lists, failed }
}

const NAMES: Record<string, string> = {}
/** Country code → English name (Intl when available). */
export function countryName(cc?: string): string {
  if (!cc) return 'Unknown'
  if (NAMES[cc]) return NAMES[cc]
  try {
    NAMES[cc] = new Intl.DisplayNames(['en'], { type: 'region' }).of(cc) ?? cc
  } catch {
    NAMES[cc] = cc
  }
  return NAMES[cc]
}

export function flag(cc?: string): string {
  if (!cc || cc.length !== 2) return '🏳'
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)))
}
