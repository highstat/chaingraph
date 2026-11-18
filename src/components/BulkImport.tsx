import { X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { bulkInvestigate } from '../actions'
import { CHAINS, detectChain } from '../chains'
import { useSettings } from '../settings'
import { useUI } from '../store'

/** Paste many addresses (optionally "address,label") and investigate them all. */
export function BulkImport() {
  const ui = useUI()
  const evm = useSettings((s) => s.defaultEvm)
  const [text, setText] = useState('')
  const parsed = useMemo(
    () =>
      text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [addr, ...rest] = l.split(/[,;\t]/).map((x) => x.trim())
          return { addr, label: rest.join(' '), chain: detectChain(addr, evm) }
        }),
    [text, evm],
  )
  const ok = parsed.filter((p) => p.chain)
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && ui.set({ modal: null })}>
      <div className="modal bulk-modal">
        <button className="modal-close clickable-icon" onClick={() => ui.set({ modal: null })}>
          <X size={18} />
        </button>
        <h2>Bulk import</h2>
        <p className="setting-intro">
          One address per line. Optional label after a comma: <code>0xabc…,Victim wallet</code>. Networks are detected automatically (0x
          addresses use {CHAINS[evm].name}).
        </p>
        <textarea className="bulk-text" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={'bc1q…\nTXyz…,Scammer deposit\n0x…'} spellCheck={false} />
        <div className="bulk-preview">
          {parsed.slice(0, 200).map((p, i) => (
            <div key={i} className="bulk-row">
              <i className="dot" style={{ background: p.chain ? CHAINS[p.chain].color : 'var(--neg)' }} />
              <code className="ellipsis">{p.addr}</code>
              <span className="muted small">{p.chain ? CHAINS[p.chain].name : 'unrecognized'}</span>
              <span className="ellipsis small">{p.label}</span>
            </div>
          ))}
        </div>
        <div className="row gap6">
          <span className="muted small grow">
            {ok.length} of {parsed.length} recognized
          </span>
          <button className="mod-ghost" onClick={() => ui.set({ modal: null })}>
            Cancel
          </button>
          <button
            className="mod-cta"
            disabled={!ok.length}
            onClick={() => {
              ui.set({ modal: null })
              void bulkInvestigate(text)
            }}
          >
            Investigate {ok.length}
          </button>
        </div>
      </div>
    </div>
  )
}
