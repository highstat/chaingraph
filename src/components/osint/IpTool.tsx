import { useEffect, useState } from 'react'
import { getJSON } from '../../chains/http'
import { doh } from '../../osint/util'
import { useUI } from '../../store'
import { Card, KV, LinkGrid, QueryBar, SaveButton, ToolHeader } from './kit'

function reverseName(ip: string): string | null {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip.split('.').reverse().join('.') + '.in-addr.arpa'
  return null
}

export function IpTool({ initial = '' }: { initial?: string }) {
  const [q, setQ] = useState(initial)
  const [r, setR] = useState<{ ip: string; geo: any; idb: any; rdap: any; ptr: string[] } | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (value = q) => {
    const ip = value.trim()
    if (!ip) return
    setQ(ip)
    setBusy(true)
    try {
      const rev = reverseName(ip)
      const [geo, idb, rdap, ptr] = await Promise.all([
        getJSON(`https://ipwho.is/${ip}`, 8000).catch(() => null),
        getJSON(`https://internetdb.shodan.io/${ip}`, 8000).catch(() => null),
        getJSON(`https://rdap.org/ip/${ip}`, 10000).catch(() => null),
        rev ? doh(rev, 'PTR').catch((): { data: string }[] => []) : Promise.resolve([] as { data: string }[]),
      ])
      setR({ ip, geo: geo?.success === false ? null : geo, idb: idb?.ip ? idb : null, rdap, ptr: ptr.map((p) => p.data.replace(/\.$/, '')) })
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (initial) void run(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial])

  const g = r?.geo
  const abuse = (r?.rdap?.entities ?? []).flatMap((e: any) => [e, ...(e.entities ?? [])]).find((e: any) => e.roles?.includes('abuse'))
  const abuseEmail = abuse?.vcardArray?.[1]?.find((x: any) => x[0] === 'email')?.[3]

  return (
    <div className="tool">
      <ToolHeader title="IP address" desc="Geolocation and network owner (ASN / ISP), connection type, reverse DNS, open ports and known vulnerabilities from Shodan InternetDB, RIR registration and abuse contact via RDAP." />
      <QueryBar value={q} onChange={setQ} onRun={() => run()} placeholder="8.8.8.8 or 2001:4860:4860::8888" busy={busy} />
      {r && (
        <>
          <div className="ogrid">
            <Card title="Location & network" status={g ? 'ok' : 'none'} right={<SaveButton title={`IP ${r.ip}`} markdown={() => `- Location: ${g ? `${g.city}, ${g.region}, ${g.country}` : '?'}\n- ASN: AS${g?.connection?.asn} ${g?.connection?.org ?? ''}\n- ISP: ${g?.connection?.isp ?? '?'}\n- PTR: ${r.ptr.join(', ')}\n- Open ports: ${r.idb?.ports?.join(', ') ?? 'unknown'}\n- CVEs: ${r.idb?.vulns?.join(', ') ?? 'none listed'}`} />}>
              {g ? (
                <KV
                  rows={[
                    ['Location', [g.city, g.region, g.country].filter(Boolean).join(', ')],
                    ['Coordinates', g.latitude != null && <button className="chip mono" onClick={() => useUI.getState().set({ osintTab: 'geo', osintSeed: `${g.latitude},${g.longitude}` })}>{`${g.latitude}, ${g.longitude}`} → map</button>],
                    ['ASN', g.connection?.asn && `AS${g.connection.asn}`],
                    ['Organization', g.connection?.org],
                    ['ISP', g.connection?.isp],
                    ['Domain', g.connection?.domain],
                    ['Time zone', g.timezone?.id && `${g.timezone.id} (UTC${g.timezone.utc})`],
                    ['Type', g.type],
                  ]}
                />
              ) : (
                <div className="muted small">No geolocation data.</div>
              )}
              <div className="muted small mt6">IP geolocation is approximate: it usually points to the ISP's location, not the person.</div>
            </Card>
            <Card title="Exposure (Shodan InternetDB)" status={r.idb ? (r.idb.vulns?.length ? 'bad' : 'ok') : 'none'}>
              {r.idb ? (
                <KV
                  rows={[
                    ['Open ports', r.idb.ports?.join(', ') || 'none seen'],
                    ['Hostnames', r.idb.hostnames?.join(', ')],
                    ['Tags', r.idb.tags?.join(', ')],
                    ['Software (CPE)', r.idb.cpes?.slice(0, 8).join(', ')],
                    ['Known CVEs', r.idb.vulns?.length ? r.idb.vulns.slice(0, 15).join(', ') : 'none listed'],
                  ]}
                />
              ) : (
                <div className="muted small">Not in InternetDB (no recent scan data).</div>
              )}
            </Card>
          </div>
          <Card title="Registration (RDAP) & DNS">
            <KV
              rows={[
                ['Network', r.rdap?.name],
                ['Range', r.rdap?.startAddress && `${r.rdap.startAddress} – ${r.rdap.endAddress}`],
                ['Country', r.rdap?.country],
                ['Abuse contact', abuseEmail],
                ['Reverse DNS', r.ptr.join(', ') || 'none'],
              ]}
            />
          </Card>
          <LinkGrid
            groups={[
              {
                title: 'Threat intelligence',
                links: [
                  { label: 'Shodan', url: `https://www.shodan.io/host/${r.ip}` },
                  { label: 'Censys', url: `https://search.censys.io/hosts/${r.ip}` },
                  { label: 'AbuseIPDB', url: `https://www.abuseipdb.com/check/${r.ip}` },
                  { label: 'GreyNoise', url: `https://viz.greynoise.io/ip/${r.ip}` },
                  { label: 'VirusTotal', url: `https://www.virustotal.com/gui/ip-address/${r.ip}` },
                  { label: 'AlienVault OTX', url: `https://otx.alienvault.com/indicator/ip/${r.ip}` },
                  { label: 'ViewDNS reverse IP', url: `https://viewdns.info/reverseip/?host=${r.ip}&t=1` },
                  { label: 'bgp.he.net', url: `https://bgp.he.net/ip/${r.ip}` },
                ],
              },
            ]}
          />
        </>
      )}
    </div>
  )
}
