import { AtSign, BookMarked, Globe2, Image, Map, Network, Phone, Search, User } from 'lucide-react'
import type { ReactNode } from 'react'
import { useUI, type OsintTab } from '../../store'
import { Directory } from './Directory'
import { DomainTool } from './DomainTool'
import { DorkTool } from './DorkTool'
import { EmailTool } from './EmailTool'
import { GeoTool } from './GeoTool'
import { ImageTool } from './ImageTool'
import { IpTool } from './IpTool'
import { PhoneTool } from './PhoneTool'
import { UsernameTool } from './UsernameTool'

const MODULES: { id: OsintTab; label: string; icon: ReactNode; group: string }[] = [
  { id: 'phone', label: 'Phone number', icon: <Phone size={15} />, group: 'People & accounts' },
  { id: 'username', label: 'Username', icon: <User size={15} />, group: 'People & accounts' },
  { id: 'email', label: 'Email', icon: <AtSign size={15} />, group: 'People & accounts' },
  { id: 'geo', label: 'GEOINT map', icon: <Map size={15} />, group: 'Places & media' },
  { id: 'image', label: 'Image forensics', icon: <Image size={15} />, group: 'Places & media' },
  { id: 'domain', label: 'Domain & DNS', icon: <Globe2 size={15} />, group: 'Infrastructure' },
  { id: 'ip', label: 'IP address', icon: <Network size={15} />, group: 'Infrastructure' },
  { id: 'dork', label: 'Search operators', icon: <Search size={15} />, group: 'Search' },
  { id: 'directory', label: 'Tool directory', icon: <BookMarked size={15} />, group: 'Search' },
]

/** Full-screen OSINT toolkit (replaces the graph area while open). */
export function OsintView() {
  const ui = useUI()
  const tab = ui.osintTab
  const seed = ui.osintSeed
  const groups = [...new Set(MODULES.map((m) => m.group))]
  return (
    <div className="osint">
      <nav className="osint-nav">
        {groups.map((g) => (
          <div key={g}>
            <div className="vtab-group-title">{g}</div>
            {MODULES.filter((m) => m.group === g).map((m) => (
              <div key={m.id} className={'vtab' + (tab === m.id ? ' is-active' : '')} onClick={() => ui.set({ osintTab: m.id, osintSeed: '' })}>
                {m.icon}
                {m.label}
              </div>
            ))}
          </div>
        ))}
        <div className="osint-note">
          Public sources only. Results are leads to verify. Respect local law and platform terms; do not use for stalking or harassment.
        </div>
      </nav>
      <div className="osint-body">
        {/* key forces a fresh module when another module hands over a value (e.g. email → domain) */}
        {tab === 'phone' && <PhoneTool />}
        {tab === 'username' && <UsernameTool key={seed} initial={seed} />}
        {tab === 'email' && <EmailTool />}
        {tab === 'geo' && <GeoTool key={seed} initial={seed} />}
        {tab === 'image' && <ImageTool />}
        {tab === 'domain' && <DomainTool key={seed} initial={seed} />}
        {tab === 'ip' && <IpTool key={seed} initial={seed} />}
        {tab === 'dork' && <DorkTool />}
        {tab === 'directory' && <Directory />}
      </div>
    </div>
  )
}
