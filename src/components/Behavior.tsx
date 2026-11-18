import { useMemo } from 'react'
import { activityProfile } from '../analysis'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Hour × weekday heatmap (UTC) with a time-zone estimate. */
export function Behavior({ times }: { times: number[] }) {
  const p = useMemo(() => activityProfile(times), [times])
  const max = Math.max(1, ...p.grid.flat())
  const fmtOff = (o: number) => `UTC${o >= 0 ? '+' : '−'}${Math.abs(o)}`
  return (
    <div>
      <div className="section-title">Activity heatmap · outgoing transactions (UTC)</div>
      <div className="heatmap">
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="hm-h">{h % 3 === 0 ? h : ''}</div>
        ))}
        {p.grid.map((row, d) => (
          <div key={d} className="hm-row">
            <div className="hm-d">{DAYS[d]}</div>
            {row.map((v, h) => (
              <div
                key={h}
                className="hm-cell"
                title={`${DAYS[d]} ${h}:00 UTC — ${v} tx`}
                style={{ background: v ? `color-mix(in srgb, var(--accent) ${Math.round(15 + (v / max) * 85)}%, transparent)` : undefined }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="stats mt6">
        <div className="stat">
          <div className="stat-k">Estimated time zone</div>
          <div className="stat-v">{p.utcOffset != null ? fmtOff(p.utcOffset) : '—'}</div>
          <div className="stat-sub">confidence: {p.confidence}</div>
        </div>
        <div className="stat">
          <div className="stat-k">Quiet window (UTC)</div>
          <div className="stat-v">{p.sleepStartUtc != null ? `${p.sleepStartUtc}:00–${(p.sleepStartUtc + 6) % 24}:00` : '—'}</div>
          <div className="stat-sub">peak {p.peakHourUtc}:00 UTC</div>
        </div>
      </div>
      <p className="muted small">
        {p.total < 8
          ? `Only ${p.total} outgoing transactions loaded. Load more history for a fingerprint.`
          : p.botLike
            ? 'Activity is spread across all hours: likely automated (bot, service or exchange wallet).'
            : 'Assumes the owner is inactive roughly 01:00–07:00 local time. A behavioral lead, not proof; travel, schedules and automation distort it.'}
      </p>
    </div>
  )
}
