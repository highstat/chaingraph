# ChainGraph CVE MCP server

Gives any MCP-capable AI client the same passive reconnaissance and vulnerability intelligence as the `/cve` page. Clients include Claude Desktop, Claude Code, Cursor, LM Studio, VS Code, and Open WebUI through `mcpo`. The server never sends anything to the target. Its data comes from DNS, certificate transparency, Shodan InternetDB, RIPEstat, NVD, FIRST EPSS, CISA KEV, CIRCL, OSV, FireHOL and Nuclei templates.

## Build

```bash
npm install
npm run mcp:build          # writes mcp/dist/chaingraph-mcp.mjs
```

The server speaks MCP over stdio. Requires Node 20+.

## Tools

| Tool | What it does |
|---|---|
| `scan_target` | Scans a domain, IP, CIDR (up to /24) or ASN. Returns hosts, ports and software, CVEs ranked by CVSS + EPSS + KEV + SSVC, IP registry and geolocation, RPKI, blocklists, email authentication, findings and an exposure score. Sends progress notifications. |
| `ip_intel` | Everything about one IP: registered owner and country (all RIRs), geolocated city and coordinates, ASN, prefix, RPKI, PTR, abuse contact, FireHOL / Spamhaus DROP / C2 / Tor lists, open ports and banner CVEs |
| `lookup_cve` | One CVE: CVSS and vector, CWE, EPSS with a 30-day trend, CISA KEV, CISA SSVC (exploitation, automatable, impact), Nuclei template availability, public GitHub repos, fixes and references |
| `search_cves` | Searches NVD by keyword, by product and version (resolved to a CPE), or by CPE. Results are ranked by priority |
| `audit_dependencies` | Takes a manifest (package-lock, requirements, go.mod, composer.lock, Cargo.lock…) or a product list. Checks packages against OSV and products against NVD |
| `kev_latest` | Latest CISA KEV additions, optionally filtered by vendor |
| `asn_overview` | Holder and announced prefixes of an AS |

Prompt: `threat_assessment(target)` runs a scan and asks the model for scenarios, jurisdiction and a remediation plan.

## Connect a client

Replace `/path/to/chaingraph` with the absolute path of this repository.

**Claude Code**

```bash
claude mcp add chaingraph -- node /path/to/chaingraph/mcp/dist/chaingraph-mcp.mjs
```

**Claude Desktop, Cursor, LM Studio, VS Code** (`claude_desktop_config.json`, `~/.cursor/mcp.json`, LM Studio's `mcp.json`):

```json
{
  "mcpServers": {
    "chaingraph": {
      "command": "node",
      "args": ["/path/to/chaingraph/mcp/dist/chaingraph-mcp.mjs"],
      "env": { "NVD_API_KEY": "" }
    }
  }
}
```

LM Studio runs local open-weight models with MCP tools, so the whole pipeline can stay on your machine except for the public data sources.

**Open WebUI and other OpenAPI-only clients:** wrap the server with [mcpo](https://github.com/open-webui/mcpo):

```bash
uvx mcpo --port 8000 -- node /path/to/chaingraph/mcp/dist/chaingraph-mcp.mjs
```

## Configuration

| Variable | Effect |
|---|---|
| `NVD_API_KEY` | Free key from nvd.nist.gov. Raises NVD from 5 to 50 requests per 30 s, about 10× faster scans |
| `CHAINGRAPH_CACHE_DIR` | Cache location (default `~/.cache/chaingraph-mcp`). NVD 3 days, InternetDB 12 h, KEV and blocklists daily |

## Responsible use

Use this server only on systems you own or are authorized to assess. Host CVEs are inferred from service banners, and distributions often backport fixes, so verify a CVE before acting on it, for example with the Nuclei template the tool points to. Data is passive and public: the server performs no port scans, exploitation or load tests.
