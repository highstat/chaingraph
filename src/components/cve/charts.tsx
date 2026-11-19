// Hand-drawn SVG charts for the CVE page. Thin marks, recessive axes, a
// tooltip on every mark, text in text colors (never the series color), and
// identity never carried by color alone (legends + labels).

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cvePriority, priorityBucket } from '../../cve/rules'
import type { CveRecord, HostResult, Severity } from '../../cve/types'
import { pct } from '../../cve/report'

interface Tip {
  x: number
  y: number
  body: ReactNode
}

function useTip() {
  const [tip, setTip] = useState<Tip | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const show = (e: React.MouseEvent, body: ReactNode) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, body })
  }
  const node = tip ? (
    <div className="viz-tip" style={{ left: tip.x, top: tip.y }}>
      {tip.body}
    </div>
  ) : null
  return { ref, show, hide: () => setTip(null), node }
}

// ---------------------------------------------------------------- Priority

const BUCKETS: { label: string; cls: Severity; color: string }[] = [
  { label: 'Act now', cls: 'critical', color: 'var(--viz-critical)' },
  { label: 'High', cls: 'high', color: 'var(--viz-serious)' },
  { label: 'Plan', cls: 'medium', color: 'var(--viz-warning)' },
  { label: 'Monitor', cls: 'low', color: 'var(--viz-neutral)' },
]

/** Part-to-whole: one segmented bar, legend with counts below. */
export function PriorityBar({ cves }: { cves: CveRecord[] }) {
  const { ref: tipRef, show, hide, node: tipNode } = useTip()
  const counts = BUCKETS.map((b) => cves.filter((c) => priorityBucket(c).label === b.label).length)
  const total = counts.reduce((a, b) => a + b, 0)
  if (!total) return <div className="muted small">No CVEs.</div>
  return (
    <div className="viz" ref={tipRef}>
      <div className="seg-bar">
        {BUCKETS.map((b, i) =>
          counts[i] ? (
            <div
              key={b.label}
              className="seg"
              style={{ flexGrow: counts[i], background: b.color }}
              onMouseMove={(e) =>
                show(
                  e,
                  <>
                    <b>{b.label}</b>: {counts[i]} CVEs ({Math.round((100 * counts[i]) / total)}%)
                  </>,
                )
              }
              onMouseLeave={hide}
            />
          ) : null,
        )}
      </div>
      <div className="viz-legend">
        {BUCKETS.map((b, i) => (
          <span key={b.label}>
            <i style={{ background: b.color }} />
            {b.label} <b>{counts[i]}</b>
          </span>
        ))}
      </div>
      {tipNode}
    </div>
  )
}

// ---------------------------------------------------------------- Risk matrix

/**
 * CVSS (impact) against EPSS percentile (likelihood). The top-right corner is
 * where to act first; KEV entries are drawn in the critical color with a ring.
 */
export function RiskScatter({ cves, hostsOf, onPick }: { cves: CveRecord[]; hostsOf?: (id: string) => string[]; onPick?: (id: string) => void }) {
  const { ref: tipRef, show, hide, node: tipNode } = useTip()
  const pts = cves.filter((c) => c.cvss != null && c.epssPct != null)
  const W = 520
  const H = 260
  const L = 34
  const B = 26
  const R = 8
  const T = 20
  const x = (v: number) => L + v * (W - L - R)
  const y = (v: number) => T + (1 - v / 10) * (H - T - B)
  if (pts.length < 3) return <div className="muted small">Not enough scored CVEs for a risk matrix ({pts.length} with both CVSS and EPSS).</div>
  // Draw KEV last so it sits on top.
  const order = [...pts].sort((a, b) => Number(!!a.kev) - Number(!!b.kev) || cvePriority(a) - cvePriority(b))
  return (
    <div className="viz" ref={tipRef}>
      <svg viewBox={`0 0 ${W} ${H}`} className="viz-svg" role="img" aria-label="Risk matrix of CVSS against EPSS percentile">
        <rect x={x(0.9)} y={y(10)} width={x(1) - x(0.9)} height={y(7) - y(10)} className="viz-zone" />
        <text x={x(1)} y={12} className="viz-zone-label" textAnchor="end">
          act first ↘
        </text>
        {[0, 2.5, 5, 7.5, 10].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="viz-grid" />
            <text x={L - 6} y={y(v) + 3} className="viz-tick" textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <text key={v} x={x(v)} y={H - 8} className="viz-tick" textAnchor="middle">
            {Math.round(v * 100)}
          </text>
        ))}
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="viz-axis" />
        {order.map((c) => (
          <circle
            key={c.id}
            cx={x(c.epssPct!)}
            cy={y(c.cvss!)}
            r={c.kev ? 5 : 4}
            className={'viz-dot' + (c.kev ? ' kev' : '')}
            onMouseMove={(e) =>
              show(
                e,
                <>
                  <b className="mono">{c.id}</b>
                  {c.kev && <span className="sev critical" style={{ marginLeft: 6 }}>KEV</span>}
                  <div>
                    CVSS {c.cvss} · EPSS {pct(c.epss)} (pct {Math.round((c.epssPct ?? 0) * 100)})
                  </div>
                  {hostsOf && <div className="muted">{hostsOf(c.id).length} host(s)</div>}
                  {c.summary && <div className="tip-sum">{c.summary.slice(0, 140)}…</div>}
                </>,
              )
            }
            onMouseLeave={hide}
            onClick={() => onPick?.(c.id)}
          />
        ))}
      </svg>
      <div className="viz-axes-labels">
        <span>↑ CVSS (impact)</span>
        <span>EPSS percentile (likelihood of exploitation) →</span>
      </div>
      <div className="viz-legend">
        <span>
          <i style={{ background: 'var(--viz-series)' }} />
          CVE
        </span>
        <span>
          <i style={{ background: 'var(--viz-critical)' }} />
          In CISA KEV (exploited)
        </span>
      </div>
      {tipNode}
    </div>
  )
}

// ---------------------------------------------------------------- Columns

/** CVEs by the year they were assigned: shows how old the exposed software is. */
export function YearColumns({ cves }: { cves: CveRecord[] }) {
  const { ref: tipRef, show, hide, node: tipNode } = useTip()
  const by = new Map<number, { n: number; kev: number }>()
  for (const c of cves) {
    const yr = Number(c.id.slice(4, 8))
    const e = by.get(yr) ?? { n: 0, kev: 0 }
    e.n++
    if (c.kev) e.kev++
    by.set(yr, e)
  }
  if (!by.size) return <div className="muted small">No CVEs.</div>
  const years = [...by.keys()].sort()
  const span: number[] = []
  for (let y = years[0]; y <= years[years.length - 1]; y++) span.push(y)
  const max = Math.max(...[...by.values()].map((v) => v.n))
  const W = 520
  const H = 180
  const L = 30
  const B = 22
  const T = 14
  const bw = (W - L) / span.length
  const barW = Math.min(24, bw - 2)
  const h = (v: number) => (v / max) * (H - B - T)
  const nice = max <= 5 ? max : Math.ceil(max / 5) * 5
  const peak = years.reduce((a, y) => (by.get(y)!.n > by.get(a)!.n ? y : a), years[0])
  return (
    <div className="viz" ref={tipRef}>
      <svg viewBox={`0 0 ${W} ${H}`} className="viz-svg" role="img" aria-label="CVEs by year">
        {[0, nice / 2, nice].map((v) => (
          <g key={v}>
            <line x1={L} x2={W} y1={H - B - (v / max) * (H - B - T)} y2={H - B - (v / max) * (H - B - T)} className="viz-grid" />
            <text x={L - 5} y={H - B - (v / max) * (H - B - T) + 3} className="viz-tick" textAnchor="end">
              {Math.round(v)}
            </text>
          </g>
        ))}
        {span.map((yr, i) => {
          const e = by.get(yr)
          const cx = L + i * bw + bw / 2
          return (
            <g key={yr} onMouseMove={(ev) => show(ev, <><b>{yr}</b>: {e?.n ?? 0} CVEs{e?.kev ? `, ${e.kev} in KEV` : ''}</>)} onMouseLeave={hide}>
              <rect x={L + i * bw} y={T} width={bw} height={H - B - T} fill="transparent" />
              {e && <path d={colPath(cx - barW / 2, H - B, barW, h(e.n))} className="viz-col" />}
              {(i % Math.ceil(span.length / 10) === 0 || i === span.length - 1) && (
                <text x={cx} y={H - 6} className="viz-tick" textAnchor="middle">
                  {span.length > 14 ? `’${String(yr).slice(2)}` : yr}
                </text>
              )}
              {yr === peak && e && (
                <text x={cx} y={H - B - h(e.n) - 4} className="viz-val" textAnchor="middle">
                  {e.n}
                </text>
              )}
            </g>
          )
        })}
        <line x1={L} x2={W} y1={H - B} y2={H - B} className="viz-axis" />
      </svg>
      {tipNode}
    </div>
  )
}

/** Column with a 4px rounded top, square at the baseline. */
function colPath(x: number, base: number, w: number, h: number) {
  const r = Math.min(4, h, w / 2)
  return `M${x},${base} V${base - h + r} Q${x},${base - h} ${x + r},${base - h} H${x + w - r} Q${x + w},${base - h} ${x + w},${base - h + r} V${base} Z`
}

// ---------------------------------------------------------------- Bars

export interface BarItem {
  key: string
  label: ReactNode
  value: number
  hint?: ReactNode
  /** Draw this bar in the critical color (with the reason in `hint`). */
  alert?: boolean
}

/** Ranked horizontal bars, value at the tip. */
export function HBars({ items, max: maxN = 10, unit = '' }: { items: BarItem[]; max?: number; unit?: string }) {
  const { ref: tipRef, show, hide, node: tipNode } = useTip()
  const shown = items.slice(0, maxN)
  const rest = items.slice(maxN).reduce((a, b) => a + b.value, 0)
  const peak = Math.max(...shown.map((i) => i.value), 1)
  if (!shown.length) return <div className="muted small">No data.</div>
  return (
    <div className="viz hbars" ref={tipRef}>
      {shown.map((i) => (
        <div key={i.key} className="hbar" onMouseMove={(e) => i.hint && show(e, i.hint)} onMouseLeave={hide}>
          <span className="hbar-label">{i.label}</span>
          <span className="hbar-track">
            <span className={'hbar-fill' + (i.alert ? ' alert' : '')} style={{ width: `${Math.max(2, (100 * i.value) / peak)}%` }} />
            <span className="hbar-val">
              {i.value}
              {unit}
            </span>
          </span>
        </div>
      ))}
      {rest > 0 && <div className="muted small">+{rest} more</div>}
      {tipNode}
    </div>
  )
}

// ---------------------------------------------------------------- Sparkline

export function Sparkline({ points, label }: { points: { date: string; epss: number }[]; label?: string }) {
  const { ref: tipRef, show, hide, node: tipNode } = useTip()
  if (points.length < 2) return null
  const W = 220
  const H = 44
  const max = Math.max(...points.map((p) => p.epss), 0.0001)
  const x = (i: number) => 3 + (i / (points.length - 1)) * (W - 8)
  const y = (v: number) => H - 4 - (v / max) * (H - 10)
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.epss).toFixed(1)}`).join(' ')
  const last = points[points.length - 1]
  const first = points[0]
  const delta = last.epss - first.epss
  return (
    <div className="viz spark" ref={tipRef}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="EPSS trend">
        <path d={`${d} L${x(points.length - 1)},${H - 4} L${x(0)},${H - 4} Z`} className="viz-area" />
        <path d={d} className="viz-line" />
        <circle cx={x(points.length - 1)} cy={y(last.epss)} r={4} className="viz-dot" />
        {points.map((p, i) => (
          <rect key={p.date} x={x(i) - W / points.length / 2} y={0} width={W / points.length} height={H} fill="transparent" onMouseMove={(e) => show(e, <>{p.date}: EPSS {pct(p.epss)}</>)} onMouseLeave={hide} />
        ))}
      </svg>
      <span className="small text2">
        {label ?? 'EPSS 30 days'}: {pct(first.epss)} → <b>{pct(last.epss)}</b>{' '}
        <span className={delta > 0.001 ? 'neg' : delta < -0.001 ? 'pos' : 'muted'}>{delta > 0.001 ? '▲ rising' : delta < -0.001 ? '▼ falling' : 'flat'}</span>
      </span>
      {tipNode}
    </div>
  )
}

// ---------------------------------------------------------------- Score gauge

export function ScoreRing({ score, grade }: { score: number; grade: string }) {
  const r = 34
  const c = 2 * Math.PI * r
  const color = score < 25 ? 'var(--viz-good)' : score < 45 ? 'var(--viz-warning)' : score < 65 ? 'var(--viz-serious)' : 'var(--viz-critical)'
  return (
    <svg viewBox="0 0 84 84" width={84} height={84} className="score-ring" role="img" aria-label={`Exposure score ${score} of 100, grade ${grade}`}>
      <circle cx={42} cy={42} r={r} className="ring-track" />
      <circle cx={42} cy={42} r={r} className="ring-val" style={{ stroke: color, strokeDasharray: `${(score / 100) * c} ${c}` }} transform="rotate(-90 42 42)" />
      <text x={42} y={42} textAnchor="middle" className="ring-grade">
        {grade}
      </text>
      <text x={42} y={58} textAnchor="middle" className="ring-score">
        {score}/100
      </text>
    </svg>
  )
}

// ---------------------------------------------------------------- Map

/** Server locations on a dark basemap; KEV hosts in the critical color. */
export function HostMap({ hosts, kevHosts }: { hosts: HostResult[]; kevHosts: Set<string> }) {
  const el = useRef<HTMLDivElement>(null)
  const pts = hosts.filter((h) => h.lat != null && h.lon != null)
  const key = pts.map((h) => h.ip).join(',')
  useEffect(() => {
    if (!el.current || !pts.length) return
    let map: import('leaflet').Map | null = null
    let dead = false
    void import('leaflet').then((L) => {
      if (dead || !el.current) return
      map = L.map(el.current, { zoomControl: true, attributionControl: true, worldCopyJump: true }).setView([30, 10], 2)
      const light = document.documentElement.dataset.theme === 'obsidian-light'
      L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${light ? 'Light' : 'Dark'}_Gray_Base/MapServer/tile/{z}/{y}/{x}`, { attribution: 'Tiles © Esri', maxNativeZoom: 16, maxZoom: 20 }).addTo(map)
      // Group hosts that share a location.
      const groups = new Map<string, HostResult[]>()
      for (const h of pts) {
        const k = `${h.lat!.toFixed(2)},${h.lon!.toFixed(2)}`
        groups.set(k, [...(groups.get(k) ?? []), h])
      }
      const bounds: [number, number][] = []
      for (const g of groups.values()) {
        const kev = g.some((h) => kevHosts.has(h.ip))
        const ll: [number, number] = [g[0].lat!, g[0].lon!]
        bounds.push(ll)
        L.circleMarker(ll, { radius: 6 + Math.min(10, Math.sqrt(g.length) * 3), color: '#000', weight: 2, fillColor: kev ? '#d03b3b' : '#3987e5', fillOpacity: 0.9 })
          .bindTooltip(`${[g[0].city, g[0].country].filter(Boolean).join(', ')} · ${g.length} host(s)<br>${g.slice(0, 6).map((h) => h.ip).join('<br>')}${kev ? '<br><b>KEV CVEs present</b>' : ''}`)
          .addTo(map)
      }
      if (bounds.length > 1) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 6 })
      else if (bounds.length === 1) map.setView(bounds[0], 5)
    })
    return () => {
      dead = true
      map?.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  if (!pts.length) return <div className="muted small">No geolocation data.</div>
  return <div ref={el} className="host-map" />
}
