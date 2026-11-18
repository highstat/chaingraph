import { Plus, RotateCcw, Settings2, X } from 'lucide-react'
import { useD } from '../derived'
import { useSettings, type Layout } from '../settings'
import { useUI } from '../store'
import { Row, Section, Slider, Switch } from './ui'

const LAYOUTS: [Layout, string][] = [
  ['force', 'Force'],
  ['lr', 'Flow →'],
  ['td', 'Flow ↓'],
  ['radial', 'Radial'],
]

/** Floating panel replicating Obsidian's graph-view settings (Filters, Groups, Display, Forces). */
export function GraphControls() {
  const s = useSettings()
  const ui = useUI()
  const d = useD()
  if (!ui.graphControlsOpen)
    return (
      <button className="graph-controls-btn clickable-icon" title="Graph settings" onClick={() => ui.set({ graphControlsOpen: true })}>
        <Settings2 size={16} />
      </button>
    )

  return (
    <div className="graph-controls">
      <div className="graph-controls-top">
        <button className="clickable-icon" title="Restore defaults" onClick={() => s.reset(['centerForce', 'repelForce', 'linkForce', 'linkDistance', 'nodeSize', 'linkThickness', 'textFade', 'arrows', 'layout'])}>
          <RotateCcw size={14} />
        </button>
        <button className="clickable-icon" title="Close" onClick={() => ui.set({ graphControlsOpen: false })}>
          <X size={14} />
        </button>
      </div>

      <Section title="Filters">
        <select className="dropdown full" value={ui.assetFilter} onChange={(e) => ui.set({ assetFilter: e.target.value })}>
          <option value="all">All assets</option>
          {d.assets.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <Row label="Min amount">
          <input className="num" type="number" min={0} value={s.minAmount || ''} placeholder="0" onChange={(e) => s.set({ minAmount: Number(e.target.value) || 0 })} />
        </Row>
        <Row label="Min USD">
          <input className="num" type="number" min={0} value={s.minUsd || ''} placeholder="0" onChange={(e) => s.set({ minUsd: Number(e.target.value) || 0 })} />
        </Row>
        <Row label="Hide spam tokens">
          <Switch on={s.hideSpam} onChange={(v) => s.set({ hideSpam: v })} />
        </Row>
        <Row label="Hide change outputs">
          <Switch on={s.hideChange} onChange={(v) => s.set({ hideChange: v })} />
        </Row>
        <Row label="Hide leaves">
          <Switch on={s.hideOrphans} onChange={(v) => s.set({ hideOrphans: v })} title="Hide counterparties with a single link" />
        </Row>
        <Row label="Show hidden">
          <Switch on={ui.showHidden} onChange={(v) => ui.set({ showHidden: v })} />
        </Row>
        <Row label="Local graph">
          <Switch on={ui.localGraph} onChange={(v) => ui.set({ localGraph: v })} />
        </Row>
        {ui.localGraph && (
          <Row label="Depth">
            <Slider value={ui.localDepth} min={1} max={4} step={1} onChange={(v) => ui.set({ localDepth: v })} />
          </Row>
        )}
      </Section>

      <Section title="Groups" defaultOpen={false}>
        {s.groups.map((g, i) => (
          <div key={i} className="group-row">
            <input
              type="color"
              value={g.color}
              onChange={(e) => s.set({ groups: s.groups.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) })}
            />
            <input
              className="text"
              value={g.query}
              placeholder="tag:suspect  cat:mixer  risk>70"
              onChange={(e) => s.set({ groups: s.groups.map((x, j) => (j === i ? { ...x, query: e.target.value } : x)) })}
            />
            <button className="clickable-icon" onClick={() => s.set({ groups: s.groups.filter((_, j) => j !== i) })}>
              <X size={13} />
            </button>
          </div>
        ))}
        <button className="mod-cta-ghost" onClick={() => s.set({ groups: [...s.groups, { query: '', color: '#f59e0b' }] })}>
          <Plus size={13} /> New group
        </button>
        <div className="hint">Queries: tag:, chain:, cat:, risk&gt;N, starred, watched, free text. Prefix - to negate.</div>
      </Section>

      <Section title="Display" defaultOpen={false}>
        <div className="seg">
          {LAYOUTS.map(([k, l]) => (
            <button key={k} className={s.layout === k ? 'on' : ''} onClick={() => s.set({ layout: k })}>
              {l}
            </button>
          ))}
        </div>
        <Row label="Color by">
          <select className="dropdown" value={s.colorBy} onChange={(e) => s.set({ colorBy: e.target.value as typeof s.colorBy })}>
            <option value="chain">Network</option>
            <option value="category">Category</option>
            <option value="risk">Risk</option>
          </select>
        </Row>
        <Row label="Edge labels">
          <select className="dropdown" value={s.edgeLabels} onChange={(e) => s.set({ edgeLabels: e.target.value as typeof s.edgeLabels })}>
            <option value="none">None</option>
            <option value="amount">Amount</option>
            <option value="full">#Order · amount · date</option>
          </select>
        </Row>
        <Row label="Arrows">
          <Switch on={s.arrows} onChange={(v) => s.set({ arrows: v })} />
        </Row>
        <Row label="Animate flows">
          <Switch on={s.particles} onChange={(v) => s.set({ particles: v })} />
        </Row>
        <Row label="Risk halo">
          <Switch on={s.riskHalo} onChange={(v) => s.set({ riskHalo: v })} />
        </Row>
        <Row label="Cluster rings">
          <Switch on={s.clusterRings} onChange={(v) => s.set({ clusterRings: v })} />
        </Row>
        <label className="slabel">Text fade threshold</label>
        <Slider value={s.textFade} min={-3} max={3} step={0.1} onChange={(v) => s.set({ textFade: v })} format={(v) => v.toFixed(1)} />
        <label className="slabel">Node size</label>
        <Slider value={s.nodeSize} min={0.4} max={3} step={0.05} onChange={(v) => s.set({ nodeSize: v })} format={(v) => v.toFixed(2)} />
        <label className="slabel">Link thickness</label>
        <Slider value={s.linkThickness} min={0.2} max={4} step={0.05} onChange={(v) => s.set({ linkThickness: v })} format={(v) => v.toFixed(2)} />
      </Section>

      <Section title="Forces" defaultOpen={false}>
        <label className="slabel">Center force</label>
        <Slider value={s.centerForce} min={0} max={1} step={0.01} onChange={(v) => s.set({ centerForce: v })} format={(v) => v.toFixed(2)} />
        <label className="slabel">Repel force</label>
        <Slider value={s.repelForce} min={0} max={20} step={0.1} onChange={(v) => s.set({ repelForce: v })} format={(v) => v.toFixed(1)} />
        <label className="slabel">Link force</label>
        <Slider value={s.linkForce} min={0} max={1} step={0.01} onChange={(v) => s.set({ linkForce: v })} format={(v) => v.toFixed(2)} />
        <label className="slabel">Link distance</label>
        <Slider value={s.linkDistance} min={10} max={250} step={1} onChange={(v) => s.set({ linkDistance: v })} format={(v) => String(Math.round(v))} />
      </Section>
    </div>
  )
}
