import { useMemo, useState } from 'react'
import { amt, day } from '../format'
import type { Transfer } from '../types'

interface Props {
  transfers: Transfer[]
  address: string
  asset: string
}

const DAY = 86400000

/** In/out volume histogram: inflow above the axis, outflow below. */
export function ActivityChart({ transfers, address, asset }: Props) {
  const [hover, setHover] = useState<number | null>(null)
  const data = useMemo(() => {
    const ts = transfers.filter((t) => t.asset === asset)
    if (!ts.length) return null
    const min = Math.min(...ts.map((t) => t.time))
    const max = Math.max(...ts.map((t) => t.time))
    const span = Math.max(max - min, DAY)
    const step = span <= 45 * DAY ? DAY : span <= 400 * DAY ? 7 * DAY : 30 * DAY
    const n = Math.min(Math.floor(span / step) + 1, 120)
    const bins = Array.from({ length: n }, (_, i) => ({ t: min + i * step, in: 0, out: 0, c: 0 }))
    for (const t of ts) {
      const b = bins[Math.min(Math.floor((t.time - min) / step), n - 1)]
      if (t.to === address) b.in += t.amount
      else b.out += t.amount
      b.c++
    }
    const peak = Math.max(...bins.map((b) => Math.max(b.in, b.out)), 1e-12)
    return { bins, peak, step }
  }, [transfers, address, asset])

  if (!data) return <div className="muted small">No {asset} transfers</div>
  const W = 300
  const H = 110
  const mid = H / 2
  const bw = W / data.bins.length
  const h = (v: number) => (v / data.peak) * (mid - 6)
  const hb = hover != null ? data.bins[hover] : null

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onMouseLeave={() => setHover(null)}>
        <line x1={0} x2={W} y1={mid} y2={mid} className="axis" />
        {data.bins.map((b, i) => (
          <g key={i} onMouseEnter={() => setHover(i)}>
            <rect x={i * bw} y={0} width={bw} height={H} className={hover === i ? 'hov' : 'nohov'} />
            {b.in > 0 && <rect x={i * bw + bw * 0.15} y={mid - h(b.in)} width={bw * 0.7} height={h(b.in)} rx={1} className="bar-in" />}
            {b.out > 0 && <rect x={i * bw + bw * 0.15} y={mid} width={bw * 0.7} height={h(b.out)} rx={1} className="bar-out" />}
          </g>
        ))}
      </svg>
      <div className="chart-foot">
        {hb ? (
          <span>
            {day(hb.t)} · <b className="pos">+{amt(hb.in)}</b> / <b className="neg">−{amt(hb.out)}</b> {asset} · {hb.c} tx
          </span>
        ) : (
          <span className="muted">
            {day(data.bins[0].t)} — {day(data.bins[data.bins.length - 1].t)} · per {data.step === DAY ? 'day' : data.step === 7 * DAY ? 'week' : 'month'}
          </span>
        )}
      </div>
    </div>
  )
}
