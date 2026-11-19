import { del as idbDel } from 'idb-keyval'
import { Check, Download, Trash2, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { CHAINS, EVM_CHAINS } from '../chains'
import { CATEGORIES, CATEGORY_META, parseLabelCsv } from '../entities'
import { download } from '../format'
import { DEFAULT_RISK, useSettings } from '../settings'
import { toast, useCases, useUI } from '../store'
import { THEMES } from '../themes'
import type { Category } from '../types'
import { Heading, Kbd, SettingItem, Slider, Switch } from './ui'

const ACCENTS = ['#2dd4bf', '#38bdf8', '#818cf8', '#a78bfa', '#f472b6', '#fb7185', '#fb923c', '#facc15', '#4ade80', '#e5e7eb']

const TABS: [string, string][] = [
  ['appearance', 'Appearance'],
  ['graph', 'Graph'],
  ['data', 'Data sources'],
  ['heuristics', 'Heuristics'],
  ['risk', 'Risk model'],
  ['trace', 'Auto-trace'],
  ['watch', 'Watchlist & alerts'],
  ['labels', 'Label library'],
  ['hotkeys', 'Hotkeys'],
  ['storage', 'Storage'],
  ['about', 'About'],
]

export const HOTKEYS: [string, string][] = [
  ['Mod+P', 'Open command palette'],
  ['Mod+O', 'Quick switcher (jump to address)'],
  ['Mod+K', 'Focus address search'],
  ['Mod+,', 'Open settings'],
  ['Mod+Z', 'Undo'],
  ['Mod+Shift+Z', 'Redo'],
  ['I', 'Obfuscation analysis panel'],
  ['B', 'Bulk import addresses'],
  ['O', 'Open / close the OSINT Toolkit'],
  ['C', 'Open / close CVE & attack surface (/cve)'],
  ['Mod+\\', 'Toggle left sidebar'],
  ['Mod+Shift+\\', 'Toggle right sidebar'],
  ['E', 'Expand selected address'],
  ['T', 'Auto-trace outflows from selected'],
  ['L', 'Toggle local graph'],
  ['F', 'Fit graph to screen'],
  ['G', 'Toggle graph settings panel'],
  ['Shift+Click', 'Find paths from selected to clicked node (or link, after “Link same owner…”)'],
  ['Double-click', 'Expand node'],
  ['Right-click', 'Node context menu'],
  ['Esc', 'Clear selection / close'],
]

export function SettingsModal() {
  const ui = useUI()
  const tab = ui.settingsTab
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && ui.set({ modal: null })}>
      <div className="modal settings-modal">
        <button className="modal-close clickable-icon" onClick={() => ui.set({ modal: null })}>
          <X size={18} />
        </button>
        <nav className="vertical-tabs">
          <div className="vtab-group-title">Options</div>
          {TABS.map(([k, l]) => (
            <div key={k} className={'vtab' + (tab === k ? ' is-active' : '')} onClick={() => ui.set({ settingsTab: k })}>
              {l}
            </div>
          ))}
        </nav>
        <div className="vertical-tab-content">
          {tab === 'appearance' && <Appearance />}
          {tab === 'graph' && <GraphTab />}
          {tab === 'data' && <DataTab />}
          {tab === 'heuristics' && <HeuristicsTab />}
          {tab === 'risk' && <RiskTab />}
          {tab === 'trace' && <TraceTab />}
          {tab === 'watch' && <WatchTab />}
          {tab === 'labels' && <LabelsTab />}
          {tab === 'hotkeys' && <HotkeysTab />}
          {tab === 'storage' && <StorageTab />}
          {tab === 'about' && <AboutTab />}
        </div>
      </div>
    </div>
  )
}

function Appearance() {
  const s = useSettings()
  return (
    <>
      <h2>Appearance</h2>
      <Heading>Themes</Heading>
      <div className="theme-grid">
        {THEMES.map((t) => (
          <button key={t.id} className={'theme-card' + (s.theme === t.id ? ' on' : '')} onClick={() => s.set({ theme: t.id })}>
            <div className="theme-swatch" style={{ background: t.vars.bg, borderColor: t.vars.border }}>
              <div style={{ background: t.vars.bg2, borderRight: `1px solid ${t.vars.border}` }} />
              <div className="sw-main">
                <i style={{ background: t.accent }} />
                <i style={{ background: t.vars.text2, width: '60%' }} />
                <i style={{ background: t.vars.muted, width: '40%' }} />
              </div>
            </div>
            <span>
              {s.theme === t.id && <Check size={12} />} {t.name}
            </span>
          </button>
        ))}
      </div>
      <SettingItem name="Accent color" desc="Highlight color for buttons, selection and focus rings.">
        <div className="accent-presets">
          {ACCENTS.map((a) => (
            <button
              key={a}
              className={'accent-dot' + ((s.accent ?? THEMES.find((t) => t.id === s.theme)!.accent) === a ? ' on' : '')}
              style={{ background: a }}
              title={a}
              onClick={() => s.set({ accent: a })}
            />
          ))}
        </div>
        <input type="color" value={s.accent ?? THEMES.find((t) => t.id === s.theme)!.accent} onChange={(e) => s.set({ accent: e.target.value })} />
        {s.accent && (
          <button className="mod-ghost" onClick={() => s.set({ accent: null })}>
            Reset
          </button>
        )}
      </SettingItem>
      <SettingItem name="Interface font size" desc="Size of UI text in pixels.">
        <Slider value={s.fontSize} min={11} max={17} step={1} onChange={(v) => s.set({ fontSize: v })} />
      </SettingItem>
      <SettingItem name="Show ribbon" desc="Vertical icon bar on the far left.">
        <Switch on={s.showRibbon} onChange={(v) => s.set({ showRibbon: v })} />
      </SettingItem>
    </>
  )
}

function GraphTab() {
  const s = useSettings()
  return (
    <>
      <h2>Graph</h2>
      <p className="setting-intro">These mirror the floating graph panel (press G). Values apply live.</p>
      <SettingItem name="Default layout" desc="Force-directed, hierarchical flow (left→right or top→down) or radial.">
        <select className="dropdown" value={s.layout} onChange={(e) => s.set({ layout: e.target.value as typeof s.layout })}>
          <option value="force">Force</option>
          <option value="lr">Flow left → right</option>
          <option value="td">Flow top → down</option>
          <option value="radial">Radial</option>
        </select>
      </SettingItem>
      <SettingItem name="Color nodes by" desc="Color groups and tags always take priority.">
        <select className="dropdown" value={s.colorBy} onChange={(e) => s.set({ colorBy: e.target.value as typeof s.colorBy })}>
          <option value="chain">Network</option>
          <option value="category">Category</option>
          <option value="risk">Risk level</option>
        </select>
      </SettingItem>
      <SettingItem name="Edge labels" desc="MetaSleuth-style labels with chronological order, amount and date.">
        <select className="dropdown" value={s.edgeLabels} onChange={(e) => s.set({ edgeLabels: e.target.value as typeof s.edgeLabels })}>
          <option value="none">None</option>
          <option value="amount">Amount</option>
          <option value="full">#Order · amount · date</option>
        </select>
      </SettingItem>
      <SettingItem name="Arrows">
        <Switch on={s.arrows} onChange={(v) => s.set({ arrows: v })} />
      </SettingItem>
      <SettingItem name="Animate flows" desc="Particles along highlighted and traced edges.">
        <Switch on={s.particles} onChange={(v) => s.set({ particles: v })} />
      </SettingItem>
      <SettingItem name="Risk halo" desc="Glow around addresses with medium risk or higher.">
        <Switch on={s.riskHalo} onChange={(v) => s.set({ riskHalo: v })} />
      </SettingItem>
      <SettingItem name="Cluster rings" desc="Colored ring shared by addresses in the same common-input cluster.">
        <Switch on={s.clusterRings} onChange={(v) => s.set({ clusterRings: v })} />
      </SettingItem>
      <Heading>Forces</Heading>
      <SettingItem name="Center force">
        <Slider value={s.centerForce} min={0} max={1} step={0.01} onChange={(v) => s.set({ centerForce: v })} format={(v) => v.toFixed(2)} />
      </SettingItem>
      <SettingItem name="Repel force">
        <Slider value={s.repelForce} min={0} max={20} step={0.1} onChange={(v) => s.set({ repelForce: v })} format={(v) => v.toFixed(1)} />
      </SettingItem>
      <SettingItem name="Link force">
        <Slider value={s.linkForce} min={0} max={1} step={0.01} onChange={(v) => s.set({ linkForce: v })} format={(v) => v.toFixed(2)} />
      </SettingItem>
      <SettingItem name="Link distance">
        <Slider value={s.linkDistance} min={10} max={250} step={1} onChange={(v) => s.set({ linkDistance: v })} />
      </SettingItem>
    </>
  )
}

function DataTab() {
  const s = useSettings()
  const [key, setKey] = useState(s.etherscanKey)
  return (
    <>
      <h2>Data sources</h2>
      <p className="setting-intro">Requests go directly from your browser to public explorers. Nothing is sent anywhere else.</p>
      <Heading>Keyless networks</Heading>
      <div className="source-list">
        {Object.values(CHAINS)
          .filter((c) => c.keyless)
          .map((c) => (
            <span key={c.id} className="source-pill">
              <i style={{ background: c.color }} />
              {c.name}
            </span>
          ))}
      </div>
      <p className="setting-desc">mempool.space · litecoinspace.org · Blockscout · TronGrid · Tronscan · Blockchair (~30 req/min) · PublicNode Solana RPC · toncenter · xrplcluster · Stellar Horizon · CoinGecko prices</p>
      <Heading>Etherscan API V2</Heading>
      <SettingItem
        name="Etherscan API key"
        desc={
          <>
            One free key unlocks {Object.values(CHAINS).filter((c) => !c.keyless).map((c) => c.name).join(', ')}. Get it at{' '}
            <a href="https://etherscan.io/myapikey" target="_blank" rel="noreferrer noopener">
              etherscan.io/myapikey
            </a>
            . Stored locally in this browser only.
          </>
        }
      >
        <input className="text mono" type="password" value={key} placeholder="Paste key" onChange={(e) => setKey(e.target.value)} />
        <button className="mod-cta" onClick={() => (s.set({ etherscanKey: key.trim() }), toast('Key saved', 'success'))}>
          Save
        </button>
      </SettingItem>
      <SettingItem name="Network for 0x addresses" desc="EVM addresses look the same on every chain. Pick where searches go by default.">
        <select className="dropdown" value={s.defaultEvm} onChange={(e) => s.set({ defaultEvm: e.target.value as typeof s.defaultEvm })}>
          {EVM_CHAINS.map((id) => (
            <option key={id} value={id}>
              {CHAINS[id].name}
              {CHAINS[id].keyless ? '' : ' (key)'}
            </option>
          ))}
        </select>
      </SettingItem>
      <SettingItem name="Request timeout" desc="Seconds before a slow explorer request is abandoned.">
        <Slider value={s.timeoutSec} min={5} max={60} step={1} onChange={(v) => s.set({ timeoutSec: v })} format={(v) => `${v}s`} />
      </SettingItem>
    </>
  )
}

function HeuristicsTab() {
  const s = useSettings()
  return (
    <>
      <h2>Heuristics</h2>
      <p className="setting-intro">Chain-analysis heuristics used by GraphSense, OXT and commercial tools. They produce leads, not proof.</p>
      <Heading>UTXO (BTC, LTC, DOGE, BCH)</Heading>
      <SettingItem name="Common-input clustering" desc="Addresses spent together in one transaction are grouped as one entity. CoinJoin transactions are excluded.">
        <Switch on={s.btcCluster} onChange={(v) => s.set({ btcCluster: v })} />
      </SettingItem>
      <SettingItem name="Change detection" desc="Marks the likely change output (address reuse, matching script type, non-round amount). Applies to newly loaded data.">
        <Switch on={s.btcChange} onChange={(v) => s.set({ btcChange: v })} />
      </SettingItem>
      <SettingItem name="CoinJoin detection" desc="Flags transactions with many equal-value outputs (Wasabi, Whirlpool, JoinMarket).">
        <Switch on={s.btcCoinjoin} onChange={(v) => s.set({ btcCoinjoin: v })} />
      </SettingItem>
      <Heading>All networks</Heading>
      <SettingItem name="Address-poisoning detector" desc="Flags pairs of addresses whose first and last 4 characters match.">
        <Switch on={s.poisoning} onChange={(v) => s.set({ poisoning: v })} />
      </SettingItem>
      <SettingItem name="Hide spam and fake tokens" desc="Symbols with URLs, spaces or handles, and USDT from non-official contracts on TRON.">
        <Switch on={s.hideSpam} onChange={(v) => s.set({ hideSpam: v })} />
      </SettingItem>
    </>
  )
}

function RiskTab() {
  const s = useSettings()
  return (
    <>
      <h2>Risk model</h2>
      <p className="setting-intro">
        Score = max(own attribution, direct exposure, ½ × indirect exposure). Each address lists every contribution in the Risk tab, so you can
        see why it scored what it did. Weights below are points for full exposure to a category.
      </p>
      {CATEGORIES.filter((c) => c !== 'unknown').map((cat) => (
        <SettingItem key={cat} name={CATEGORY_META[cat].label}>
          <Slider
            value={s.riskWeights[cat]}
            min={0}
            max={100}
            step={1}
            onChange={(v) => s.set({ riskWeights: { ...s.riskWeights, [cat]: v } })}
          />
        </SettingItem>
      ))}
      <button className="mod-ghost" onClick={() => s.set({ riskWeights: DEFAULT_RISK })}>
        Restore default weights
      </button>
    </>
  )
}

function TraceTab() {
  const s = useSettings()
  const toggle = (c: Category) => s.set({ traceStop: s.traceStop.includes(c) ? s.traceStop.filter((x) => x !== c) : [...s.traceStop, c] })
  return (
    <>
      <h2>Auto-trace</h2>
      <p className="setting-intro">Follow-the-money automation: expand an address, follow its largest outflows, repeat hop by hop.</p>
      <SettingItem name="Depth (hops)">
        <Slider value={s.traceDepth} min={1} max={6} step={1} onChange={(v) => s.set({ traceDepth: v })} />
      </SettingItem>
      <SettingItem name="Branches per hop" desc="How many of the largest flows to follow from each address.">
        <Slider value={s.traceBranches} min={1} max={8} step={1} onChange={(v) => s.set({ traceBranches: v })} />
      </SettingItem>
      <SettingItem name="Minimum share" desc="Ignore flows below this percentage of the address's outflow.">
        <Slider value={s.traceMinShare} min={0} max={50} step={1} onChange={(v) => s.set({ traceMinShare: v })} format={(v) => `${v}%`} />
      </SettingItem>
      <SettingItem name="Chronological" desc="Only follow flows that happened after the funds arrived at the address.">
        <Switch on={s.traceChrono} onChange={(v) => s.set({ traceChrono: v })} />
      </SettingItem>
      <SettingItem name="Stop at" desc="Stop a branch when it reaches one of these categories." stack>
        <div className="chips">
          {CATEGORIES.filter((c) => c !== 'unknown').map((c) => (
            <button key={c} className={'chip' + (s.traceStop.includes(c) ? ' on' : '')} style={{ ['--c' as string]: CATEGORY_META[c].color }} onClick={() => toggle(c)}>
              {CATEGORY_META[c].label}
            </button>
          ))}
        </div>
      </SettingItem>
    </>
  )
}

function WatchTab() {
  const s = useSettings()
  return (
    <>
      <h2>Watchlist & alerts</h2>
      <p className="setting-intro">Watched addresses are re-checked while ChainGraph is open. New transfers raise an alert.</p>
      <SettingItem name="Check interval">
        <Slider value={s.watchIntervalMin} min={1} max={60} step={1} onChange={(v) => s.set({ watchIntervalMin: v })} format={(v) => `${v} min`} />
      </SettingItem>
      <SettingItem name="Desktop notifications">
        <Switch
          on={s.watchNotify}
          onChange={async (v) => {
            if (v && 'Notification' in window && Notification.permission !== 'granted') await Notification.requestPermission()
            s.set({ watchNotify: v })
          }}
        />
      </SettingItem>
    </>
  )
}

function LabelsTab() {
  const s = useSettings()
  const file = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState({ address: '', label: '', category: 'exchange' as Category })
  const list = s.labels.filter((l) => !q || `${l.address} ${l.label} ${l.category}`.toLowerCase().includes(q.toLowerCase()))
  const exportCsv = () => download('chaingraph-labels.csv', ['address,label,category,chain', ...s.labels.map((l) => `${l.address},${l.label.replace(/,/g, ' ')},${l.category},${l.chain ?? ''}`)].join('\n'), 'text/csv')
  return (
    <>
      <h2>Label library</h2>
      <p className="setting-intro">
        Your own attribution database, applied to every case (like GraphSense TagPacks). CSV format: <code>address,label,category,chain</code>.
      </p>
      <div className="row gap6 mb12">
        <button className="mod-cta" onClick={() => file.current?.click()}>
          <Upload size={14} /> Import CSV
        </button>
        <button className="mod-ghost" onClick={exportCsv} disabled={!s.labels.length}>
          <Download size={14} /> Export
        </button>
        <span className="grow" />
        <span className="muted small">{s.labels.length} labels</span>
        <input
          ref={file}
          type="file"
          accept=".csv,.txt"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            const parsed = parseLabelCsv(await f.text())
            const map = new Map(s.labels.map((l) => [l.address.toLowerCase(), l]))
            for (const l of parsed) map.set(l.address.toLowerCase(), l)
            s.set({ labels: [...map.values()] })
            toast(`Imported ${parsed.length} labels`, 'success')
            e.target.value = ''
          }}
        />
      </div>
      <div className="label-add">
        <input className="text mono" placeholder="Address" value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
        <input className="text" placeholder="Label" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
        <select className="dropdown" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as Category })}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_META[c].label}
            </option>
          ))}
        </select>
        <button
          className="mod-cta"
          disabled={!draft.address.trim() || !draft.label.trim()}
          onClick={() => {
            s.set({ labels: [...s.labels.filter((l) => l.address.toLowerCase() !== draft.address.trim().toLowerCase()), { ...draft, address: draft.address.trim() }] })
            setDraft({ ...draft, address: '', label: '' })
          }}
        >
          Add
        </button>
      </div>
      <input className="text full mb8" placeholder="Filter labels…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="label-table">
        {list.slice(0, 400).map((l) => (
          <div key={l.address} className="label-row">
            <i style={{ background: CATEGORY_META[l.category].color }} />
            <span className="ellipsis">{l.label}</span>
            <code className="ellipsis">{l.address}</code>
            <span className="muted small">{CATEGORY_META[l.category].label}</span>
            <button className="clickable-icon" onClick={() => s.set({ labels: s.labels.filter((x) => x !== l) })}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {!list.length && <div className="muted small pad">No labels yet.</div>}
      </div>
    </>
  )
}

function HotkeysTab() {
  return (
    <>
      <h2>Hotkeys</h2>
      <p className="setting-intro">Mod is ⌘ on macOS and Ctrl elsewhere.</p>
      {HOTKEYS.map(([k, d]) => (
        <SettingItem key={k} name={d}>
          <Kbd k={k} />
        </SettingItem>
      ))}
    </>
  )
}

function StorageTab() {
  const cases = useCases()
  return (
    <>
      <h2>Storage</h2>
      <p className="setting-intro">Cases live in this browser's IndexedDB. Settings live in localStorage. Nothing is uploaded.</p>
      <SettingItem name="Back up all cases" desc="Download every case as one JSON file.">
        <button className="mod-ghost" onClick={() => download('chaingraph-backup.json', JSON.stringify(Object.values(cases.cases)))}>
          <Download size={14} /> Export all
        </button>
      </SettingItem>
      <SettingItem name="Delete all data" desc="Removes every case and resets settings. This cannot be undone.">
        <button
          className="mod-warning"
          onClick={async () => {
            if (!confirm('Delete all cases and settings?')) return
            await idbDel('chaingraph.db.v2')
            localStorage.removeItem('chaingraph.settings')
            localStorage.removeItem('chaingraph.v1')
            location.reload()
          }}
        >
          <Trash2 size={14} /> Delete everything
        </button>
      </SettingItem>
    </>
  )
}

function AboutTab() {
  return (
    <>
      <h2>About ChainGraph</h2>
      <p className="setting-intro">
        Open, client-side crypto investigation workspace. Feature set modeled on Chainalysis Reactor, TRM Forensics, Arkham, Breadcrumbs,
        MetaSleuth and GraphSense, with the interaction model of Obsidian. See <code>docs/RESEARCH.md</code> for the methodology.
      </p>
      <p className="setting-intro">
        ChainGraph maps flows between addresses using public blockchain data. Attribution is heuristic. It does not identify owners: identity
        can only be established through the relevant service (for example, exchange KYC) via lawful process.
      </p>
    </>
  )
}
