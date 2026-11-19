// Radar: re-scan chosen targets on a schedule and log what changed
// (new hosts, opened ports, new CVEs / KEV entries, new subdomains).

import { Bell, Loader2, Play, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { parseTarget } from '../../cve/scan'
import { openScan, pollRadar, useCve, useRadar } from '../../cve/state'
import { toast } from '../../store'
import { Card, ToolHeader } from '../osint/kit'

export function RadarTab() {
  const radar = useRadar()
  const history = useCve((s) => s.history)
  const [target, setTarget] = useState('')
  const [interval, setIntervalH] = useState(24)

  const add = () => {
    const t = parseTarget(target)
    if (!t) return toast('Enter a domain, IP, CIDR or ASN')
    radar.add(t.value, interval)
    setTarget('')
    void pollRadar(t.value)
  }

  return (
    <div className="tool">
      <ToolHeader
        title="Radar"
        desc="Monitor targets for changes. ChainGraph re-runs the passive scan at the chosen interval while it is open, compares it with the previous baseline and records new hosts, opened or closed ports, new CVEs, new known-exploited CVEs and new subdomains."
      />
      <form
        className="query-bar"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <div className="search-box big">
          <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Domain, IP, CIDR or ASN to watch" spellCheck={false} />
        </div>
        <select className="dropdown" value={interval} onChange={(e) => setIntervalH(Number(e.target.value))}>
          <option value={1}>Every hour</option>
          <option value={6}>Every 6 hours</option>
          <option value={24}>Daily</option>
          <option value={168}>Weekly</option>
        </select>
        <button className="mod-cta" disabled={!target.trim()}>
          <Plus size={14} /> Watch
        </button>
        {'Notification' in window && Notification.permission !== 'granted' && (
          <button type="button" className="mod-ghost" onClick={() => void Notification.requestPermission()}>
            <Bell size={14} /> Enable notifications
          </button>
        )}
      </form>

      <Card title={`Watched targets (${radar.items.length})`}>
        {!radar.items.length ? (
          <div className="muted small">Nothing watched yet. Add a target above, or press “Watch” on a scan result.</div>
        ) : (
          <table className="ctbl">
            <thead>
              <tr>
                <th>Target</th>
                <th style={{ width: 140 }}>Interval</th>
                <th style={{ width: 200 }}>Last check</th>
                <th style={{ width: 160 }}>Baseline</th>
                <th style={{ width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {radar.items.map((i) => {
                const last = history.find((h) => h.target === i.target)
                return (
                  <tr key={i.target}>
                    <td className="mono">
                      {last ? (
                        <a onClick={() => void openScan(last.id)} title="Open the latest scan">
                          {i.target}
                        </a>
                      ) : (
                        i.target
                      )}
                      {i.error && <div className="neg small">{i.error}</div>}
                    </td>
                    <td>
                      <select className="dropdown sm" value={i.intervalH} onChange={(e) => radar.patch(i.target, { intervalH: Number(e.target.value) })}>
                        <option value={1}>hourly</option>
                        <option value={6}>6 h</option>
                        <option value={24}>daily</option>
                        <option value={168}>weekly</option>
                      </select>
                    </td>
                    <td className="small">{i.running ? <Loader2 size={13} className="spin" /> : i.lastRun ? new Date(i.lastRun).toLocaleString() : 'never'}</td>
                    <td className="small text2">{i.baseline ? `${Object.keys(i.baseline.ports).length} hosts · ${i.baseline.cves.length} CVEs · ${i.baseline.kev.length} KEV · score ${i.baseline.score}` : '–'}</td>
                    <td>
                      <div className="row gap4">
                        <button className="chip" title="Check now" disabled={i.running} onClick={() => void pollRadar(i.target)}>
                          <Play size={11} />
                        </button>
                        <button className="chip" title="Stop watching" onClick={() => radar.remove(i.target)}>
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <div className="muted small mt6">Checks run only while ChainGraph is open in a tab. Cached data (InternetDB 12 h, NVD 3 days) keeps repeated checks light.</div>
      </Card>

      <Card
        title={`Change log (${radar.events.length})`}
        right={
          radar.events.length > 0 && (
            <button className="chip" onClick={radar.clearLog}>
              Clear
            </button>
          )
        }
      >
        {!radar.events.length ? (
          <div className="muted small">No events yet.</div>
        ) : (
          <div className="events">
            {radar.events.map((e, i) => (
              <div key={i} className={'event ' + e.level}>
                <span className="muted small">{new Date(e.at).toLocaleString()}</span>
                <span className="mono small">{e.target}</span>
                <span>{e.text}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
