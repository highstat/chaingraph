import { useMemo, useState } from 'react'
import { enc } from '../../osint/util'
import { Card, LinkGrid, ToolHeader } from './kit'

interface Dork {
  words: string
  exact: string
  any: string
  site: string
  inurl: string
  intitle: string
  intext: string
  filetype: string
  exclude: string
  after: string
  before: string
}

const EMPTY: Dork = { words: '', exact: '', any: '', site: '', inurl: '', intitle: '', intext: '', filetype: '', exclude: '', after: '', before: '' }

const TEMPLATES: { label: string; set: Partial<Dork>; hint: string }[] = [
  { label: 'Person: profiles', set: { site: 'linkedin.com/in OR site:facebook.com OR site:instagram.com OR site:x.com' }, hint: 'Put the full name in “Exact phrase”' },
  { label: 'Person: CV / resume', set: { any: 'resume CV curriculum', filetype: 'pdf' }, hint: 'Name in “Exact phrase”' },
  { label: 'Company: documents', set: { filetype: 'pdf OR filetype:xlsx OR filetype:docx' }, hint: 'Domain in “Site”' },
  { label: 'Company: employees', set: { site: 'linkedin.com/in' }, hint: 'Company name in “Exact phrase”' },
  { label: 'Mentions excluding own site', set: {}, hint: 'Domain in “Exact phrase” and in “Exclude” as -site:domain' },
  { label: 'Paste sites', set: { site: 'pastebin.com OR site:justpaste.it OR site:rentry.co' }, hint: 'Keyword in “Exact phrase”' },
  { label: 'Telegram channels & posts', set: { site: 't.me' }, hint: 'Keyword in “Exact phrase”' },
  { label: 'Forums & Reddit', set: { site: 'reddit.com OR inurl:forum OR inurl:viewtopic' }, hint: 'Keyword in “Exact phrase”' },
  { label: 'Crypto scam reports', set: { any: 'scam fraud "rug pull" phishing' }, hint: 'Address / project name in “Exact phrase”' },
  { label: 'Public spreadsheets', set: { site: 'docs.google.com/spreadsheets' }, hint: 'Keyword in “Exact phrase”' },
  { label: 'Court & legal documents', set: { any: 'court indictment complaint "case no"', filetype: 'pdf' }, hint: 'Name in “Exact phrase”' },
  { label: 'News archive', set: { site: 'reuters.com OR site:apnews.com OR site:bbc.com' }, hint: 'Topic in “Exact phrase”' },
]

export function build(d: Dork): string {
  const parts: string[] = []
  if (d.words.trim()) parts.push(d.words.trim())
  if (d.exact.trim()) parts.push(`"${d.exact.trim()}"`)
  if (d.any.trim()) parts.push(`(${d.any.trim().match(/"[^"]+"|\S+/g)!.join(' OR ')})`)
  if (d.site.trim()) parts.push(`site:${d.site.trim()}`)
  if (d.inurl.trim()) parts.push(`inurl:${d.inurl.trim()}`)
  if (d.intitle.trim()) parts.push(`intitle:"${d.intitle.trim()}"`)
  if (d.intext.trim()) parts.push(`intext:"${d.intext.trim()}"`)
  if (d.filetype.trim()) parts.push(`filetype:${d.filetype.trim()}`)
  if (d.exclude.trim()) parts.push(d.exclude.trim().split(/\s+/).map((w) => (w.startsWith('-') ? w : `-${w}`)).join(' '))
  if (d.after) parts.push(`after:${d.after}`)
  if (d.before) parts.push(`before:${d.before}`)
  return parts.join(' ')
}

export function DorkTool() {
  const [d, setD] = useState<Dork>(EMPTY)
  const q = useMemo(() => build(d), [d])
  const field = (k: keyof Dork, label: string, placeholder = '', type = 'text') => (
    <label className="dork-field">
      <span>{label}</span>
      <input className="text" type={type} value={d[k]} placeholder={placeholder} onChange={(e) => setD({ ...d, [k]: e.target.value })} />
    </label>
  )
  return (
    <div className="tool">
      <ToolHeader title="Search operators (dorks)" desc="Build precise queries with search operators and run them on several engines. Templates cover common investigation needs." />
      <Card title="Templates">
        <div className="chips">
          {TEMPLATES.map((t) => (
            <button key={t.label} className="chip" title={t.hint} onClick={() => setD({ ...EMPTY, exact: d.exact, ...t.set })}>
              {t.label}
            </button>
          ))}
        </div>
      </Card>
      <Card title="Query">
        <div className="dork-grid">
          {field('exact', 'Exact phrase', 'John Smith')}
          {field('words', 'All words', 'crypto wallet')}
          {field('any', 'Any of', 'resume cv "about me"')}
          {field('site', 'Site / domain', 'example.com')}
          {field('inurl', 'In URL', 'admin')}
          {field('intitle', 'In title', 'index of')}
          {field('intext', 'In text', '')}
          {field('filetype', 'File type', 'pdf')}
          {field('exclude', 'Exclude words', 'jobs -site:example.com')}
          {field('after', 'After', '', 'date')}
          {field('before', 'Before', '', 'date')}
        </div>
        <div className="dork-out">
          <code>{q || 'Fill in fields to build a query'}</code>
          <button className="mod-ghost sm" disabled={!q} onClick={() => navigator.clipboard.writeText(q)}>
            Copy
          </button>
          <button className="mod-ghost sm" onClick={() => setD(EMPTY)}>
            Clear
          </button>
        </div>
      </Card>
      {q && (
        <LinkGrid
          groups={[
            {
              title: 'Run on',
              links: [
                { label: 'Google', url: `https://www.google.com/search?q=${enc(q)}` },
                { label: 'Bing', url: `https://www.bing.com/search?q=${enc(q)}` },
                { label: 'DuckDuckGo', url: `https://duckduckgo.com/?q=${enc(q)}` },
                { label: 'Yandex', url: `https://yandex.com/search/?text=${enc(q)}` },
                { label: 'Brave Search', url: `https://search.brave.com/search?q=${enc(q)}` },
                { label: 'Google News', url: `https://news.google.com/search?q=${enc(q)}` },
                { label: 'Google Images', url: `https://www.google.com/search?tbm=isch&q=${enc(q)}` },
                { label: 'Google Scholar', url: `https://scholar.google.com/scholar?q=${enc(q)}` },
              ],
            },
          ]}
        />
      )}
    </div>
  )
}
