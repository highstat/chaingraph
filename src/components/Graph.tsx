import ForceGraph from 'force-graph'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { LEVEL_COLOR, type RiskResult } from '../analysis'
import { CATEGORY_META, type Attribution } from '../entities'
import { amt, day, short } from '../format'
import type { Settings } from '../settings'
import { hexA } from '../themes'
import type { CaseEdge, CaseNode } from '../types'

export interface GNode {
  id: string
  ref: CaseNode
  degree: number
  color: string
  risk?: RiskResult
  attr?: Attribution
  cluster?: string
  flagged: boolean
  x?: number
  y?: number
  fx?: number
  fy?: number
}
export interface GLink {
  id: string
  source: string | GNode
  target: string | GNode
  ref: CaseEdge
  weight: number
  curvature: number
  __controlPoints?: number[]
}

export interface GraphHandle {
  fit: () => void
  focus: (id: string) => void
  png: () => string | null
  pos: (id: string) => { x: number; y: number } | null
  reheat: () => void
}

export interface Palette {
  bg: string
  text: string
  muted: string
  accent: string
  warn: string
}

type GraphSettings = Pick<
  Settings,
  | 'layout' | 'centerForce' | 'repelForce' | 'linkForce' | 'linkDistance' | 'nodeSize' | 'linkThickness'
  | 'arrows' | 'textFade' | 'particles' | 'edgeLabels' | 'riskHalo' | 'clusterRings'
>

interface Props {
  nodes: CaseNode[]
  edges: CaseEdge[]
  colors: Map<string, string>
  risk: Map<string, RiskResult>
  attr: Map<string, Attribution>
  clusterOf: Map<string, string>
  flagged: Set<string>
  highlight: Set<string> // traced / path edges
  spotlight: { nodes: Set<string>; edges: Set<string> } | null // evidence of a selected finding
  selected: string | null
  selectedEdge: string | null
  settings: GraphSettings
  palette: Palette
  onSelect: (id: string | null) => void
  onSelectEdge: (id: string) => void
  onExpand: (id: string) => void
  onShiftClick: (id: string) => void
  onMoved: (id: string, x: number, y: number) => void
  onContext: (id: string, x: number, y: number) => void
}

function displayName(n: CaseNode, a?: Attribution): string {
  return n.alias || n.info?.name || a?.label || n.info?.apiTags?.[0] || short(n.address)
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function hashHue(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h) % 360
}

export const Graph = forwardRef<GraphHandle, Props>(function Graph(props, ref) {
  const host = useRef<HTMLDivElement>(null)
  const fg = useRef<ForceGraph<GNode, GLink> | null>(null)
  const nodeMap = useRef(new Map<string, GNode>())
  const focus = useRef({ hover: null as string | null, neighbors: new Set<string>(), links: new Set<string>() })
  const pendingFit = useRef(false)
  const live = useRef(props)
  live.current = props

  const radius = (n: GNode) => Math.min(((n.ref.expanded ? 5 : 3) + Math.sqrt(n.degree) * 0.8) * live.current.settings.nodeSize, 16 * live.current.settings.nodeSize)

  useImperativeHandle(ref, () => ({
    fit: () => fg.current?.zoomToFit(500, 60),
    focus: (id) => {
      const n = nodeMap.current.get(id)
      if (n?.x != null && fg.current) {
        fg.current.centerAt(n.x, n.y, 600)
        fg.current.zoom(Math.max(fg.current.zoom(), 2.2), 600)
      }
    },
    png: () => host.current?.querySelector('canvas')?.toDataURL('image/png') ?? null,
    pos: (id) => {
      const n = nodeMap.current.get(id)
      return n?.x != null ? { x: n.x, y: n.y! } : null
    },
    reheat: () => fg.current?.d3ReheatSimulation(),
  }))

  const recompute = () => {
    const g = fg.current
    if (!g) return
    const s = focus.current
    const center = s.hover ?? live.current.selected
    s.neighbors = new Set()
    s.links = new Set()
    if (center) {
      for (const l of g.graphData().links) {
        const a = typeof l.source === 'object' ? l.source.id : l.source
        const b = typeof l.target === 'object' ? l.target.id : l.target
        if (a === center || b === center) {
          s.links.add(l.id)
          s.neighbors.add(a)
          s.neighbors.add(b)
        }
      }
    }
    g.linkDirectionalParticles(g.linkDirectionalParticles())
  }

  // Create the renderer once.
  useEffect(() => {
    const el = host.current!
    const g = new ForceGraph<GNode, GLink>(el)
      .autoPauseRedraw(false)
      .nodeId('id')
      .cooldownTicks(150)
      .d3VelocityDecay(0.3)
      .minZoom(0.05)
      .onDagError(() => {}) // cycles are normal in money flows; let the layout cope
      .linkCurvature((l) => l.curvature)
      .linkDirectionalArrowRelPos(0.94)
      .linkLineDash((l) => (l.ref.virtual ? [5, 4] : l.ref.change ? [3, 3] : null))
      .linkWidth((l) => {
        const sp = live.current.spotlight
        if (sp) return ((sp.edges.has(l.id) ? 1.6 : 0.2) + l.weight * 2.5) * live.current.settings.linkThickness
        if (l.ref.virtual) return 1.4 * live.current.settings.linkThickness
        const hl = focus.current.links.has(l.id) || live.current.highlight.has(l.id) || live.current.selectedEdge === l.id
        return ((hl ? 1.2 : 0.35) + l.weight * 3) * live.current.settings.linkThickness
      })
      .linkColor((l) => {
        const p = live.current.palette
        const sp = live.current.spotlight
        if (sp) return sp.edges.has(l.id) ? p.warn : hexA(p.muted, 0.08)
        if (l.ref.virtual) return l.ref.linkKind === 'same-owner' ? hexA(p.accent, 0.9) : '#f472b6'
        if (live.current.selectedEdge === l.id) return p.text
        if (live.current.highlight.has(l.id)) return p.warn
        if (focus.current.links.has(l.id)) return p.accent
        if (focus.current.hover || live.current.selected) return hexA(p.muted, 0.12)
        return hexA(p.muted, 0.45)
      })
      .linkDirectionalArrowLength((l) => (live.current.settings.arrows && l.ref.linkKind !== 'same-owner' ? 3.5 : 0))
      .linkDirectionalArrowColor((l) =>
        live.current.highlight.has(l.id) ? live.current.palette.warn : focus.current.links.has(l.id) ? live.current.palette.accent : hexA(live.current.palette.muted, 0.6),
      )
      .linkDirectionalParticles((l) =>
        !l.ref.virtual && live.current.settings.particles && (focus.current.links.has(l.id) || live.current.highlight.has(l.id) || live.current.spotlight?.edges.has(l.id))
          ? 2 + Math.round(l.weight * 3)
          : 0,
      )
      .linkDirectionalParticleWidth(2.2)
      .linkDirectionalParticleSpeed(0.006)
      .linkDirectionalParticleColor((l) => (live.current.highlight.has(l.id) ? live.current.palette.warn : live.current.palette.accent))
      .linkCanvasObjectMode(() => 'after')
      .linkCanvasObject((l, ctx, scale) => {
        const mode = l.ref.virtual ? 'link' : live.current.settings.edgeLabels
        if (mode === 'none') return
        const hl = focus.current.links.has(l.id) || live.current.highlight.has(l.id) || !!live.current.spotlight?.edges.has(l.id) || !!l.ref.virtual
        // Unhighlighted labels only when zoomed in, and only for significant flows.
        if (!hl && (scale < 2.6 || l.weight < 0.35)) return
        const s = l.source as GNode
        const t = l.target as GNode
        if (s.x == null || t.x == null) return
        let x = (s.x + t.x) / 2
        let y = (s.y! + t.y!) / 2
        if (l.__controlPoints) {
          x = 0.25 * s.x + 0.5 * l.__controlPoints[0] + 0.25 * t.x
          y = 0.25 * s.y! + 0.5 * l.__controlPoints[1] + 0.25 * t.y!
        }
        const e = l.ref
        const text =
          mode === 'link'
            ? e.linkKind === 'same-owner' ? 'same owner' : e.linkKind === 'demix' ? 'probable demix' : e.linkKind === 'chain-hop' ? 'chain hop' : 'link'
            : mode === 'full' ? `#${e.order} · ${amt(e.amount)} ${e.asset} · ${day(e.first)}` : `${amt(e.amount)} ${e.asset}`
        if (mode === 'link' && scale < 1.2) return
        const fs = Math.max(9 / scale, 1.8)
        ctx.font = `500 ${fs}px Inter, system-ui, sans-serif`
        const w = ctx.measureText(text).width
        ctx.fillStyle = hexA(live.current.palette.bg, 0.85)
        ctx.fillRect(x - w / 2 - fs * 0.3, y - fs * 0.65, w + fs * 0.6, fs * 1.3)
        ctx.fillStyle = hl ? live.current.palette.text : live.current.palette.muted
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(text, x, y)
      })
      .nodeLabel((n) => {
        const r = n.risk
        const a = n.attr
        return `<div class="tip"><b>${esc(displayName(n.ref, a))}</b><code>${esc(n.ref.address)}</code>${
          a && a.category !== 'unknown' ? `<span style="color:${CATEGORY_META[a.category].color}">● ${CATEGORY_META[a.category].label}</span>` : ''
        }${r ? `<span>Risk <b style="color:${LEVEL_COLOR[r.level]}">${r.score}</b></span>` : ''}${
          n.ref.info?.balance != null ? `<span>${amt(n.ref.info.balance)} ${n.ref.info.balanceAsset}</span>` : ''
        }</div>`
      })
      .nodeCanvasObject((node, ctx, scale) => {
        const n = node.ref
        const L = live.current
        const st = L.settings
        const f = focus.current
        const sel = L.selected === node.id
        const active = f.hover === node.id || sel
        const dim = L.spotlight ? !L.spotlight.nodes.has(node.id) : (f.hover || L.selected) && !f.neighbors.has(node.id) && !active
        const r = radius(node)
        const x = node.x!
        const y = node.y!
        // Positions can be NaN on the very first tick (e.g. DAG layouts); skip until settled.
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(r)) return
        ctx.globalAlpha = dim ? 0.16 : 1

        if (st.riskHalo && node.risk && node.risk.score >= 25) {
          const grd = ctx.createRadialGradient(x, y, r, x, y, r + 7)
          grd.addColorStop(0, hexA(LEVEL_COLOR[node.risk.level], 0.55))
          grd.addColorStop(1, hexA(LEVEL_COLOR[node.risk.level], 0))
          ctx.fillStyle = grd
          ctx.beginPath()
          ctx.arc(x, y, r + 7, 0, 2 * Math.PI)
          ctx.fill()
        }
        if (active) {
          ctx.beginPath()
          ctx.arc(x, y, r + 4, 0, 2 * Math.PI)
          ctx.fillStyle = hexA(L.palette.accent, 0.22)
          ctx.fill()
        }
        ctx.beginPath()
        ctx.arc(x, y, r, 0, 2 * Math.PI)
        ctx.fillStyle = n.expanded ? node.color : L.palette.bg
        ctx.fill()
        ctx.lineWidth = n.expanded ? 1 / scale : 1.5
        ctx.strokeStyle = n.expanded ? hexA(L.palette.text, 0.3) : node.color
        ctx.stroke()
        if (sel) {
          ctx.lineWidth = 2 / scale
          ctx.strokeStyle = L.palette.text
          ctx.stroke()
        }
        if (st.clusterRings && node.cluster) {
          ctx.beginPath()
          ctx.arc(x, y, r + 2.2, 0, 2 * Math.PI)
          ctx.lineWidth = 1.4
          ctx.strokeStyle = `hsl(${hashHue(node.cluster)} 80% 62%)`
          ctx.stroke()
        }
        if (node.flagged) {
          ctx.beginPath()
          ctx.arc(x, y, r + 3.5, 0, 2 * Math.PI)
          ctx.setLineDash([2, 2])
          ctx.lineWidth = 1.2
          ctx.strokeStyle = L.palette.warn
          ctx.stroke()
          ctx.setLineDash([])
        }
        if (n.starred || n.watch) {
          ctx.font = `${Math.max(8 / scale, 3)}px system-ui`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'bottom'
          ctx.fillStyle = L.palette.warn
          ctx.fillText(`${n.starred ? '★' : ''}${n.watch ? '◉' : ''}`, x, y - r - 1)
        }

        // Obsidian-style text fade: labels fade in past a zoom threshold.
        const named = !!(n.alias || n.tags.length || n.info?.name || node.attr?.label || n.info?.apiTags?.length)
        const thr = 1.5 * Math.pow(1.7, st.textFade)
        const need = active || n.alias || n.tags.length ? 0 : named || n.expanded ? thr * 0.55 : thr * 1.6
        const alpha = need === 0 ? 1 : Math.max(0, Math.min(1, (scale - need) / (need * 0.4)))
        if (alpha > 0.02 && (scale > 0.5 || active)) {
          const fs = Math.max(11 / scale, 2)
          ctx.globalAlpha = (dim ? 0.16 : 1) * alpha
          ctx.font = `${active ? 600 : 400} ${fs}px Inter, system-ui, sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'
          ctx.fillStyle = active ? L.palette.text : hexA(L.palette.text, 0.82)
          ctx.fillText(displayName(n, node.attr), x, y + r + 2)
        }
        ctx.globalAlpha = 1
      })
      .nodePointerAreaPaint((node, color, ctx) => {
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(node.x!, node.y!, radius(node) + 3, 0, 2 * Math.PI)
        ctx.fill()
      })
      .onNodeHover((node) => {
        focus.current.hover = node?.id ?? null
        recompute()
        el.style.cursor = node ? 'pointer' : 'default'
      })
      .onNodeClick((node, ev) => {
        if (ev.shiftKey) return live.current.onShiftClick(node.id)
        if (ev.detail === 2) live.current.onExpand(node.id)
        live.current.onSelect(node.id)
      })
      .onNodeRightClick((node, ev) => {
        ev.preventDefault()
        live.current.onContext(node.id, ev.clientX, ev.clientY)
      })
      .onLinkClick((l) => live.current.onSelectEdge(l.id))
      .onBackgroundClick(() => live.current.onSelect(null))
      .onNodeDragEnd((node) => {
        node.fx = node.x
        node.fy = node.y
        live.current.onMoved(node.id, node.x!, node.y!)
      })
      .onEngineStop(() => {
        if (pendingFit.current) {
          pendingFit.current = false
          g.zoomToFit(600, 60)
        }
      })

    fg.current = g
    const ro = new ResizeObserver(() => g.width(el.clientWidth).height(el.clientHeight))
    ro.observe(el)
    return () => {
      ro.disconnect()
      ;(g as any)._destructor?.()
      el.innerHTML = ''
    }
  }, [])

  // Forces & layout (Obsidian "Forces" panel).
  useEffect(() => {
    const g = fg.current
    if (!g) return
    const st = props.settings
    ;(g.d3Force('charge') as any)?.strength(-st.repelForce * 12).distanceMax(500)
    ;(g.d3Force('link') as any)?.distance(st.linkDistance).strength(st.linkForce)
    let simNodes: GNode[] = []
    const k = st.centerForce * 0.12
    const gravity = Object.assign(
      (alpha: number) => {
        for (const n of simNodes) {
          ;(n as any).vx -= (n.x ?? 0) * k * alpha
          ;(n as any).vy -= (n.y ?? 0) * k * alpha
        }
      },
      { initialize: (ns: GNode[]) => void (simNodes = ns) },
    )
    g.d3Force('gravity', gravity as any)
    const mode = st.layout === 'force' ? null : st.layout === 'radial' ? 'radialout' : st.layout
    if (g.dagMode() !== mode) {
      g.dagMode(mode as any).dagLevelDistance(st.linkDistance * 1.6)
      pendingFit.current = true
    }
    g.d3ReheatSimulation()
  }, [props.settings.layout, props.settings.centerForce, props.settings.repelForce, props.settings.linkForce, props.settings.linkDistance])

  useEffect(() => {
    fg.current?.backgroundColor(props.palette.bg)
  }, [props.palette.bg])

  // Sync data while preserving node object identity (keeps layout stable).
  useEffect(() => {
    const g = fg.current
    if (!g) return
    const map = nodeMap.current
    const degree = new Map<string, number>()
    for (const e of props.edges) degree.set(e.source, (degree.get(e.source) ?? 0) + 1).set(e.target, (degree.get(e.target) ?? 0) + 1)
    const nodes: GNode[] = props.nodes.map((n) => {
      let gn = map.get(n.id)
      if (!gn) {
        gn = { id: n.id, ref: n, degree: 0, color: '', flagged: false }
        const e = props.edges.find((e) => e.source === n.id || e.target === n.id)
        const other = e && map.get(e.source === n.id ? e.target : e.source)
        if (other?.x != null) {
          gn.x = other.x + (Math.random() - 0.5) * 30
          gn.y = other.y! + (Math.random() - 0.5) * 30
        }
        map.set(n.id, gn)
      }
      if (n.pinned && gn.fx == null) {
        gn.fx = gn.x = n.pinned.x
        gn.fy = gn.y = n.pinned.y
      } else if (!n.pinned && gn.fx != null) {
        gn.fx = undefined
        gn.fy = undefined
      }
      gn.ref = n
      gn.degree = degree.get(n.id) ?? 0
      gn.color = props.colors.get(n.id) ?? '#888'
      gn.risk = props.risk.get(n.id)
      gn.attr = props.attr.get(n.id)
      gn.cluster = props.clusterOf.get(n.id)
      gn.flagged = props.flagged.has(n.id)
      return gn
    })
    const keep = new Set(props.nodes.map((n) => n.id))
    for (const k of map.keys()) if (!keep.has(k)) map.delete(k)

    const maxUsd = Math.max(0, ...props.edges.map((e) => e.usd ?? 0))
    const maxByAsset = new Map<string, number>()
    for (const e of props.edges) maxByAsset.set(e.asset, Math.max(maxByAsset.get(e.asset) ?? 0, e.amount))
    const pairs = new Set(props.edges.map((e) => `${e.source}>${e.target}`))
    const links: GLink[] = props.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      ref: e,
      weight: e.virtual
        ? 0.25
        : e.usd != null && maxUsd > 0
          ? Math.log1p(e.usd) / Math.log1p(maxUsd)
          : Math.log1p(e.amount) / Math.log1p(maxByAsset.get(e.asset) || 1),
      curvature: e.virtual ? 0.35 : pairs.has(`${e.target}>${e.source}`) ? 0.25 : 0,
    }))

    const prev = g.graphData()
    const structural =
      prev.nodes.length !== nodes.length ||
      prev.links.length !== links.length ||
      prev.links.some((l, i) => l.id !== links[i]?.id)
    if (structural) {
      if (prev.nodes.length === 0 || nodes.length > prev.nodes.length * 1.3) pendingFit.current = true
      g.graphData({ nodes, links })
    } else {
      // Same structure: refresh edge payloads (amounts change with time filters).
      const byId = new Map(links.map((l) => [l.id, l]))
      for (const l of prev.links) {
        const nl = byId.get(l.id)!
        l.ref = nl.ref
        l.weight = nl.weight
      }
    }
    recompute()
  }, [props.nodes, props.edges, props.colors, props.risk, props.attr, props.clusterOf, props.flagged])

  useEffect(() => {
    recompute()
  }, [props.selected, props.settings.particles, props.highlight, props.selectedEdge, props.spotlight])

  return <div ref={host} className="graph-host" onContextMenu={(e) => e.preventDefault()} />
})
