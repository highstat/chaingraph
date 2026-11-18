import { Pause, Play, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useD } from '../derived'
import { day } from '../format'
import { isSpamAsset } from '../model'
import { useUI } from '../store'

const BINS = 120

/** Time histogram with a range brush (filters the graph) and playback. */
export function Timeline() {
  const d = useD()
  const ui = useUI()
  const svg = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null)
  const [playing, setPlaying] = useState(false)

  const data = useMemo(() => {
    const ts = d.transfers.filter((t) => !isSpamAsset(t.asset))
    if (!ts.length) return null
    let min = Infinity
    let max = -Infinity
    for (const t of ts) (min = Math.min(min, t.time)), (max = Math.max(max, t.time))
    if (max === min) max = min + 86400000
    const bins = new Array(BINS).fill(0)
    for (const t of ts) bins[Math.min(BINS - 1, Math.floor(((t.time - min) / (max - min)) * BINS))]++
    return { min, max, bins, peak: Math.max(...bins) }
  }, [d.transfers])

  // Playback: grow the window's end from start to finish (Obsidian "Animate").
  useEffect(() => {
    if (!playing || !data) return
    const span = data.max - data.min
    let end = ui.timeRange ? ui.timeRange[1] : data.min + span * 0.02
    if (end >= data.max) end = data.min + span * 0.02
    const timer = setInterval(() => {
      end += span / 150
      if (end >= data.max) {
        end = data.max
        setPlaying(false)
      }
      useUI.setState({ timeRange: [data.min, end] })
    }, 60)
    return () => clearInterval(timer)
  }, [playing, data])

  if (!data) return <div className="timeline empty-tl">Load some addresses to see the timeline.</div>

  const W = 1000
  const H = 64
  const toX = (t: number) => ((t - data.min) / (data.max - data.min)) * W
  const fromX = (clientX: number) => {
    const r = svg.current!.getBoundingClientRect()
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width))
    return data.min + f * (data.max - data.min)
  }
  const range = drag ? [Math.min(drag.a, drag.b), Math.max(drag.a, drag.b)] : ui.timeRange

  return (
    <div className="timeline">
      <div className="tl-head">
        <button className="clickable-icon" title={playing ? 'Pause' : 'Play: reveal flows over time'} onClick={() => setPlaying(!playing)}>
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <span className="tl-label">
          {range ? `${day(range[0])} → ${day(range[1])}` : `${day(data.min)} → ${day(data.max)}`}
        </span>
        <span className="muted small">Drag to filter by time</span>
        <span className="grow" />
        {ui.timeRange && (
          <button className="mod-ghost sm" onClick={() => (setPlaying(false), ui.set({ timeRange: null }))}>
            Reset range
          </button>
        )}
        <button className="clickable-icon" title="Close timeline" onClick={() => ui.set({ timelineOpen: false })}>
          <X size={14} />
        </button>
      </div>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="tl-svg"
        onMouseDown={(e) => {
          const t = fromX(e.clientX)
          setDrag({ a: t, b: t })
          setPlaying(false)
        }}
        onMouseMove={(e) => drag && setDrag({ ...drag, b: fromX(e.clientX) })}
        onMouseUp={() => {
          if (drag) {
            const [a, b] = [Math.min(drag.a, drag.b), Math.max(drag.a, drag.b)]
            ui.set({ timeRange: b - a > (data.max - data.min) / 400 ? [a, b] : null })
          }
          setDrag(null)
        }}
        onMouseLeave={() => setDrag(null)}
      >
        {data.bins.map((v, i) =>
          v ? (
            <rect
              key={i}
              x={(i / BINS) * W + 0.5}
              width={W / BINS - 1}
              y={H - 4 - (v / data.peak) * (H - 10)}
              height={(v / data.peak) * (H - 10)}
              className={range && (data.min + ((i + 0.5) / BINS) * (data.max - data.min) < range[0] || data.min + ((i + 0.5) / BINS) * (data.max - data.min) > range[1]) ? 'tl-bar off' : 'tl-bar'}
            />
          ) : null,
        )}
        {range && <rect x={toX(range[0])} width={Math.max(1, toX(range[1]) - toX(range[0]))} y={0} height={H} className="tl-brush" />}
      </svg>
    </div>
  )
}
