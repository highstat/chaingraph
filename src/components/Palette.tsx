import { useEffect, useMemo, useRef, useState } from 'react'
import { investigate } from '../actions'
import { CHAINS, detectChain } from '../chains'
import { buildCommands, graphApi } from '../commands'
import { useD } from '../derived'
import { short } from '../format'
import { useSettings } from '../settings'
import { select, useUI } from '../store'
import { Kbd } from './ui'

/** Fuzzy subsequence match with a simple score (lower is better). */
function fuzzy(q: string, s: string): number | null {
  if (!q) return 0
  const a = q.toLowerCase()
  const b = s.toLowerCase()
  const direct = b.indexOf(a)
  if (direct >= 0) return direct
  let i = 0
  let score = 100
  for (let j = 0; j < b.length && i < a.length; j++) if (b[j] === a[i]) (i++, (score += j))
  return i === a.length ? score : null
}

interface Item {
  key: string
  title: string
  sub?: string
  hotkey?: string
  dot?: string
  run: () => void
}

/** Obsidian command palette (mode "palette") and quick switcher (mode "switcher"). */
export function Palette({ mode }: { mode: 'palette' | 'switcher' }) {
  const d = useD()
  const ui = useUI()
  const evm = useSettings((s) => s.defaultEvm)
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const close = () => ui.set({ modal: null })

  const items = useMemo<Item[]>(() => {
    if (mode === 'palette') {
      return buildCommands(d)
        .filter((c) => !c.when || c.when())
        .map((c) => ({ key: c.id, title: c.name, hotkey: c.hotkey, run: c.run }))
    }
    const nodes = Object.values(d.c?.nodes ?? {}).map((n) => ({
      key: n.id,
      title: n.alias || n.info?.name || d.attr.get(n.id)?.label || short(n.address, 10, 8),
      sub: `${CHAINS[n.chain].name} · ${n.address}`,
      dot: CHAINS[n.chain].color,
      run: () => {
        select(n.id)
        graphApi.current?.focus(n.id)
      },
    }))
    const chain = detectChain(q, evm)
    if (chain && !nodes.some((n) => n.key.endsWith(q.trim().toLowerCase()) || n.key.endsWith(q.trim()))) {
      nodes.unshift({ key: 'new', title: `Investigate ${short(q.trim(), 10, 8)}`, sub: `New address on ${CHAINS[chain].name}`, dot: CHAINS[chain].color, run: () => investigate(q) })
    }
    return nodes
  }, [mode, d, q, evm])

  const filtered = useMemo(() => {
    if (mode === 'switcher' && items[0]?.key === 'new') return items
    return items
      .map((it) => ({ it, s: fuzzy(q, `${it.title} ${it.sub ?? ''}`) }))
      .filter((x) => x.s != null)
      .sort((a, b) => a.s! - b.s!)
      .map((x) => x.it)
      .slice(0, 80)
  }, [items, q, mode])

  useEffect(() => setIdx(0), [q])
  useEffect(() => {
    list.current?.children[idx]?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  const run = (it?: Item) => {
    if (!it) return
    close()
    it.run()
  }

  return (
    <div className="modal-bg top" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="prompt">
        <input
          autoFocus
          className="prompt-input"
          placeholder={mode === 'palette' ? 'Type a command…' : 'Find an address in this case, or paste a new one…'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setIdx((i) => Math.min(i + 1, filtered.length - 1)))
            else if (e.key === 'ArrowUp') (e.preventDefault(), setIdx((i) => Math.max(i - 1, 0)))
            else if (e.key === 'Enter') run(filtered[idx])
            else if (e.key === 'Escape') close()
          }}
        />
        <div className="prompt-results" ref={list}>
          {filtered.map((it, i) => (
            <div key={it.key} className={'suggestion' + (i === idx ? ' is-selected' : '')} onMouseEnter={() => setIdx(i)} onClick={() => run(it)}>
              {it.dot && <i className="dot" style={{ background: it.dot }} />}
              <div className="suggestion-content">
                <div className="suggestion-title">{it.title}</div>
                {it.sub && <div className="suggestion-note">{it.sub}</div>}
              </div>
              {it.hotkey && <Kbd k={it.hotkey} />}
            </div>
          ))}
          {!filtered.length && <div className="suggestion empty">No matches</div>}
        </div>
        <div className="prompt-instructions">
          <span>
            <kbd>↑↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> {mode === 'palette' ? 'run' : 'open'}
          </span>
          <span>
            <kbd>esc</kbd> dismiss
          </span>
        </div>
      </div>
    </div>
  )
}
