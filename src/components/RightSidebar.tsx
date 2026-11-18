import { BarChart3, Eye, Info, RefreshCw, Route, ShieldAlert, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { clearTrace, pollWatchlist, removeLink } from '../actions'
import { LEVEL_COLOR } from '../analysis'
import { CHAINS } from '../chains'
import { graphApi } from '../commands'
import { useD } from '../derived'
import { CATEGORY_META } from '../entities'
import { amt, date, short, usd } from '../format'
import { select, useCases, useUI, type RightPane } from '../store'
import type { Category } from '../types'
import { renderNote } from '../markdown'
import { Insights } from './Insights'
import { Inspector } from './Inspector'
import { IconBtn } from './ui'

const MAJOR = new Set(['BTC', 'ETH', 'WETH', 'WBTC', 'USDT', 'USDC', 'DAI', 'TRX', 'LTC', 'DOGE', 'BCH', 'BNB', 'POL', 'AVAX'])

export function RightSidebar() {
  const ui = useUI()
  const d = useD()
  const sel = ui.selected ? d.c?.nodes[ui.selected] : undefined
  const high = d.findings.filter((f) => f.severity === 'high' || f.severity === 'medium').length
  const tabs: [RightPane, React.ReactNode, string][] = [
    ['inspector', <Info size={16} />, 'Inspector'],
    [
      'insights',
      <span className="badge-wrap">
        <ShieldAlert size={16} />
        {high > 0 && <span className="icon-badge">{high > 99 ? '99+' : high}</span>}
      </span>,
      'Obfuscation analysis',
    ],
    ['overview', <BarChart3 size={16} />, 'Case overview'],
    ['paths', <Route size={16} />, 'Paths & traces'],
    ['watch', <Eye size={16} />, 'Watchlist'],
  ]
  return (
    <aside className="side-dock right">
      <div className="dock-header">
        {tabs.map(([k, icon, title]) => (
          <IconBtn key={k} title={title} active={ui.rightPane === k} onClick={() => ui.set({ rightPane: k })}>
            {icon}
          </IconBtn>
        ))}
      </div>
      <div className="dock-content">
        {ui.rightPane === 'inspector' &&
          (ui.selectedEdge ? <EdgePanel /> : sel ? <Inspector key={sel.id} node={sel} /> : <Empty text="Select an address or an edge on the graph." />)}
        {ui.rightPane === 'insights' && <Insights />}
        {ui.rightPane === 'overview' && <Overview />}
        {ui.rightPane === 'paths' && <Paths />}
        {ui.rightPane === 'watch' && <Watchlist />}
      </div>
    </aside>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="empty-pane">{text}</div>
}

function nameFn(d: ReturnType<typeof useD>) {
  return (id: string) => {
    const n = d.c.nodes[id]
    return n ? n.alias || n.info?.name || d.attr.get(id)?.label || short(n.address) : short(id)
  }
}

/** Arkham-style transaction log for one edge. */
function EdgePanel() {
  const d = useD()
  const ui = useUI()
  const e = d.edgesAll.find((x) => x.id === ui.selectedEdge)
  if (!e) return <Empty text="Edge no longer in graph." />
  const name = nameFn(d)
  const s = d.c.nodes[e.source]
  const txs = d.transfers
    .filter((t) => `${t.chain}:${t.from}` === e.source && `${t.chain}:${t.to}` === e.target && t.asset === e.asset)
    .sort((a, b) => a.time - b.time)
  const chain = CHAINS[s.chain]
  return (
    <div className="pane-pad">
      <div className="row gap6">
        <div className="section-title grow">Flow #{e.order}</div>
        <IconBtn title="Close" onClick={() => ui.set({ selectedEdge: null })}>
          <X size={14} />
        </IconBtn>
      </div>
      <div className="edge-ends">
        <a onClick={() => (select(e.source), graphApi.current?.focus(e.source))}>{name(e.source)}</a>
        <span className="muted">→</span>
        <a onClick={() => (select(e.target), graphApi.current?.focus(e.target))}>{name(e.target)}</a>
      </div>
      <div className="stats">
        <div className="stat">
          <div className="stat-k">Total</div>
          <div className="stat-v">
            {amt(e.amount)} {e.asset}
          </div>
          {e.usd != null && <div className="stat-sub">{usd(e.usd)}</div>}
        </div>
        <div className="stat">
          <div className="stat-k">Transfers</div>
          <div className="stat-v">{e.count}</div>
          <div className="stat-sub">{e.change ? 'likely change' : ''}</div>
        </div>
      </div>
      <div className="section-title">Transactions</div>
      <div className="txlist">
        {txs.map((t, i) => (
          <div key={t.hash + i} className="tx">
            <span className="muted small">{i + 1}</span>
            <a href={chain.txExplorer(t.hash)} target="_blank" rel="noreferrer noopener" className="ellipsis mono small" title={t.hash}>
              {short(t.hash, 10, 8)}
            </a>
            <span className="r">{amt(t.amount)}</span>
            <span className="muted small">{date(t.time)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Overview() {
  const d = useD()
  const ui = useUI()
  const c = d.c
  const name = nameFn(d)
  const nodes = Object.values(c.nodes)
  const byCat = useMemo(() => {
    const m = new Map<Category, number>()
    for (const n of nodes) {
      const cat = d.attr.get(n.id)?.category ?? 'unknown'
      if (cat !== 'unknown') m.set(cat, (m.get(cat) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [nodes, d.attr])
  const risky = useMemo(
    () => nodes.map((n) => ({ n, r: d.risk.get(n.id)! })).filter((x) => x.r && x.r.score >= 55).sort((a, b) => b.r.score - a.r.score).slice(0, 12),
    [nodes, d.risk],
  )
  const top = useMemo(() => {
    const priced = d.edgesAll.filter((e) => e.usd != null)
    const pool = priced.length ? priced.sort((a, b) => b.usd! - a.usd!) : d.edgesAll.filter((e) => MAJOR.has(e.asset)).sort((a, b) => b.amount - a.amount)
    return (ui.assetFilter === 'all' ? pool : d.edgesAll.filter((e) => e.asset === ui.assetFilter).sort((a, b) => b.amount - a.amount)).slice(0, 12)
  }, [d.edgesAll, ui.assetFilter])
  const pick = (id: string) => (select(id), graphApi.current?.focus(id))

  return (
    <div className="pane-pad">
      <div className="section-title">{c.title}</div>
      <div className="stats">
        <div className="stat"><div className="stat-k">Addresses</div><div className="stat-v">{nodes.length}</div></div>
        <div className="stat"><div className="stat-k">Investigated</div><div className="stat-v">{nodes.filter((n) => n.expanded).length}</div></div>
        <div className="stat"><div className="stat-k">Flows</div><div className="stat-v">{d.edgesAll.length}</div></div>
        <div className="stat"><div className="stat-k">Clusters</div><div className="stat-v">{d.clusters.members.size}</div></div>
      </div>
      {d.lookalikes.length > 0 && (
        <div className="callout warn" onClick={() => pick(d.lookalikes[0][0])}>
          {d.lookalikes.length} lookalike address pair(s) — possible address poisoning
        </div>
      )}
      <CaseNotes />
      {c.links.length > 0 && (
        <div className="section">
          <div className="section-title">Investigator links ({c.links.length})</div>
          {c.links.map((l) => (
            <div key={l.id} className="list-row">
              <span className="pill tiny">{l.kind}</span>
              <span className="ellipsis grow" onClick={() => pick(l.a)}>
                {name(l.a)} ↔ {name(l.b)}
              </span>
              {l.confidence != null && <span className="muted small">{Math.round(l.confidence * 100)}%</span>}
              <button className="clickable-icon" title="Remove link" onClick={() => removeLink(l.id)}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      {risky.length > 0 && (
        <div className="section">
          <div className="section-title">High-risk addresses</div>
          {risky.map(({ n, r }) => (
            <div key={n.id} className="list-row" onClick={() => pick(n.id)}>
              <span className="risk-chip" style={{ background: LEVEL_COLOR[r.level] }}>{r.score}</span>
              <span className="ellipsis grow">{name(n.id)}</span>
              <span className="muted small ellipsis">{r.reasons[0]?.text}</span>
            </div>
          ))}
        </div>
      )}
      {byCat.length > 0 && (
        <div className="section">
          <div className="section-title">Entities by category</div>
          {byCat.map(([cat, count]) => (
            <div key={cat} className="kv">
              <span><i className="dot" style={{ background: CATEGORY_META[cat].color }} /> {CATEGORY_META[cat].label}</span>
              <span>{count}</span>
            </div>
          ))}
        </div>
      )}
      {top.length > 0 && (
        <div className="section">
          <div className="section-title">Largest flows</div>
          {top.map((e) => (
            <div key={e.id} className="flow" onClick={() => useUI.getState().set({ selectedEdge: e.id, rightPane: 'inspector' })}>
              <span className="ellipsis">{name(e.source)}</span>
              <span className="muted">→</span>
              <span className="ellipsis">{name(e.target)}</span>
              <span className="r">
                {e.usd != null ? usd(e.usd) : `${amt(e.amount)} `}
                <span className="muted small"> {e.usd != null ? '' : e.asset}</span>
              </span>
            </div>
          ))}
        </div>
      )}
      {!nodes.length && <Empty text="Paste an address in the search bar to start." />}
    </div>
  )
}

function Paths() {
  const d = useD()
  const ui = useUI()
  const name = nameFn(d)
  const traced = d.c.traced
  return (
    <div className="pane-pad">
      <div className="row gap6">
        <div className="section-title grow">Paths & traces</div>
        {(traced.length > 0 || ui.path) && (
          <button className="mod-ghost sm" onClick={clearTrace}>
            Clear
          </button>
        )}
      </div>
      {ui.trace && (
        <div className="callout">
          <RefreshCw size={13} className="spin" /> {ui.trace.step}
          <button className="mod-ghost sm" onClick={() => useUI.setState({ trace: { ...ui.trace!, cancel: true } })}>
            Cancel
          </button>
        </div>
      )}
      <p className="muted small">
        Select an address, then <kbd>Shift</kbd>+click another to find every shortest path between them. Use <b>Trace</b> (or <kbd>T</kbd>) to
        follow funds automatically.
      </p>
      {ui.pathFrom && <div className="callout">Path start: {name(ui.pathFrom)}. Shift+click the target.</div>}
      {ui.path && (
        <div className="section">
          <div className="section-title">
            {ui.path.paths.length} path(s) {name(ui.path.from)} → {name(ui.path.to)} {ui.path.directed ? '' : '(ignoring direction)'}
          </div>
          {ui.path.paths.map((p, i) => (
            <div key={i} className="path">
              {p.nodes.map((n, j) => (
                <span key={n}>
                  {j > 0 && <span className="muted"> → </span>}
                  <a onClick={() => (select(n), graphApi.current?.focus(n))}>{name(n)}</a>
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
      {traced.length > 0 && (
        <div className="section">
          <div className="section-title">Traced flows ({traced.length})</div>
          {d.edgesAll
            .filter((e) => traced.includes(e.id))
            .sort((a, b) => a.first - b.first)
            .map((e) => (
              <div key={e.id} className="flow" onClick={() => useUI.getState().set({ selectedEdge: e.id, rightPane: 'inspector' })}>
                <span className="ellipsis">{name(e.source)}</span>
                <span className="muted">→</span>
                <span className="ellipsis">{name(e.target)}</span>
                <span className="r">
                  {amt(e.amount)} <span className="muted small">{e.asset}</span>
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}

function Watchlist() {
  const cases = useCases()
  const watched = Object.values(cases.cases).flatMap((c) => Object.values(c.nodes).filter((n) => n.watch).map((n) => ({ c, n })))
  return (
    <div className="pane-pad">
      <div className="row gap6">
        <div className="section-title grow">Watchlist ({watched.length})</div>
        <button className="mod-ghost sm" onClick={() => void pollWatchlist()} disabled={!watched.length}>
          <RefreshCw size={12} /> Check now
        </button>
      </div>
      <p className="muted small">Watched addresses are polled while the app is open (interval in Settings → Watchlist).</p>
      {watched.map(({ c, n }) => (
        <div
          key={c.id + n.id}
          className="list-row"
          onClick={() => {
            cases.open(c.id)
            select(n.id)
            setTimeout(() => graphApi.current?.focus(n.id), 300)
          }}
        >
          <i className="dot" style={{ background: CHAINS[n.chain].color }} />
          <span className="ellipsis grow">{n.alias || n.info?.name || short(n.address, 8, 6)}</span>
          <span className="muted small ellipsis">{c.title}</span>
        </div>
      ))}
      {!watched.length && <Empty text="No watched addresses. Use the eye icon in the inspector." />}
    </div>
  )
}

function CaseNotes() {
  const d = useD()
  const update = useCases((s) => s.update)
  const [editing, setEditing] = useState(false)
  const c = d.c
  return (
    <div className="section">
      <div className="row gap6">
        <div className="section-title grow">Case notes</div>
        <button className="chip" onClick={() => setEditing(!editing)}>
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>
      {editing || !c.note ? (
        <textarea
          className="case-note"
          value={c.note}
          placeholder="Incident summary, timeline, victim details, hypotheses… (Markdown)"
          onChange={(e) => update(c.id, (x) => ({ ...x, note: e.target.value }))}
          onFocus={() => setEditing(true)}
        />
      ) : (
        <div className="md" onDoubleClick={() => setEditing(true)}>
          {renderNote(c.note, () => {})}
        </div>
      )}
    </div>
  )
}
