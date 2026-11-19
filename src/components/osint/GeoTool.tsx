import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Crosshair, Download, MapPin, Ruler, Sun, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as SunCalc from 'suncalc'
import { getJSON } from '../../chains/http'
import { bearing, compass, destination, distance, fmtDist, fmtDms, fmtMgrs, geoLinks, parseCoords, type LatLng } from '../../osint/geo'
import { download } from '../../format'
import { toast } from '../../store'
import { Card, KV, LinkGrid, SaveButton, ToolHeader } from './kit'

interface Pin extends LatLng {
  id: string
  label: string
}

const PIN_KEY = 'chaingraph.geo.pins'

// OpenStreetMap feature presets for "what is around this point" (Overpass).
const PRESETS: [string, string][] = [
  ['Places of worship', 'nwr[amenity=place_of_worship]'],
  ['Schools & universities', 'nwr[amenity~"^(school|university|college)$"]'],
  ['Fuel stations', 'nwr[amenity=fuel]'],
  ['Masts & towers (telecom)', 'nwr[man_made~"^(mast|tower|communications_tower)$"]'],
  ['Power towers & lines', 'node[power=tower]'],
  ['Wind turbines', 'nwr["generator:source"=wind]'],
  ['Water towers', 'nwr[man_made=water_tower]'],
  ['Bridges', 'way[bridge=yes][name]'],
  ['Railway stations', 'nwr[railway~"^(station|halt)$"]'],
  ['Bus stops', 'node[highway=bus_stop]'],
  ['Hospitals & clinics', 'nwr[amenity~"^(hospital|clinic)$"]'],
  ['Police & fire stations', 'nwr[amenity~"^(police|fire_station)$"]'],
  ['Banks & ATMs', 'nwr[amenity~"^(bank|atm)$"]'],
  ['Hotels', 'nwr[tourism~"^(hotel|hostel|motel)$"]'],
  ['Airfields & helipads', 'nwr[aeroway~"^(aerodrome|helipad)$"]'],
  ['Stadiums & sports', 'nwr[leisure~"^(stadium|sports_centre)$"]'],
  ['Surveillance cameras (mapped)', 'node[man_made=surveillance]'],
  ['Named buildings', 'way[building][name]'],
]

const LAYERS = {
  Satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }),
  Streets: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }),
  // CARTO basemaps now require an API key; Esri's dark canvas is keyless.
  Dark: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 16, maxZoom: 20, attribution: 'Tiles © Esri' }),
  Topographic: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '© OpenTopoMap (CC-BY-SA)' }),
}
const LABELS = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 })

const dot = (color: string, size = 12) =>
  L.divIcon({ className: '', html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 2px rgba(0,0,0,.4)"></div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] })

type Side = 'point' | 'sun' | 'nearby' | 'pins'

export function GeoTool({ initial = '' }: { initial?: string }) {
  const host = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layers = useRef<{ point?: L.Marker; sun?: L.LayerGroup; nearby?: L.LayerGroup; measure?: L.LayerGroup; pins?: L.LayerGroup }>({})
  const [q, setQ] = useState(initial)
  const [p, setP] = useState<LatLng | null>(null)
  const [side, setSide] = useState<Side>('point')
  const [info, setInfo] = useState<{ addr?: any; elev?: number; tz?: string } | null>(null)
  const [pins, setPins] = useState<Pin[]>(() => JSON.parse(localStorage.getItem(PIN_KEY) ?? '[]'))
  const [measure, setMeasure] = useState<LatLng[] | null>(null)
  const measureRef = useRef(measure)
  measureRef.current = measure

  // Sun / chronolocation state
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [minutes, setMinutes] = useState(() => new Date().getUTCHours() * 60 + new Date().getUTCMinutes())
  const [shadowBrg, setShadowBrg] = useState('')
  const [ratio, setRatio] = useState('')

  // Nearby state
  const [preset, setPreset] = useState(0)
  const [radius, setRadius] = useState(500)
  const [nearby, setNearby] = useState<{ name: string; lat: number; lng: number; tags: Record<string, string> }[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const m = L.map(host.current!, { zoomControl: true, worldCopyJump: true }).setView([30, 10], 3)
    LAYERS.Satellite.addTo(m)
    LABELS.addTo(m)
    L.control.layers(LAYERS, { Labels: LABELS }, { position: 'topright' }).addTo(m)
    L.control.scale({ imperial: true }).addTo(m)
    layers.current.sun = L.layerGroup().addTo(m)
    layers.current.nearby = L.layerGroup().addTo(m)
    layers.current.measure = L.layerGroup().addTo(m)
    layers.current.pins = L.layerGroup().addTo(m)
    m.on('click', (e: L.LeafletMouseEvent) => {
      const pt = { lat: e.latlng.lat, lng: e.latlng.lng }
      if (measureRef.current) setMeasure((prev) => [...(prev ?? []), pt].slice(-2))
      else setP(pt)
    })
    map.current = m
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(host.current!)
    return () => {
      ro.disconnect()
      m.remove()
    }
  }, [])

  useEffect(() => {
    if (initial) void search(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial])

  // Point marker + info (reverse geocode, elevation, time zone)
  useEffect(() => {
    const m = map.current
    if (!m || !p) return
    layers.current.point?.remove()
    layers.current.point = L.marker([p.lat, p.lng], { icon: dot('#2dd4bf', 16) }).addTo(m)
    setInfo(null)
    let alive = true
    Promise.all([
      getJSON(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${p.lat}&lon=${p.lng}&zoom=18&addressdetails=1&accept-language=en`, 10000).catch(() => null),
      getJSON(`https://api.open-meteo.com/v1/elevation?latitude=${p.lat}&longitude=${p.lng}`, 8000).catch(() => null),
      getJSON(`https://timeapi.io/api/TimeZone/coordinate?latitude=${p.lat}&longitude=${p.lng}`, 8000).catch(() => null),
    ]).then(([addr, elev, tz]) => alive && setInfo({ addr, elev: elev?.elevation?.[0], tz: tz?.timeZone }))
    return () => {
      alive = false
    }
  }, [p])

  // Pins layer
  useEffect(() => {
    localStorage.setItem(PIN_KEY, JSON.stringify(pins))
    const g = layers.current.pins
    if (!g) return
    g.clearLayers()
    for (const pin of pins) L.marker([pin.lat, pin.lng], { icon: dot('#f472b6') }).bindTooltip(pin.label).addTo(g)
  }, [pins])

  // Measure layer
  useEffect(() => {
    const g = layers.current.measure
    if (!g) return
    g.clearLayers()
    for (const pt of measure ?? []) L.marker([pt.lat, pt.lng], { icon: dot('#fbbf24', 10) }).addTo(g)
    if (measure?.length === 2) L.polyline(measure.map((x) => [x.lat, x.lng] as [number, number]), { color: '#fbbf24', weight: 3, dashArray: '6 6' }).addTo(g)
  }, [measure])

  // Sun position for the chosen UTC date/time
  const when = useMemo(() => new Date(`${date}T00:00:00Z`).getTime() + minutes * 60000, [date, minutes])
  const sun = useMemo(() => {
    if (!p) return null
    // suncalc 2.x: degrees, azimuth clockwise from north.
    const pos = SunCalc.getPosition(new Date(when), p.lat, p.lng)
    const az = pos.azimuth
    const alt = pos.altitude
    const times = SunCalc.getTimes(new Date(when), p.lat, p.lng)
    return { az, alt, shadowAz: (az + 180) % 360, ratio: alt > 0 ? 1 / Math.tan((alt * Math.PI) / 180) : Infinity, times }
  }, [p, when])

  useEffect(() => {
    const g = layers.current.sun
    if (!g) return
    g.clearLayers()
    if (!p || !sun || side !== 'sun') return
    const len = 300
    L.polyline([[p.lat, p.lng], [destination(p, sun.az, len).lat, destination(p, sun.az, len).lng]], { color: '#facc15', weight: 4 }).bindTooltip(`Sun ${sun.az.toFixed(1)}°`).addTo(g)
    if (sun.alt > 0) {
      const sl = Math.min(len, 60 * sun.ratio)
      const end = destination(p, sun.shadowAz, sl)
      L.polyline([[p.lat, p.lng], [end.lat, end.lng]], { color: '#111', weight: 6, opacity: 0.85 }).bindTooltip(`Shadow ${sun.shadowAz.toFixed(1)}°`).addTo(g)
    }
  }, [p, sun, side])

  const localTime = (d: Date | null) => {
    if (!d || isNaN(d.getTime())) return '—' // polar day/night: no sunrise or sunset
    try {
      return d.toLocaleString('en-GB', { timeZone: info?.tz ?? 'UTC', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })
    } catch {
      return d.toISOString().slice(11, 16)
    }
  }

  // Chronolocation: find times on the chosen date whose shadow matches the observation.
  const chrono = useMemo(() => {
    if (!p || shadowBrg === '') return null
    const target = Number(shadowBrg)
    const r = ratio === '' ? null : Number(ratio)
    const start = new Date(`${date}T00:00:00Z`).getTime()
    const cands: { t: number; err: number }[] = []
    for (let m = 0; m < 1440; m += 2) {
      const pos = SunCalc.getPosition(new Date(start + m * 60000), p.lat, p.lng)
      if (pos.altitude <= 0) continue
      const sh = (pos.azimuth + 180) % 360
      let err = Math.abs(((sh - target + 540) % 360) - 180)
      if (r != null) err += Math.abs(1 / Math.tan((pos.altitude * Math.PI) / 180) - r) * 20
      cands.push({ t: start + m * 60000, err })
    }
    cands.sort((a, b) => a.err - b.err)
    const best = cands[0]
    if (!best) return []
    // A second, clearly different time can match equally well (morning vs. afternoon): show it too.
    const alt = cands.find((c) => Math.abs(c.t - best.t) > 3 * 3600000 && c.err <= best.err + 5)
    return alt ? [best, alt] : [best]
  }, [p, shadowBrg, ratio, date])

  const search = async (value = q) => {
    const s = value.trim()
    if (!s) return
    const c = parseCoords(s)
    if (c) {
      setP(c)
      map.current?.setView([c.lat, c.lng], 17)
      return
    }
    setBusy(true)
    try {
      const r = await getJSON(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=en&q=${encodeURIComponent(s)}`, 10000)
      if (!r[0]) return toast('Place not found', 'info')
      const pt = { lat: Number(r[0].lat), lng: Number(r[0].lon) }
      setP(pt)
      map.current?.setView([pt.lat, pt.lng], 16)
    } finally {
      setBusy(false)
    }
  }

  const runNearby = async () => {
    if (!p) return
    setBusy(true)
    setNearby(null)
    try {
      const query = `[out:json][timeout:25];(${PRESETS[preset][1]}(around:${radius},${p.lat},${p.lng}););out center 300;`
      // Public Overpass instances are often busy: try mirrors in turn.
      let j: any = null
      for (const url of ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
        const ctl = new AbortController()
        const timer = setTimeout(() => ctl.abort(), 25000)
        try {
          const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }), signal: ctl.signal })
          if (res.ok) {
            j = await res.json()
            break
          }
        } catch {
          /* next mirror */
        } finally {
          clearTimeout(timer)
        }
      }
      if (!j) throw new Error('All Overpass servers are busy, try again in a minute')
      const items = (j.elements ?? []).map((e: any) => ({
        name: e.tags?.name || e.tags?.operator || e.tags?.ref || PRESETS[preset][0],
        lat: e.lat ?? e.center?.lat,
        lng: e.lon ?? e.center?.lon,
        tags: e.tags ?? {},
      }))
      setNearby(items)
      const g = layers.current.nearby!
      g.clearLayers()
      L.circle([p.lat, p.lng], { radius, color: '#2dd4bf', weight: 1, fillOpacity: 0.05 }).addTo(g)
      for (const it of items) L.marker([it.lat, it.lng], { icon: dot('#60a5fa', 10) }).bindTooltip(it.name).addTo(g)
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const exportPins = (kind: 'geojson' | 'kml') => {
    if (kind === 'geojson') {
      download('pins.geojson', JSON.stringify({ type: 'FeatureCollection', features: pins.map((x) => ({ type: 'Feature', properties: { name: x.label }, geometry: { type: 'Point', coordinates: [x.lng, x.lat] } })) }, null, 1), 'application/geo+json')
    } else {
      const body = pins.map((x) => `<Placemark><name>${x.label.replace(/[<&]/g, '')}</name><Point><coordinates>${x.lng},${x.lat},0</coordinates></Point></Placemark>`).join('')
      download('pins.kml', `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${body}</Document></kml>`, 'application/vnd.google-earth.kml+xml')
    }
  }

  const a = info?.addr?.address ?? {}
  const measureText = measure?.length === 2 ? `${fmtDist(distance(measure[0], measure[1]))} · bearing ${bearing(measure[0], measure[1]).toFixed(1)}° ${compass(bearing(measure[0], measure[1]))}` : null

  return (
    <div className="tool geo">
      <ToolHeader title="GEOINT" desc="Satellite and street maps, coordinate conversion (decimal, DMS, MGRS, map URLs), reverse geocoding, elevation, time zone, sun & shadow chronolocation, OpenStreetMap features around a point, measurements, pins and imagery pivots." />
      <form
        className="query-bar"
        onSubmit={(e) => {
          e.preventDefault()
          void search()
        }}
      >
        <div className="search-box big">
          <Crosshair size={15} className="muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Place name, "48.8584, 2.2945", 48°51'30"N 2°17'40"E, 31U DQ 48251 11932, or a Google Maps link`} spellCheck={false} />
        </div>
        <button className="mod-cta" disabled={busy}>Locate</button>
        <button type="button" className={'mod-ghost' + (measure ? ' on-accent' : '')} onClick={() => setMeasure(measure ? null : [])} title="Click two points on the map">
          <Ruler size={14} /> {measure ? 'Measuring…' : 'Measure'}
        </button>
      </form>
      {measureText && <div className="callout">Distance {measureText}</div>}
      <div className="geo-layout">
        <div ref={host} className="geo-map" />
        <div className="geo-side">
          <div className="seg four">
            {(
              [
                ['point', 'Point'],
                ['sun', 'Sun'],
                ['nearby', 'Nearby'],
                ['pins', `Pins ${pins.length}`],
              ] as [Side, string][]
            ).map(([k, l]) => (
              <button key={k} className={side === k ? 'on' : ''} onClick={() => setSide(k)}>
                {l}
              </button>
            ))}
          </div>
          {!p && side !== 'pins' && <div className="empty-pane">Click the map or search a place / coordinates.</div>}

          {p && side === 'point' && (
            <>
              <KV
                rows={[
                  ['Decimal', <code>{`${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`}</code>],
                  ['DMS', <code>{fmtDms(p)}</code>],
                  ['MGRS', <code>{fmtMgrs(p)}</code>],
                  ['Address', info?.addr?.display_name ?? (info ? '—' : 'loading…')],
                  ['Country', a.country && `${a.country} (${String(a.country_code ?? '').toUpperCase()})`],
                  ['Elevation', info?.elev != null ? `${info.elev} m` : undefined],
                  ['Time zone', info?.tz],
                  ['Local time', info?.tz ? localTime(new Date()) : undefined],
                ]}
              />
              <div className="row gap6 mt6">
                <button className="mod-ghost sm" onClick={() => setPins([...pins, { ...p, id: crypto.randomUUID(), label: a.road || a.city || a.town || a.village || `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}` }])}>
                  <MapPin size={12} /> Pin
                </button>
                <button className="mod-ghost sm" onClick={() => navigator.clipboard.writeText(`${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`)}>Copy</button>
                <SaveButton title={`Location ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`} markdown={() => `- Coordinates: ${p.lat.toFixed(6)}, ${p.lng.toFixed(6)} (${fmtDms(p)}, MGRS ${fmtMgrs(p)})\n- Address: ${info?.addr?.display_name ?? '?'}\n- Elevation: ${info?.elev ?? '?'} m · Time zone: ${info?.tz ?? '?'}\n- Map: https://www.openstreetmap.org/#map=18/${p.lat}/${p.lng}`} />
              </div>
            </>
          )}

          {p && side === 'sun' && sun && (
            <>
              <label className="slabel">Date (UTC)</label>
              <input type="date" className="text full" value={date} onChange={(e) => setDate(e.target.value)} />
              <label className="slabel">
                Time {String(Math.floor(minutes / 60)).padStart(2, '0')}:{String(minutes % 60).padStart(2, '0')} UTC · local {localTime(new Date(when))}
              </label>
              <input type="range" min={0} max={1439} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="full" />
              <KV
                rows={[
                  ['Sun azimuth', `${sun.az.toFixed(1)}° ${compass(sun.az)}`],
                  ['Sun altitude', `${sun.alt.toFixed(1)}°${sun.alt <= 0 ? ' (below horizon)' : ''}`],
                  ['Shadow direction', sun.alt > 0 ? `${sun.shadowAz.toFixed(1)}° ${compass(sun.shadowAz)}` : '—'],
                  ['Shadow / height', sun.alt > 0 ? `${sun.ratio.toFixed(2)} × object height` : '—'],
                  ['Sunrise', localTime(sun.times.sunrise)],
                  ['Solar noon', localTime(sun.times.solarNoon)],
                  ['Sunset', localTime(sun.times.sunset)],
                  ['Golden hour', localTime(sun.times.goldenHour)],
                ]}
              />
              <div className="section-title mt6">
                <Sun size={12} /> Chronolocation
              </div>
              <div className="hint">Enter the shadow direction measured in the photo (degrees from north) and, optionally, shadow length ÷ object height. ChainGraph finds the matching time on the chosen date.</div>
              <div className="row gap6 mt6">
                <input className="num" placeholder="shadow °" value={shadowBrg} onChange={(e) => setShadowBrg(e.target.value)} />
                <input className="num" placeholder="ratio" value={ratio} onChange={(e) => setRatio(e.target.value)} />
              </div>
              {chrono?.map((c) => (
                <div key={c.t} className="callout" onClick={() => setMinutes(Math.round((c.t - new Date(`${date}T00:00:00Z`).getTime()) / 60000))} style={{ cursor: 'pointer' }}>
                  Best match {new Date(c.t).toISOString().slice(11, 16)} UTC · local {localTime(new Date(c.t))} · error {c.err.toFixed(1)}
                </div>
              ))}
            </>
          )}

          {p && side === 'nearby' && (
            <>
              <select className="dropdown full" value={preset} onChange={(e) => setPreset(Number(e.target.value))}>
                {PRESETS.map(([l], i) => (
                  <option key={l} value={i}>
                    {l}
                  </option>
                ))}
              </select>
              <label className="slabel">Radius {radius} m</label>
              <input type="range" min={100} max={5000} step={100} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="full" />
              <button className="mod-cta full-btn" disabled={busy} onClick={runNearby}>
                {busy ? 'Querying OpenStreetMap…' : 'Find around point'}
              </button>
              {nearby && <div className="muted small mt6">{nearby.length} result(s)</div>}
              <div className="near-list">
                {nearby?.slice(0, 200).map((n, i) => (
                  <div key={i} className="list-row" onClick={() => map.current?.setView([n.lat, n.lng], 18)}>
                    <span className="ellipsis grow">{n.name}</span>
                    <span className="muted small">{fmtDist(distance(p, n)).split(' (')[0]}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {side === 'pins' && (
            <>
              <div className="row gap6">
                <button className="mod-ghost sm" disabled={!pins.length} onClick={() => exportPins('geojson')}>
                  <Download size={12} /> GeoJSON
                </button>
                <button className="mod-ghost sm" disabled={!pins.length} onClick={() => exportPins('kml')}>
                  <Download size={12} /> KML
                </button>
              </div>
              {pins.map((pin) => (
                <div key={pin.id} className="list-row">
                  <MapPin size={12} className="muted" />
                  <input className="pin-label" value={pin.label} onChange={(e) => setPins(pins.map((x) => (x.id === pin.id ? { ...x, label: e.target.value } : x)))} />
                  <button className="clickable-icon" onClick={() => (setP(pin), map.current?.setView([pin.lat, pin.lng], 17))}>
                    <Crosshair size={12} />
                  </button>
                  <button className="clickable-icon" onClick={() => setPins(pins.filter((x) => x.id !== pin.id))}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              {!pins.length && <div className="empty-pane">No pins yet.</div>}
            </>
          )}
        </div>
      </div>
      {p && <LinkGrid groups={geoLinks(p)} />}
      {p && (
        <Card title="Tip">
          <div className="small text2">
            Typical geolocation workflow: identify distinctive features in the photo (signs, architecture, vegetation, road markings), narrow the region, use “Nearby”
            to find matching features (masts, churches, bridges), verify with street-level imagery, then confirm the time with sun and shadow.
          </div>
        </Card>
      )}
    </div>
  )
}
