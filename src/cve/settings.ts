// Persistent settings for the CVE page: data-source keys, scan defaults and the
// bring-your-own-key AI connection. Stored in localStorage on this device only.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ScanOptions } from './types'

export type AiProvider = 'anthropic' | 'openai' | 'openrouter' | 'groq' | 'deepseek' | 'mistral' | 'together' | 'ollama' | 'lmstudio' | 'custom'

export interface ProviderPreset {
  id: AiProvider
  label: string
  baseUrl: string
  models: string[]
  keyless?: boolean
  note?: string
}

export const AI_PRESETS: ProviderPreset[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2'] },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: [] },
  { id: 'openrouter', label: 'OpenRouter (hundreds of models)', baseUrl: 'https://openrouter.ai/api/v1', models: [], note: 'One key for open-weight and commercial models. Use “Load models” to browse.' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', models: [] },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', models: [] },
  { id: 'together', label: 'Together AI', baseUrl: 'https://api.together.xyz/v1', models: [] },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    models: [],
    keyless: true,
    note: 'Runs any local model you have pulled. Start Ollama with OLLAMA_ORIGINS="*" (or this site’s origin) so the browser may call it.',
  },
  { id: 'lmstudio', label: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1', models: [], keyless: true, note: 'Enable “CORS” in LM Studio’s local server settings.' },
  { id: 'custom', label: 'Custom OpenAI-compatible', baseUrl: '', models: [], keyless: true, note: 'Any server that implements /chat/completions (vLLM, llama.cpp, text-generation-webui, LiteLLM…).' },
]

export const DEFAULT_SYSTEM_PROMPT = `You are a senior vulnerability analyst inside ChainGraph's CVE workspace. You help the owner of the scanned infrastructure (or an authorized assessor) understand its external attack surface.

Rules:
- Base every statement on the scan data provided. Say clearly when data is missing or a CVE is only version-inferred from a service banner (distributions often backport fixes, so these can be false positives).
- Prioritize by real-world risk: CISA KEV status, EPSS probability, CVSS, and whether the service is exposed to the internet.
- Describe likely attack paths at a high level and focus on detection, mitigation and remediation: upgrades, configuration changes, firewalling, monitoring.
- Be concise and structured. Use Markdown headings, short bullet lists and tables.`

export interface CveSettings {
  nvdKey: string
  scan: ScanOptions
  // AI
  provider: AiProvider
  baseUrl: string
  apiKey: string
  model: string
  systemPrompt: string
  maxContextCves: number
  aiAck: boolean
  set: (p: Partial<CveSettings>) => void
  setScan: (p: Partial<ScanOptions>) => void
}

export const useCveSettings = create<CveSettings>()(
  persist(
    (set) => ({
      nvdKey: '',
      scan: { subdomains: true, maxSubdomains: 60, headers: false, reverseIp: false, nvdCpeLimit: 10, active: false },
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: '',
      model: '',
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      maxContextCves: 25,
      aiAck: false,
      set: (p) => set(p),
      setScan: (p) => set((s) => ({ scan: { ...s.scan, ...p } })),
    }),
    { name: 'chaingraph-cve-settings', version: 1 },
  ),
)
