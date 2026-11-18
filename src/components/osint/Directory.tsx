import { useMemo, useState } from 'react'
import { LinkGrid, ToolHeader, type LinkItem } from './kit'

const DIR: Record<string, LinkItem[]> = {
  'Usernames & social': [
    { label: 'WhatsMyName', url: 'https://whatsmyname.app/', note: 'Username across 600+ sites' },
    { label: 'Sherlock (CLI)', url: 'https://github.com/sherlock-project/sherlock' },
    { label: 'Maigret (CLI, reports)', url: 'https://github.com/soxoj/maigret' },
    { label: 'Social Searcher', url: 'https://www.social-searcher.com/' },
    { label: 'Telegram search (tgstat)', url: 'https://tgstat.com/search' },
    { label: 'Reddit user analyser', url: 'https://reddit-user-analyser.netlify.app/' },
    { label: 'Nitter instances (X mirror)', url: 'https://status.d420.de/' },
  ],
  'Email & phone': [
    { label: 'Epieos', url: 'https://epieos.com/' },
    { label: 'Hunter.io', url: 'https://hunter.io/' },
    { label: 'Have I Been Pwned', url: 'https://haveibeenpwned.com/' },
    { label: 'PhoneInfoga (CLI)', url: 'https://github.com/sundowndev/phoneinfoga' },
    { label: 'Holehe (CLI, account check)', url: 'https://github.com/megadose/holehe' },
    { label: 'Local Calling Guide (NANP)', url: 'https://localcallingguide.com/' },
  ],
  'Images & video': [
    { label: 'Google Lens', url: 'https://lens.google.com/' },
    { label: 'Yandex Images', url: 'https://yandex.com/images/' },
    { label: 'TinEye', url: 'https://tineye.com/' },
    { label: 'FotoForensics', url: 'https://fotoforensics.com/' },
    { label: 'Forensically', url: 'https://29a.ch/photo-forensics/' },
    { label: 'InVID / WeVerify plugin', url: 'https://www.invid-project.eu/tools-and-services/invid-verification-plugin/' },
    { label: 'YouTube DataViewer (Amnesty)', url: 'https://citizenevidence.amnestyusa.org/' },
    { label: 'Jeffrey’s EXIF viewer', url: 'https://exifdata.com/' },
  ],
  'GEOINT & imagery': [
    { label: 'Google Earth Web', url: 'https://earth.google.com/web/' },
    { label: 'Sentinel Hub EO Browser', url: 'https://apps.sentinel-hub.com/eo-browser/' },
    { label: 'NASA Worldview', url: 'https://worldview.earthdata.nasa.gov/' },
    { label: 'Overpass Turbo', url: 'https://overpass-turbo.eu/' },
    { label: 'SunCalc', url: 'https://www.suncalc.org/' },
    { label: 'PeakVisor', url: 'https://peakvisor.com/' },
    { label: 'Mapillary', url: 'https://www.mapillary.com/app/' },
    { label: 'GeoNames', url: 'https://www.geonames.org/' },
    { label: 'What3words', url: 'https://what3words.com/' },
    { label: 'Bellingcat OpenStreetMap search', url: 'https://osm-search.bellingcat.com/' },
  ],
  'Transport': [
    { label: 'FlightRadar24', url: 'https://www.flightradar24.com/' },
    { label: 'ADS-B Exchange (unfiltered)', url: 'https://globe.adsbexchange.com/' },
    { label: 'MarineTraffic', url: 'https://www.marinetraffic.com/' },
    { label: 'VesselFinder', url: 'https://www.vesselfinder.com/' },
    { label: 'OpenRailwayMap', url: 'https://www.openrailwaymap.org/' },
    { label: 'FAA aircraft registry', url: 'https://registry.faa.gov/aircraftinquiry/' },
  ],
  'Domains, IPs & infrastructure': [
    { label: 'urlscan.io', url: 'https://urlscan.io/' },
    { label: 'VirusTotal', url: 'https://www.virustotal.com/' },
    { label: 'Shodan', url: 'https://www.shodan.io/' },
    { label: 'Censys', url: 'https://search.censys.io/' },
    { label: 'SecurityTrails', url: 'https://securitytrails.com/' },
    { label: 'DNSDumpster', url: 'https://dnsdumpster.com/' },
    { label: 'crt.sh', url: 'https://crt.sh/' },
    { label: 'BuiltWith', url: 'https://builtwith.com/' },
    { label: 'GreyNoise', url: 'https://viz.greynoise.io/' },
    { label: 'AbuseIPDB', url: 'https://www.abuseipdb.com/' },
  ],
  'Companies & public records': [
    { label: 'OpenCorporates', url: 'https://opencorporates.com/' },
    { label: 'SEC EDGAR', url: 'https://www.sec.gov/edgar/search/' },
    { label: 'UK Companies House', url: 'https://find-and-update.company-information.service.gov.uk/' },
    { label: 'OpenSanctions', url: 'https://www.opensanctions.org/' },
    { label: 'OFAC sanctions search', url: 'https://sanctionssearch.ofac.treas.gov/' },
    { label: 'ICIJ Offshore Leaks', url: 'https://offshoreleaks.icij.org/' },
    { label: 'OCCRP Aleph', url: 'https://aleph.occrp.org/' },
    { label: 'GLEIF (LEI lookup)', url: 'https://search.gleif.org/' },
    { label: 'CourtListener (US courts)', url: 'https://www.courtlistener.com/' },
  ],
  'Archives': [
    { label: 'Wayback Machine', url: 'https://web.archive.org/' },
    { label: 'archive.today', url: 'https://archive.ph/' },
    { label: 'CachedView', url: 'https://cachedview.nl/' },
    { label: 'Common Crawl index', url: 'https://index.commoncrawl.org/' },
  ],
  'Crypto': [
    { label: 'Etherscan', url: 'https://etherscan.io/' },
    { label: 'Tronscan', url: 'https://tronscan.org/' },
    { label: 'mempool.space', url: 'https://mempool.space/' },
    { label: 'Arkham Intelligence', url: 'https://intel.arkm.com/' },
    { label: 'MetaSleuth', url: 'https://metasleuth.io/' },
    { label: 'Breadcrumbs', url: 'https://www.breadcrumbs.app/' },
    { label: 'Chainabuse (scam reports)', url: 'https://www.chainabuse.com/' },
    { label: 'OXT (Bitcoin analysis)', url: 'https://oxt.me/' },
  ],
  'Methodology': [
    { label: 'OSINT Framework', url: 'https://osintframework.com/' },
    { label: 'Bellingcat toolkit', url: 'https://bellingcat.gitbook.io/toolkit' },
    { label: 'Berkeley Protocol (digital investigations)', url: 'https://www.ohchr.org/en/publications/policy-and-methodological-publications/berkeley-protocol-digital-open-source' },
    { label: 'IntelTechniques resources', url: 'https://inteltechniques.com/tools/' },
  ],
}

export function Directory() {
  const [q, setQ] = useState('')
  const groups = useMemo(() => {
    const t = q.trim().toLowerCase()
    return Object.entries(DIR)
      .map(([title, links]) => ({ title, links: links.filter((l) => !t || `${l.label} ${l.note ?? ''} ${title}`.toLowerCase().includes(t)) }))
      .filter((g) => g.links.length)
  }, [q])
  const total = Object.values(DIR).flat().length
  return (
    <div className="tool">
      <ToolHeader title="Tool directory" desc={`${total} curated external tools by category, for steps that need a dedicated service or a local command-line tool.`} />
      <input className="text full mb12" placeholder="Filter tools…" value={q} onChange={(e) => setQ(e.target.value)} />
      <LinkGrid groups={groups} />
    </div>
  )
}
