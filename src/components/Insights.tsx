import { BookOpen, Check, Eye, Link2, Merge, ShieldAlert, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { addLink, applyCluster, dismissFinding, expandMixers, findFunder, followPeelChain } from '../actions'
import { graphApi } from '../commands'
import { useD } from '../derived'
import { KIND_META, SEVERITY_COLOR, type Finding, type FindingKind, type Severity } from '../obfuscation'
import { select, toast, useCases, useUI } from '../store'

const ORDER: Severity[] = ['high', 'medium', 'low', 'info']

/** Obfuscation & laundering-pattern findings for the active case. */
export function Insights() {
  const d = useD()
  const ui = useUI()
  const [kind, setKind] = useState<FindingKind | 'all'>('all')
  const [glossary, setGlossary] = useState(false)
  const findings = d.findings
  const counts = useMemo(() => {
    const m = new Map<FindingKind, number>()
    for (const f of findings) m.set(f.kind, (m.get(f.kind) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [findings])
  const list = useMemo(
    () => findings.filter((f) => kind === 'all' || f.kind === kind).sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity) || (b.confidence ?? 0) - (a.confidence ?? 0)),
    [findings, kind],
  )
  const bySev = ORDER.map((s) => [s, findings.filter((f) => f.severity === s).length] as const)
  const sel = ui.selected ? d.c.nodes[ui.selected] : undefined

  const show = (f: Finding) => {
    ui.set({ spotlight: ui.spotlight?.id === f.id ? null : { id: f.id, nodes: f.nodes, edges: f.edges } })
    if (f.nodes[0]) graphApi.current?.focus(f.nodes[f.nodes.length > 2 ? 1 : 0])
  }

  return (
    <div className="pane-pad">
      <div className="row gap6">
        <ShieldAlert size={15} className="accent" />
        <div className="section-title grow" style={{ margin: 0 }}>Obfuscation analysis</div>
        <button className={'chip' + (glossary ? ' on' : '')} onClick={() => setGlossary(!glossary)} title="Techniques glossary">
          <BookOpen size={12} /> Techniques
        </button>
      </div>

      <div className="sev-row">
        {bySev.map(([s, n]) => (
          <div key={s} className="sev-box" style={{ borderColor: n ? SEVERITY_COLOR[s] + '88' : undefined }}>
            <b style={{ color: n ? SEVERITY_COLOR[s] : undefined }}>{n}</b>
            <span>{s}</span>
          </div>
        ))}
      </div>

      <div className="section">
        <div className="section-title">Deep analysis</div>
        <div className="action-grid">
          <button className="mod-ghost sm" onClick={() => void expandMixers()} title="Load mixer histories, then match deposits to withdrawals">
            Load mixers for demixing
          </button>
          <button className="mod-ghost sm" disabled={!sel || !!ui.trace} onClick={() => sel && void followPeelChain(sel.id)} title="Follow change outputs hop by hop (UTXO)">
            Follow peel chain
          </button>
          <button className="mod-ghost sm" disabled={!sel} onClick={() => sel && void findFunder(sel.id)} title="Who paid for the first gas / activation">
            Find first funder
          </button>
          <button
            className="mod-ghost sm"
            disabled={!sel}
            onClick={() => (ui.set({ linkFrom: sel!.id }), toast('Shift+click another address to link it as the same owner', 'info'))}
          >
            Link same owner…
          </button>
        </div>
        {!sel && <div className="hint mt6">Select an address to enable per-address analysis.</div>}
      </div>

      {glossary && (
        <div className="section glossary">
          {(Object.keys(KIND_META) as FindingKind[]).map((k) => (
            <div key={k} className="gloss">
              <b>{KIND_META[k].label}</b>
              <span>{KIND_META[k].technique}</span>
            </div>
          ))}
        </div>
      )}

      {counts.length > 0 && (
        <div className="chips mb8">
          <button className={'chip' + (kind === 'all' ? ' on' : '')} onClick={() => setKind('all')}>
            All {findings.length}
          </button>
          {counts.map(([k, n]) => (
            <button key={k} className={'chip' + (kind === k ? ' on' : '')} onClick={() => setKind(k)}>
              {KIND_META[k].label} {n}
            </button>
          ))}
        </div>
      )}

      {list.slice(0, 150).map((f) => (
        <FindingCard key={f.id} f={f} active={ui.spotlight?.id === f.id} onShow={() => show(f)} />
      ))}
      {!findings.length && (
        <div className="empty-pane">
          No obfuscation patterns in the loaded data yet. Expand more addresses, load mixer histories, or follow traces to give the detectors more to work with.
        </div>
      )}
      {d.allFindings.length > findings.length && (
        <button className="mod-ghost sm mt6" onClick={() => useCases.getState().update(d.c.id, (x) => ({ ...x, dismissed: [] }))}>
          Restore {d.allFindings.length - findings.length} dismissed
        </button>
      )}
    </div>
  )
}

function FindingCard({ f, active, onShow }: { f: Finding; active: boolean; onShow: () => void }) {
  const d = useD()
  const accepted =
    f.link && d.c.links.some((l) => (l.a === f.link!.a && l.b === f.link!.b) || (l.a === f.link!.b && l.b === f.link!.a))
  return (
    <div className={'finding' + (active ? ' active' : '')} style={{ borderLeftColor: SEVERITY_COLOR[f.severity] }}>
      <div className="finding-head">
        <span className="finding-kind" style={{ color: SEVERITY_COLOR[f.severity] }}>
          {KIND_META[f.kind].label}
        </span>
        {f.confidence != null && <span className="conf">{Math.round(f.confidence * 100)}%</span>}
      </div>
      <div className="finding-title" onClick={() => f.nodes[0] && select(f.nodes[f.nodes.length > 2 ? 1 : 0])}>
        {f.title}
      </div>
      <div className="finding-detail">{f.detail}</div>
      {f.confidence != null && (
        <div className="conf-track">
          <div style={{ width: `${f.confidence * 100}%`, background: SEVERITY_COLOR[f.severity] }} />
        </div>
      )}
      <div className="finding-actions">
        <button className="mod-ghost sm" onClick={onShow}>
          <Eye size={12} /> {active ? 'Hide' : 'Show'}
        </button>
        {f.link && (
          <button
            className="mod-ghost sm"
            disabled={accepted}
            onClick={() => (addLink(f.link!.a, f.link!.b, f.link!.kind, f.title, f.confidence), toast('Link added to the graph', 'success'))}
          >
            {accepted ? <Check size={12} /> : <Link2 size={12} />} {accepted ? 'Linked' : 'Accept link'}
          </button>
        )}
        {f.cluster && f.cluster.length > 1 && (
          <button className="mod-ghost sm" onClick={() => applyCluster(f.cluster!, KIND_META[f.kind].label)}>
            <Merge size={12} /> Same owner
          </button>
        )}
        <span className="grow" />
        <button className="clickable-icon" title="Dismiss" onClick={() => dismissFinding(f.id)}>
          <X size={13} />
        </button>
      </div>
    </div>
  )
}
