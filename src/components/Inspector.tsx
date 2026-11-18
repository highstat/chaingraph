import { Copy, ExternalLink, Eye, GitBranch, Pin, Star, Trash2, Workflow } from 'lucide-react'
import { useMemo, useState } from 'react'
import { autoTrace, expand, expandNeighbors, findFunder, followPeelChain, investigate } from '../actions'
import { LEVEL_COLOR } from '../analysis'
import { CHAINS } from '../chains'
import { graphApi } from '../commands'
import { useD } from '../derived'
import { CATEGORIES, CATEGORY_META } from '../entities'
import { amt, date, day, short, usd } from '../format'
import { renderNote } from '../markdown'
import { nodeId, patchNode, removeNode } from '../model'
import { select, useCases, useUI } from '../store'
import type { CaseNode, Category, TagId } from '../types'
import { TAGS } from '../types'
import { ActivityChart } from './ActivityChart'
import { Behavior } from './Behavior'
import { IconBtn } from './ui'

type Tab = 'overview' | 'risk' | 'flows' | 'tx' | 'behavior' | 'note'

export function Inspector({ node }: { node: CaseNode }) {
  const d = useD()
  const ui = useUI()
  const update = useCases((s) => s.update)
  const [tab, setTab] = useState<Tab>('overview')
  const [editing, setEditing] = useState(false)
  const c = d.c
  const chain = CHAINS[node.chain]
  const a = d.attr.get(node.id)
  const r = d.risk.get(node.id)
  const loading = ui.loading.has(node.id)
  const patch = (p: Partial<CaseNode>) => update(c.id, (x) => patchNode(x, node.id, p))

  const transfers = useMemo(
    () => d.transfers.filter((t) => t.chain === node.chain && (t.from === node.address || t.to === node.address)),
    [d.transfers, node.chain, node.address],
  )
  const assets = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of transfers) m.set(t.asset, (m.get(t.asset) ?? 0) + 1)
    return [...m.entries()].sort((x, y) => y[1] - x[1]).map(([k]) => k)
  }, [transfers])
  const [pick, setPick] = useState<string | null>(null)
  const asset = pick && assets.includes(pick) ? pick : assets[0]

  const totals = useMemo(() => {
    let inA = 0, outA = 0, first = Infinity, last = 0
    for (const t of transfers) {
      first = Math.min(first, t.time)
      last = Math.max(last, t.time)
      if (t.asset !== asset) continue
      if (t.to === node.address) inA += t.amount
      else outA += t.amount
    }
    return { inA, outA, first, last }
  }, [transfers, asset, node.address])

  const counterparties = useMemo(() => {
    const m = new Map<string, { addr: string; in: number; out: number; n: number }>()
    for (const t of transfers) {
      if (t.asset !== asset) continue
      const other = t.from === node.address ? t.to : t.from
      const row = m.get(other) ?? { addr: other, in: 0, out: 0, n: 0 }
      if (t.to === node.address) row.in += t.amount
      else row.out += t.amount
      row.n++
      m.set(other, row)
    }
    return [...m.values()].sort((x, y) => y.in + y.out - (x.in + x.out))
  }, [transfers, asset, node.address])

  const cluster = d.clusters.of.get(node.id)
  const members = cluster ? d.clusters.members.get(cluster)! : []
  const look = d.lookalikes.filter((p) => p.includes(node.id)).map((p) => (p[0] === node.id ? p[1] : p[0]))
  const price = asset ? c.prices[asset] : undefined

  const nameOf = (addr: string) => {
    const id = nodeId(node.chain, addr)
    const n = c.nodes[id]
    return n?.alias || n?.info?.name || d.attr.get(id)?.label || short(addr)
  }
  const go = (id: string) => {
    select(id)
    graphApi.current?.focus(id)
  }
  const toggleTag = (t: TagId) => patch({ tags: node.tags.includes(t) ? node.tags.filter((x) => x !== t) : [...node.tags, t] })

  return (
    <div className="inspector">
      <div className="insp-head">
        <div className="row gap6 small">
          <span className="chain-dot" style={{ background: chain.color }} />
          <span className="muted">{chain.name}</span>
          {node.info?.isContract && <span className="pill">contract</span>}
          {a && a.category !== 'unknown' && (
            <span className="pill" style={{ color: CATEGORY_META[a.category].color, borderColor: CATEGORY_META[a.category].color + '66' }}>
              {CATEGORY_META[a.category].label}
            </span>
          )}
          <span className="grow" />
          <IconBtn title={node.starred ? 'Unstar' : 'Star'} active={node.starred} onClick={() => patch({ starred: !node.starred })}>
            <Star size={15} fill={node.starred ? 'currentColor' : 'none'} />
          </IconBtn>
          <IconBtn title={node.watch ? 'Stop watching' : 'Watch for new transfers'} active={node.watch} onClick={() => patch({ watch: !node.watch })}>
            <Eye size={15} />
          </IconBtn>
          <IconBtn title={node.pinned ? 'Unpin position' : 'Pin position'} active={!!node.pinned} onClick={() => patch({ pinned: node.pinned ? undefined : graphApi.current?.pos(node.id) ?? undefined })}>
            <Pin size={15} />
          </IconBtn>
        </div>
        <input className="alias" placeholder={node.info?.name || a?.label || 'Untitled — add an alias'} value={node.alias ?? ''} onChange={(e) => patch({ alias: e.target.value || undefined })} />
        <div className="addr-line">
          <code title={node.address}>{node.address}</code>
          <IconBtn title="Copy address" onClick={() => navigator.clipboard.writeText(node.address)}>
            <Copy size={13} />
          </IconBtn>
          <a className="clickable-icon" title="Open in explorer" href={chain.explorer(node.address)} target="_blank" rel="noreferrer noopener">
            <ExternalLink size={13} />
          </a>
        </div>
        {r && (
          <div className="risk-bar" onClick={() => setTab('risk')} title="Open risk breakdown">
            <span className="risk-score" style={{ color: LEVEL_COLOR[r.level] }}>
              {r.score}
            </span>
            <div className="risk-track">
              <div style={{ width: `${r.score}%`, background: LEVEL_COLOR[r.level] }} />
            </div>
            <span className="small" style={{ color: LEVEL_COLOR[r.level] }}>
              {r.level} risk
            </span>
          </div>
        )}
        {node.info?.isScam && <div className="callout danger">Explorer flags this address as scam</div>}
        {look.map((id) => (
          <div key={id} className="callout warn" onClick={() => go(id)}>
            Lookalike address in case: <code>{short(c.nodes[id]?.address ?? id, 8, 6)}</code> — possible address poisoning
          </div>
        ))}
        {!!node.info?.apiTags?.length && (
          <div className="row wrap gap4">
            {node.info.apiTags.map((t, i) => (
              <span key={t + i} className="pill src">
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="row wrap gap4">
          {(Object.keys(TAGS) as TagId[]).map((t) => (
            <button key={t} className={'tag' + (node.tags.includes(t) ? ' on' : '')} style={{ ['--c' as string]: TAGS[t].color }} onClick={() => toggleTag(t)}>
              #{TAGS[t].label}
            </button>
          ))}
        </div>
        <div className="row gap6">
          <button className="mod-cta" disabled={loading || (node.expanded && !node.cursor)} onClick={() => void expand(node.id)}>
            <GitBranch size={14} />
            {loading ? 'Loading…' : !node.expanded ? 'Expand' : node.cursor ? 'Load more' : 'Fully loaded'}
          </button>
          <button className="mod-ghost" disabled={!!ui.trace} onClick={() => void autoTrace(node.id, 'out')} title="Follow the largest outflows hop by hop">
            <Workflow size={14} /> Trace
          </button>
          <span className="grow" />
          <IconBtn title="Remove from case" className="danger" onClick={() => (update(c.id, (x) => removeNode(x, node.id)), select(null))}>
            <Trash2 size={15} />
          </IconBtn>
        </div>
        <div className="row wrap gap4">
          <button className="chip" disabled={loading} onClick={() => void expandNeighbors(node.id)} title="Expand the 5 largest counterparties">
            Expand top 5
          </button>
          {chain.family !== 'utxo' && (
            <button className="chip" disabled={loading} onClick={() => void findFunder(node.id)} title="Who paid for the first gas / activation">
              First funder
            </button>
          )}
          {chain.family === 'utxo' && (
            <button className="chip" disabled={!!ui.trace} onClick={() => void followPeelChain(node.id)} title="Follow change outputs hop by hop">
              Follow peel chain
            </button>
          )}
          <button className="chip" disabled={!!ui.trace} onClick={() => void autoTrace(node.id, 'in')} title="Trace where the funds came from">
            Trace sources
          </button>
          <button className="chip" onClick={() => ui.set({ linkFrom: node.id })} title="Then Shift+click another address">
            Link same owner…
          </button>
          <button className="chip" onClick={() => patch({ hidden: !node.hidden })}>
            {node.hidden ? 'Unhide' : 'Hide'}
          </button>
        </div>
        {node.funder && (
          <div className="callout" onClick={() => go(nodeId(node.chain, node.funder!.address))} style={{ cursor: 'pointer' }}>
            First funded by <b>{nameOf(node.funder.address)}</b> · {amt(node.funder.amount)} {node.funder.asset} · {day(node.funder.time)}
          </div>
        )}
      </div>

      <div className="tabs">
        {(
          [
            ['overview', 'Overview'],
            ['risk', 'Risk'],
            ['flows', `Flows ${counterparties.length || ''}`],
            ['tx', `Transfers ${transfers.length || ''}`],
            ['behavior', 'Behavior'],
            ['note', 'Note' + (node.note ? ' •' : '')],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>

      <div className="insp-body">
        {assets.length > 1 && (tab === 'overview' || tab === 'flows' || tab === 'tx') && (
          <div className="row wrap gap4 mb8">
            {assets.slice(0, 10).map((x) => (
              <button key={x} className={'chip' + (x === asset ? ' on' : '')} onClick={() => setPick(x)}>
                {x}
              </button>
            ))}
          </div>
        )}

        {tab === 'overview' && (
          <>
            <div className="stats">
              <Stat k="Balance" v={node.info?.balance != null ? `${amt(node.info.balance)} ${node.info.balanceAsset}` : '—'} sub={node.info?.balance != null && node.info.balanceAsset && c.prices[node.info.balanceAsset] ? usd(node.info.balance * c.prices[node.info.balanceAsset]) : undefined} />
              <Stat k="Transactions" v={node.info?.txCount != null ? node.info.txCount.toLocaleString('en-US') : '—'} />
              <Stat k={`Received ${asset ?? ''}`} v={amt(totals.inA)} cls="pos" sub={price ? usd(totals.inA * price) : undefined} />
              <Stat k={`Sent ${asset ?? ''}`} v={amt(totals.outA)} cls="neg" sub={price ? usd(totals.outA * price) : undefined} />
              <Stat k="First seen" v={totals.first < Infinity ? day(totals.first) : '—'} />
              <Stat k="Last seen" v={totals.last ? day(totals.last) : '—'} />
            </div>
            <div className="section">
              <div className="section-title">Attribution</div>
              <div className="kv">
                <span>Category</span>
                <select className="dropdown sm" value={node.category ?? ''} onChange={(e) => patch({ category: (e.target.value || undefined) as Category | undefined })}>
                  <option value="">Auto: {CATEGORY_META[a?.category ?? 'unknown'].label}</option>
                  {CATEGORIES.map((x) => (
                    <option key={x} value={x}>
                      {CATEGORY_META[x].label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="kv">
                <span>Source</span>
                <span className="muted">{a?.source === 'none' ? 'No attribution' : a?.source}</span>
              </div>
            </div>
            {cluster && (
              <div className="section">
                <div className="section-title">Cluster · {members.length} addresses (common-input)</div>
                <div className="cluster-list">
                  {members.slice(0, 40).map((m) => (
                    <a
                      key={m}
                      className={'cluster-item' + (m === node.id ? ' self' : '')}
                      onClick={() => (c.nodes[m] ? go(m) : investigate(m.slice(m.indexOf(':') + 1)))}
                      title={c.nodes[m] ? 'Select' : 'Add to case and expand'}
                    >
                      {c.nodes[m] ? nameOf(m.slice(m.indexOf(':') + 1)) : short(m.slice(m.indexOf(':') + 1), 10, 6)}
                      {!c.nodes[m] && <span className="muted small"> + add</span>}
                    </a>
                  ))}
                </div>
              </div>
            )}
            {!!node.info?.tokens?.length && (
              <div className="section">
                <div className="section-title">Token holdings</div>
                {node.info.tokens.map((t, i) => (
                  <div key={t.symbol + i} className="kv">
                    <span>{t.symbol}</span>
                    <span>{amt(t.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="section">
              <div className="section-title">Activity {asset}</div>
              {asset ? (
                <ActivityChart transfers={transfers} address={node.address} asset={asset} />
              ) : (
                <div className="muted small">{node.expanded ? 'No transfers found' : 'Expand the address to load its history'}</div>
              )}
            </div>
            <div className="muted small">
              {transfers.length} transfers loaded{node.cursor ? ' · more pages available' : ''}. Totals reflect loaded data; USD at current prices.
            </div>
          </>
        )}

        {tab === 'risk' && r && (
          <>
            <div className="risk-big" style={{ color: LEVEL_COLOR[r.level] }}>
              {r.score}
              <span>/100 · {r.level}</span>
            </div>
            <div className="section">
              <div className="section-title">Why this score</div>
              {r.reasons.length ? (
                r.reasons.map((x, i) => (
                  <div key={i} className="reason">
                    <span className="pts">+{x.points}</span>
                    <span>{x.text}</span>
                  </div>
                ))
              ) : (
                <div className="muted small">No risk indicators found in loaded data.</div>
              )}
            </div>
            {(['in', 'out'] as const).map((dir) => {
              const ex = Object.entries(r.exposure[dir]).sort((x, y) => y[1]! - x[1]!) as [Category, number][]
              if (!ex.length || (ex.length === 1 && ex[0][0] === 'unknown')) return null
              return (
                <div key={dir} className="section">
                  <div className="section-title">
                    Direct exposure · {dir === 'in' ? 'sources of funds' : 'destinations'} ({r.measure === 'usd' ? 'by USD' : 'by transfer count'})
                  </div>
                  <div className="expo-bar">
                    {ex.map(([cat, share]) => (
                      <div key={cat} style={{ width: `${share * 100}%`, background: CATEGORY_META[cat].color }} title={`${CATEGORY_META[cat].label} ${Math.round(share * 100)}%`} />
                    ))}
                  </div>
                  {ex.map(([cat, share]) => (
                    <div key={cat} className="kv">
                      <span>
                        <i className="dot" style={{ background: CATEGORY_META[cat].color }} /> {CATEGORY_META[cat].label}
                      </span>
                      <span>{(share * 100).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              )
            })}
            <div className="muted small">Heuristic score for triage, not a finding. Adjust weights in Settings → Risk model.</div>
          </>
        )}

        {tab === 'flows' && (
          <table className="tbl">
            <thead>
              <tr>
                <th>Counterparty</th>
                <th className="r">In</th>
                <th className="r">Out</th>
                <th className="r">#</th>
              </tr>
            </thead>
            <tbody>
              {counterparties.slice(0, 200).map((cp) => {
                const id = nodeId(node.chain, cp.addr)
                const cat = d.attr.get(id)?.category
                return (
                  <tr key={cp.addr} onClick={() => go(id)}>
                    <td className="ellipsis" title={cp.addr}>
                      {cat && cat !== 'unknown' && <i className="dot" style={{ background: CATEGORY_META[cat].color }} />} {nameOf(cp.addr)}
                    </td>
                    <td className="r pos">{cp.in ? amt(cp.in) : ''}</td>
                    <td className="r neg">{cp.out ? amt(cp.out) : ''}</td>
                    <td className="r muted">{cp.n}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {tab === 'tx' && (
          <div className="txlist">
            {[...transfers]
              .filter((t) => t.asset === asset)
              .sort((x, y) => y.time - x.time)
              .slice(0, 300)
              .map((t, i) => {
                const incoming = t.to === node.address
                const other = incoming ? t.from : t.to
                return (
                  <div key={t.hash + i} className="tx">
                    <span className={incoming ? 'pos' : 'neg'}>{incoming ? '←' : '→'}</span>
                    <a className="ellipsis" onClick={() => go(nodeId(node.chain, other))} title={other}>
                      {nameOf(other)}
                      {t.change && <span className="pill tiny">change</span>}
                      {t.coinjoin && <span className="pill tiny warn">{t.cjKind && t.cjKind !== 'generic' ? t.cjKind : 'coinjoin'}</span>}
                      {t.internal && <span className="pill tiny">internal</span>}
                      {t.memo && <span className="pill tiny src">{t.memo}</span>}
                    </a>
                    <span className={'r ' + (incoming ? 'pos' : 'neg')}>
                      {incoming ? '+' : '−'}
                      {amt(t.amount)}
                    </span>
                    <a className="muted small" href={chain.txExplorer(t.hash)} target="_blank" rel="noreferrer noopener" title={t.hash}>
                      {date(t.time)}
                    </a>
                  </div>
                )
              })}
          </div>
        )}

        {tab === 'behavior' && <Behavior times={transfers.filter((t) => t.from === node.address).map((t) => t.time)} />}

        {tab === 'note' && (
          <div className="note">
            <div className="row gap6 mb8">
              <button className={'chip' + (!editing ? ' on' : '')} onClick={() => setEditing(false)}>
                Reading
              </button>
              <button className={'chip' + (editing ? ' on' : '')} onClick={() => setEditing(true)}>
                Editing
              </button>
            </div>
            {editing || !node.note ? (
              <textarea
                autoFocus={editing}
                value={node.note}
                placeholder={'Markdown. Link other addresses with [[alias]] or [[0x…]].\n\n## Source\n- found via …'}
                onChange={(e) => patch({ note: e.target.value })}
                onFocus={() => setEditing(true)}
              />
            ) : (
              <div className="md" onDoubleClick={() => setEditing(true)}>
                {renderNote(node.note, (target) => {
                  const t = target.trim().toLowerCase()
                  const hit = Object.values(c.nodes).find((n) => n.alias?.toLowerCase() === t || n.address.toLowerCase() === t || n.address.toLowerCase().startsWith(t))
                  if (hit) go(hit.id)
                  else investigate(target)
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ k, v, cls, sub }: { k: string; v: string; cls?: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="stat-k">{k}</div>
      <div className={'stat-v ' + (cls ?? '')}>{v}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}
