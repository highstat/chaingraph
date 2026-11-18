import { ChevronRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'

/** Obsidian-style toggle switch. */
export function Switch({ on, onChange, title }: { on: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} title={title} className={'switch' + (on ? ' on' : '')} onClick={() => onChange(!on)}>
      <span />
    </button>
  )
}

export function Slider(p: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <div className="slider">
      <input type="range" min={p.min} max={p.max} step={p.step ?? (p.max - p.min) / 100} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} />
      <span className="slider-val">{p.format ? p.format(p.value) : p.value}</span>
    </div>
  )
}

/** A row in settings: name + description on the left, control on the right. */
export function SettingItem({ name, desc, children, stack }: { name: string; desc?: ReactNode; children?: ReactNode; stack?: boolean }) {
  return (
    <div className={'setting-item' + (stack ? ' stack' : '')}>
      <div className="setting-info">
        <div className="setting-name">{name}</div>
        {desc && <div className="setting-desc">{desc}</div>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

export function Heading({ children }: { children: ReactNode }) {
  return <div className="setting-heading">{children}</div>
}

/** Collapsible section, like the Obsidian graph-view settings groups. */
export function Section({ title, children, defaultOpen = true, right }: { title: string; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={'gsection' + (open ? ' open' : '')}>
      <div className="gsection-head" onClick={() => setOpen(!open)}>
        <ChevronRight size={14} className="chev" />
        <span>{title}</span>
        <span className="grow" />
        {right}
      </div>
      {open && <div className="gsection-body">{children}</div>}
    </div>
  )
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grow-row">
      <span>{label}</span>
      {children}
    </div>
  )
}

export function Kbd({ k }: { k: string }) {
  return (
    <span className="kbd-group">
      {k.split('+').map((x) => (
        <kbd key={x}>{x}</kbd>
      ))}
    </span>
  )
}

export function IconBtn({ title, onClick, children, active, className }: { title: string; onClick?: () => void; children: ReactNode; active?: boolean; className?: string }) {
  return (
    <button type="button" className={'clickable-icon' + (active ? ' is-active' : '') + (className ? ' ' + className : '')} aria-label={title} title={title} onClick={onClick}>
      {children}
    </button>
  )
}
