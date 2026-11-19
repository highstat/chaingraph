// How to give AI clients (Claude, Cursor, LM Studio…) the CVE engine as MCP tools.

import { Copy } from 'lucide-react'
import { useState } from 'react'
import { toast } from '../../store'
import { Card, ToolHeader } from '../osint/kit'

const TOOLS: [string, string][] = [
  ['scan_target', 'Attack-surface scan of a domain, IP, range or ASN with ranked CVEs, IP intel, findings and score'],
  ['ip_intel', 'Registered owner and country, geolocation, ASN, RPKI, PTR, abuse contact, blocklists, exposure'],
  ['lookup_cve', 'CVSS, CWE, EPSS + 30-day trend, CISA KEV, CISA SSVC, Nuclei template, public repos, fixes'],
  ['search_cves', 'NVD search by keyword, product + version or CPE, ranked by priority'],
  ['audit_dependencies', 'Manifest or product list → OSV and NVD advisories'],
  ['kev_latest', 'Latest CISA KEV additions, filter by vendor'],
  ['asn_overview', 'AS holder and announced prefixes'],
]

function Snippet({ title, code }: { title: string; code: string }) {
  return (
    <div className="snippet">
      <div className="snippet-head">
        <span>{title}</span>
        <button className="chip" onClick={() => void navigator.clipboard.writeText(code).then(() => toast('Copied', 'success'))}>
          <Copy size={11} /> Copy
        </button>
      </div>
      <pre className="md-code">{code}</pre>
    </div>
  )
}

export function McpTab() {
  const [path, setPath] = useState('/path/to/chaingraph')
  const bin = `${path.replace(/\/+$/, '')}/mcp/dist/chaingraph-mcp.mjs`
  const json = JSON.stringify({ mcpServers: { chaingraph: { command: 'node', args: [bin], env: { NVD_API_KEY: '' } } } }, null, 2)
  return (
    <div className="tool">
      <ToolHeader
        title="MCP server for AI models"
        desc="The same CVE engine as this page, packaged as a Model Context Protocol server. Any MCP client can then run scans and look up CVEs and IPs by itself: Claude Desktop, Claude Code, Cursor, VS Code, or LM Studio with local open-weight models. It runs on your machine over stdio and uses system DNS, without browser limits."
      />
      <Card title="1. Build it once">
        <Snippet title="Terminal, in the ChainGraph repository" code={`npm install\nnpm run mcp:build`} />
        <label className="row gap6 small mt6">
          Repository path
          <input value={path} onChange={(e) => setPath(e.target.value)} spellCheck={false} style={{ flex: 1 }} />
        </label>
      </Card>
      <Card title="2. Connect a client">
        <Snippet title="Claude Code" code={`claude mcp add chaingraph -- node ${bin}`} />
        <Snippet title="Claude Desktop · Cursor (~/.cursor/mcp.json) · LM Studio (mcp.json) · VS Code" code={json} />
        <Snippet title="Open WebUI and other OpenAPI clients (via mcpo)" code={`uvx mcpo --port 8000 -- node ${bin}`} />
        <div className="muted small">Optional: set NVD_API_KEY for ~10× faster NVD lookups. The cache lives in ~/.cache/chaingraph-mcp.</div>
      </Card>
      <Card title="Tools the model gets">
        <table className="ctbl">
          <tbody>
            {TOOLS.map(([n, d]) => (
              <tr key={n}>
                <td className="mono" style={{ width: 200 }}>
                  {n}
                </td>
                <td className="small text2">{d}</td>
              </tr>
            ))}
            <tr>
              <td className="mono">threat_assessment</td>
              <td className="small text2">Prompt: scan, then write scenarios, jurisdiction and a remediation plan</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  )
}
