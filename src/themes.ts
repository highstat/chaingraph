import { logoSvg } from './components/Logo'

export interface Theme {
  id: string
  name: string
  dark: boolean
  accent: string
  vars: {
    bg: string // background-primary (graph, editor)
    bg2: string // background-secondary (sidebars)
    bg3: string // modifier surfaces (inputs, cards)
    hover: string
    border: string
    text: string
    text2: string
    muted: string
    pos: string
    neg: string
    warn: string
  }
}

export const THEMES: Theme[] = [
  {
    id: 'amoled',
    name: 'AMOLED Black',
    dark: true,
    accent: '#2dd4bf',
    vars: { bg: '#000000', bg2: '#000000', bg3: '#0c0c0e', hover: '#16161a', border: '#1d1d22', text: '#e8e8ec', text2: '#a1a1aa', muted: '#63636e', pos: '#4ade80', neg: '#f87171', warn: '#fbbf24' },
  },
  {
    id: 'obsidian',
    name: 'Obsidian Dark',
    dark: true,
    accent: '#8a5cf5',
    vars: { bg: '#1e1e1e', bg2: '#262626', bg3: '#2a2a2a', hover: '#333333', border: '#363636', text: '#dadada', text2: '#b3b3b3', muted: '#808080', pos: '#57c26a', neg: '#ef5d63', warn: '#e0ac00' },
  },
  {
    id: 'obsidian-light',
    name: 'Obsidian Light',
    dark: false,
    accent: '#7c4dff',
    vars: { bg: '#ffffff', bg2: '#f6f6f6', bg3: '#ededed', hover: '#e6e6e6', border: '#e0e0e0', text: '#222222', text2: '#4f4f4f', muted: '#8a8a8a', pos: '#1f8f3a', neg: '#d93036', warn: '#b07800' },
  },
  {
    id: 'midnight',
    name: 'Midnight Blue',
    dark: true,
    accent: '#5b9cff',
    vars: { bg: '#0b0f17', bg2: '#0f1420', bg3: '#151b2a', hover: '#1b2335', border: '#222b40', text: '#dbe4f3', text2: '#a3b1c9', muted: '#66738c', pos: '#4fd1a5', neg: '#ff6b81', warn: '#ffc857' },
  },
  {
    id: 'nord',
    name: 'Nord',
    dark: true,
    accent: '#88c0d0',
    vars: { bg: '#2e3440', bg2: '#3b4252', bg3: '#434c5e', hover: '#4c566a', border: '#4c566a', text: '#eceff4', text2: '#d8dee9', muted: '#9aa3b5', pos: '#a3be8c', neg: '#bf616a', warn: '#ebcb8b' },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    dark: true,
    accent: '#bd93f9',
    vars: { bg: '#282a36', bg2: '#21222c', bg3: '#343746', hover: '#3c3f52', border: '#44475a', text: '#f8f8f2', text2: '#cfcfe0', muted: '#8b8fae', pos: '#50fa7b', neg: '#ff5555', warn: '#f1fa8c' },
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin Mocha',
    dark: true,
    accent: '#cba6f7',
    vars: { bg: '#1e1e2e', bg2: '#181825', bg3: '#313244', hover: '#3a3b52', border: '#313244', text: '#cdd6f4', text2: '#bac2de', muted: '#7f849c', pos: '#a6e3a1', neg: '#f38ba8', warn: '#f9e2af' },
  },
  {
    id: 'gruvbox',
    name: 'Gruvbox Dark',
    dark: true,
    accent: '#fe8019',
    vars: { bg: '#282828', bg2: '#1d2021', bg3: '#32302f', hover: '#3c3836', border: '#3c3836', text: '#ebdbb2', text2: '#d5c4a1', muted: '#928374', pos: '#b8bb26', neg: '#fb4934', warn: '#fabd2f' },
  },
  {
    id: 'solarized',
    name: 'Solarized Dark',
    dark: true,
    accent: '#2aa198',
    vars: { bg: '#002b36', bg2: '#073642', bg3: '#0b3f4c', hover: '#114b59', border: '#174f5c', text: '#d3dcdc', text2: '#93a1a1', muted: '#657b83', pos: '#859900', neg: '#dc322f', warn: '#b58900' },
  },
]

export const themeById = (id: string) => THEMES.find((t) => t.id === id) ?? THEMES[0]

/** Push a theme into CSS custom properties on <html>. */
export function applyTheme(id: string, accent: string | null, fontSize: number) {
  const t = themeById(id)
  const root = document.documentElement
  for (const [k, v] of Object.entries(t.vars)) root.style.setProperty(`--${k}`, v)
  const a = accent || t.accent
  root.style.setProperty('--accent', a)
  root.style.setProperty('--accent-soft', hexA(a, 0.16))
  root.style.setProperty('--accent-ring', hexA(a, 0.35))
  root.style.setProperty('--font-ui', `${fontSize}px`)
  root.style.colorScheme = t.dark ? 'dark' : 'light'
  root.dataset.theme = t.id
  setFavicon(a, t.vars.bg === '#000000' ? '#0a0a0c' : t.vars.bg2)
}

/** Keep the browser-tab icon in sync with the accent color. */
function setFavicon(accent: string, bg: string) {
  const svg = logoSvg(accent, bg)
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.type = 'image/svg+xml'
  link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg)
}

export function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
