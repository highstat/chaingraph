import {
  ChartNoAxesGantt, Command, Download, FileText, FolderArchive, HelpCircle, Image, ListPlus, PanelLeft, PanelRight, Plus, Search, Settings, ShieldAlert,
  SlidersHorizontal, Radar, Waypoints, Workflow, X,
} from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { addLink, autoTrace, expand, investigate, pollWatchlist, runPathfinding } from './actions'
import { CHAINS, EVM_CHAINS, detectChain, detectPrivacy, detectTxHash } from './chains'
import { graphApi } from './commands'
import { ContextMenu, type MenuState } from './components/ContextMenu'
import { Graph, type GraphHandle, type Palette as GPalette } from './components/Graph'
import { GraphControls } from './components/GraphControls'
import { LeftSidebar } from './components/LeftSidebar'
import { Palette } from './components/Palette'
import { RightSidebar } from './components/RightSidebar'
import { SettingsModal } from './components/SettingsModal'
import { Timeline } from './components/Timeline'
import { BulkImport } from './components/BulkImport'
import { Logo } from './components/Logo'
import { IconBtn } from './components/ui'
import { DerivedContext, useDerived } from './derived'
import { download } from './format'
import { patchNode } from './model'
import { markdownReport, obsidianVault } from './report'
import { useSettings } from './settings'
import { hydrateCases, redo, select, toast, undo, useCases, useUI } from './store'
import { applyTheme, themeById } from './themes'
import type { ChainId } from './types'

// The OSINT toolkit (maps, phone metadata, EXIF) loads on first open.
const OsintView = lazy(() => import('./components/osint/OsintView').then((m) => ({ default: m.OsintView })))

const EXAMPLES = [
  { label: 'vitalik.eth', addr: 'vitalik.eth' },
  { label: 'Tornado Cash 1 ETH pool', addr: '0x47CE0C6eD5B0Ce3d3A51fdb1C52DC66a7c3c2936' },
  { label: 'BTC sample', addr: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh' },
  { label: 'TRON sample', addr: 'TNPdqto8HiuMzoG7Vv9wyyYhWzCojLeHAF' },
  { label: 'Solana sample', addr: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM' },
]

export default function App() {
  const hydrated = useCases((s) => s.hydrated)
  const s = useSettings()

  useEffect(() => {
    void hydrateCases()
  }, [])
  useEffect(() => applyTheme(s.theme, s.accent, s.fontSize), [s.theme, s.accent, s.fontSize])

  if (!hydrated) return <div className="boot">Loading vault…</div>
  return <Workspace />
}

function Workspace() {
  const d = useDerived()
  const s = useSettings()
  const ui = useUI()
  const cases = useCases()
  const graph = useRef<GraphHandle>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [query, setQuery] = useState('')
  const c = d.c

  useEffect(() => {
    graphApi.current = graph.current
    if (import.meta.env.DEV) (window as unknown as { __cg: unknown }).__cg = d // debugging aid in dev builds only
  })

  // Watchlist polling.
  useEffect(() => {
    const t = setInterval(() => void pollWatchlist(), s.watchIntervalMin * 60000)
    return () => clearInterval(t)
  }, [s.watchIntervalMin])

  // Global hotkeys (Obsidian-like).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const typing = e.target instanceof Element && e.target.closest('input,textarea,select,[contenteditable]')
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      const st = useUI.getState()
      if (mod && k === 'p') return e.preventDefault(), st.set({ modal: 'palette' })
      if (mod && k === 'o') return e.preventDefault(), st.set({ modal: 'switcher' })
      if (mod && k === ',') return e.preventDefault(), st.set({ modal: 'settings' })
      if (mod && k === 'k') return e.preventDefault(), document.getElementById('addr-search')?.focus()
      if (mod && k === 'z' && !typing) return e.preventDefault(), e.shiftKey ? redo() : undo()
      if (mod && k === 'y' && !typing) return e.preventDefault(), redo()
      if (mod && e.key === '\\') return e.preventDefault(), e.shiftKey ? st.set({ rightOpen: !st.rightOpen }) : st.set({ leftOpen: !st.leftOpen })
      if (e.key === 'Escape') {
        if (st.modal) return st.set({ modal: null })
        if (typing) return (e.target as HTMLElement).blur()
        setMenu(null)
        return st.set({ selected: null, selectedEdge: null, pathFrom: null, linkFrom: null, spotlight: null })
      }
      if (typing || mod || st.modal) return
      if (k === 'f') graph.current?.fit()
      else if (k === 'g') st.set({ graphControlsOpen: !st.graphControlsOpen })
      else if (k === 'l') st.set({ localGraph: !st.localGraph })
      else if (k === 'e' && st.selected) void expand(st.selected)
      else if (k === 't' && st.selected && !st.trace) void autoTrace(st.selected, 'out')
      else if (k === 'i') st.set({ rightOpen: true, rightPane: 'insights' })
      else if (k === 'b') st.set({ modal: 'bulk' })
      else if (k === 'o') st.set({ view: st.view === 'osint' ? 'graph' : 'osint' })
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const theme = themeById(s.theme)
  const palette = useMemo<GPalette>(
    () => ({ bg: theme.vars.bg, text: theme.vars.text, muted: theme.vars.muted, accent: s.accent || theme.accent, warn: theme.vars.warn }),
    [theme, s.accent],
  )
  const spotlight = useMemo(
    () => (ui.spotlight ? { nodes: new Set(ui.spotlight.nodes), edges: new Set(ui.spotlight.edges) } : null),
    [ui.spotlight],
  )
  const highlight = useMemo(() => {
    const set = new Set(c?.traced ?? [])
    for (const p of ui.path?.paths ?? []) for (const e of p.edges) set.add(e)
    return set
  }, [c?.traced, ui.path])
  const graphSettings = useMemo(
    () => ({
      layout: s.layout, centerForce: s.centerForce, repelForce: s.repelForce, linkForce: s.linkForce, linkDistance: s.linkDistance,
      nodeSize: s.nodeSize, linkThickness: s.linkThickness, arrows: s.arrows, textFade: s.textFade, particles: s.particles,
      edgeLabels: s.edgeLabels, riskHalo: s.riskHalo, clusterRings: s.clusterRings,
    }),
    [s.layout, s.centerForce, s.repelForce, s.linkForce, s.linkDistance, s.nodeSize, s.linkThickness, s.arrows, s.textFade, s.particles, s.edgeLabels, s.riskHalo, s.clusterRings],
  )

  if (!c) return null
  const detected = detectChain(query, s.defaultEvm)
  const kindLabel = !query.trim()
    ? ''
    : detected
      ? CHAINS[detected].name
      : /\.eth$/i.test(query.trim())
        ? 'ENS name'
        : detectTxHash(query)
          ? 'transaction'
          : detectPrivacy(query)
            ? 'privacy coin'
            : 'unknown'
  const safe = c.title.replace(/[\\/:*?"<>|]/g, '_')
  const ctx = { c, edges: d.edgesAll, attr: d.attr, risk: d.risk, findings: d.findings }
  const empty = Object.keys(c.nodes).length === 0
  const exportPng = () => {
    const url = graph.current?.png()
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = `${safe}.png`
    a.click()
  }

  return (
    <DerivedContext.Provider value={d}>
      <div className={'app' + (s.showRibbon ? '' : ' no-ribbon') + (ui.leftOpen && ui.view === 'graph' ? '' : ' left-closed') + (ui.rightOpen && ui.view === 'graph' ? '' : ' right-closed')}>
        {s.showRibbon && (
          <nav className="ribbon">
            <div className="ribbon-logo" title="ChainGraph">
              <Logo size={24} />
            </div>
            <IconBtn title="OSINT Toolkit (O)" active={ui.view === 'osint'} onClick={() => ui.set({ view: ui.view === 'osint' ? 'graph' : 'osint' })}><Radar size={18} /></IconBtn>
            <IconBtn title="Quick switcher (⌘O)" onClick={() => ui.set({ modal: 'switcher' })}><Search size={18} /></IconBtn>
            <IconBtn title="Command palette (⌘P)" onClick={() => ui.set({ modal: 'palette' })}><Command size={18} /></IconBtn>
            <IconBtn title="Graph settings (G)" active={ui.graphControlsOpen} onClick={() => ui.set({ graphControlsOpen: !ui.graphControlsOpen })}><SlidersHorizontal size={18} /></IconBtn>
            <IconBtn title="Timeline" active={ui.timelineOpen} onClick={() => ui.set({ timelineOpen: !ui.timelineOpen })}><ChartNoAxesGantt size={18} /></IconBtn>
            <IconBtn title="Local graph (L)" active={ui.localGraph} onClick={() => ui.set({ localGraph: !ui.localGraph })}><Waypoints size={18} /></IconBtn>
            <IconBtn title="Obfuscation analysis (I)" active={ui.rightOpen && ui.rightPane === 'insights'} onClick={() => ui.set({ rightOpen: true, rightPane: 'insights' })}><ShieldAlert size={18} /></IconBtn>
            <IconBtn title="Bulk import (B)" onClick={() => ui.set({ modal: 'bulk' })}><ListPlus size={18} /></IconBtn>
            <IconBtn title="Markdown report" onClick={() => download(`${safe}.md`, markdownReport(ctx), 'text/markdown')}><FileText size={18} /></IconBtn>
            <IconBtn title="Export Obsidian vault" onClick={() => download(`${safe}-vault.zip`, obsidianVault(ctx))}><FolderArchive size={18} /></IconBtn>
            <div className="grow" />
            <IconBtn title="Hotkeys" onClick={() => ui.set({ modal: 'settings', settingsTab: 'hotkeys' })}><HelpCircle size={18} /></IconBtn>
            <IconBtn title="Settings (⌘,)" onClick={() => ui.set({ modal: 'settings' })}><Settings size={18} /></IconBtn>
          </nav>
        )}

        {ui.leftOpen && ui.view === 'graph' && <LeftSidebar />}

        <main className={'workspace-main' + (ui.view === 'osint' ? ' osint-mode' : '')}>
          <div className="tab-bar">
            <IconBtn title="Toggle left sidebar (⌘\)" onClick={() => ui.set({ leftOpen: !ui.leftOpen })}><PanelLeft size={16} /></IconBtn>
            <div className="tabs-row">
              <div className={'ws-tab pinned' + (ui.view === 'osint' ? ' is-active' : '')} onClick={() => ui.set({ view: 'osint' })} title="OSINT Toolkit (O)">
                <Radar size={13} />
                <span className="ellipsis">OSINT Toolkit</span>
              </div>
              {cases.tabs.map((id) => {
                const t = cases.cases[id]
                if (!t) return null
                return (
                  <div key={id} className={'ws-tab' + (id === cases.activeId && ui.view === 'graph' ? ' is-active' : '')} onClick={() => (cases.open(id), select(null), ui.set({ view: 'graph' }))}>
                    <span className="ellipsis">{t.title}</span>
                    {cases.tabs.length > 1 && (
                      <button className="ws-tab-close" onClick={(e) => (e.stopPropagation(), cases.closeTab(id))}>
                        <X size={12} />
                      </button>
                    )}
                  </div>
                )
              })}
              <IconBtn title="New case" onClick={() => cases.create()}><Plus size={15} /></IconBtn>
            </div>
            <IconBtn title="Toggle right sidebar (⌘⇧\)" onClick={() => ui.set({ rightOpen: !ui.rightOpen })}><PanelRight size={16} /></IconBtn>
          </div>

          <div className="view-header">
            <input className="view-title" value={c.title} onChange={(e) => cases.update(c.id, (x) => ({ ...x, title: e.target.value }))} />
            <form className="search-box" onSubmit={(e) => (e.preventDefault(), investigate(query), setQuery(''))}>
              <Search size={14} className="muted" />
              <input id="addr-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Address, tx hash or ENS — BTC, ETH, SOL, TRON, TON, XRP, XLM, LTC, DOGE…" spellCheck={false} autoComplete="off" />
              {query && (
                <span className="detect" style={{ color: detected ? CHAINS[detected].color : kindLabel === 'unknown' ? 'var(--neg)' : 'var(--accent)' }}>
                  {kindLabel}
                </span>
              )}
              <kbd>⌘K</kbd>
            </form>
            <select className="dropdown" value={s.defaultEvm} onChange={(e) => s.set({ defaultEvm: e.target.value as ChainId })} title="Network used for 0x addresses">
              {EVM_CHAINS.map((id) => (
                <option key={id} value={id}>
                  {CHAINS[id].name}
                  {CHAINS[id].keyless ? '' : ' (key)'}
                </option>
              ))}
            </select>
            <div className="view-actions">
              <IconBtn title="Auto-trace from selected (T)" onClick={() => ui.selected && void autoTrace(ui.selected)}><Workflow size={16} /></IconBtn>
              <IconBtn title="Export PNG" onClick={exportPng}><Image size={16} /></IconBtn>
              <IconBtn title="Export Markdown report" onClick={() => download(`${safe}.md`, markdownReport(ctx), 'text/markdown')}><Download size={16} /></IconBtn>
            </div>
          </div>

          <div className="graph-wrap">
            <Graph
              ref={graph}
              nodes={d.vNodes}
              edges={d.vEdges}
              colors={d.colors}
              risk={d.risk}
              attr={d.attr}
              clusterOf={d.clusters.of}
              flagged={d.flagged}
              highlight={highlight}
              spotlight={spotlight}
              selected={ui.selected}
              selectedEdge={ui.selectedEdge}
              settings={graphSettings}
              palette={palette}
              onSelect={(id) => select(id)}
              onSelectEdge={(id) => ui.set({ selectedEdge: id, rightPane: 'inspector', rightOpen: true })}
              onExpand={(id) => void expand(id)}
              onShiftClick={(id) => {
                const st = useUI.getState()
                if (st.linkFrom && st.linkFrom !== id) {
                  addLink(st.linkFrom, id, 'same-owner', 'Manual link')
                  st.set({ linkFrom: null })
                  return toast('Linked as same owner', 'success')
                }
                const from = st.pathFrom ?? st.selected
                if (from && from !== id) runPathfinding(from, id)
                else select(id)
              }}
              onMoved={(id, x, y) => cases.update(c.id, (cs) => patchNode(cs, id, { pinned: { x, y } }))}
              onContext={(id, x, y) => setMenu({ id, x, y })}
            />
            <GraphControls />
            {empty && (
              <div className="empty-state">
                <Logo size={56} />
                <h2>Start an investigation</h2>
                <p>Paste a wallet address, transaction hash or ENS name. The network is detected automatically across 20+ blockchains, using public explorers with no API keys.</p>
                <div className="row gap6 center">
                  {EXAMPLES.map((e) => (
                    <button key={e.addr} className="mod-ghost" onClick={() => investigate(e.addr)}>
                      {e.label}
                    </button>
                  ))}
                </div>
                <div className="hints">
                  <span><kbd>⌘P</kbd> commands</span>
                  <span><kbd>double-click</kbd> expand</span>
                  <span><kbd>right-click</kbd> actions</span>
                  <span><kbd>T</kbd> auto-trace</span>
                  <span><kbd>I</kbd> obfuscation analysis</span>
                  <span><kbd>B</kbd> bulk import</span>
                </div>
              </div>
            )}
            <div className="graph-badges">
              {ui.localGraph && <span className="badge" onClick={() => ui.set({ localGraph: false })}>Local graph · depth {ui.localDepth} ✕</span>}
              {ui.timeRange && <span className="badge" onClick={() => ui.set({ timeRange: null })}>Time filter ✕</span>}
              {ui.assetFilter !== 'all' && <span className="badge" onClick={() => ui.set({ assetFilter: 'all' })}>{ui.assetFilter} ✕</span>}
              {ui.pathFrom && <span className="badge accent">Shift+click a target to find paths</span>}
              {ui.linkFrom && <span className="badge accent" onClick={() => ui.set({ linkFrom: null })}>Shift+click an address to link as same owner ✕</span>}
              {ui.spotlight && <span className="badge accent" onClick={() => ui.set({ spotlight: null })}>Showing finding evidence ✕</span>}
              {ui.trace && (
                <span className="badge accent">
                  {ui.trace.step} <a onClick={() => useUI.setState({ trace: { ...ui.trace!, cancel: true } })}>cancel</a>
                </span>
              )}
              {d.lookalikes.length > 0 && (
                <span className="badge warn" onClick={() => select(d.lookalikes[0][0])}>
                  ⚠ {d.lookalikes.length} lookalike pair(s)
                </span>
              )}
            </div>
            <div className="legend">
              {[...new Set(d.vNodes.map((n) => n.chain))].map((k) => (
                <span key={k}>
                  <i style={{ background: CHAINS[k].color }} />
                  {CHAINS[k].name}
                </span>
              ))}
              {!!d.vNodes.length && (
                <span>
                  <i className="hollow" />
                  not expanded
                </span>
              )}
            </div>
          </div>
          {ui.view === 'osint' && (
            <Suspense fallback={<div className="boot">Loading OSINT toolkit…</div>}>
              <OsintView />
            </Suspense>
          )}
          {ui.timelineOpen && ui.view === 'graph' && <Timeline />}
          <footer className="status-bar">
            <span>{d.vNodes.length}/{Object.keys(c.nodes).length} addresses</span>
            <span>{d.vEdges.length} flows</span>
            <span>{d.transfers.length} transfers</span>
            {ui.loading.size > 0 && <span className="pulse">● loading {ui.loading.size}</span>}
            <span className="muted">{s.layout}</span>
          </footer>
        </main>

        {ui.rightOpen && ui.view === 'graph' && <RightSidebar />}

        {ui.modal === 'settings' && <SettingsModal />}
        {(ui.modal === 'palette' || ui.modal === 'switcher') && <Palette mode={ui.modal} />}
        {ui.modal === 'bulk' && <BulkImport />}
        {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
        <div className="toasts">
          {ui.toasts.map((t) => (
            <div key={t.id} className={'notice ' + t.kind}>
              {t.text}
            </div>
          ))}
        </div>
      </div>
    </DerivedContext.Provider>
  )
}
