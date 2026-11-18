import { useState } from 'react'
import { getJSON } from '../../chains/http'
import { dnsFallback, doh, dohAvailable, enc, sha256Hex, type DnsAnswer } from '../../osint/util'
import { useUI } from '../../store'
import { Card, CryptoPivots, KV, LinkGrid, QueryBar, SaveButton, ToolHeader } from './kit'

// Common disposable / temporary mail providers.
const DISPOSABLE = new Set(
  'mailinator.com guerrillamail.com guerrillamail.info sharklasers.com 10minutemail.com 10minutemail.net tempmail.com temp-mail.org tempmail.net yopmail.com yopmail.net trashmail.com getnada.com nada.email dispostable.com maildrop.cc mailnesia.com throwawaymail.com fakeinbox.com emailondeck.com mohmal.com tempail.com mintemail.com mytemp.email burnermail.io spamgourmet.com mailcatch.com moakt.com tempr.email discard.email inboxkitten.com 1secmail.com 1secmail.org emailfake.com tmail.ws tmpmail.org'.split(' '),
)

const PROVIDERS: [RegExp, string][] = [
  [/google\.com|googlemail\.com/i, 'Google (Gmail / Workspace)'],
  [/outlook\.com|protection\.outlook|hotmail/i, 'Microsoft 365 / Outlook'],
  [/protonmail|proton\.me/i, 'Proton Mail (end-to-end encrypted, privacy-focused)'],
  [/yandex/i, 'Yandex Mail'],
  [/mail\.ru/i, 'Mail.ru'],
  [/zoho/i, 'Zoho Mail'],
  [/icloud|apple/i, 'Apple iCloud'],
  [/yahoodns|yahoo/i, 'Yahoo Mail'],
  [/tutanota|tuta\.io/i, 'Tuta (encrypted)'],
  [/mimecast/i, 'Mimecast (corporate gateway)'],
  [/pphosted|proofpoint/i, 'Proofpoint (corporate gateway)'],
  [/mailgun|sendgrid|amazonses/i, 'Transactional mail service'],
]

interface Result {
  email: string
  local: string
  domain: string
  validSyntax: boolean
  mx: string[]
  provider?: string
  spf?: string
  dmarc?: string
  disposable: boolean
  gravatar?: any
  dnsUnknown?: boolean
}

export function EmailTool() {
  const [q, setQ] = useState('')
  const [r, setR] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    const email = q.trim().toLowerCase()
    const m = email.match(/^([^@\s]+)@([^@\s]+\.[a-z]{2,})$/i)
    setBusy(true)
    try {
      if (!m) {
        setR({ email, local: '', domain: '', validSyntax: false, mx: [], disposable: false })
        return
      }
      const [, local, domain] = m
      const [mx, txt, dmarc, hash] = await Promise.all([
        doh(domain, 'MX').catch((): DnsAnswer[] => []),
        doh(domain, 'TXT').catch((): DnsAnswer[] => []),
        doh(`_dmarc.${domain}`, 'TXT').catch((): DnsAnswer[] => []),
        sha256Hex(email),
      ])
      const gravatar = await getJSON(`https://api.gravatar.com/v3/profiles/${hash}`, 6000).catch(() => null)
      let mxHosts = mx.map((a) => a.data.split(' ').pop()!.replace(/\.$/, ''))
      if (!dohAvailable()) {
        const fb = await dnsFallback(domain).catch(() => [])
        mxHosts = fb.filter((r) => r.type === 'MX').map((r) => r.data.split(' ').pop()!.replace(/\.$/, ''))
        txt.push(...fb.filter((r) => r.type === 'TXT').map((r) => ({ name: domain, type: 16, TTL: 0, data: r.data })))
      }
      setR({
        email,
        local,
        domain,
        validSyntax: true,
        mx: mxHosts,
        provider: PROVIDERS.find(([re]) => mxHosts.some((h) => re.test(h)))?.[1],
        spf: txt.map((t) => t.data.replace(/"/g, '')).find((t) => t.startsWith('v=spf1')),
        dmarc: dmarc.map((t) => t.data.replace(/"/g, '')).find((t) => t.startsWith('v=DMARC1')),
        disposable: DISPOSABLE.has(domain),
        gravatar: gravatar?.display_name || gravatar?.profile_url ? gravatar : null,
        dnsUnknown: !dohAvailable() && !mxHosts.length,
      })
    } finally {
      setBusy(false)
    }
  }

  const g = (s: string) => `https://www.google.com/search?q=${enc(s)}`
  return (
    <div className="tool">
      <ToolHeader title="Email" desc="Syntax and deliverability (MX, SPF, DMARC via DNS-over-HTTPS), mail provider, disposable-address check, Gravatar public profile, and pivots to search engines and breach-notification services." />
      <QueryBar value={q} onChange={setQ} onRun={run} placeholder="name@example.com" busy={busy} />
      {r && !r.validSyntax && <div className="callout warn">Not a valid email address.</div>}
      {r?.validSyntax && (
        <>
          <div className="ogrid">
            <Card title="Mailbox" status={r.dnsUnknown ? 'none' : r.mx.length ? (r.disposable ? 'warn' : 'ok') : 'bad'} right={<SaveButton title={`Email ${r.email}`} markdown={() => `- Provider: ${r.provider ?? 'unknown'}\n- MX: ${r.mx.join(', ') || 'none'}\n- Disposable: ${r.disposable}\n- Gravatar: ${r.gravatar ? r.gravatar.profile_url : 'none'}`} />}>
              <KV
                rows={[
                  ['Domain', r.domain],
                  ['Accepts mail', r.dnsUnknown ? 'Unknown: DNS lookups are blocked on this network' : r.mx.length ? 'Yes (MX records present)' : 'No MX records: cannot receive mail'],
                  ['Provider', r.provider ?? (r.mx.length ? 'Self-hosted or other' : '—')],
                  ['MX', r.mx.join(', ')],
                  ['Disposable', r.disposable ? 'Yes — temporary inbox, typical for throwaway accounts' : 'Not in the known list'],
                  ['SPF', r.spf],
                  ['DMARC', r.dmarc],
                ]}
              />
            </Card>
            <Card title="Gravatar profile" status={r.gravatar ? 'ok' : 'none'}>
              {r.gravatar ? (
                <div className="row gap6" style={{ alignItems: 'flex-start' }}>
                  {r.gravatar.avatar_url && <img src={r.gravatar.avatar_url} alt="" className="hit-avatar big" />}
                  <KV
                    rows={[
                      ['Name', r.gravatar.display_name],
                      ['Location', r.gravatar.location],
                      ['Job', [r.gravatar.job_title, r.gravatar.company].filter(Boolean).join(' @ ')],
                      ['About', r.gravatar.description],
                      ['Profile', <a href={r.gravatar.profile_url} target="_blank" rel="noreferrer noopener">{r.gravatar.profile_url}</a>],
                      ['Accounts', (r.gravatar.verified_accounts ?? []).map((a: any) => `${a.service_label}: ${a.url}`).join(' · ')],
                    ]}
                  />
                </div>
              ) : (
                <div className="muted small">No public Gravatar profile for this address.</div>
              )}
              {r.gravatar && <CryptoPivots text={JSON.stringify(r.gravatar)} />}
            </Card>
          </div>
          <div className="row gap6 mb12">
            <button className="mod-ghost sm" onClick={() => useUI.getState().set({ osintTab: 'username', osintSeed: r.local })}>
              Search “{r.local}” as a username →
            </button>
            <button className="mod-ghost sm" onClick={() => useUI.getState().set({ osintTab: 'domain', osintSeed: r.domain })}>
              Investigate domain {r.domain} →
            </button>
          </div>
          <LinkGrid
            groups={[
              {
                title: 'Search',
                links: [
                  { label: 'Google: exact address', url: g(`"${r.email}"`) },
                  { label: 'Google: documents', url: g(`"${r.email}" (filetype:pdf OR filetype:xls OR filetype:doc OR filetype:csv)`) },
                  { label: 'Google: social', url: g(`"${r.email}" (site:facebook.com OR site:linkedin.com OR site:x.com OR site:github.com)`) },
                  { label: 'Google: paste sites', url: g(`"${r.email}" (site:pastebin.com OR site:justpaste.it)`) },
                  { label: 'Bing', url: `https://www.bing.com/search?q=${enc(`"${r.email}"`)}` },
                  { label: 'GitHub commits', url: `https://github.com/search?q=${enc(r.email)}&type=commits` },
                ],
              },
              {
                title: 'Account & breach exposure',
                links: [
                  { label: 'Have I Been Pwned', url: 'https://haveibeenpwned.com/', note: 'Breach notification service; paste the address there' },
                  { label: 'Epieos (Google & accounts)', url: `https://epieos.com/?q=${enc(r.email)}` },
                  { label: 'Hunter email verifier', url: `https://hunter.io/email-verifier/${enc(r.email)}` },
                  { label: 'Intelligence X (public records)', url: `https://intelx.io/?s=${enc(r.email)}` },
                ],
              },
            ]}
          />
        </>
      )}
    </div>
  )
}
