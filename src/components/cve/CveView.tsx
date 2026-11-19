// /cve — attack surface, CVE intelligence and AI analysis workspace.

import { Bot, Cable, Database, FileCode2, Radar as RadarIcon, ScanSearch, ShieldAlert, Waypoints } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { hackertargetAvailable } from '../../cve/sources'
import { useCveSettings } from '../../cve/settings'
import { hydrateCveHistory, useCve, useRadar, type CveTab } from '../../cve/state'
import { ToolHeader } from '../osint/kit'
import { SettingItem } from '../ui'
import { AiTab } from './AiTab'
import { InfraGraph } from './InfraGraph'
import { IntelTab } from './IntelTab'
import { McpTab } from './McpTab'
import { RadarTab } from './RadarTab'
import { ScanTab } from './ScanTab'
import { StackTab } from './StackTab'

const MODULES: { id: CveTab; label: string; icon: ReactNode; group: string }[] = [
  { id: 'scan', label: 'Surface scan', icon: <ScanSearch size={15} />, group: 'Reconnaissance' },
  { id: 'graph', label: 'Infrastructure graph', icon: <Waypoints size={15} />, group: 'Reconnaissance' },
  { id: 'intel', label: 'CVE intelligence', icon: <ShieldAlert size={15} />, group: 'Vulnerabilities' },
  { id: 'stack', label: 'Stack audit', icon: <FileCode2 size={15} />, group: 'Vulnerabilities' },
  { id: 'ai', label: 'AI analyst', icon: <Bot size={15} />, group: 'Analysis' },
  { id: 'radar', label: 'Radar', icon: <RadarIcon size={15} />, group: 'Analysis' },
  { id: 'mcp', label: 'MCP server', icon: <Cable size={15} />, group: 'Analysis' },
  { id: 'settings', label: 'Sources & keys', icon: <Database size={15} />, group: 'Analysis' },
]

export function CveView() {
  const cve = useCve()
  const radarCount = useRadar((s) => s.items.length)
  useEffect(() => {
    void hydrateCveHistory()
  }, [])
  const groups = [...new Set(MODULES.map((m) => m.group))]
  return (
    <div className="osint cve">
      <nav className="osint-nav">
        {groups.map((g) => (
          <div key={g}>
            <div className="vtab-group-title">{g}</div>
            {MODULES.filter((m) => m.group === g).map((m) => (
              <div key={m.id} className={'vtab' + (cve.tab === m.id ? ' is-active' : '')} onClick={() => cve.set({ tab: m.id })}>
                {m.icon}
                {m.label}
                {m.id === 'scan' && cve.progress && <span className="pulse small">●</span>}
                {m.id === 'radar' && radarCount > 0 && <span className="pill tiny">{radarCount}</span>}
              </div>
            ))}
          </div>
        ))}
        <div className="osint-note">
          Passive data only: public DNS, certificate logs and internet-wide scan datasets. Assess systems you own or are authorized to test. CVEs are inferred from banners; verify before acting.
        </div>
      </nav>
      <div className={'osint-body' + (cve.tab === 'graph' ? ' no-scroll' : '')}>
        {cve.tab === 'scan' && <ScanTab key={cve.result?.id ?? 'none'} />}
        {cve.tab === 'graph' && <InfraGraph />}
        {cve.tab === 'intel' && <IntelTab />}
        {cve.tab === 'stack' && <StackTab />}
        {cve.tab === 'ai' && <AiTab />}
        {cve.tab === 'radar' && <RadarTab />}
        {cve.tab === 'mcp' && <McpTab />}
        {cve.tab === 'settings' && <SourcesTab />}
      </div>
    </div>
  )
}

const SOURCES: [string, string, string][] = [
  ['Shodan InternetDB', 'Open ports, CPEs, tags and banner-inferred CVEs per IP (weekly refresh)', 'Keyless'],
  ['NVD 2.0', 'CVE details, CVSS, CWE, CPE matching, KEV fields', 'Keyless (5 req / 30 s) or free key'],
  ['FIRST EPSS', 'Probability of exploitation in the next 30 days', 'Keyless'],
  ['CISA KEV', 'Vulnerabilities exploited in the wild, ransomware use', 'Keyless (GitHub mirror)'],
  ['CIRCL Vulnerability-Lookup', 'CVE 5 records with CISA ADP scores', 'Keyless'],
  ['OSV.dev', 'Package advisories (npm, PyPI, Go, Maven, crates.io…)', 'Keyless'],
  ['RIPEstat', 'Prefix, ASN, holder, geolocation, announced prefixes', 'Keyless'],
  ['Cert Spotter / crt.sh', 'Subdomains from certificate transparency', 'Keyless'],
  ['DNS over HTTPS', 'Google, Cloudflare and AliDNS resolvers', 'Keyless'],
  ['HackerTarget', 'HTTP headers, reverse IP (opt-in)', '~50 free calls / day'],
  ['GitHub search', 'Public PoC repository count (on request)', 'Keyless (10 / min)'],
  ['RIPEstat whois / abuse / RPKI', 'Registered owner & country (all RIRs), abuse contact, route-origin validity', 'Keyless'],
  ['FireHOL blocklists', 'FireHOL level 1–3, Spamhaus DROP, C2 tracker, Tor exits', 'Keyless (GitHub)'],
  ['Nuclei templates', 'Which CVEs have a safe detection template', 'Keyless (GitHub)'],
]

function SourcesTab() {
  const s = useCveSettings()
  return (
    <div className="tool">
      <ToolHeader title="Sources & keys" desc="Every source is free and called straight from your browser. Keys are optional and stored only in this browser." />
      <SettingItem name="NVD API key" desc={<>Raises the NVD limit from 5 to 50 requests per 30 s, making product lookups ~10× faster. Free at nvd.nist.gov/developers/request-an-api-key.</>}>
        <input type="password" value={s.nvdKey} onChange={(e) => s.set({ nvdKey: e.target.value })} placeholder="optional" autoComplete="off" style={{ width: 280 }} />
      </SettingItem>
      <SettingItem name="HackerTarget quota" desc="Used only when header fingerprinting or reverse IP is enabled in scan options.">
        <span className={hackertargetAvailable() ? 'pos' : 'neg'}>{hackertargetAvailable() ? 'available' : 'used up for now'}</span>
      </SettingItem>
      <div className="section-title mt6">Data sources</div>
      <table className="ctbl">
        <thead>
          <tr>
            <th style={{ width: 210 }}>Source</th>
            <th>Used for</th>
            <th style={{ width: 230 }}>Access</th>
          </tr>
        </thead>
        <tbody>
          {SOURCES.map(([a, b, c]) => (
            <tr key={a}>
              <td>{a}</td>
              <td className="small text2">{b}</td>
              <td className="small">{c}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
