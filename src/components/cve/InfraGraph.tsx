// Infrastructure graph: domains → IPs → ASNs, with software and the most
// important CVEs hanging off each host.

import ForceGraph from 'force-graph'
import { useEffect, useMemo, useRef, useState } from 'react'
import { cpeLabel, cvePriority, isCdn, priorityBucket } from '../../cve/rules'
import { hostsFor, rankedCves } from '../../cve/report'
import { useCve } from '../../cve/state'
import type { ScanResult } from '../../cve/types'
import { useSettings } from '../../settings'
import { themeById } from '../../themes'
import { Empty } from '../osint/kit'
import { CveDetail } from './shared'

type Kind = 'domain' | 'sub' | 'ip' | 'asn' | 'tech' | 'cve'
interface N {
  id: string
  kind: Kind
  label: string
  weight: number
  color?: string
  x?: number
  y?: number
}
interface L {
  source: string | N
  target: string | N
}

const KIND_COLOR: Record<Kind, string> = { domain: '#38bdf8', sub: '#7dd3fc', ip: '#a78bfa', asn: '#94a3b8', tech: '#4ade80', cve: '#f87171' }
const SEV_COLOR = { critical: '#ef4444', high: '#f97316', medium: '#facc15', low: '#94a3b8', info: '#64748b' }

function build(r: ScanResult, opts: { cves: boolean; tech: boolean }): { nodes: N[]; links: L[] } {
  const nodes = new Map<string, N>()
  const links: L[] = []
  const add = (n: N) => (nodes.has(n.id) ? nodes.get(n.id)! : (nodes.set(n.id, n), n))
  const link = (a: string, b: string) => links.push({ source: a, target: b })
  if (r.kind === 'domain') add({ id: `d:${r.target}`, kind: 'domain', label: r.target, weight: 6 })
  for (const d of r.domains) {
    if (!d.ips.length) continue
    if (d.name !== r.target) {
      add({ id: `d:${d.name}`, kind: 'sub', label: d.name, weight: 2 })
      link(`d:${r.target}`, `d:${d.name}`)
    }
  }
  const top = new Set(rankedCves(r).slice(0, 40).map((c) => c.id))
  for (const h of r.hosts) {
    const kev = h.vulns.some((id) => r.cves[id]?.kev)
    add({ id: `ip:${h.ip}`, kind: 'ip', label: h.ip, weight: 3 + Math.min(6, h.vulns.length / 10), color: kev ? SEV_COLOR.critical : isCdn(h) ? '#64748b' : undefined })
    for (const v of h.via) link(`d:${v}`, `ip:${h.ip}`)
    if (h.asn) {
      add({ id: `as:${h.asn}`, kind: 'asn', label: `AS${h.asn} ${h.holder ?? ''}`.trim(), weight: 4 })
      link(`ip:${h.ip}`, `as:${h.asn}`)
    }
    if (opts.tech)
      for (const c of h.cpes) {
        add({ id: `t:${c}`, kind: 'tech', label: cpeLabel(c), weight: 2 })
        link(`ip:${h.ip}`, `t:${c}`)
      }
    if (opts.cves)
      for (const id of h.vulns) {
        if (!top.has(id)) continue
        const c = r.cves[id]
        add({ id: `c:${id}`, kind: 'cve', label: id, weight: 1.5 + cvePriority(c) / 30, color: SEV_COLOR[priorityBucket(c).cls] })
        // Attach CVEs to the software they come from when we know it.
        const via = h.cpes.find((cp) => r.cpe[cp]?.cves.includes(id))
        link(via && opts.tech ? `t:${via}` : `ip:${h.ip}`, `c:${id}`)
      }
  }
  return { nodes: [...nodes.values()], links: links.filter((l) => nodes.has(l.source as string) && nodes.has(l.target as string)) }
}

export function InfraGraph() {
  const r = useCve((s) => s.result)
  const el = useRef<HTMLDivElement>(null)
  const fg = useRef<ForceGraph<N, L> | null>(null)
  const [sel, setSel] = useState<N | null>(null)
  const [showCves, setShowCves] = useState(true)
  const [showTech, setShowTech] = useState(true)
  const settings = useSettings()
  const theme = themeById(settings.theme)
  const data = useMemo(() => (r ? build(r, { cves: showCves, tech: showTech }) : null), [r, showCves, showTech])

  useEffect(() => {
    if (!el.current || !data) return
    const g = new ForceGraph<N, L>(el.current)
      .backgroundColor(theme.vars.bg)
      .nodeId('id')
      .nodeVal((n) => n.weight)
      .nodeLabel((n) => n.label)
      .linkColor(() => 'rgba(148,163,184,0.25)')
      .linkDirectionalParticles(0)
      .nodeCanvasObject((n, ctx, scale) => {
        const r0 = Math.sqrt(n.weight) * 3.2
        ctx.beginPath()
        ctx.arc(n.x!, n.y!, r0, 0, 2 * Math.PI)
        ctx.fillStyle = n.color ?? KIND_COLOR[n.kind]
        ctx.fill()
        if (scale > 1.4 || n.kind === 'domain' || n.kind === 'asn') {
          ctx.font = `${Math.max(3, 11 / scale)}px ${getComputedStyle(document.body).fontFamily}`
          ctx.fillStyle = theme.vars.text
          ctx.textAlign = 'center'
          ctx.fillText(n.label.length > 32 ? n.label.slice(0, 30) + '…' : n.label, n.x!, n.y! + r0 + 10 / scale)
        }
      })
      .nodePointerAreaPaint((n, color, ctx) => {
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(n.x!, n.y!, Math.sqrt(n.weight) * 3.2 + 2, 0, 2 * Math.PI)
        ctx.fill()
      })
      .onNodeClick((n) => setSel(n))
      .graphData(data)
    g.d3Force('charge')?.strength(-60)
    fg.current = g
    const ro = new ResizeObserver(() => el.current && g.width(el.current.clientWidth).height(el.current.clientHeight))
    ro.observe(el.current)
    setTimeout(() => g.zoomToFit(400, 40), 900)
    return () => {
      ro.disconnect()
      g._destructor()
      fg.current = null
    }
  }, [data, theme])

  if (!r) return <Empty>Run a scan first: the graph shows how domains, IPs, networks, software and CVEs connect.</Empty>
  const cve = sel?.kind === 'cve' ? r.cves[sel.id.slice(2)] : null
  const host = sel?.kind === 'ip' ? r.hosts.find((h) => h.ip === sel.label) : null
  return (
    <div className="infra">
      <div className="infra-bar">
        <span className="mono">{r.target}</span>
        <span className="muted small">
          {data?.nodes.length} nodes · {data?.links.length} links
        </span>
        <span className="grow" />
        <label className="row gap4 small">
          <input type="checkbox" checked={showTech} onChange={(e) => setShowTech(e.target.checked)} /> software
        </label>
        <label className="row gap4 small">
          <input type="checkbox" checked={showCves} onChange={(e) => setShowCves(e.target.checked)} /> top 40 CVEs
        </label>
        <button className="mod-ghost sm" onClick={() => fg.current?.zoomToFit(400, 40)}>
          Fit
        </button>
      </div>
      <div className="infra-legend">
        {(Object.keys(KIND_COLOR) as Kind[]).map((k) => (
          <span key={k}>
            <i style={{ background: KIND_COLOR[k] }} /> {{ domain: 'domain', sub: 'subdomain', ip: 'IP', asn: 'network (ASN)', tech: 'software', cve: 'CVE' }[k]}
          </span>
        ))}
        <span>
          <i style={{ background: SEV_COLOR.critical }} /> host with KEV CVE
        </span>
      </div>
      <div ref={el} className="infra-canvas" />
      {sel && (
        <div className="infra-side">
          <div className="row">
            <b className="ellipsis grow">{sel.label}</b>
            <button className="chip" onClick={() => setSel(null)}>
              ✕
            </button>
          </div>
          {cve && <CveDetail c={cve} hosts={hostsFor(r, cve.id)} />}
          {host && (
            <div className="small">
              <div>
                {host.holder} {host.asn && `(AS${host.asn})`}
              </div>
              <div className="muted">{[host.city, host.country].filter(Boolean).join(', ')}</div>
              <div className="mt6">Ports: {host.ports.join(', ') || 'none'}</div>
              <div>Software: {host.cpes.map(cpeLabel).join(', ') || '?'}</div>
              <div>CVEs: {host.vulns.length}</div>
              {host.via.length > 0 && <div>Domains: {host.via.join(', ')}</div>}
            </div>
          )}
          {!cve && !host && <div className="muted small">{sel.kind}</div>}
        </div>
      )}
    </div>
  )
}
