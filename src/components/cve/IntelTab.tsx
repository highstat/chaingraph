// CVE intelligence: look up a CVE, search NVD by keyword, product or CPE, and
// browse the latest additions to CISA's Known Exploited Vulnerabilities list.

import { Loader2, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { bestCpe, epss, kevCatalog, kevInfo, nvdByCpe, nvdCpeSearch, nvdCve, nvdEta, nvdSearch, type KevEntry } from '../../cve/sources'
import { cvePriority } from '../../cve/rules'
import { useCve } from '../../cve/state'
import type { CveRecord } from '../../cve/types'
import { toast } from '../../store'
import { Card, ToolHeader } from '../osint/kit'
import { CveDetail, CveTable } from './shared'

async function decorate(items: CveRecord[]): Promise<CveRecord[]> {
  const [ep, kev] = await Promise.all([epss(items.map((c) => c.id)).catch(() => ({}) as Record<string, { epss: number; pct: number }>), kevCatalog()])
  return items.map((c) => {
    const k = kev.get(c.id)
    return { ...c, epss: ep[c.id]?.epss, epssPct: ep[c.id]?.pct, kev: c.kev ?? (k ? kevInfo(k) : undefined) }
  })
}

export function IntelTab() {
  const seed = useCve((s) => s.intelSeed)
  const [q, setQ] = useState(seed)
  const [recent, setRecent] = useState(0)
  const [busy, setBusy] = useState(false)
  const [single, setSingle] = useState<CveRecord | null>(null)
  const [list, setList] = useState<{ title: string; items: CveRecord[]; total?: number } | null>(null)

  const run = async (value = q) => {
    const v = value.trim()
    if (!v) return
    setBusy(true)
    setSingle(null)
    setList(null)
    try {
      const id = v.match(/^CVE-\d{4}-\d{4,}$/i)?.[0].toUpperCase()
      if (id) {
        const rec = (await nvdCve(id)) ?? { id, detail: 'none' as const }
        setSingle((await decorate([rec]))[0])
      } else if (v.startsWith('cpe:')) {
        const items = await nvdByCpe(v.startsWith('cpe:2.3:') ? v : v.replace(/^cpe:\//, 'cpe:2.3:'))
        setList({ title: `CVEs for ${v}`, items: (await decorate(items)).sort((a, b) => cvePriority(b) - cvePriority(a)) })
      } else if (/\d+\.\d+/.test(v) && !/\s{2,}/.test(v)) {
        // "nginx 1.18.0": resolve the product to a CPE first, then match CVEs.
        toast(`Resolving product via the NVD CPE dictionary (~${nvdEta(2)} s)`, 'info')
        const cpes = await nvdCpeSearch(v)
        if (!cpes.length) {
          const r = await nvdSearch(v, recent || undefined)
          setList({ title: `Keyword “${v}”`, items: (await decorate(r.items)).sort((a, b) => cvePriority(b) - cvePriority(a)), total: r.total })
        } else {
          const best = bestCpe(cpes, v)!
          const items = await nvdByCpe(best.name)
          setList({ title: `${best.title} (${best.name})`, items: (await decorate(items)).sort((a, b) => cvePriority(b) - cvePriority(a)) })
        }
      } else {
        const r = await nvdSearch(v, recent || undefined)
        setList({ title: `Keyword “${v}”${recent ? `, last ${recent} days` : ''}`, items: (await decorate(r.items)).sort((a, b) => cvePriority(b) - cvePriority(a)), total: r.total })
      }
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (seed) void run(seed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed])

  return (
    <div className="tool">
      <ToolHeader
        title="CVE intelligence"
        desc="Look up any CVE with CVSS, EPSS exploitation probability, CISA KEV status, weaknesses, fixes and references. Search NVD by keyword, by product and version (resolved to a CPE), or by a CPE string."
      />
      <form
        className="query-bar"
        onSubmit={(e) => {
          e.preventDefault()
          void run()
        }}
      >
        <div className="search-box big">
          <Search size={15} className="muted" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="CVE-2024-3400 · “fortinet ssl vpn” · nginx 1.18.0 · cpe:2.3:a:apache:http_server:2.4.49" spellCheck={false} />
        </div>
        <select className="dropdown" value={recent} onChange={(e) => setRecent(Number(e.target.value))} title="Limit keyword searches by publication date">
          <option value={0}>Any date</option>
          <option value={30}>Last 30 days</option>
          <option value={120}>Last 120 days</option>
        </select>
        <button className="mod-cta" disabled={busy || !q.trim()}>
          {busy ? <Loader2 size={14} className="spin" /> : <Search size={14} />} Search
        </button>
      </form>
      {busy && <div className="muted small">NVD allows 5 keyless requests per 30 s, so searches can take a few seconds. Results are cached.</div>}
      {single && (
        <Card title={single.id}>
          <CveDetail c={single} />
        </Card>
      )}
      {list && (
        <Card title={`${list.title}: ${list.items.length}${list.total && list.total > list.items.length ? ` of ${list.total}` : ''}`}>
          <CveTable items={list.items} limit={50} />
        </Card>
      )}
      <KevFeed />
    </div>
  )
}

function KevFeed() {
  const [items, setItems] = useState<KevEntry[] | null>(null)
  const [vendor, setVendor] = useState('')
  useEffect(() => {
    void kevCatalog().then((m) => setItems([...m.values()].sort((a, b) => b.dateAdded.localeCompare(a.dateAdded))))
  }, [])
  const shown = (items ?? []).filter((k) => !vendor || `${k.vendorProject} ${k.product}`.toLowerCase().includes(vendor.toLowerCase())).slice(0, 60)
  const rows: CveRecord[] = shown.map((k) => ({ id: k.cveID, summary: `${k.vendorProject} ${k.product}: ${k.vulnerabilityName}. ${k.shortDescription}`, kev: kevInfo(k), detail: 'none' }))
  return (
    <Card
      title={`Exploited in the wild: latest CISA KEV additions${items ? ` (${items.length} total)` : ''}`}
      right={<input className="mini-input" placeholder="Filter vendor / product" value={vendor} onChange={(e) => setVendor(e.target.value)} />}
    >
      {!items ? <div className="muted small">Loading catalog…</div> : <CveTable items={rows} limit={20} />}
    </Card>
  )
}
