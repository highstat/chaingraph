import { ArrowDownToLine, Coins, Copy, ExternalLink, Eye, EyeOff, GitBranch, Link2, Locate, Route, Scissors, Star, Trash2, Users, Waypoints, Workflow } from 'lucide-react'
import { useEffect } from 'react'
import { addLink, autoTrace, expand, expandNeighbors, findFunder, followPeelChain } from '../actions'
import { CHAINS } from '../chains'
import { graphApi } from '../commands'
import { patchNode, removeNode } from '../model'
import { select, toast, useCases, useUI } from '../store'
import { TAGS, type TagId } from '../types'

export interface MenuState {
  id: string
  x: number
  y: number
}

export function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const cases = useCases()
  const c = cases.cases[cases.activeId]
  const n = c?.nodes[menu.id]
  const selected = useUI((s) => s.selected)
  useEffect(() => {
    const h = () => onClose()
    window.addEventListener('mousedown', h)
    window.addEventListener('blur', h)
    return () => {
      window.removeEventListener('mousedown', h)
      window.removeEventListener('blur', h)
    }
  }, [onClose])
  if (!n) return null
  const patch = (p: Parameters<typeof patchNode>[2]) => cases.update(c.id, (x) => patchNode(x, n.id, p))
  const item = (icon: React.ReactNode, label: string, fn: () => void, cls = '') => (
    <div
      className={'menu-item ' + cls}
      onMouseDown={(e) => {
        e.stopPropagation()
        onClose()
        fn()
      }}
    >
      <span className="menu-icon">{icon}</span>
      {label}
    </div>
  )
  const style = { left: Math.min(menu.x, window.innerWidth - 260), top: Math.max(8, Math.min(menu.y, window.innerHeight - 560)) }
  return (
    <div className="menu" style={style} onMouseDown={(e) => e.stopPropagation()}>
      {item(<GitBranch size={14} />, n.expanded ? (n.cursor ? 'Load more history' : 'Fully loaded') : 'Expand', () => void expand(n.id))}
      {item(<Workflow size={14} />, 'Auto-trace outflows', () => void autoTrace(n.id, 'out'))}
      {item(<ArrowDownToLine size={14} />, 'Trace inflows (source of funds)', () => void autoTrace(n.id, 'in'))}
      {item(<Users size={14} />, 'Expand top 5 counterparties', () => void expandNeighbors(n.id))}
      {CHAINS[n.chain].family === 'utxo'
        ? item(<Scissors size={14} />, 'Follow peel chain', () => void followPeelChain(n.id))
        : item(<Coins size={14} />, 'Find first funder', () => void findFunder(n.id))}
      {selected && selected !== n.id && item(<Link2 size={14} />, 'Link with selected as same owner', () => (addLink(selected, n.id, 'same-owner', 'Manual link'), toast('Linked as same owner', 'success')))}
      {item(<Route size={14} />, 'Find path from here…', () => (useUI.getState().set({ pathFrom: n.id }), toast('Shift+click the target address', 'info')))}
      {item(<Waypoints size={14} />, 'Open local graph', () => (select(n.id), useUI.getState().set({ localGraph: true })))}
      {item(<Locate size={14} />, 'Center on node', () => graphApi.current?.focus(n.id))}
      <div className="menu-sep" />
      {item(<Star size={14} />, n.starred ? 'Unstar' : 'Star', () => patch({ starred: !n.starred }))}
      {item(<Eye size={14} />, n.watch ? 'Stop watching' : 'Watch for new transfers', () => patch({ watch: !n.watch }))}
      {item(<EyeOff size={14} />, n.hidden ? 'Unhide' : 'Hide from graph', () => patch({ hidden: !n.hidden }))}
      <div className="menu-tags">
        {(Object.keys(TAGS) as TagId[]).map((t) => (
          <button
            key={t}
            className={'tag' + (n.tags.includes(t) ? ' on' : '')}
            style={{ ['--c' as string]: TAGS[t].color }}
            onMouseDown={(e) => {
              e.stopPropagation()
              patch({ tags: n.tags.includes(t) ? n.tags.filter((x) => x !== t) : [...n.tags, t] })
            }}
          >
            #{TAGS[t].label}
          </button>
        ))}
      </div>
      <div className="menu-sep" />
      {item(<Copy size={14} />, 'Copy address', () => navigator.clipboard.writeText(n.address))}
      {item(<ExternalLink size={14} />, `Open in ${CHAINS[n.chain].name} explorer`, () => window.open(CHAINS[n.chain].explorer(n.address), '_blank', 'noopener'))}
      {item(<Trash2 size={14} />, 'Remove from case', () => (cases.update(c.id, (x) => removeNode(x, n.id)), select(null)), 'danger')}
    </div>
  )
}
