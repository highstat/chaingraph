import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Category, ChainId, LabelEntry } from './types'

export type Layout = 'force' | 'lr' | 'td' | 'radial'
export type ColorBy = 'chain' | 'category' | 'risk'
export type EdgeLabels = 'none' | 'amount' | 'full'

export interface ColorGroup {
  query: string // e.g. "tag:suspect", "chain:btc", "cat:exchange", "risk>70", free text
  color: string
}

export interface Settings {
  // Appearance
  theme: string
  accent: string | null // null = theme default
  fontSize: number
  showRibbon: boolean
  // Graph: Obsidian graph-view parity
  layout: Layout
  centerForce: number // 0..1
  repelForce: number // 0..20
  linkForce: number // 0..1
  linkDistance: number // 10..250
  nodeSize: number // 0.4..3
  linkThickness: number // 0.2..4
  arrows: boolean
  textFade: number // -3..3 (Obsidian "text fade threshold")
  particles: boolean
  edgeLabels: EdgeLabels
  colorBy: ColorBy
  riskHalo: boolean
  clusterRings: boolean
  groups: ColorGroup[]
  // Filters (persist like Obsidian)
  hideSpam: boolean
  hideChange: boolean
  hideOrphans: boolean // counterparties with a single link
  minAmount: number
  minUsd: number
  // Data sources
  defaultEvm: ChainId
  etherscanKey: string
  timeoutSec: number
  // Heuristics
  btcChange: boolean
  btcCoinjoin: boolean
  btcCluster: boolean
  poisoning: boolean
  // Risk
  riskWeights: Record<Category, number>
  // Auto-trace
  traceDepth: number
  traceBranches: number
  traceMinShare: number // % of node outflow
  traceStop: Category[]
  traceChrono: boolean
  // Watchlist
  watchIntervalMin: number
  watchNotify: boolean
  // Labels library (TagPack-like)
  labels: LabelEntry[]
}

export const DEFAULT_RISK: Record<Category, number> = {
  sanctioned: 100,
  darknet: 95,
  scam: 90,
  mixer: 80,
  gambling: 45,
  instant: 55,
  bridge: 15,
  exchange: 10,
  service: 10,
  defi: 5,
  individual: 0,
  unknown: 0,
}

export const DEFAULTS: Settings = {
  theme: 'amoled',
  accent: null,
  fontSize: 13,
  showRibbon: true,
  layout: 'force',
  centerForce: 0.35,
  repelForce: 9,
  linkForce: 0.6,
  linkDistance: 45,
  nodeSize: 1,
  linkThickness: 1,
  arrows: true,
  textFade: 0,
  particles: true,
  edgeLabels: 'none',
  colorBy: 'chain',
  riskHalo: true,
  clusterRings: true,
  groups: [
    { query: 'cat:exchange', color: '#3e8ed0' },
    { query: 'cat:mixer', color: '#a855f7' },
    { query: 'cat:scam', color: '#e5484d' },
  ],
  hideSpam: true,
  hideChange: false,
  hideOrphans: false,
  minAmount: 0,
  minUsd: 0,
  defaultEvm: 'eth',
  etherscanKey: '',
  timeoutSec: 20,
  btcChange: true,
  btcCoinjoin: true,
  btcCluster: true,
  poisoning: true,
  riskWeights: DEFAULT_RISK,
  traceDepth: 3,
  traceBranches: 3,
  traceMinShare: 5,
  traceStop: ['exchange', 'mixer', 'bridge', 'sanctioned', 'instant'],
  traceChrono: true,
  watchIntervalMin: 5,
  watchNotify: true,
  labels: [],
}

interface SettingsStore extends Settings {
  set: (patch: Partial<Settings>) => void
  reset: (keys?: (keyof Settings)[]) => void
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      set: (patch) => set(patch),
      reset: (keys) =>
        set(keys ? Object.fromEntries(keys.map((k) => [k, DEFAULTS[k]])) : { ...DEFAULTS }),
    }),
    {
      name: 'chaingraph.settings',
      version: 1,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Settings>
        return { ...current, ...p, riskWeights: { ...DEFAULT_RISK, ...(p.riskWeights ?? {}) } }
      },
    },
  ),
)
