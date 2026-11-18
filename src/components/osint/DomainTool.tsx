import { useEffect, useState } from 'react'
import { getJSON } from '../../chains/http'
import { dnsFallback, doh, dohAvailable, enc, type DnsAnswer } from '../../osint/util'
import { useUI } from '../../store'
import { Card, CryptoPivots, KV, LinkGrid, QueryBar, SaveButton, ToolHeader } from './kit'

const TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'CAA', 'SOA'] as const

// Service fingerprints from DNS records.
const FINGERPRINTS: [RegExp, string][] = [
  [/google-site-verification/i, 'Google Search Console'],
  [/MS=ms\d+/i, 'Microsoft 365'],
  [/facebook-domain-verification/i, 'Meta Business'],
  [/apple-domain-verification/i, 'Apple'],
  [/atlassian-domain-verification/i, 'Atlassian'],
  [/stripe-verification/i, 'Stripe'],
  [/docusign/i, 'DocuSign'],
  [/hubspot/i, 'HubSpot'],
  [/zoom/i, 'Zoom'],
  [/_github-challenge|github/i, 'GitHub'],
  [/cloudflare/i, 'Cloudflare'],
  [/awsdns/i, 'AWS Route 53'],
  [/azure-dns/i, 'Azure DNS'],
  [/googledomains|google\.com\.?$/i, 'Google'],
  [/shopify/i, 'Shopify'],
  [/wixdns/i, 'Wix'],
  [/squarespace/i, 'Squarespace'],
  [/mailgun/i, 'Mailgun'],
  [/sendgrid/i, 'SendGrid'],
  [/zendesk/i, 'Zendesk'],
  [/ddos-guard/i, 'DDoS-Guard'],
  [/njalla/i, 'Njalla (privacy registrar)'],
]

interface Result {
  domain: string
  rdap?: any
  dns: Partial<Record<(typeof TYPES)[number], DnsAnswer[]>>
  subs: string[]
  wayback?: { url: string; timestamp: string }
}

function rdapEvents(r: any): Record<string, string> {
  const out: Record<string, string> = {}
  for (const e of r?.events ?? []) out[e.eventAction] = String(e.eventDate).slice(0, 10)
  return out
}

function entity(r: any, role: string): string | undefined {
  const e = (r?.entities ?? []).find((x: any) => x.roles?.includes(role))
  const v = e?.vcardArray?.[1]
  const fn = v?.find((x: any) => x[0] === 'fn')?.[3]
  return fn || e?.handle
}

export function DomainTool({ initial = '' }: { initial?: string }) {
  const [q, setQ] = useState(initial)
  const [r, setR] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [subBusy, setSubBusy] = useState(false)

  const run = async (value = q) => {
    const domain = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')
    if (!domain) return
    setQ(domain)
    setBusy(true)
    try {
      const [rdap, wb, ...answers] = await Promise.all([
        getJSON(`https://rdap.org/domain/${domain}`, 12000).catch(() => null),
        getJSON(`https://archive.org/wayback/available?url=${domain}&timestamp=19900101`, 8000).catch(() => null),
        ...TYPES.map((t) => doh(domain, t).catch(() => [])),
      ])
      let dns: Result['dns'] = Object.fromEntries(TYPES.map((t, i) => [t, (answers[i] as DnsAnswer[]).filter((a) => a.type === { A: 1, AAAA: 28, CNAME: 5, MX: 15, NS: 2, TXT: 16, CAA: 257, SOA: 6 }[t])]))
      if (!dohAvailable()) {
        // DoH blocked on this network: fall back to HackerTarget's DNS lookup.
        const fb = await dnsFallback(domain).catch(() => [])
        dns = {}
        for (const r of fb) (dns[r.type as (typeof TYPES)[number]] ??= []).push({ name: domain, type: 0, TTL: 0, data: r.data })
      }
      const snap = wb?.archived_snapshots?.closest
      setR({ domain, rdap, dns, subs: [], wayback: snap ? { url: snap.url, timestamp: snap.timestamp } : undefined })
    } finally {
      setBusy(false)
    }
    // Subdomains from certificate transparency (slow, so loaded after the main result).
    setSubBusy(true)
    const [ct, ht] = await Promise.all([
      getJSON(`https://crt.sh/?q=%25.${domain}&output=json`, 25000).catch(() => []),
      fetch(`https://api.hackertarget.com/hostsearch/?q=${domain}`).then((x) => x.text()).catch(() => ''),
    ])
    const subs = new Set<string>()
    for (const c of ct ?? []) for (const n of String(c.name_value).split('\n')) if (n.endsWith(domain) && !n.startsWith('*')) subs.add(n.toLowerCase())
    for (const line of ht.split('\n')) {
      const h = line.split(',')[0]
      if (h?.endsWith(domain)) subs.add(h.toLowerCase())
    }
    setR((prev) => (prev && prev.domain === domain ? { ...prev, subs: [...subs].sort() } : prev))
    setSubBusy(false)
  }

  useEffect(() => {
    if (initial) void run(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial])

  const allText = r ? [...Object.values(r.dns).flat().map((a) => a!.data)].join(' ') : ''
  const services = r ? [...new Set(FINGERPRINTS.filter(([re]) => re.test(allText)).map(([, n]) => n))] : []
  const ev = rdapEvents(r?.rdap)
  const ips = (r?.dns.A ?? []).map((a) => a.data)
  const age = ev.registration ? ((Date.now() - Date.parse(ev.registration)) / 86400000 / 365).toFixed(1) : null

  return (
    <div className="tool">
      <ToolHeader title="Domain & DNS" desc="RDAP registration data (modern WHOIS), all DNS records over HTTPS, service fingerprints, subdomains from certificate transparency, and web-archive history." />
      <QueryBar value={q} onChange={setQ} onRun={() => run()} placeholder="example.com" busy={busy} />
      {r && (
        <>
          <div className="ogrid">
            <Card
              title="Registration (RDAP)"
              status={r.rdap ? (age && Number(age) < 0.5 ? 'warn' : 'ok') : 'none'}
              right={<SaveButton title={`Domain ${r.domain}`} markdown={() => `- Registrar: ${entity(r.rdap, 'registrar') ?? '?'}\n- Registered: ${ev.registration ?? '?'} · Expires: ${ev.expiration ?? '?'}\n- NS: ${(r.dns.NS ?? []).map((x) => x.data).join(', ')}\n- A: ${ips.join(', ')}\n- Services: ${services.join(', ')}\n- Subdomains (${r.subs.length}): ${r.subs.slice(0, 50).join(', ')}`} />}
            >
              {r.rdap ? (
                <KV
                  rows={[
                    ['Registrar', entity(r.rdap, 'registrar')],
                    ['Registrant', entity(r.rdap, 'registrant') ?? 'Redacted / privacy-protected'],
                    ['Registered', ev.registration && `${ev.registration} (${age} years ago)`],
                    ['Updated', ev['last changed']],
                    ['Expires', ev.expiration],
                    ['Status', (r.rdap.status ?? []).join(', ')],
                    ['Name servers', (r.rdap.nameservers ?? []).map((n: any) => n.ldhName).join(', ')],
                    ['DNSSEC', r.rdap.secureDNS?.delegationSigned ? 'Signed' : 'Not signed'],
                  ]}
                />
              ) : (
                <div className="muted small">No RDAP data (some ccTLDs do not publish RDAP).</div>
              )}
              {age && Number(age) < 0.5 && <div className="callout warn">Registered less than 6 months ago: common for phishing and scam sites.</div>}
            </Card>
            <Card title="Fingerprints & history">
              <KV
                rows={[
                  ['Services', services.join(', ') || 'None detected'],
                  ['IP addresses', ips.length ? ips.map((ip) => <button key={ip} className="chip mono" onClick={() => useUI.getState().set({ osintTab: 'ip', osintSeed: ip })}>{ip}</button>) : undefined],
                  ['First archived', r.wayback ? <a href={r.wayback.url} target="_blank" rel="noreferrer noopener">{`${r.wayback.timestamp.slice(0, 4)}-${r.wayback.timestamp.slice(4, 6)}-${r.wayback.timestamp.slice(6, 8)}`}</a> : 'Never archived'],
                ]}
              />
              <CryptoPivots text={allText} />
            </Card>
          </div>
          <Card title={`DNS records${dohAvailable() ? '' : ' (fallback source: DoH blocked on this network)'}`}>
            <table className="tbl dns">
              <tbody>
                {TYPES.flatMap((t) =>
                  (r.dns[t] ?? []).map((a, i) => (
                    <tr key={t + i}>
                      <td className="muted">{t}</td>
                      <td className="mono small" style={{ wordBreak: 'break-all' }}>
                        {a.data}
                      </td>
                      <td className="r muted small">{a.TTL ? `${a.TTL}s` : ''}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </Card>
          <Card title={`Subdomains (certificate transparency) · ${subBusy ? 'loading…' : r.subs.length}`}>
            <div className="sub-list">
              {r.subs.slice(0, 400).map((s) => (
                <a key={s} href={`https://${s}`} target="_blank" rel="noreferrer noopener" className="mono small">
                  {s}
                </a>
              ))}
              {!subBusy && !r.subs.length && <span className="muted small">None found.</span>}
            </div>
          </Card>
          <LinkGrid
            groups={[
              {
                title: 'Deeper lookups',
                links: [
                  { label: 'urlscan.io', url: `https://urlscan.io/domain/${r.domain}` },
                  { label: 'VirusTotal', url: `https://www.virustotal.com/gui/domain/${r.domain}` },
                  { label: 'SecurityTrails (DNS history)', url: `https://securitytrails.com/domain/${r.domain}/dns` },
                  { label: 'DNSDumpster', url: 'https://dnsdumpster.com/' },
                  { label: 'crt.sh', url: `https://crt.sh/?q=${r.domain}` },
                  { label: 'BuiltWith (tech stack)', url: `https://builtwith.com/${r.domain}` },
                  { label: 'ViewDNS reverse IP', url: `https://viewdns.info/reverseip/?host=${r.domain}&t=1` },
                  { label: 'Shodan', url: `https://www.shodan.io/search?query=hostname%3A${r.domain}` },
                  { label: 'Censys', url: `https://search.censys.io/search?resource=hosts&q=${r.domain}` },
                ],
              },
              {
                title: 'Archives & search',
                links: [
                  { label: 'Wayback Machine (all captures)', url: `https://web.archive.org/web/*/${r.domain}*` },
                  { label: 'archive.today', url: `https://archive.ph/${r.domain}` },
                  { label: 'Google: site', url: `https://www.google.com/search?q=${enc(`site:${r.domain}`)}` },
                  { label: 'Google: documents', url: `https://www.google.com/search?q=${enc(`site:${r.domain} (filetype:pdf OR filetype:docx OR filetype:xlsx)`)}` },
                  { label: 'Google: mentions', url: `https://www.google.com/search?q=${enc(`"${r.domain}" -site:${r.domain}`)}` },
                  { label: 'GitHub code mentions', url: `https://github.com/search?q=${enc(`"${r.domain}"`)}&type=code` },
                ],
              },
            ]}
          />
        </>
      )}
    </div>
  )
}
