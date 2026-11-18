import { ChevronRight, FilePlus2, Files, FolderClosed, FolderOpen, Hash, Search, Star, Trash2, Upload } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { CHAINS } from '../chains'
import { graphApi } from '../commands'
import { useD } from '../derived'
import { CATEGORY_META } from '../entities'
import { short } from '../format'
import { select, toast, useCases, useUI, type LeftPane } from '../store'
import { TAGS, type Case, type CaseNode, type TagId } from '../types'
import { IconBtn } from './ui'

export function LeftSidebar() {
  const ui = useUI()
  const tabs: [LeftPane, React.ReactNode, string][] = [
    ['files', <Files size={16} />, 'Cases'],
    ['search', <Search size={16} />, 'Search all cases'],
    ['starred', <Star size={16} />, 'Starred'],
    ['tags', <Hash size={16} />, 'Tags & categories'],
  ]
  return (
    <aside className="side-dock left">
      <div className="dock-header">
        {tabs.map(([k, icon, title]) => (
          <IconBtn key={k} title={title} active={ui.leftPane === k} onClick={() => ui.set({ leftPane: k })}>
            {icon}
          </IconBtn>
        ))}
      </div>
      <div className="dock-content">
        {ui.leftPane === 'files' && <Vault />}
        {ui.leftPane === 'search' && <SearchPane />}
        {ui.leftPane === 'starred' && <StarredPane />}
        {ui.leftPane === 'tags' && <TagsPane />}
      </div>
    </aside>
  )
}

const label = (n: CaseNode) => n.alias || n.info?.name || short(n.address, 7, 5)

function openNode(caseId: string, id: string) {
  const cs = useCases.getState()
  if (cs.activeId !== caseId) cs.open(caseId)
  select(id)
  setTimeout(() => graphApi.current?.focus(id), cs.activeId !== caseId ? 400 : 0)
}

function NodeRow({ c, n, depth = 2 }: { c: Case; n: CaseNode; depth?: number }) {
  const selected = useUI((s) => s.selected)
  return (
    <div className={'nav-file' + (selected === n.id ? ' is-active' : '')} style={{ paddingLeft: depth * 12 }} onClick={() => openNode(c.id, n.id)} title={n.address}>
      <i className="dot" style={{ background: n.tags.length ? TAGS[n.tags[0]].color : CHAINS[n.chain].color }} />
      <span className="ellipsis">{label(n)}</span>
      {n.starred && <Star size={11} className="muted" fill="currentColor" />}
    </div>
  )
}

function Vault() {
  const cs = useCases()
  const file = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const isOpen = (id: string) => open[id] ?? id === cs.activeId
  return (
    <>
      <div className="nav-header">
        <IconBtn title="New case" onClick={() => cs.create()}>
          <FilePlus2 size={15} />
        </IconBtn>
        <IconBtn title="Import case (JSON)" onClick={() => file.current?.click()}>
          <Upload size={15} />
        </IconBtn>
        <input
          ref={file}
          type="file"
          accept=".json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            try {
              const data = JSON.parse(await f.text())
              const list = Array.isArray(data) ? data : [data]
              for (const c of list) {
                if (!c.nodes || !c.transfers) throw new Error()
                cs.importCase(c)
              }
              toast(`Imported ${list.length} case(s)`, 'success')
            } catch {
              toast('Not a ChainGraph export')
            }
            e.target.value = ''
          }}
        />
      </div>
      <div className="nav-tree">
        {cs.order.map((id) => {
          const c = cs.cases[id]
          if (!c) return null
          const o = isOpen(id)
          const nodes = Object.values(c.nodes)
          const investigated = nodes.filter((n) => n.expanded)
          const annotated = nodes.filter((n) => !n.expanded && (n.alias || n.tags.length || n.note || n.starred))
          return (
            <div key={id}>
              <div
                className={'nav-folder' + (id === cs.activeId ? ' is-active' : '')}
                onClick={() => {
                  cs.open(id)
                  setOpen({ ...open, [id]: id === cs.activeId ? !o : true })
                }}
              >
                <ChevronRight size={13} className={'chev' + (o ? ' open' : '')} />
                {o ? <FolderOpen size={14} /> : <FolderClosed size={14} />}
                <span className="ellipsis grow">{c.title}</span>
                <span className="count">{nodes.length}</span>
                <button
                  className="clickable-icon hover-only"
                  title="Delete case"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirm(`Delete “${c.title}” permanently?`)) cs.remove(id)
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
              {o && (
                <>
                  {investigated.map((n) => (
                    <NodeRow key={n.id} c={c} n={n} />
                  ))}
                  {annotated.length > 0 && <div className="nav-sub">Annotated</div>}
                  {annotated.map((n) => (
                    <NodeRow key={n.id} c={c} n={n} />
                  ))}
                  {!nodes.length && <div className="nav-empty">Empty case</div>}
                </>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

function SearchPane() {
  const cs = useCases()
  const [q, setQ] = useState('')
  const results = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (t.length < 2) return []
    const out: { c: Case; n: CaseNode; where: string }[] = []
    for (const c of Object.values(cs.cases)) {
      for (const n of Object.values(c.nodes)) {
        const hit =
          n.address.toLowerCase().includes(t) ? 'address' : n.alias?.toLowerCase().includes(t) ? 'alias' : n.info?.name?.toLowerCase().includes(t) ? 'label' : n.note.toLowerCase().includes(t) ? 'note' : n.info?.apiTags?.some((x) => x.toLowerCase().includes(t)) ? 'tag' : null
        if (hit) out.push({ c, n, where: hit })
        if (out.length > 200) return out
      }
    }
    return out
  }, [q, cs.cases])
  return (
    <div className="pane-pad">
      <input className="text full" autoFocus placeholder="Search addresses, aliases, labels, notes…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="muted small mt6">{q.trim().length >= 2 ? `${results.length} result(s) across all cases` : 'Type at least 2 characters'}</div>
      {results.map(({ c, n, where }) => (
        <div key={c.id + n.id} className="search-result" onClick={() => openNode(c.id, n.id)}>
          <div className="ellipsis">{label(n)}</div>
          <div className="muted small ellipsis">
            {c.title} · {where}
          </div>
        </div>
      ))}
    </div>
  )
}

function StarredPane() {
  const cs = useCases()
  const items = Object.values(cs.cases).flatMap((c) => Object.values(c.nodes).filter((n) => n.starred).map((n) => ({ c, n })))
  return (
    <div className="pane-pad">
      {items.map(({ c, n }) => (
        <div key={c.id + n.id} className="search-result" onClick={() => openNode(c.id, n.id)}>
          <div className="ellipsis">{label(n)}</div>
          <div className="muted small ellipsis">{c.title}</div>
        </div>
      ))}
      {!items.length && <div className="empty-pane">Star important addresses to pin them here.</div>}
    </div>
  )
}

function TagsPane() {
  const d = useD()
  const [pick, setPick] = useState<string | null>(null)
  const nodes = Object.values(d.c?.nodes ?? {})
  const tagCounts = (Object.keys(TAGS) as TagId[]).map((t) => [t, nodes.filter((n) => n.tags.includes(t)).length] as const).filter(([, n]) => n)
  const catCounts = Object.entries(
    nodes.reduce<Record<string, number>>((m, n) => {
      const c = d.attr.get(n.id)?.category ?? 'unknown'
      if (c !== 'unknown') m[c] = (m[c] ?? 0) + 1
      return m
    }, {}),
  ).sort((a, b) => b[1] - a[1])
  const list = pick
    ? nodes.filter((n) => (pick.startsWith('tag:') ? n.tags.includes(pick.slice(4) as TagId) : d.attr.get(n.id)?.category === pick.slice(4)))
    : []
  return (
    <div className="pane-pad">
      <div className="nav-sub">Tags</div>
      {tagCounts.map(([t, n]) => (
        <div key={t} className={'tag-row' + (pick === `tag:${t}` ? ' is-active' : '')} onClick={() => setPick(pick === `tag:${t}` ? null : `tag:${t}`)}>
          <span style={{ color: TAGS[t].color }}>#{TAGS[t].label}</span>
          <span className="count">{n}</span>
        </div>
      ))}
      {!tagCounts.length && <div className="nav-empty">No tags in this case</div>}
      <div className="nav-sub">Categories</div>
      {catCounts.map(([c, n]) => (
        <div key={c} className={'tag-row' + (pick === `cat:${c}` ? ' is-active' : '')} onClick={() => setPick(pick === `cat:${c}` ? null : `cat:${c}`)}>
          <span>
            <i className="dot" style={{ background: CATEGORY_META[c as keyof typeof CATEGORY_META].color }} /> {CATEGORY_META[c as keyof typeof CATEGORY_META].label}
          </span>
          <span className="count">{n}</span>
        </div>
      ))}
      {list.length > 0 && <div className="nav-sub">Matching</div>}
      {list.map((n) => (
        <NodeRow key={n.id} c={d.c} n={n} depth={1} />
      ))}
    </div>
  )
}
