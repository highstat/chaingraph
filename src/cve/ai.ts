// Bring-your-own-key AI analyst. Any OpenAI-compatible endpoint (OpenAI,
// OpenRouter, Groq, DeepSeek, Mistral, Together, local Ollama / LM Studio, or a
// custom server) or Anthropic via the official SDK. Requests go straight from
// the browser to the provider the user picked: there is no ChainGraph server.

import { AI_PRESETS, useCveSettings } from './settings'

export interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  system: string
  messages: ChatMsg[]
  onText: (delta: string) => void
  signal: AbortSignal
}

const trimSlash = (s: string) => s.replace(/\/+$/, '')

export function aiReady(): string | null {
  const s = useCveSettings.getState()
  const preset = AI_PRESETS.find((p) => p.id === s.provider)
  if (!s.baseUrl.trim() && s.provider !== 'anthropic') return 'Set the API base URL'
  if (!s.apiKey.trim() && !preset?.keyless) return 'Add your API key'
  if (!s.model.trim()) return 'Choose a model'
  return null
}

export async function chat(req: ChatRequest): Promise<void> {
  const s = useCveSettings.getState()
  if (s.provider === 'anthropic') return chatAnthropic(req)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (s.apiKey.trim()) headers.authorization = `Bearer ${s.apiKey.trim()}`
  if (s.provider === 'openrouter') {
    headers['HTTP-Referer'] = location.origin
    headers['X-Title'] = 'ChainGraph'
  }
  let res: Response
  try {
    res = await fetch(`${trimSlash(s.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers,
      signal: req.signal,
      body: JSON.stringify({
        model: s.model.trim(),
        stream: true,
        messages: [{ role: 'system', content: req.system }, ...req.messages],
      }),
    })
  } catch (e) {
    if (req.signal.aborted) return
    throw networkError(e, s.baseUrl, s.provider)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let msg = text
    try {
      msg = JSON.parse(text).error?.message ?? text
    } catch {
      /* plain text */
    }
    throw new Error(`${res.status}: ${msg.slice(0, 300) || res.statusText}`)
  }
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') return
      try {
        const j = JSON.parse(data)
        if (j.error) throw new Error(j.error.message ?? 'Provider error')
        const delta = j.choices?.[0]?.delta?.content
        if (delta) req.onText(delta)
      } catch (e) {
        if (e instanceof SyntaxError) continue
        throw e
      }
    }
  }
}

/** Models that accept the server-side refusal fallback. */
const FALLBACK_MODELS = new Set(['claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5'])

async function chatAnthropic(req: ChatRequest): Promise<void> {
  const s = useCveSettings.getState()
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  // The key belongs to the user and never leaves their browser except to Anthropic.
  const client = new Anthropic({ apiKey: s.apiKey.trim(), dangerouslyAllowBrowser: true, ...(s.baseUrl.trim() && s.baseUrl !== 'https://api.anthropic.com' ? { baseURL: trimSlash(s.baseUrl) } : {}) })
  const model = s.model.trim()
  const fallback = FALLBACK_MODELS.has(model)
  try {
    const stream = client.beta.messages.stream(
      {
        model,
        max_tokens: 64000,
        system: req.system,
        messages: req.messages,
        ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { signal: req.signal },
    )
    stream.on('text', (t) => req.onText(t))
    const final = await stream.finalMessage()
    if (final.stop_reason === 'refusal') req.onText('\n\n_The model declined this request._')
    if (final.stop_reason === 'max_tokens') req.onText('\n\n_Answer cut off at the output limit._')
  } catch (e) {
    if (req.signal.aborted) return
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Anthropic rejected the API key')
    if (e instanceof Anthropic.RateLimitError) throw new Error('Anthropic rate limit reached, try again shortly')
    if (e instanceof Anthropic.APIError) throw new Error(`Anthropic ${e.status ?? ''}: ${e.message}`)
    throw e
  }
}

const isLocalProvider = (id: string) => id === 'ollama' || id === 'lmstudio' || id === 'custom'

/** Human-readable reason a browser fetch failed, with the next step to try. */
function networkError(e: unknown, baseUrl: string, provider: string): Error {
  const raw = (e as Error)?.message ?? String(e)
  if (isLocalProvider(provider)) {
    return new Error(`Cannot reach ${baseUrl || 'the local server'}. Start it, then allow this site's origin in its CORS settings. (${raw})`)
  }
  let host = baseUrl
  try {
    host = new URL(baseUrl).host
  } catch {
    /* keep the raw string */
  }
  return new Error(`Cannot reach ${host}. Check the network/VPN, try another provider, or type a model ID manually — the built-in list below still works. (${raw})`)
}

/** List models from an OpenAI-compatible /models endpoint. */
export async function listModels(): Promise<string[]> {
  const s = useCveSettings.getState()
  if (s.provider === 'anthropic') return AI_PRESETS[0].models
  let res: Response
  try {
    res = await fetch(`${trimSlash(s.baseUrl)}/models`, {
      headers: s.apiKey.trim() ? { authorization: `Bearer ${s.apiKey.trim()}` } : {},
      signal: AbortSignal.timeout(15000),
    })
  } catch (e) {
    throw networkError(e, s.baseUrl, s.provider)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status}: ${text.slice(0, 160) || res.statusText}`)
  }
  try {
    const j = await res.json()
    const ids = ((j.data ?? j.models ?? []) as any[]).map((m) => m.id ?? m.name).filter(Boolean).sort() as string[]
    return ids.length ? ids : AI_PRESETS.find((p) => p.id === s.provider)?.models ?? []
  } catch {
    throw new Error('The provider returned an invalid model list. Type a model ID manually instead.')
  }
}

export const QUICK_PROMPTS: { label: string; prompt: string }[] = [
  {
    label: 'Threat assessment',
    prompt:
      'Write a predictive threat assessment for this attack surface: the 3–5 most likely attack scenarios (entry point → impact), how likely each is given KEV/EPSS, and what would detect or stop it. End with an overall risk verdict.',
  },
  {
    label: 'Remediation plan',
    prompt: 'Turn the findings into a prioritized remediation plan: a table with action, affected hosts, effort, and risk reduced. Group into “today”, “this week”, “this quarter”.',
  },
  { label: 'Explain top CVEs', prompt: 'Explain the top 5 CVEs in plain language: what component, what an attacker gains, whether it is likely a false positive (backports), and the fix.' },
  { label: 'Executive summary', prompt: 'Write a half-page executive summary for non-technical management: overall posture, the biggest risks, and three decisions needed.' },
  { label: 'Hardening checklist', prompt: 'Give a hardening checklist for the exposed services and technologies found (ports to close, configs, headers, email authentication), as checkboxes.' },
]
