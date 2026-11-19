// Shared pieces of the CVE page: severity chips, the CVE detail drawer and a
// small Markdown renderer for AI answers (tables, code blocks, lists).

import { ChevronDown, ChevronRight, ExternalLink, Loader2 } from 'lucide-react'
import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { inline } from '../../markdown'
import { cvePriority, priorityBucket, severityOf } from '../../cve/rules'
import { circlCve, epssSeries, githubPocCount, nvdCve } from '../../cve/sources'
import { Sparkline } from './charts'
import { cveLinks, pct } from '../../cve/report'
import type { CveRecord, Severity } from '../../cve/types'

export function Sev({ s, children }: { s: Severity; children?: ReactNode }) {
  return <span className={'sev ' + s}>{children ?? s}</span>
}

export function CvssCell({ c }: { c: CveRecord }) {
  if (c.cvss == null) return <span className="muted">–</span>
  return <Sev s={severityOf(c.cvss)}>{c.cvss.toFixed(1)}</Sev>
}

export function PriorityCell({ c }: { c: CveRecord }) {
  const b = priorityBucket(c)
  return (
    <span className="row gap4" title="Priority = CVSS impact + EPSS likelihood, raised to “Act now” for CISA KEV entries">
      <Sev s={b.cls}>{b.label}</Sev>
      <span className="muted small">{cvePriority(c)}</span>
    </span>
  )
}


/** Expandable CVE row body: loads full details on demand (NVD, then CIRCL). */
export function CveDetail({ c, hosts }: { c: CveRecord; hosts?: string[] }) {
  const [full, setFull] = useState<CveRecord>(c)
  const [busy, setBusy] = useState(() => !(c.summary && c.refs?.length))
  const [poc, setPoc] = useState<number | null | undefined>(undefined)
  const [series, setSeries] = useState<{ date: string; epss: number }[]>([])

  useEffect(() => {
    let live = true
    epssSeries(c.id)
      .then((x) => live && setSeries(x))
      .catch(() => {})
    // SSVC lives in the CVE 5 record; fetch it when the row has NVD data only.
    if (!c.ssvc && c.detail !== 'circl')
      circlCve(c.id)
        .then((x) => live && x?.ssvc && setFull((prev) => ({ ...prev, ssvc: x.ssvc })))
        .catch(() => {})
    return () => {
      live = false
    }
  }, [c])

  useEffect(() => {
    let live = true
    if (c.summary && c.refs?.length) return
    // CIRCL answers immediately; NVD sits behind the 6 s keyless queue.
    circlCve(c.id)
      .then((x) => x ?? nvdCve(c.id))
      .then((x) => live && x && setFull((prev) => ({ ...x, kev: prev.kev, epss: prev.epss, epssPct: prev.epssPct })))
      .catch(() => {})
      .finally(() => live && setBusy(false))
    return () => {
      live = false
    }
  }, [c])

  const refs = [...new Map((full.refs ?? []).map((r) => [r.url, r])).values()]
  const patch = refs.filter((r) => r.tags?.some((t) => /patch|vendor advisory|mitigation|release notes/i.test(t)))
  const exploit = refs.filter((r) => r.tags?.some((t) => /exploit/i.test(t)))
  return (
    <div className="cve-detail">
      {busy && (
        <div className="muted small row gap6">
          <Loader2 size={12} className="spin" /> Loading details…
        </div>
      )}
      {full.summary && <p className="cve-summary">{full.summary}</p>}
      <div className="cve-facts">
        <span>CVSS {full.cvss ?? '–'}{full.cvssVersion ? ` (v${full.cvssVersion})` : ''}</span>
        {full.vector && <code className="small">{full.vector}</code>}
        <span>EPSS {pct(full.epss)} · percentile {pct(full.epssPct)}</span>
        {full.cwe?.length ? <span>{full.cwe.join(', ')}</span> : null}
        {full.published && <span>Published {full.published}</span>}
      </div>
      <div className="row gap6 wrap">
        {full.ssvc?.exploitation && (
          <span className={'sev ' + (full.ssvc.exploitation === 'active' ? 'critical' : full.ssvc.exploitation === 'poc' ? 'high' : 'low')} title="CISA SSVC: exploitation status">
            exploitation: {full.ssvc.exploitation}
          </span>
        )}
        {full.ssvc?.automatable && (
          <span className={'sev ' + (full.ssvc.automatable === 'yes' ? 'high' : 'low')} title="CISA SSVC: can it be exploited at scale without user interaction?">
            automatable: {full.ssvc.automatable}
          </span>
        )}
        {full.ssvc?.impact && (
          <span className={'sev ' + (full.ssvc.impact === 'total' ? 'high' : 'low')} title="CISA SSVC: technical impact">
            impact: {full.ssvc.impact}
          </span>
        )}
        {full.nuclei && (
          <a className="sev info" href={`https://github.com/projectdiscovery/nuclei-templates/search?q=${c.id}`} target="_blank" rel="noreferrer noopener" title="A Nuclei detection template exists: the CVE can be verified safely on your own systems">
            nuclei check available
          </a>
        )}
      </div>
      {series.length > 1 && <Sparkline points={series} />}
      {full.kev && (
        <div className="callout danger">
          <b>CISA KEV</b> since {full.kev.added}
          {full.kev.ransomware ? ' · used by ransomware' : ''}
          {full.kev.due ? ` · federal due date ${full.kev.due}` : ''}
          {full.kev.action && <div className="small mt6">{full.kev.action}</div>}
        </div>
      )}
      {hosts && hosts.length > 0 && <div className="small text2">Hosts: {hosts.join(', ')}</div>}
      <div className="row gap6 wrap mt6">
        {cveLinks(c.id).map((l) => (
          <a key={l.label} className="chip" href={l.url} target="_blank" rel="noreferrer noopener">
            {l.label} <ExternalLink size={10} />
          </a>
        ))}
        {poc === undefined ? (
          <button className="chip" onClick={() => void githubPocCount(c.id).then(setPoc, () => setPoc(null))} title="Count public GitHub repositories that mention this CVE (exploit availability signal)">
            Public PoC count?
          </button>
        ) : (
          <a className={'chip' + (poc ? ' warn' : '')} href={`https://github.com/search?q=${c.id}&type=repositories`} target="_blank" rel="noreferrer noopener">
            {poc == null ? 'GitHub unavailable' : `${poc} public repos`} <ExternalLink size={10} />
          </a>
        )}
      </div>
      {(patch.length > 0 || exploit.length > 0) && (
        <div className="cve-refs">
          {patch.length > 0 && <RefList title="Fixes & advisories" refs={patch} />}
          {exploit.length > 0 && <RefList title="Exploit references (reported)" refs={exploit} />}
        </div>
      )}
    </div>
  )
}

function RefList({ title, refs }: { title: string; refs: { url: string }[] }) {
  return (
    <div>
      <div className="section-title">{title}</div>
      {refs.slice(0, 8).map((r) => (
        <a key={r.url} className="ref-link ellipsis" href={r.url} target="_blank" rel="noreferrer noopener">
          {r.url.replace(/^https?:\/\//, '')}
        </a>
      ))}
    </div>
  )
}

/** Table of CVEs with expandable detail rows. */
export function CveTable({ items, hostsOf, limit = 50 }: { items: CveRecord[]; hostsOf?: (id: string) => string[]; limit?: number }) {
  const [open, setOpen] = useState<string | null>(null)
  const [n, setN] = useState(limit)
  if (!items.length) return <div className="muted small">No CVEs.</div>
  return (
    <>
      <table className="ctbl">
        <thead>
          <tr>
            <th style={{ width: 22 }} />
            <th style={{ width: 150 }}>CVE</th>
            <th style={{ width: 110 }}>Priority</th>
            <th style={{ width: 60 }}>CVSS</th>
            <th style={{ width: 70 }}>EPSS</th>
            <th style={{ width: 54 }}>KEV</th>
            <th>Summary</th>
            {hostsOf && <th style={{ width: 70 }}>Hosts</th>}
          </tr>
        </thead>
        <tbody>
          {items.slice(0, n).map((c) => (
            <Fragment key={c.id}>
              <tr className={open === c.id ? 'open' : ''} onClick={() => setOpen(open === c.id ? null : c.id)}>
                <td>{open === c.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</td>
                <td className="mono">{c.id}</td>
                <td>
                  <PriorityCell c={c} />
                </td>
                <td>
                  <CvssCell c={c} />
                </td>
                <td className="mono small">{pct(c.epss)}</td>
                <td>{c.kev ? <Sev s="critical">KEV</Sev> : ''}</td>
                <td className="ellipsis text2 small">{c.summary ?? (c.detail === 'none' ? 'Open for details' : '')}</td>
                {hostsOf && <td className="small">{hostsOf(c.id).length}</td>}
              </tr>
              {open === c.id && (
                <tr className="detail-row">
                  <td colSpan={hostsOf ? 8 : 7}>
                    <CveDetail c={c} hosts={hostsOf?.(c.id)} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      {items.length > n && (
        <button className="mod-cta-ghost full-btn mt6" onClick={() => setN(n + 100)}>
          Show more ({items.length - n} left)
        </button>
      )}
    </>
  )
}

/** Markdown for AI answers: headings, lists, tables, fenced code, quotes. */
export function Md({ src }: { src: string }) {
  const lines = src.split('\n')
  const out: ReactNode[] = []
  const noop = () => {}
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('```')) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++])
      i++
      out.push(<pre key={out.length} className="md-code">{body.join('\n')}</pre>)
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      const row = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      const head = row(line)
      const body: string[][] = []
      i += 2
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(row(lines[i++]))
      out.push(
        <div key={out.length} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>{head.map((h, k) => <th key={k}>{inline(h, noop)}</th>)}</tr>
            </thead>
            <tbody>
              {body.map((r, k) => (
                <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c, noop)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }
    const li = line.match(/^(\s*)([-*]|\d+[.)])\s+(.*)/)
    if (li) {
      const ordered = /\d/.test(li[2])
      const items: ReactNode[] = []
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*]|\d+[.)])\s+(.*)/)
        if (!m) break
        const box = m[3].match(/^\[( |x)\]\s+(.*)/i)
        items.push(
          <li key={i} style={{ marginLeft: Math.min(3, Math.floor(m[1].length / 2)) * 14 }}>
            {box ? <input type="checkbox" defaultChecked={box[1] !== ' '} /> : null} {inline(box ? box[2] : m[3], noop)}
          </li>,
        )
        i++
      }
      out.push(ordered ? <ol key={out.length}>{items}</ol> : <ul key={out.length}>{items}</ul>)
      continue
    }
    const h = line.match(/^(#{1,4})\s+(.*)/)
    if (h) out.push(<div key={out.length} className={'md-h md-h' + h[1].length}>{inline(h[2], noop)}</div>)
    else if (line.startsWith('>')) out.push(<blockquote key={out.length}>{inline(line.replace(/^>\s?/, ''), noop)}</blockquote>)
    else if (/^-{3,}$/.test(line.trim())) out.push(<hr key={out.length} />)
    else if (line.trim()) out.push(<p key={out.length}>{inline(line, noop)}</p>)
    i++
  }
  return <div className="md">{out}</div>
}
