// Small building blocks shared by the OSINT modules.

import { BookmarkPlus, ExternalLink, Loader2, Search, Workflow } from 'lucide-react'
import type { ReactNode } from 'react'
import { investigate } from '../../actions'
import { CHAINS } from '../../chains'
import { extractCrypto, saveToCase } from '../../osint/util'
import { useUI } from '../../store'

export function ToolHeader({ title, desc, children }: { title: string; desc: string; children?: ReactNode }) {
  return (
    <div className="tool-head">
      <h2>{title}</h2>
      <p className="setting-intro">{desc}</p>
      {children}
    </div>
  )
}

export function QueryBar(p: { value: string; onChange: (v: string) => void; onRun: () => void; placeholder: string; busy?: boolean; extra?: ReactNode }) {
  return (
    <form
      className="query-bar"
      onSubmit={(e) => {
        e.preventDefault()
        p.onRun()
      }}
    >
      <div className="search-box big">
        <Search size={15} className="muted" />
        <input autoFocus value={p.value} onChange={(e) => p.onChange(e.target.value)} placeholder={p.placeholder} spellCheck={false} autoComplete="off" />
      </div>
      {p.extra}
      <button className="mod-cta" disabled={p.busy || !p.value.trim()}>
        {p.busy ? <Loader2 size={14} className="spin" /> : <Search size={14} />} Analyze
      </button>
    </form>
  )
}

export function Card({ title, children, right, status }: { title: string; children: ReactNode; right?: ReactNode; status?: 'ok' | 'warn' | 'bad' | 'none' }) {
  return (
    <div className="ocard">
      <div className="ocard-head">
        {status && <i className={'odot ' + status} />}
        <span>{title}</span>
        <span className="grow" />
        {right}
      </div>
      <div className="ocard-body">{children}</div>
    </div>
  )
}

export function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div className="okv">
      {rows
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => (
          <div key={k} className="okv-row">
            <span>{k}</span>
            <span>{v}</span>
          </div>
        ))}
    </div>
  )
}

export interface LinkItem {
  label: string
  url: string
  note?: string
}

export function LinkGrid({ groups }: { groups: { title: string; links: LinkItem[] }[] }) {
  return (
    <div className="link-groups">
      {groups.map((g) => (
        <div key={g.title} className="link-group">
          <div className="section-title">{g.title}</div>
          <div className="link-grid">
            {g.links.map((l) => (
              <a key={l.label + l.url} className="olink" href={l.url} target="_blank" rel="noreferrer noopener" title={l.note ?? l.url}>
                <span className="ellipsis">{l.label}</span>
                <ExternalLink size={11} />
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function SaveButton({ title, markdown }: { title: string; markdown: () => string }) {
  return (
    <button className="mod-ghost sm" onClick={() => saveToCase(title, markdown())} title="Append these results to the active case's notes">
      <BookmarkPlus size={13} /> Save to case
    </button>
  )
}

/** Detect crypto addresses in any text and offer to investigate them in the graph. */
export function CryptoPivots({ text }: { text: string }) {
  const found = extractCrypto(text)
  if (!found.length) return null
  return (
    <div className="callout">
      <Workflow size={13} /> Crypto addresses found:
      {found.map((f) => (
        <button
          key={f.address}
          className="chip"
          onClick={() => {
            useUI.getState().set({ view: 'graph' })
            investigate(f.address)
          }}
        >
          {CHAINS[f.chain].name} {f.address.slice(0, 8)}…
        </button>
      ))}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty-pane">{children}</div>
}
