import { autoTrace, clearTrace, expand, expandMixers, expandNeighbors, findFunder, followPeelChain } from './actions'
import type { GraphHandle } from './components/Graph'
import type { Derived } from './derived'
import { download } from './format'
import { patchNode } from './model'
import { markdownReport, obsidianVault, transfersCsv } from './report'
import { useSettings } from './settings'
import { redo, toast, undo, useCases, useUI } from './store'

/** Imperative handle to the graph, set by <App/>. */
export const graphApi: { current: GraphHandle | null } = { current: null }

export interface Command {
  id: string
  name: string
  hotkey?: string
  run: () => void
  when?: () => boolean
}

const sel = () => useUI.getState().selected
const cid = () => useCases.getState().activeId
const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_')

export function buildCommands(d: Derived): Command[] {
  const ui = useUI.getState()
  const st = useSettings.getState()
  const c = d.c
  const ctx = { c, edges: d.edgesAll, attr: d.attr, risk: d.risk, findings: d.findings }
  return [
    { id: 'new-case', name: 'Case: New case', run: () => useCases.getState().create() },
    { id: 'switcher', name: 'Quick switcher: Jump to address', hotkey: 'Mod+O', run: () => ui.set({ modal: 'switcher' }) },
    { id: 'settings', name: 'Settings: Open settings', hotkey: 'Mod+,', run: () => ui.set({ modal: 'settings' }) },
    { id: 'search', name: 'Search: Focus address search', hotkey: 'Mod+K', run: () => document.getElementById('addr-search')?.focus() },
    { id: 'expand', name: 'Address: Expand / load more', hotkey: 'E', when: () => !!sel(), run: () => void expand(sel()!) },
    { id: 'trace-out', name: 'Trace: Auto-trace outflows from selected', hotkey: 'T', when: () => !!sel(), run: () => void autoTrace(sel()!, 'out') },
    { id: 'trace-in', name: 'Trace: Trace inflows (sources of funds)', when: () => !!sel(), run: () => void autoTrace(sel()!, 'in') },
    { id: 'insights', name: 'Analysis: Open obfuscation analysis', hotkey: 'I', run: () => ui.set({ rightOpen: true, rightPane: 'insights' }) },
    { id: 'mixers', name: 'Analysis: Load mixer histories for demixing', run: () => void expandMixers() },
    { id: 'peel', name: 'Analysis: Follow peel chain from selected', when: () => !!sel(), run: () => void followPeelChain(sel()!) },
    { id: 'funder', name: 'Analysis: Find first funder of selected', when: () => !!sel(), run: () => void findFunder(sel()!) },
    { id: 'neighbors', name: 'Address: Expand top 5 counterparties', when: () => !!sel(), run: () => void expandNeighbors(sel()!) },
    { id: 'link', name: 'Analysis: Link selected with another address as same owner…', when: () => !!sel(), run: () => (ui.set({ linkFrom: sel() }), toast('Shift+click the other address', 'info')) },
    { id: 'hide', name: 'Address: Toggle hidden', when: () => !!sel(), run: () => useCases.getState().update(cid(), (x) => patchNode(x, sel()!, { hidden: !x.nodes[sel()!]?.hidden })) },
    { id: 'osint', name: 'OSINT: Open toolkit', hotkey: 'O', run: () => ui.set({ view: 'osint' }) },
    ...(['phone', 'username', 'email', 'geo', 'image', 'domain', 'ip', 'dork', 'directory'] as const).map((t) => ({
      id: `osint-${t}`,
      name: `OSINT: ${{ phone: 'Phone number lookup', username: 'Username search', email: 'Email investigation', geo: 'GEOINT map', image: 'Image forensics (EXIF, ELA)', domain: 'Domain & DNS', ip: 'IP address', dork: 'Search operator builder', directory: 'Tool directory' }[t]}`,
      run: () => ui.set({ view: 'osint', osintTab: t, osintSeed: '' }),
    })),
    { id: 'bulk', name: 'Case: Bulk import addresses', hotkey: 'B', run: () => ui.set({ modal: 'bulk' }) },
    { id: 'undo', name: 'Edit: Undo', hotkey: 'Mod+Z', run: undo },
    { id: 'redo', name: 'Edit: Redo', hotkey: 'Mod+Shift+Z', run: redo },
    { id: 'trace-clear', name: 'Trace: Clear highlighted traces and paths', run: clearTrace },
    { id: 'path', name: 'Trace: Find path from selected… (then Shift+click target)', when: () => !!sel(), run: () => (ui.set({ pathFrom: sel() }), toast('Shift+click the target address', 'info')) },
    { id: 'star', name: 'Address: Toggle star', when: () => !!sel(), run: () => useCases.getState().update(cid(), (x) => patchNode(x, sel()!, { starred: !x.nodes[sel()!]?.starred })) },
    { id: 'watch', name: 'Address: Toggle watch (alerts)', when: () => !!sel(), run: () => useCases.getState().update(cid(), (x) => patchNode(x, sel()!, { watch: !x.nodes[sel()!]?.watch })) },
    { id: 'local', name: 'Graph: Toggle local graph', hotkey: 'L', run: () => ui.set({ localGraph: !useUI.getState().localGraph }) },
    { id: 'fit', name: 'Graph: Fit to screen', hotkey: 'F', run: () => graphApi.current?.fit() },
    { id: 'controls', name: 'Graph: Toggle graph settings panel', hotkey: 'G', run: () => ui.set({ graphControlsOpen: !useUI.getState().graphControlsOpen }) },
    { id: 'timeline', name: 'Graph: Toggle timeline', run: () => ui.set({ timelineOpen: !useUI.getState().timelineOpen }) },
    { id: 'layout-force', name: 'Layout: Force-directed', run: () => st.set({ layout: 'force' }) },
    { id: 'layout-lr', name: 'Layout: Flow left → right', run: () => st.set({ layout: 'lr' }) },
    { id: 'layout-td', name: 'Layout: Flow top → down', run: () => st.set({ layout: 'td' }) },
    { id: 'layout-radial', name: 'Layout: Radial', run: () => st.set({ layout: 'radial' }) },
    { id: 'color-chain', name: 'Color nodes by network', run: () => st.set({ colorBy: 'chain' }) },
    { id: 'color-cat', name: 'Color nodes by category', run: () => st.set({ colorBy: 'category' }) },
    { id: 'color-risk', name: 'Color nodes by risk', run: () => st.set({ colorBy: 'risk' }) },
    { id: 'left', name: 'View: Toggle left sidebar', hotkey: 'Mod+\\', run: () => ui.set({ leftOpen: !useUI.getState().leftOpen }) },
    { id: 'right', name: 'View: Toggle right sidebar', hotkey: 'Mod+Shift+\\', run: () => ui.set({ rightOpen: !useUI.getState().rightOpen }) },
    { id: 'export-md', name: 'Export: Markdown report', run: () => c && download(`${safe(c.title)}.md`, markdownReport(ctx), 'text/markdown') },
    { id: 'export-vault', name: 'Export: Obsidian vault (.zip)', run: () => c && download(`${safe(c.title)}-vault.zip`, obsidianVault(ctx)) },
    { id: 'export-csv', name: 'Export: Transfers CSV (legal request format)', run: () => c && download(`${safe(c.title)}.csv`, transfersCsv(c), 'text/csv') },
    { id: 'export-json', name: 'Export: Case JSON', run: () => c && download(`${safe(c.title)}.chaingraph.json`, JSON.stringify(c)) },
    {
      id: 'export-png',
      name: 'Export: Graph PNG',
      run: () => {
        const url = graphApi.current?.png()
        if (!url || !c) return
        const a = document.createElement('a')
        a.href = url
        a.download = `${safe(c.title)}.png`
        a.click()
      },
    },
    { id: 'theme-amoled', name: 'Theme: AMOLED Black', run: () => st.set({ theme: 'amoled' }) },
    { id: 'theme-obsidian', name: 'Theme: Obsidian Dark', run: () => st.set({ theme: 'obsidian' }) },
    { id: 'theme-light', name: 'Theme: Obsidian Light', run: () => st.set({ theme: 'obsidian-light' }) },
  ]
}
