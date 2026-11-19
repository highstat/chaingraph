import { BookmarkPlus, Bot, Bug, Download, Flame, Globe2, History, Loader2, MapPin, Plug, Radar as RadarIcon, Search, Server, Settings2, ShieldX, Square, Waypoints } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { download } from '../../format'
import { saveToCase } from '../../osint/util'
import { toast } from '../../store'
import { countryName, flag, BLOCKLISTS } from '../../cve/intel'
import { cpeLabel, isCdn, portRule, priorityBucket, sevRank, SEV_ORDER, TAG_RULES } from '../../cve/rules'
import { hostsFor, rankedCves, scanMarkdown } from '../../cve/report'
import { cidrSize, parseTarget } from '../../cve/scan'
import { useCveSettings } from '../../cve/settings'
import { openScan, startScan, useCve, useRadar } from '../../cve/state'
import type { CveRecord, Finding, HostResult, ScanResult, Severity } from '../../cve/types'
import { Card, KV, ToolHeader } from '../osint/kit'
import { Switch } from '../ui'
import { HBars, HostMap, PriorityBar, RiskScatter, ScoreRing, YearColumns, type BarItem } from './charts'
import { CveTable, Sev } from './shared'

const EXAMPLES = ['scanme.nmap.org', 'example.com', '45.33.32.156', 'AS63949']

export function ScanTab() {
  const cve = useCve()
  const s = useCveSettings()
  const [q, setQ] = useState(cve.result?.target ?? '')
  const [showOpts, setShowOpts] = useState(false)
  const busy = !!cve.progress

  const run = (value = q) => {
    const t = parseTarget(value)
    if (!t) return toast('Enter a domain, IP, CIDR range or ASN')
    if (t.kind === 'cidr' && cidrSize(t.value) > 64 && !confirm(`Check up to ${Math.min(256, cidrSize(t.value))} addresses against InternetDB? This takes a minute.`)) return
    setQ(value)
    void startScan(value)
  }

  return (
    <div className="tool">
      <ToolHeader
        title="Attack surface & CVE scan"
        desc="Passive reconnaissance of a domain, IP, range or ASN: every IP behind the domain and its subdomains, open ports, software stack and the CVEs that apply, ranked by real-world exploitation (CISA KEV, EPSS) rather than CVSS alone. Nothing is sent to the target itself."
      />
      <form
        className="query-bar"
        onSubmit={(e) => {
          e.preventDefault()
          run()
        }}
      >
        <div className="search-box big">
          <Search size={15} className="muted" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="example.com · 203.0.113.10 · 203.0.113.0/26 · AS13335" spellCheck={false} autoComplete="off" />
        </div>
        <button type="button" className={'mod-ghost' + (showOpts ? ' on' : '')} onClick={() => setShowOpts(!showOpts)} title="Scan options">
          <Settings2 size={14} />
        </button>
        {busy ? (
          <button type="button" className="mod-warning" onClick={() => cve.set({ cancel: true })}>
            <Square size={13} /> Stop
          </button>
        ) : (
          <button className="mod-cta" disabled={!q.trim()}>
            <Search size={14} /> Scan
          </button>
        )}
      </form>
      {!cve.result && !busy && (
        <div className="row gap6 wrap">
          <span className="muted small">Try:</span>
          {EXAMPLES.map((e) => (
            <button key={e} className="chip" onClick={() => run(e)}>
              {e}
            </button>
          ))}
        </div>
      )}
      {showOpts && <ScanOptionsPanel />}
      {busy && <ProgressBar />}
      {cve.result && <Results r={cve.result} />}
      {cve.history.length > 0 && (
        <Card title="Scan history" right={<History size={14} className="muted" />}>
          <div className="hist">
            {cve.history.map((h) => (
              <button key={h.id} className={'hist-item' + (cve.result?.id === h.id ? ' on' : '')} onClick={() => void openScan(h.id)}>
                <span className={'grade g' + h.grade}>{h.grade}</span>
                <span className="mono ellipsis">{h.target}</span>
                <span className="muted small">{new Date(h.at).toLocaleString()}</span>
              </button>
            ))}
          </div>
        </Card>
      )}
      {s.scan.headers || s.scan.reverseIp ? null : (
        <div className="muted small mt6">HTTP-header fingerprinting and reverse-IP lookups are off by default: they use HackerTarget’s free quota (~50 calls a day). Turn them on in scan options.</div>
      )}
    </div>
  )
}

function ScanOptionsPanel() {
  const s = useCveSettings()
  const o = s.scan
  return (
    <div className="ocard opts">
      <div className="opts-grid">
        <label className="opt">
          <Switch on={o.subdomains} onChange={(v) => s.setScan({ subdomains: v })} />
          <span>Subdomains from certificate transparency</span>
        </label>
        <label className="opt">
          <span>Max subdomains to resolve</span>
          <input type="number" min={5} max={300} value={o.maxSubdomains} onChange={(e) => s.setScan({ maxSubdomains: Math.max(5, Math.min(300, Number(e.target.value) || 60)) })} />
        </label>
        <label className="opt">
          <span>NVD product lookups per scan</span>
          <input type="number" min={0} max={60} value={o.nvdCpeLimit} onChange={(e) => s.setScan({ nvdCpeLimit: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })} />
        </label>
        <label className="opt">
          <Switch on={o.headers} onChange={(v) => s.setScan({ headers: v })} />
          <span>HTTP headers: tech stack + security headers (HackerTarget quota)</span>
        </label>
        <label className="opt">
          <Switch on={o.reverseIp} onChange={(v) => s.setScan({ reverseIp: v })} />
          <span>Reverse IP: other sites on the same server (HackerTarget quota)</span>
        </label>
        <label className="opt active-opt">
          <Switch
            on={!!o.active}
            onChange={(v) => {
              if (v && !confirm('Active probing sends real requests to the target (HTTP/HTTPS, TLS handshake, TCP port and exposed-file checks). Only enable it for systems you own or are explicitly authorized to test. Continue?')) return
              s.setScan({ active: v })
            }}
          />
          <span>
            Active probing — authorized targets only
            <span className="muted"> · live HTTP/TLS, open ports, exposed files (full results via the MCP server)</span>
          </span>
        </label>
      </div>
      <div className="muted small">
        Without an NVD API key each product lookup waits ~6.5 s (NVD allows 5 requests per 30 s). Add a free key in the Sources tab to make it ~10× faster. Results are cached for 3 days.
        {o.active && <span className="warn"> Active probing is on: the browser can only read responses the target allows (CORS); the MCP server runs the full active checks.</span>}
      </div>
    </div>
  )
}

function ProgressBar() {
  const p = useCve((s) => s.progress)!
  const w = p.total ? Math.round((100 * p.done) / p.total) : null
  return (
    <div className="scan-progress">
      <div className="row gap6">
        <Loader2 size={14} className="spin" />
        <span>{p.step}</span>
        <span className="grow" />
        {p.total > 0 && (
          <span className="muted small">
            {p.done}/{p.total}
          </span>
        )}
      </div>
      <div className="bar">
        <i style={{ width: w == null ? '30%' : `${w}%` }} className={w == null ? 'indeterminate' : ''} />
      </div>
    </div>
  )
}

type Section = 'overview' | 'findings' | 'cves' | 'hosts' | 'geo' | 'dns' | 'active'

function Results({ r }: { r: ScanResult }) {
  const cves = useMemo(() => rankedCves(r), [r])
  const [section, setSection] = useState<Section>('overview')
  const [sevFilter, setSevFilter] = useState<Severity | 'all'>('all')
  const [catFilter, setCatFilter] = useState<string | null>(null)
  const kev = cves.filter((c) => c.kev)
  const ports = r.hosts.reduce((a, h) => a + h.ports.length, 0)
  const cats = useMemo(() => {
    const m = new Map<string, { n: number; worst: Severity }>()
    for (const f of r.findings) {
      const e = m.get(f.category)
      if (!e) m.set(f.category, { n: 1, worst: f.severity })
      else m.set(f.category, { n: e.n + 1, worst: sevRank(f.severity) < sevRank(e.worst) ? f.severity : e.worst })
    }
    return [...m].sort((a, b) => sevRank(a[1].worst) - sevRank(b[1].worst) || b[1].n - a[1].n)
  }, [r.findings])
  const findings = r.findings.filter((f) => (sevFilter === 'all' || f.severity === sevFilter) && (!catFilter || f.category === catFilter))
  const radar = useRadar()
  const ui = useCve()
  const countries = new Set(r.hosts.map((h) => h.country).filter(Boolean))
  const listed = r.hosts.filter((h) => h.lists?.length).length
  const crit = r.findings.filter((f) => f.severity === 'critical').length
  const SECTIONS: [Section, string, number | null][] = [
    ['overview', 'Overview', null],
    ['findings', 'Findings', r.findings.length],
    ['cves', 'CVEs', cves.length],
    ['hosts', 'Hosts & IP intel', r.hosts.length],
    ['geo', 'Geography & networks', countries.size],
    ['dns', 'DNS, email & stack', r.domains.length],
    ...(r.active ? ([['active', 'Active probe', r.active.findings.length]] as [Section, string, number | null][]) : []),
  ]

  return (
    <>
      <div className="hero">
        <ScoreRing score={r.score} grade={r.grade} />
        <div className="hero-main">
          <div className="hero-target mono">{r.target}</div>
          <div className="muted small">
            {r.kind.toUpperCase()} · {new Date(r.started).toLocaleString()}
            {r.finished ? ` · ${Math.round((r.finished - r.started) / 1000)} s` : ''}
            {r.degraded ? ' · incomplete (a source did not answer)' : ''}
          </div>
          <div className="hero-verdict">
            {crit ? (
              <>
                <Sev s="critical">{crit} critical</Sev> {kev.length ? `${kev.length} known-exploited CVE(s) on exposed services` : 'exposures need attention'}
              </>
            ) : r.findings.some((f) => f.severity === 'high') ? (
              <>
                <Sev s="high">high</Sev> no critical issues, some high-risk exposure
              </>
            ) : (
              <>
                <Sev s="low">low</Sev> no critical or high findings
              </>
            )}
          </div>
        </div>
        <div className="hero-stats">
          <Stat icon={<Globe2 size={14} />} label={r.kind === 'domain' ? 'Domains resolved' : 'Target'} value={r.kind === 'domain' ? `${r.domains.filter((d) => d.ips.length).length}/${r.domains.length}` : r.target} />
          <Stat icon={<Server size={14} />} label="Hosts" value={r.hosts.length} />
          <Stat icon={<Plug size={14} />} label="Open ports" value={ports} />
          <Stat icon={<Bug size={14} />} label="CVEs (inferred)" value={cves.length} />
          <Stat icon={<Flame size={14} />} label="Known exploited" value={kev.length} tone={kev.length ? 'bad' : undefined} />
          <Stat icon={<MapPin size={14} />} label="Countries" value={countries.size} />
          <Stat icon={<ShieldX size={14} />} label="On blocklists" value={listed} tone={listed ? 'bad' : undefined} />
        </div>
      </div>
      <div className="row gap6 wrap result-actions">
        <div className="section-tabs">
          {SECTIONS.map(([id, label, n]) => (
            <button key={id} className={section === id ? 'on' : ''} onClick={() => setSection(id)}>
              {label}
              {n != null && <span className="n">{n}</span>}
            </button>
          ))}
        </div>
        <span className="grow" />
        <button className="mod-ghost sm" onClick={() => ui.set({ tab: 'graph' })} title="Infrastructure graph">
          <Waypoints size={13} />
        </button>
        <button className="mod-ghost sm" onClick={() => ui.set({ tab: 'ai' })}>
          <Bot size={13} /> Ask AI
        </button>
        <button
          className="mod-ghost sm"
          disabled={radar.items.some((i) => i.target === r.target)}
          onClick={() => {
            radar.add(r.target, 24)
            toast('Added to Radar (checks every 24 h while ChainGraph is open)', 'success')
          }}
        >
          <RadarIcon size={13} /> {radar.items.some((i) => i.target === r.target) ? 'On Radar' : 'Watch'}
        </button>
        <button className="mod-ghost sm" onClick={() => saveToCase(`Attack surface: ${r.target}`, scanMarkdown(r))} title="Append the report to the active case’s notes">
          <BookmarkPlus size={13} />
        </button>
        <button className="mod-ghost sm" onClick={() => download(`${r.target.replace(/[^\w.-]/g, '_')}-attack-surface.md`, scanMarkdown(r), 'text/markdown')}>
          <Download size={13} /> Report
        </button>
        <button className="mod-ghost sm" onClick={() => download(`${r.target.replace(/[^\w.-]/g, '_')}-scan.json`, JSON.stringify(r, null, 2))}>
          JSON
        </button>
      </div>
      {r.notes.length > 0 && (
        <div className="callout">
          {r.notes.map((n) => (
            <div key={n}>{n}</div>
          ))}
        </div>
      )}

      {r.kind === 'asn' && <AsnPanel r={r} />}

      {section === 'overview' && <Overview r={r} cves={cves} cats={cats} onCat={(c) => (setCatFilter(c), setSection('findings'))} />}

      {section === 'findings' && (
        <>
          {cats.length > 0 && (
            <div className="cat-grid">
              {cats.map(([cat, v]) => (
                <button key={cat} className={'cat-tile ' + v.worst + (catFilter === cat ? ' on' : '')} onClick={() => setCatFilter(catFilter === cat ? null : cat)}>
                  <span className="cat-n">{v.n}</span>
                  <span className="cat-name">{cat}</span>
                </button>
              ))}
            </div>
          )}
          <Card
            title={`Findings (${findings.length})`}
            right={
              <div className="row gap4">
                {(['all', ...SEV_ORDER] as const).map((sv) => (
                  <button key={sv} className={'chip' + (sevFilter === sv ? ' on' : '')} onClick={() => setSevFilter(sv)}>
                    {sv}
                  </button>
                ))}
              </div>
            }
          >
            <FindingList items={findings} />
          </Card>
        </>
      )}

      {section === 'cves' && (
        <>
          <div className="viz-grid">
            <Card title="Risk matrix: impact × likelihood">
              <RiskScatter cves={cves} hostsOf={(id) => hostsFor(r, id)} />
            </Card>
            <Card title="Exploitation signals">
              <HBars
                items={[
                  { key: 'kev', label: 'In CISA KEV (exploited)', value: kev.length, alert: true, hint: 'CISA has evidence of exploitation in the wild' },
                  { key: 'active', label: 'SSVC: active exploitation', value: cves.filter((c) => c.ssvc?.exploitation === 'active').length, alert: true, hint: 'CISA SSVC decision point (top CVEs only)' },
                  { key: 'poc', label: 'SSVC: public PoC', value: cves.filter((c) => c.ssvc?.exploitation === 'poc').length, hint: 'Proof-of-concept code exists' },
                  { key: 'auto', label: 'SSVC: automatable', value: cves.filter((c) => c.ssvc?.automatable === 'yes').length, hint: 'Can be exploited at scale without interaction' },
                  { key: 'epss', label: 'EPSS ≥ 10%', value: cves.filter((c) => (c.epss ?? 0) >= 0.1).length, hint: '≥10% chance of exploitation in the next 30 days' },
                  { key: 'nuclei', label: 'Nuclei check available', value: cves.filter((c) => c.nuclei).length, hint: 'A detection template exists: you can verify safely' },
                ]}
              />
            </Card>
          </div>
          <Card title={`Priority CVEs (${cves.length})`} right={<span className="muted small">version-inferred · confirm installed builds</span>}>
            <CveTable items={cves} hostsOf={(id) => hostsFor(r, id)} limit={30} />
          </Card>
        </>
      )}

      {section === 'hosts' && (
        <Card title={`Hosts (${r.hosts.length})`} right={<span className="muted small">click a row for registry, routing, blocklist and CVE details</span>}>
          <HostTable r={r} />
        </Card>
      )}

      {section === 'geo' && <Geography r={r} />}

      {section === 'active' && r.active && <ActivePanel a={r.active} />}

      {section === 'dns' && (
        <>
          <div className="ogrid">
            {r.tech.length > 0 && (
              <Card title="Technology stack">
                <div className="tech-list">
                  {r.tech.map((t) => {
                    const st = t.cpe ? r.cpe[t.cpe] : undefined
                    return (
                      <div key={t.name + (t.version ?? '') + t.source} className="tech">
                        <span className="tech-name">{t.name}</span>
                        {t.version && <span className="mono small">{t.version}</span>}
                        <span className="grow" />
                        {st && (
                          <span className={'pill ' + (st.status === 'matched' ? 'warn' : '')} title={CPE_HELP[st.status]}>
                            {st.status === 'matched' ? `${st.cves.length} CVEs` : st.status}
                          </span>
                        )}
                        <span className="muted small">{t.source}</span>
                      </div>
                    )
                  })}
                </div>
              </Card>
            )}
            {r.email && (
              <Card title="Email authentication" status={r.email.spf && r.email.dmarc && !/p=none/i.test(r.email.dmarc) ? 'ok' : 'warn'}>
                <KV rows={[['MX', r.email.mx.join(', ') || 'none'], ['SPF', r.email.spf ?? 'missing'], ['DMARC', r.email.dmarc ?? 'missing']]} />
              </Card>
            )}
            {r.headers && (
              <Card title="HTTP response headers">
                <KV rows={Object.entries(r.headers).filter(([k]) => k !== 'set-cookie').slice(0, 30)} />
              </Card>
            )}
          </div>
          {r.domains.length > 0 && (
            <Card title={`Domains & subdomains (${r.domains.length})`}>
              <div className="sub-list">
                {r.domains.map((d) => (
                  <div key={d.name} className={'small mono' + (d.ips.length ? '' : ' muted')} title={d.cname ? `CNAME ${d.cname}` : ''}>
                    {d.name} <span className="muted">{d.ips.slice(0, 2).join(', ') || (d.cname ? `→ ${d.cname}` : 'unresolved')}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {r.coHosted.length > 0 && (
            <Card title={`Co-hosted sites on ${r.hosts[0]?.ip} (${r.coHosted.length})`}>
              <div className="sub-list">
                {r.coHosted.map((d) => (
                  <div key={d} className="small mono">
                    {d}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </>
  )
}

function Overview({ r, cves, cats, onCat }: { r: ScanResult; cves: CveRecord[]; cats: [string, { n: number; worst: Severity }][]; onCat: (c: string) => void }) {
  const portCount = new Map<number, number>()
  for (const h of r.hosts) for (const p of h.ports) portCount.set(p, (portCount.get(p) ?? 0) + 1)
  const portItems: BarItem[] = [...portCount]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([p, n]) => {
      const rule = portRule(p)
      return { key: String(p), label: <span className="mono">{p}{rule ? <span className="muted"> {rule.service}</span> : null}</span>, value: n, alert: rule?.severity === 'critical', hint: rule ? `${rule.service}: ${rule.why}` : `Port ${p}` }
    })
  const top = cves.slice(0, 5)
  return (
    <>
      <div className="viz-grid">
        <Card title="CVE priority">
          <PriorityBar cves={cves} />
          {top.length > 0 && (
            <div className="top-cves">
              {top.map((c) => (
                <div key={c.id} className="top-cve">
                  <span className="mono">{c.id}</span>
                  {c.kev ? <Sev s="critical">KEV</Sev> : <Sev s={priorityBucket(c).cls}>{priorityBucket(c).label}</Sev>}
                  <span className="ellipsis small text2">{c.kev?.name ?? c.summary ?? ''}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Findings by category">
          <HBars
            items={cats.map(([cat, v]) => ({ key: cat, label: <span className="row gap6"><Sev s={v.worst}>{v.worst}</Sev>{cat}</span>, value: v.n, hint: <a onClick={() => onCat(cat)}>Open {cat}</a> }))}
            max={8}
          />
          <div className="row gap4 wrap mt6">
            {cats.slice(0, 8).map(([cat]) => (
              <button key={cat} className="chip" onClick={() => onCat(cat)}>
                {cat} →
              </button>
            ))}
          </div>
        </Card>
        <Card title="Risk matrix: impact × likelihood">
          <RiskScatter cves={cves} hostsOf={(id) => hostsFor(r, id)} />
        </Card>
        <Card title="CVEs by year assigned">
          <YearColumns cves={cves} />
          <div className="muted small">Old CVEs on live services usually mean unpatched or end-of-life software.</div>
        </Card>
        <Card title="Open ports">
          <HBars items={portItems} max={10} unit=" host(s)" />
        </Card>
        <Card title="Server locations">
          <HostMap hosts={r.hosts} kevHosts={new Set(r.hosts.filter((h) => h.vulns.some((id) => r.cves[id]?.kev)).map((h) => h.ip))} />
        </Card>
      </div>
    </>
  )
}

function Geography({ r }: { r: ScanResult }) {
  const tally = <K extends string>(key: (h: HostResult) => K | undefined) => {
    const m = new Map<K, HostResult[]>()
    for (const h of r.hosts) {
      const k = key(h)
      if (k) m.set(k, [...(m.get(k) ?? []), h])
    }
    return [...m].sort((a, b) => b[1].length - a[1].length)
  }
  const geo = tally((h) => h.country)
  const reg = tally((h) => h.regCountry)
  const asn = tally((h) => (h.asn ? `AS${h.asn}` : undefined))
  const rir = tally((h) => h.rir)
  const mism = r.hosts.filter((h) => h.regCountry && h.country && h.regCountry !== h.country)
  const kevHosts = new Set(r.hosts.filter((h) => h.vulns.some((id) => r.cves[id]?.kev)).map((h) => h.ip))
  const countryItems = (rows: [string, HostResult[]][]) =>
    rows.map(([cc, hs]) => ({ key: cc, label: <span>{flag(cc)} {countryName(cc)}</span>, value: hs.length, hint: hs.slice(0, 8).map((h) => h.ip).join(', ') }))
  return (
    <>
      <Card title="Where the servers are">
        <HostMap hosts={r.hosts} kevHosts={kevHosts} />
      </Card>
      <div className="viz-grid">
        <Card title="Geolocated country (where the server sits)">
          <HBars items={countryItems(geo)} unit=" host(s)" />
        </Card>
        <Card title="Registered country (whois of the IP block)">
          <HBars items={countryItems(reg)} unit=" host(s)" />
        </Card>
        <Card title="Networks (ASN)">
          <HBars items={asn.map(([a, hs]) => ({ key: a, label: <span><span className="mono">{a}</span> <span className="muted">{hs[0].holder ?? ''}</span></span>, value: hs.length, hint: hs[0].holder }))} unit=" host(s)" />
        </Card>
        <Card title="Regional registry">
          <HBars items={rir.map(([a, hs]) => ({ key: a, label: a, value: hs.length, hint: RIR_INFO[a] ?? a }))} unit=" host(s)" />
        </Card>
      </div>
      {mism.length > 0 && (
        <Card title={`Registered in one country, located in another (${mism.length})`}>
          <div className="muted small mb6">Normal for clouds and CDNs. Matters for data-residency rules and for which jurisdiction’s abuse process applies.</div>
          <table className="ctbl">
            <tbody>
              {mism.map((h) => (
                <tr key={h.ip}>
                  <td className="mono">{h.ip}</td>
                  <td>
                    {flag(h.regCountry)} registered {countryName(h.regCountry)}
                  </td>
                  <td>
                    {flag(h.country)} located {countryName(h.country)}
                    {h.city ? `, ${h.city}` : ''}
                  </td>
                  <td className="small text2">{h.org ?? h.holder}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  )
}

const RIR_INFO: Record<string, string> = {
  ARIN: 'North America',
  RIPE: 'Europe, Middle East, Central Asia',
  APNIC: 'Asia-Pacific',
  LACNIC: 'Latin America & Caribbean',
  AFRINIC: 'Africa',
}

function ActivePanel({ a }: { a: import('../../cve/active').ActiveResult }) {
  return (
    <>
      <div className="callout">
        Active probe of <span className="mono">{a.target}</span>: these checks sent real, non-destructive requests to the target (HTTP/HTTPS, TLS handshake, TCP connect and exposed-file GETs).
      </div>
      {a.notes.map((n) => (
        <div key={n} className="callout warn">
          {n}
        </div>
      ))}
      <div className="ogrid">
        {a.http.map((x) => (
          <Card key={x.url} title={x.scheme.toUpperCase()} status={x.status < 0 ? 'none' : x.status < 400 ? 'ok' : 'warn'}>
            {x.error ? (
              <div className="muted small">No response: {x.error}</div>
            ) : x.opaque ? (
              <div className="muted small">Host answered, but the browser blocked reading the response (CORS).</div>
            ) : (
              <KV
                rows={[
                  ['Status', String(x.status)],
                  ['Final URL', x.finalUrl !== x.url ? x.finalUrl : x.redirected ? '(redirected)' : x.url],
                  ['Server', x.server],
                  ['X-Powered-By', x.poweredBy],
                  ['Title', x.title],
                  ['Response time', `${x.timeMs} ms`],
                ]}
              />
            )}
          </Card>
        ))}
        {a.tls && (
          <Card title="TLS certificate" status={a.tls.daysLeft != null && a.tls.daysLeft < 0 ? 'bad' : a.tls.selfSigned || a.tls.authorized === false ? 'warn' : 'ok'}>
            <KV
              rows={[
                ['Subject', a.tls.subject],
                ['Issuer', a.tls.issuer],
                ['Protocol', [a.tls.protocol, a.tls.cipher].filter(Boolean).join(' · ')],
                ['Valid until', a.tls.validTo && `${a.tls.validTo}${a.tls.daysLeft != null ? ` (${a.tls.daysLeft} days)` : ''}`],
                ['Trusted', a.tls.selfSigned ? 'no — self-signed' : a.tls.authorized === false ? `no — ${a.tls.authError}` : 'yes'],
                ['SANs', a.tls.altNames?.slice(0, 10).join(', ')],
              ]}
            />
          </Card>
        )}
        {a.ports && (
          <Card title="Open ports (live TCP connect)" status={a.ports.open.length ? 'warn' : 'ok'}>
            <div className="ports">
              {a.ports.open.length ? (
                a.ports.open.map((p) => {
                  const rule = portRule(p)
                  return (
                    <span key={p} className={'port ' + (rule?.severity ?? '')} title={rule ? `${rule.service}: ${rule.why}` : undefined}>
                      {p}
                      {rule ? ` ${rule.service}` : ''}
                    </span>
                  )
                })
              ) : (
                <span className="muted small">None of {a.ports.checked.length} common ports answered.</span>
              )}
            </div>
            <div className="muted small mt6">Confirms what is open right now, unlike the passive InternetDB data which can be stale.</div>
          </Card>
        )}
        {(a.cors || a.methods) && (
          <Card title="HTTP behavior">
            <KV
              rows={[
                ['CORS Allow-Origin', a.cors?.allowOrigin ?? (a.cors ? 'not set' : undefined)],
                ['CORS reflects origin', a.cors ? (a.cors.open ? 'yes — permissive' : 'no') : undefined],
                ['Allowed methods', a.methods?.allowed.join(', ')],
                ['TRACE enabled', a.methods ? (a.methods.trace ? 'yes' : 'no') : undefined],
              ]}
            />
          </Card>
        )}
      </div>
      {a.paths.length > 0 && (
        <Card title={`Reachable files & endpoints (${a.paths.length})`}>
          <table className="ctbl">
            <thead>
              <tr>
                <th style={{ width: 60 }}>Status</th>
                <th style={{ width: 260 }}>Path</th>
                <th style={{ width: 90 }}>Kind</th>
                <th>What it means</th>
              </tr>
            </thead>
            <tbody>
              {a.paths.map((p) => (
                <tr key={p.path}>
                  <td>
                    <Sev s={p.severity}>{p.status}</Sev>
                  </td>
                  <td className="mono small">{p.path}</td>
                  <td className="small">{p.kind}</td>
                  <td className="small text2">{p.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  )
}

const CPE_HELP: Record<string, string> = {
  matched: 'NVD lists CVEs for this exact product version',
  unmatched: 'NVD has no CVEs under this name. Shodan and NVD sometimes use different vendor names, so this is “not matched”, not “clean”.',
  unversioned: 'No version in the banner: CVEs cannot be matched',
  pending: 'Over the per-scan NVD lookup limit (raise it in scan options)',
  error: 'NVD lookup failed',
}

function Stat({ label, value, tone, icon }: { label: string; value: number | string; tone?: 'bad'; icon?: ReactNode }) {
  return (
    <div className={'stat' + (tone ? ' ' + tone : '')}>
      <div className="stat-l">
        {icon}
        {label}
      </div>
      <div className="stat-v ellipsis">{value}</div>
    </div>
  )
}

function FindingList({ items }: { items: Finding[] }) {
  if (!items.length) return <div className="muted small">Nothing matches the filter.</div>
  return (
    <div className="cfindings">
      {items.map((f) => (
        <div key={f.id} className="cfind">
          <Sev s={f.severity} />
          <div className="grow">
            <div className="cfind-title">{f.title}</div>
            <div className="small text2">{f.detail}</div>
          </div>
          <span className="pill" title="How sure the rule is. Banner-inferred CVEs stay low because distributions backport fixes.">
            {Math.round(f.confidence * 100)}%
          </span>
          <span className="muted small cfind-cat">{f.category}</span>
        </div>
      ))}
    </div>
  )
}

function HostTable({ r }: { r: ScanResult }) {
  const [open, setOpen] = useState<string | null>(null)
  const sorted = [...r.hosts].sort((a, b) => b.vulns.length - a.vulns.length || b.ports.length - a.ports.length)
  return (
    <table className="ctbl hosts">
      <thead>
        <tr>
          <th style={{ width: 150 }}>IP</th>
          <th>Network</th>
          <th style={{ width: 110 }}>Country</th>
          <th style={{ width: 170 }}>Ports</th>
          <th>Software</th>
          <th style={{ width: 60 }}>CVEs</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((h) => (
          <HostRow key={h.ip} h={h} r={r} open={open === h.ip} onToggle={() => setOpen(open === h.ip ? null : h.ip)} />
        ))}
      </tbody>
    </table>
  )
}

function HostRow({ h, r, open, onToggle }: { h: HostResult; r: ScanResult; open: boolean; onToggle: () => void }) {
  const kev = h.vulns.filter((id) => r.cves[id]?.kev).length
  return (
    <>
      <tr onClick={onToggle} className={open ? 'open' : ''}>
        <td className="mono">
          {h.ip}
          {h.via.length > 0 && <div className="muted small ellipsis">{h.via.slice(0, 2).join(', ')}</div>}
        </td>
        <td className="small">
          <div className="ellipsis">{h.org ?? h.holder ?? '?'}</div>
          <div className="muted ellipsis">
            {h.asn ? `AS${h.asn}` : ''} {h.netname ?? ''}
          </div>
          {(h.lists?.length ?? 0) > 0 && (
            <div className="row gap4 wrap">
              {h.lists!.map((l) => (
                <span key={l} className={'sev ' + (l === 'tor' ? 'medium' : 'critical')}>
                  {BLOCKLISTS.find((b) => b.id === l)?.label ?? l}
                </span>
              ))}
            </div>
          )}
        </td>
        <td className="small" title={`Located: ${countryName(h.country)}${h.city ? `, ${h.city}` : ''} · Registered: ${countryName(h.regCountry)}`}>
          <div>
            {flag(h.country)} {h.country ?? '?'}
            {h.city ? <span className="muted"> {h.city}</span> : null}
          </div>
          {h.regCountry && h.regCountry !== h.country && <div className="muted">reg. {flag(h.regCountry)} {h.regCountry}</div>}
        </td>
        <td>
          <div className="ports">
            {h.ports.map((p) => {
              const rule = portRule(p)
              return (
                <span key={p} className={'port ' + (rule && !isCdn(h) ? rule.severity : '')} title={rule ? `${rule.service}: ${rule.why}` : undefined}>
                  {p}
                </span>
              )
            })}
            {!h.inIdb && <span className="muted small">no scan data</span>}
          </div>
        </td>
        <td className="small">
          <div className="ellipsis">{h.cpes.map(cpeLabel).join(', ')}</div>
          <div className="row gap4 wrap">
            {h.tags.map((t) => (
              <span key={t} className="pill" title={TAG_RULES[t]?.why}>
                {TAG_RULES[t]?.label ?? t}
              </span>
            ))}
          </div>
        </td>
        <td>
          {h.vulns.length || ''}
          {kev > 0 && (
            <div>
              <Sev s="critical">{kev} KEV</Sev>
            </div>
          )}
        </td>
      </tr>
      {open && (
        <tr className="detail-row">
          <td colSpan={6}>
            <div className="intel-grid">
              <KV
                rows={[
                  ['Registered to', h.org],
                  ['Network name', h.netname],
                  ['Range', h.netRange],
                  ['Registry', h.rir && `${h.rir}${h.regDate ? ` · since ${h.regDate}` : ''}`],
                  ['Registered country', h.regCountry && `${flag(h.regCountry)} ${countryName(h.regCountry)}`],
                  ['Located in', h.country && `${flag(h.country)} ${countryName(h.country)}${h.city ? `, ${h.city}` : ''}${h.lat != null ? ` (${h.lat.toFixed(2)}, ${h.lon?.toFixed(2)})` : ''}`],
                ]}
              />
              <KV
                rows={[
                  ['ASN', h.asn && `AS${h.asn} ${h.holder ?? ''}`],
                  ['Announced prefix', h.prefix],
                  ['RPKI', h.rpki && <span className={h.rpki === 'valid' ? 'pos' : h.rpki === 'invalid' ? 'neg' : 'muted'}>{h.rpki}</span>],
                  ['Reverse DNS', h.ptr?.join(', ') || 'none'],
                  ['Abuse contact', h.abuse ? (h.abuse.length ? h.abuse.join(', ') : 'none registered') : 'unknown'],
                  ['Blocklists', h.lists?.length ? h.lists.map((l) => BLOCKLISTS.find((b) => b.id === l)?.label ?? l).join(', ') : h.ip.includes(':') ? 'IPv6 not checked' : h.lists ? 'not listed (FireHOL 1–3, Spamhaus DROP, C2, Tor)' : 'not checked (lists unavailable)'],
                ]}
              />
            </div>
            <div className="row gap6 wrap small mb6">
              {[
                ['Shodan', `https://www.shodan.io/host/${h.ip}`],
                ['Censys', `https://search.censys.io/hosts/${h.ip}`],
                ['GreyNoise', `https://viz.greynoise.io/ip/${h.ip}`],
                ['AbuseIPDB', `https://www.abuseipdb.com/check/${h.ip}`],
                ['bgp.he.net', `https://bgp.he.net/ip/${h.ip}`],
              ].map(([l, u]) => (
                <a key={l} className="chip" href={u} target="_blank" rel="noreferrer noopener">
                  {l}
                </a>
              ))}
              {h.prefix && <span className="muted">prefix {h.prefix}</span>}
              {h.hostnames.length > 0 && <span className="muted">PTR/hostnames: {h.hostnames.slice(0, 6).join(', ')}</span>}
            </div>
            {isCdn(h) && <div className="callout">Shared CDN edge: open ports and CVEs describe the CDN, not the origin server behind it.</div>}
            {h.tags.includes('honeypot') && <div className="callout warn">Likely honeypot: banners and CVEs are deliberately fake.</div>}
            <CveTable items={h.vulns.map((id) => r.cves[id]).filter(Boolean).sort((a, b) => Number(!!b.kev) - Number(!!a.kev) || (b.epss ?? 0) - (a.epss ?? 0))} limit={15} />
          </td>
        </tr>
      )}
    </>
  )
}

function AsnPanel({ r }: { r: ScanResult }) {
  const scan = (p: string) => {
    const bits = Number(p.split('/')[1])
    const target = bits < 24 ? p.replace(/\/\d+$/, '/24') : p
    if (bits < 24) toast(`Prefix is larger than /24: scanning the first /24 (${target})`, 'info')
    void startScan(target)
  }
  const v4 = r.prefixes.filter((p) => !p.includes(':'))
  return (
    <Card title={`AS${r.asnInfo?.asn} · ${r.asnInfo?.holder ?? ''} — ${r.prefixes.length} announced prefixes`}>
      <div className="sub-list">
        {v4.slice(0, 400).map((p) => (
          <button key={p} className="chip mono" onClick={() => scan(p)} title="Scan this prefix (up to /24)">
            {p}
          </button>
        ))}
      </div>
      {r.prefixes.length > v4.length && <div className="muted small mt6">{r.prefixes.length - v4.length} IPv6 prefixes not listed.</div>}
    </Card>
  )
}
