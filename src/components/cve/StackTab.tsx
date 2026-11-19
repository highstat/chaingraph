// Stack audit: paste a dependency manifest or a list of products and versions
// to get the advisories that apply (OSV.dev for packages, NVD for products).
// This covers what a browser cannot fingerprint remotely.

import { FileCode2, Loader2 } from 'lucide-react'
import { Fragment, useState } from 'react'
import { bestCpe, epss, kevCatalog, kevInfo, nvdByCpe, nvdCpeSearch, nvdEta, osvBatch, osvVuln, pool, type OsvQuery } from '../../cve/sources'
import { cvePriority, severityOf } from '../../cve/rules'
import type { CveRecord } from '../../cve/types'
import { toast } from '../../store'
import { parseManifest } from '../../cve/manifest'
import { Card, ToolHeader } from '../osint/kit'
import { CveTable, Sev } from './shared'

interface PkgVuln {
  pkg: OsvQuery
  id: string
  aliases: string[]
  summary: string
  fixed?: string
  cvss?: number
}

const SAMPLE = `# Products and versions (matched against NVD)
nginx 1.18.0
OpenSSH 7.4
Apache Tomcat 9.0.30

# Packages (matched against OSV.dev): ecosystem:name@version
npm:lodash@4.17.15
pypi:django@3.2.0
go:golang.org/x/net@v0.7.0`

export function StackTab() {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState('')
  const [pkgVulns, setPkgVulns] = useState<PkgVuln[] | null>(null)
  const [productCves, setProductCves] = useState<{ product: string; cpe?: string; items: CveRecord[] }[]>([])
  const [meta, setMeta] = useState<{ format: string; packages: number; products: number } | null>(null)

  const run = async () => {
    const parsed = parseManifest(text)
    if (!parsed.queries.length && !parsed.products.length) return toast('Nothing recognized. Paste a manifest or lines like “nginx 1.18.0”.')
    setMeta({ format: parsed.format, packages: parsed.queries.length, products: parsed.products.length })
    setPkgVulns(null)
    setProductCves([])
    try {
      if (parsed.queries.length) {
        setBusy(`Querying OSV.dev for ${parsed.queries.length} packages`)
        const ids = await osvBatch(parsed.queries)
        const pairs = parsed.queries.flatMap((q, i) => (ids[i] ?? []).map((id) => ({ q, id })))
        const uniq = [...new Set(pairs.map((p) => p.id))].slice(0, 150)
        let done = 0
        const details = new Map<string, any>()
        await pool(uniq, 6, async (id) => {
          details.set(id, await osvVuln(id).catch(() => null))
          setBusy(`Advisory details ${++done}/${uniq.length}`)
        })
        setPkgVulns(
          pairs
            .filter((p) => details.get(p.id))
            .map(({ q, id }) => {
              const d = details.get(id)
              const aff = (d.affected ?? []).find((a: any) => a.package?.name === q.name) ?? d.affected?.[0]
              const fixed = (aff?.ranges ?? []).flatMap((r: any) => r.events ?? []).map((e: any) => e.fixed).filter(Boolean).pop()
              const score = (d.severity ?? []).map((s: any) => s.score).find((s: string) => /^\d/.test(s)) ?? aff?.ecosystem_specific?.severity ?? d.database_specific?.severity
              return {
                pkg: q,
                id,
                aliases: (d.aliases ?? []).filter((a: string) => a.startsWith('CVE-')),
                summary: d.summary ?? d.details?.slice(0, 200) ?? '',
                fixed,
                cvss: typeof score === 'string' && /^\d/.test(score) ? Number(score) : SEV_WORD[String(score).toUpperCase()],
              }
            }),
        )
      }
      if (parsed.products.length) {
        const out: { product: string; cpe?: string; items: CveRecord[] }[] = []
        const kev = await kevCatalog()
        for (const [i, p] of parsed.products.slice(0, 15).entries()) {
          setBusy(`NVD: ${p} (${i + 1}/${Math.min(15, parsed.products.length)}, ~${nvdEta(2 * (Math.min(15, parsed.products.length) - i))} s left)`)
          const cpes = await nvdCpeSearch(p).catch(() => [])
          if (!cpes.length) {
            out.push({ product: p, items: [] })
            setProductCves([...out])
            continue
          }
          const best = bestCpe(cpes, p)!
          const items = await nvdByCpe(best.name).catch(() => [])
          const ep = await epss(items.map((c) => c.id)).catch(() => ({}) as Record<string, { epss: number; pct: number }>)
          out.push({
            product: p,
            cpe: best.name,
            items: items
              .map((c) => ({ ...c, epss: ep[c.id]?.epss, epssPct: ep[c.id]?.pct, kev: c.kev ?? (kev.get(c.id) ? kevInfo(kev.get(c.id)!) : undefined) }))
              .sort((a, b) => cvePriority(b) - cvePriority(a)),
          })
          setProductCves([...out])
        }
      }
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  const byPkg = new Map<string, PkgVuln[]>()
  for (const v of pkgVulns ?? []) {
    const k = `${v.pkg.ecosystem}:${v.pkg.name}@${v.pkg.version}`
    byPkg.set(k, [...(byPkg.get(k) ?? []), v])
  }

  return (
    <div className="tool">
      <ToolHeader
        title="Stack audit"
        desc="Paste package-lock.json, package.json, requirements.txt, composer.lock, go.mod, Cargo.lock or Gemfile.lock, or list products with versions. Packages are checked against OSV.dev (GitHub, PyPA, Go and other advisory databases); products against NVD with EPSS and KEV prioritization."
      />
      <textarea className="stack-input mono" value={text} onChange={(e) => setText(e.target.value)} placeholder={SAMPLE} spellCheck={false} />
      <div className="row gap6 mt6">
        <button className="mod-cta" disabled={!!busy || !text.trim()} onClick={() => void run()}>
          {busy ? <Loader2 size={14} className="spin" /> : <FileCode2 size={14} />} Audit
        </button>
        <button className="mod-ghost" onClick={() => setText(SAMPLE)}>
          Load example
        </button>
        {busy && <span className="muted small">{busy}</span>}
        {meta && !busy && (
          <span className="muted small">
            {meta.format}: {meta.packages} packages, {meta.products} products
          </span>
        )}
      </div>

      {pkgVulns && (
        <Card title={`Vulnerable packages: ${byPkg.size} of ${meta?.packages ?? 0} (${pkgVulns.length} advisories)`}>
          {!byPkg.size ? (
            <div className="muted small">No known advisories for these versions.</div>
          ) : (
            <table className="ctbl">
              <thead>
                <tr>
                  <th style={{ width: '28%' }}>Package</th>
                  <th style={{ width: 170 }}>Advisory</th>
                  <th style={{ width: 70 }}>Severity</th>
                  <th>Summary</th>
                  <th style={{ width: 110 }}>Fixed in</th>
                </tr>
              </thead>
              <tbody>
                {[...byPkg].map(([k, vs]) => (
                  <Fragment key={k}>
                    {vs.map((v, i) => (
                      <tr key={v.id}>
                        <td className="mono small">{i === 0 ? k : ''}</td>
                        <td className="small">
                          <a href={`https://osv.dev/vulnerability/${v.id}`} target="_blank" rel="noreferrer noopener" className="mono">
                            {v.id}
                          </a>
                          {v.aliases.length > 0 && <div className="muted">{v.aliases.join(', ')}</div>}
                        </td>
                        <td>{v.cvss != null ? <Sev s={severityOf(v.cvss)}>{v.cvss}</Sev> : <span className="muted">–</span>}</td>
                        <td className="small text2">{v.summary}</td>
                        <td className="mono small">{v.fixed ?? '–'}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {productCves.map((p) => (
        <Card key={p.product} title={`${p.product}: ${p.items.length} CVEs`} right={<span className="muted small mono">{p.cpe ?? 'no CPE match in NVD'}</span>}>
          <CveTable items={p.items} limit={15} />
        </Card>
      ))}
    </div>
  )
}

/** OSV database severity words → representative CVSS score. */
const SEV_WORD: Record<string, number> = { CRITICAL: 9.5, HIGH: 8, MODERATE: 5.5, MEDIUM: 5.5, LOW: 3 }
