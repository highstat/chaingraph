// Geospatial helpers: coordinate parsing/formatting, distance & bearing.

import { forward as toMgrs, toPoint as fromMgrs } from 'mgrs'

export interface LatLng {
  lat: number
  lng: number
}

/** Parse decimal, DMS, MGRS or a map URL (Google/OSM/Bing/Yandex). */
export function parseCoords(input: string): LatLng | null {
  const s = input.trim()
  const at = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || s.match(/[?&](?:q|ll|query|center)=(-?\d+\.\d+)(?:,|%2C)(-?\d+\.\d+)/i)
  if (at) return valid(Number(at[1]), Number(at[2]))
  const osm = s.match(/#map=\d+\/(-?\d+\.\d+)\/(-?\d+\.\d+)/)
  if (osm) return valid(Number(osm[1]), Number(osm[2]))
  const yx = s.match(/[?&]ll=(-?\d+\.\d+)%2C(-?\d+\.\d+)/)
  if (yx) return valid(Number(yx[2]), Number(yx[1]))
  const dec = s.match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/)
  if (dec) return valid(Number(dec[1]), Number(dec[2]))
  const dms = [...s.matchAll(/(\d{1,3})[°\s]+(\d{1,2})['′\s]+(\d{1,2}(?:\.\d+)?)["″\s]*([NSEW])/gi)]
  if (dms.length === 2) {
    const v = dms.map(([, d, m, sec, h]) => (Number(d) + Number(m) / 60 + Number(sec) / 3600) * (/[SW]/i.test(h) ? -1 : 1))
    const latFirst = /[NS]/i.test(dms[0][4])
    return valid(latFirst ? v[0] : v[1], latFirst ? v[1] : v[0])
  }
  const mgrs = s.replace(/\s+/g, '').toUpperCase()
  if (/^\d{1,2}[C-X][A-Z]{2}\d{2,10}$/.test(mgrs)) {
    try {
      const [lng, lat] = fromMgrs(mgrs)
      return valid(lat, lng)
    } catch {
      return null
    }
  }
  return null
}

function valid(lat: number, lng: number): LatLng | null {
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null
}

export function dms(v: number, pos: string, neg: string): string {
  const a = Math.abs(v)
  const d = Math.floor(a)
  const m = Math.floor((a - d) * 60)
  const sec = ((a - d - m / 60) * 3600).toFixed(1)
  return `${d}°${m}'${sec}"${v >= 0 ? pos : neg}`
}

export const fmtDms = (p: LatLng) => `${dms(p.lat, 'N', 'S')} ${dms(p.lng, 'E', 'W')}`

export function fmtMgrs(p: LatLng): string {
  try {
    const m = toMgrs([p.lng, p.lat], 5)
    return `${m.slice(0, -10)} ${m.slice(-10, -5)} ${m.slice(-5)}`
  } catch {
    return '—'
  }
}

const R = 6371008.8
const rad = (d: number) => (d * Math.PI) / 180

export function distance(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function bearing(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat))
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng))
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/** Destination point given start, bearing (deg) and distance (m). */
export function destination(p: LatLng, brg: number, dist: number): LatLng {
  const d = dist / R
  const b = rad(brg)
  const lat1 = rad(p.lat)
  const lng1 = rad(p.lng)
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b))
  const lng2 = lng1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2))
  return { lat: (lat2 * 180) / Math.PI, lng: (((lng2 * 180) / Math.PI + 540) % 360) - 180 }
}

export const compass = (deg: number) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(deg / 22.5) % 16]

export function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 100000 ? 0 : 2)} km (${(m / 1609.344).toFixed(2)} mi)` : `${m.toFixed(0)} m (${(m * 3.28084).toFixed(0)} ft)`
}

/** External map / imagery / street-level services centered on a point. */
export function geoLinks(p: LatLng) {
  const { lat, lng } = p
  const ll = `${lat.toFixed(6)},${lng.toFixed(6)}`
  return [
    {
      title: 'Maps & satellite',
      links: [
        { label: 'Google Maps', url: `https://www.google.com/maps/@${ll},18z` },
        { label: 'Google Earth', url: `https://earth.google.com/web/@${ll},500a,1000d,35y,0h,0t,0r` },
        { label: 'Bing Maps (aerial)', url: `https://www.bing.com/maps?cp=${lat}~${lng}&lvl=18&style=a` },
        { label: 'Yandex Maps', url: `https://yandex.com/maps/?ll=${lng},${lat}&z=17&l=sat` },
        { label: 'Apple Maps', url: `https://maps.apple.com/?ll=${ll}&z=17&t=k` },
        { label: 'OpenStreetMap', url: `https://www.openstreetmap.org/#map=18/${lat}/${lng}` },
        { label: 'Wikimapia', url: `https://wikimapia.org/#lat=${lat}&lon=${lng}&z=17` },
        { label: 'Sentinel Hub EO Browser', url: `https://apps.sentinel-hub.com/eo-browser/?zoom=14&lat=${lat}&lng=${lng}` },
        { label: 'Zoom Earth (weather/fires)', url: `https://zoom.earth/#view=${lat},${lng},12z` },
        { label: 'NASA Worldview', url: `https://worldview.earthdata.nasa.gov/?v=${lng - 0.5},${lat - 0.3},${lng + 0.5},${lat + 0.3}` },
      ],
    },
    {
      title: 'Street level',
      links: [
        { label: 'Google Street View', url: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${ll}` },
        { label: 'Yandex Panoramas', url: `https://yandex.com/maps/?ll=${lng},${lat}&z=17&panorama%5Bpoint%5D=${lng},${lat}` },
        { label: 'Mapillary', url: `https://www.mapillary.com/app/?lat=${lat}&lng=${lng}&z=17` },
        { label: 'KartaView', url: `https://kartaview.org/map/@${lat},${lng},17z` },
        { label: 'Bing Streetside', url: `https://www.bing.com/maps?cp=${lat}~${lng}&lvl=19&style=x` },
      ],
    },
    {
      title: 'Analysis & context',
      links: [
        { label: 'SunCalc (sun path)', url: `https://www.suncalc.org/#/${lat},${lng},17/null/null/null/null` },
        { label: 'PeakVisor (mountains)', url: `https://peakvisor.com/panorama.html?lat=${lat}&lng=${lng}` },
        { label: 'Overpass Turbo', url: `https://overpass-turbo.eu/?C=${lat};${lng};17` },
        { label: 'FlightRadar24', url: `https://www.flightradar24.com/${lat.toFixed(2)},${lng.toFixed(2)}/10` },
        { label: 'ADS-B Exchange', url: `https://globe.adsbexchange.com/?lat=${lat}&lon=${lng}&zoom=10` },
        { label: 'MarineTraffic', url: `https://www.marinetraffic.com/en/ais/home/centerx:${lng.toFixed(3)}/centery:${lat.toFixed(3)}/zoom:12` },
        { label: 'OpenCellID (cell towers)', url: `https://opencellid.org/#zoom=15&lat=${lat}&lon=${lng}` },
        { label: 'Wigle (Wi-Fi networks)', url: `https://wigle.net/map?maplat=${lat}&maplon=${lng}&mapzoom=16` },
      ],
    },
  ]
}
