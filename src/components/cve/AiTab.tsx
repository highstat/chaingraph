// AI analyst: chat about the active scan with any model the user connects.

import { Bot, Eraser, KeyRound, Loader2, RotateCcw, Send, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { aiReady, chat, listModels, QUICK_PROMPTS } from '../../cve/ai'
import { aiContext } from '../../cve/report'
import { AI_PRESETS, DEFAULT_SYSTEM_PROMPT, useCveSettings, type AiProvider } from '../../cve/settings'
import { useCve } from '../../cve/state'
import { saveToCase } from '../../osint/util'
import { toast } from '../../store'
import { Card, ToolHeader } from '../osint/kit'
import { Md } from './shared'

export function AiTab() {
  const s = useCveSettings()
  const cve = useCve()
  const r = cve.result
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [showConn, setShowConn] = useState(() => !!aiReady())
  const abort = useRef<AbortController | null>(null)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Braces matter: scrollIntoView returns a Promise in current browsers.
    void end.current?.scrollIntoView({ block: 'end' })
  }, [cve.chat])

  const send = async (text: string) => {
    const missing = aiReady()
    if (missing) {
      setShowConn(true)
      return toast(missing)
    }
    if (!s.aiAck) {
      setShowConn(true)
      return toast('Confirm the data notice in the connection panel first')
    }
    const q = text.trim()
    if (!q || streaming) return
    setInput('')
    const history = [...useCve.getState().chat, { role: 'user' as const, content: q }]
    useCve.setState({ chat: [...history, { role: 'assistant', content: '' }] })
    const system = r ? `${s.systemPrompt}\n\n--- SCAN DATA ---\n${aiContext(r, s.maxContextCves)}` : s.systemPrompt
    const ctl = new AbortController()
    abort.current = ctl
    setStreaming(true)
    let acc = ''
    try {
      await chat({
        system,
        messages: history,
        signal: ctl.signal,
        onText: (d) => {
          acc += d
          useCve.setState({ chat: [...history, { role: 'assistant', content: acc }] })
        },
      })
    } catch (e) {
      useCve.setState({ chat: [...history, { role: 'assistant', content: `${acc}\n\n**Error:** ${(e as Error).message}` }] })
    } finally {
      setStreaming(false)
      abort.current = null
    }
  }

  return (
    <div className="tool ai-tool">
      <ToolHeader
        title="AI analyst"
        desc="Ask questions about the active scan in plain language: predictive threat scenarios, remediation plans, CVE explanations. Connect any model with your own API key, including local models through Ollama or LM Studio that never leave your machine."
      >
        <div className="row gap6 wrap">
          <span className={'pill ' + (aiReady() ? 'warn' : 'src')}>
            {aiReady() ?? `${AI_PRESETS.find((p) => p.id === s.provider)?.label} · ${s.model}`}
          </span>
          <span className="pill">{r ? `Context: ${r.target} (top ${s.maxContextCves} CVEs)` : 'No scan loaded: general questions only'}</span>
          <button className="mod-ghost sm" onClick={() => setShowConn(!showConn)}>
            <KeyRound size={13} /> Connection
          </button>
        </div>
      </ToolHeader>
      {showConn && <Connection />}

      <div className="chat">
        {!cve.chat.length && (
          <div className="chat-empty">
            <Bot size={28} className="muted" />
            <div className="muted">{r ? `Ask anything about ${r.target}, or start with a preset:` : 'Run a scan to give the analyst context, or ask a general question.'}</div>
          </div>
        )}
        {cve.chat.map((m, i) => (
          <div key={i} className={'msg ' + m.role}>
            {m.role === 'assistant' ? m.content ? <Md src={m.content} /> : <Loader2 size={14} className="spin" /> : <div className="msg-user">{m.content}</div>}
            {m.role === 'assistant' && m.content && !(streaming && i === cve.chat.length - 1) && (
              <div className="msg-actions">
                <button className="chip" onClick={() => void navigator.clipboard.writeText(m.content).then(() => toast('Copied', 'success'))}>
                  Copy
                </button>
                <button className="chip" onClick={() => saveToCase(`AI analyst${r ? `: ${r.target}` : ''}`, m.content)}>
                  Save to case
                </button>
              </div>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>

      <div className="chat-foot">
      <div className="row gap6 wrap quick">
        {QUICK_PROMPTS.map((p) => (
          <button key={p.label} className="chip" disabled={streaming} onClick={() => void send(p.prompt)}>
            {p.label}
          </button>
        ))}
        <span className="grow" />
        {cve.chat.length > 0 && (
          <button className="chip" onClick={() => useCve.setState({ chat: [] })} disabled={streaming}>
            <Eraser size={11} /> Clear
          </button>
        )}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault()
          void send(input)
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send(input)
            }
          }}
          placeholder={r ? `Ask about ${r.target}… (Enter to send, Shift+Enter for a new line)` : 'Ask a question…'}
          rows={2}
        />
        {streaming ? (
          <button type="button" className="mod-warning" onClick={() => abort.current?.abort()}>
            <Square size={13} /> Stop
          </button>
        ) : (
          <button className="mod-cta" disabled={!input.trim()}>
            <Send size={14} />
          </button>
        )}
      </form>
      </div>
    </div>
  )
}

function Connection() {
  const s = useCveSettings()
  const preset = AI_PRESETS.find((p) => p.id === s.provider)!
  const [models, setModels] = useState<string[]>(preset.models)
  const [loading, setLoading] = useState(false)

  const pick = (id: AiProvider) => {
    const p = AI_PRESETS.find((x) => x.id === id)!
    s.set({ provider: id, baseUrl: p.baseUrl, model: p.models[0] ?? '' })
    setModels(p.models)
  }
  const load = async () => {
    setLoading(true)
    try {
      const m = await listModels()
      setModels(m)
      if (!s.model && m[0]) s.set({ model: m[0] })
      toast(`${m.length} models`, 'success')
    } catch (e) {
      toast(`Could not list models: ${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card title="Model connection">
      <div className="conn-grid">
        <label>
          <span>Provider</span>
          <select className="dropdown" value={s.provider} onChange={(e) => pick(e.target.value as AiProvider)}>
            {AI_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Base URL</span>
          <input value={s.baseUrl} onChange={(e) => s.set({ baseUrl: e.target.value })} placeholder="https://…/v1" spellCheck={false} />
        </label>
        <label>
          <span>API key {preset.keyless ? '(optional)' : ''}</span>
          <input type="password" value={s.apiKey} onChange={(e) => s.set({ apiKey: e.target.value })} placeholder={preset.keyless ? 'not needed for local servers' : 'sk-…'} autoComplete="off" />
        </label>
        <label>
          <span>Model</span>
          <div className="row gap6">
            <input list="cve-models" value={s.model} onChange={(e) => s.set({ model: e.target.value })} placeholder="model id" spellCheck={false} />
            <datalist id="cve-models">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <button className="mod-ghost sm" onClick={() => void load()} disabled={loading} type="button">
              {loading ? <Loader2 size={12} className="spin" /> : null} Load models
            </button>
          </div>
        </label>
        <label>
          <span>CVEs sent as context</span>
          <input type="number" min={5} max={150} value={s.maxContextCves} onChange={(e) => s.set({ maxContextCves: Math.max(5, Math.min(150, Number(e.target.value) || 25)) })} />
        </label>
      </div>
      {preset.note && <div className="muted small mt6">{preset.note}</div>}
      <details className="mt6">
        <summary className="small">System prompt</summary>
        <textarea className="sys-prompt mono" value={s.systemPrompt} onChange={(e) => s.set({ systemPrompt: e.target.value })} rows={9} />
        <button className="mod-ghost sm" onClick={() => s.set({ systemPrompt: DEFAULT_SYSTEM_PROMPT })}>
          <RotateCcw size={12} /> Reset
        </button>
      </details>
      <label className="ack">
        <input type="checkbox" checked={s.aiAck} onChange={(e) => s.set({ aiAck: e.target.checked })} />
        <span>
          I understand that AI mode sends the scan summary and my questions to the provider above (everything else in ChainGraph stays in this browser), and that my API key is stored in this browser’s localStorage. Local
          providers (Ollama, LM Studio) keep everything on this machine.
        </span>
      </label>
    </Card>
  )
}
