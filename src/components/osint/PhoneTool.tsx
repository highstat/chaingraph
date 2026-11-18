import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode, type PhoneNumber } from 'libphonenumber-js/max'
import { useMemo, useState } from 'react'
import { enc } from '../../osint/util'
import { Card, KV, LinkGrid, QueryBar, SaveButton, ToolHeader, type LinkItem } from './kit'

const TYPE_LABEL: Record<string, string> = {
  MOBILE: 'Mobile',
  FIXED_LINE: 'Fixed line (landline)',
  FIXED_LINE_OR_MOBILE: 'Fixed line or mobile (not distinguishable in this numbering plan)',
  TOLL_FREE: 'Toll-free',
  PREMIUM_RATE: 'Premium rate',
  SHARED_COST: 'Shared cost',
  VOIP: 'VoIP (internet telephony)',
  PERSONAL_NUMBER: 'Personal number (follow-me)',
  PAGER: 'Pager',
  UAN: 'Universal access number (company)',
  VOICEMAIL: 'Voicemail access',
}

const regionName = (cc?: string) => {
  if (!cc) return ''
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(cc) ?? cc
  } catch {
    return cc
  }
}

/** North American Numbering Plan specifics (US, Canada, Caribbean). */
function nanpNotes(n: PhoneNumber): string[] {
  if (n.countryCallingCode !== '1') return []
  const nat = n.nationalNumber
  const npa = nat.slice(0, 3)
  const nxx = nat.slice(3, 6)
  const line = nat.slice(6)
  const out: string[] = [`Area code (NPA) ${npa}, exchange (NXX) ${nxx}, line ${line}.`]
  if (/^8(00|33|44|55|66|77|88)$/.test(npa)) out.push('Toll-free area code: usually a business or a virtual number routed anywhere.')
  if (npa === '900') out.push('900 premium-rate service.')
  if (/^5(00|21|22|23|24|25|26|27|28|29|33|44|66|77|88)$/.test(npa)) out.push('Personal communications service (5XX) number: often virtual / follow-me.')
  if (nxx === '555' && /^01\d\d$/.test(line)) out.push('555-01XX is reserved for fiction: this number does not exist.')
  out.push('Numbers can be ported between carriers, so the original carrier of the NPA-NXX block may differ from the current one.')
  return out
}

export function PhoneTool() {
  const [q, setQ] = useState('')
  const [country, setCountry] = useState<CountryCode>('US')
  const [run, setRun] = useState('')

  const n = useMemo(() => (run ? parsePhoneNumberFromString(run, country) : undefined), [run, country])
  const countries = useMemo(() => getCountries().map((c) => ({ c, name: regionName(c) })).sort((a, b) => a.name.localeCompare(b.name)), [])

  const formats = useMemo(() => {
    if (!n) return []
    const nat = n.nationalNumber
    const set = new Set<string>([n.number, n.formatInternational(), n.formatNational(), nat, `${n.countryCallingCode}${nat}`])
    if (n.countryCallingCode === '1' && nat.length === 10) {
      const [a, b, c] = [nat.slice(0, 3), nat.slice(3, 6), nat.slice(6)]
      ;[`(${a}) ${b}-${c}`, `${a}-${b}-${c}`, `${a}.${b}.${c}`, `${a} ${b} ${c}`, `1-${a}-${b}-${c}`, `+1 (${a}) ${b}-${c}`].forEach((f) => set.add(f))
    }
    return [...set]
  }, [n])

  const groups = useMemo(() => {
    if (!n) return []
    const e164 = n.number
    const digits = e164.replace('+', '')
    const nat = n.nationalNumber
    const quoted = formats.slice(0, 6).map((f) => `"${f}"`).join(' OR ')
    const g = (query: string) => `https://www.google.com/search?q=${enc(query)}`
    const search: LinkItem[] = [
      { label: 'Google: all formats', url: g(quoted) },
      { label: 'Bing: all formats', url: `https://www.bing.com/search?q=${enc(quoted)}` },
      { label: 'DuckDuckGo', url: `https://duckduckgo.com/?q=${enc(quoted)}` },
      { label: 'Yandex', url: `https://yandex.com/search/?text=${enc(quoted)}` },
      { label: 'Social profiles', url: g(`${quoted} (site:facebook.com OR site:instagram.com OR site:linkedin.com OR site:x.com OR site:tiktok.com OR site:vk.com)`) },
      { label: 'Telegram mentions', url: g(`${quoted} (site:t.me OR site:telegram.me)`) },
      { label: 'Classifieds / marketplaces', url: g(`${quoted} (site:craigslist.org OR site:olx.* OR site:avito.ru OR site:ebay.com OR site:offerup.com)`) },
      { label: 'Documents (PDF, XLS, DOC)', url: g(`${quoted} (filetype:pdf OR filetype:xls OR filetype:xlsx OR filetype:doc OR filetype:csv)`) },
      { label: 'Paste sites', url: g(`${quoted} (site:pastebin.com OR site:ghostbin.* OR site:justpaste.it OR site:controlc.com)`) },
      { label: 'Forums & Reddit', url: g(`${quoted} (site:reddit.com OR inurl:forum OR inurl:thread)`) },
      { label: 'Business listings', url: g(`${quoted} (site:yelp.com OR site:yellowpages.com OR site:bbb.org OR site:google.com/maps)`) },
      { label: 'Crypto / scam reports', url: g(`${quoted} (scam OR fraud OR crypto OR bitcoin OR usdt)`) },
    ]
    const messengers: LinkItem[] = [
      { label: 'WhatsApp chat', url: `https://wa.me/${digits}`, note: 'Opens a chat if the number has WhatsApp; shows the profile name/photo inside the app' },
      { label: 'Telegram', url: `https://t.me/+${digits}`, note: 'Resolves only if the user allows finding by phone number' },
      { label: 'Signal', url: `https://signal.me/#p/+${digits}` },
      { label: 'Viber', url: `viber://chat?number=%2B${digits}` },
    ]
    const reputation: LinkItem[] = [
      { label: 'Truecaller (caller ID)', url: `https://www.truecaller.com/search/${(n.country ?? 'us').toLowerCase()}/${nat}` },
      { label: 'Sync.ME (caller ID)', url: `https://sync.me/search/?number=${enc(e164)}` },
      { label: 'Should I Answer (spam reports)', url: `https://www.shouldianswer.com/phone-number/${nat}` },
      { label: 'Tellows (spam score)', url: `https://www.tellows.com/num/${enc(e164)}` },
      { label: '800notes (complaints)', url: n.countryCallingCode === '1' ? `https://800notes.com/Phone.aspx/1-${nat.slice(0, 3)}-${nat.slice(3, 6)}-${nat.slice(6)}` : `https://800notes.com/` },
    ]
    const telecom: LinkItem[] =
      n.countryCallingCode === '1'
        ? [
            { label: 'Local Calling Guide: carrier & rate center', url: `https://localcallingguide.com/lca_prefix.php?npa=${nat.slice(0, 3)}&nxx=${nat.slice(3, 6)}`, note: 'Original carrier (OCN) and city/state of the NPA-NXX block' },
            { label: 'NANPA area code map', url: `https://nationalnanpa.com/area_code_maps/display.html?${nat.slice(0, 3)}` },
            { label: 'FCC complaint data search', url: `https://opendata.fcc.gov/browse?q=${nat}` },
          ]
        : [{ label: 'ITU numbering plans', url: 'https://www.itu.int/oth/T0202.aspx?parent=T0202' }]
    return [
      { title: 'Search the number everywhere', links: search },
      { title: 'Messenger presence', links: messengers },
      { title: 'Caller ID & spam reputation', links: reputation },
      { title: 'Telecom data', links: telecom },
    ]
  }, [n, formats])

  return (
    <div className="tool">
      <ToolHeader
        title="Phone number"
        desc="Offline validation and classification (Google libphonenumber metadata), every common format, and pivots: search engines, messengers, caller-ID and spam databases, telecom records."
      />
      <QueryBar
        value={q}
        onChange={setQ}
        onRun={() => setRun(q.trim())}
        placeholder="+1 212 555 0123, 8 (999) 123-45-67, 020 7946 0000…"
        extra={
          <select className="dropdown" value={country} onChange={(e) => setCountry(e.target.value as CountryCode)} title="Default country for numbers without +code">
            {countries.map(({ c, name }) => (
              <option key={c} value={c}>
                {name} (+{getCountryCallingCode(c)})
              </option>
            ))}
          </select>
        }
      />
      {run && !n && <div className="callout warn">Could not parse this number. Add the international prefix (+…) or pick the right default country.</div>}
      {n && (
        <>
          <div className="ogrid">
            <Card title="Classification" status={n.isValid() ? 'ok' : n.isPossible() ? 'warn' : 'bad'}>
              <KV
                rows={[
                  ['Valid', n.isValid() ? 'Yes — assigned range in the numbering plan' : n.isPossible() ? 'Possible length, but not an assigned range' : 'No'],
                  ['Country', n.country ? `${regionName(n.country)} (${n.country})` : `+${n.countryCallingCode} (shared code)`],
                  ['Line type', TYPE_LABEL[n.getType() ?? ''] ?? 'Unknown'],
                  ['E.164', <code>{n.number}</code>],
                  ['International', n.formatInternational()],
                  ['National', n.formatNational()],
                  ['URI', n.getURI()],
                ]}
              />
            </Card>
            <Card title="Notes">
              <ul className="notes">
                {nanpNotes(n).map((x) => (
                  <li key={x}>{x}</li>
                ))}
                {n.getType() === 'VOIP' && <li>VoIP numbers are cheap to obtain online and often used for throwaway accounts.</li>}
                {n.getType() === 'MOBILE' && <li>Mobile numbers are commonly tied to messenger accounts: check the messenger links below.</li>}
                <li>Owner identity of private numbers is not public data. Lawful routes: the carrier via legal process, or what the person published themselves.</li>
              </ul>
            </Card>
          </div>
          <Card title="Formats to search" right={<SaveButton title={`Phone ${n.number}`} markdown={() => `- E.164: ${n.number}\n- Country: ${regionName(n.country)}\n- Type: ${TYPE_LABEL[n.getType() ?? ''] ?? 'unknown'}\n- Valid: ${n.isValid()}\n- Formats: ${formats.join(' · ')}`} />}>
            <div className="chips">
              {formats.map((f) => (
                <button key={f} className="chip mono" onClick={() => navigator.clipboard.writeText(f)} title="Copy">
                  {f}
                </button>
              ))}
            </div>
          </Card>
          <LinkGrid groups={groups} />
        </>
      )}
    </div>
  )
}
