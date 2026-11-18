import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getJSON } from '../../chains/http'
import { ago, enc } from '../../osint/util'
import { Card, CryptoPivots, LinkGrid, QueryBar, SaveButton, ToolHeader, type LinkItem } from './kit'

interface Hit {
  site: string
  url: string
  found: boolean | null // null = error / unknown
  name?: string
  bio?: string
  created?: number
  avatar?: string
  extra?: string
}

type Checker = (u: string) => Promise<Omit<Hit, 'site'>>

// Platforms with public, CORS-enabled APIs: checked live from the browser.
const LIVE: Record<string, Checker> = {
  GitHub: async (u) => {
    const r = await fetch(`https://api.github.com/users/${enc(u)}`)
    if (r.status === 404) return { url: `https://github.com/${u}`, found: false }
    const j = await r.json()
    return { url: j.html_url, found: true, name: j.name, bio: [j.bio, j.company, j.location, j.blog, j.email].filter(Boolean).join(' · '), created: Date.parse(j.created_at), avatar: j.avatar_url, extra: `${j.public_repos} repos, ${j.followers} followers` }
  },
  GitLab: async (u) => {
    const j = await getJSON(`https://gitlab.com/api/v4/users?username=${enc(u)}`)
    const x = j[0]
    return x ? { url: x.web_url, found: true, name: x.name, avatar: x.avatar_url, extra: x.state } : { url: `https://gitlab.com/${u}`, found: false }
  },
  Keybase: async (u) => {
    const j = await getJSON(`https://keybase.io/_/api/1.0/user/lookup.json?usernames=${enc(u)}`)
    const x = j.them?.[0]
    if (!x) return { url: `https://keybase.io/${u}`, found: false }
    const proofs = (x.proofs_summary?.all ?? []).map((p: any) => `${p.proof_type}:${p.nametag}`).join(', ')
    const wallets = Object.values(x.cryptocurrency_addresses ?? {}).flat().map((w: any) => w.address).join(' ')
    return { url: `https://keybase.io/${u}`, found: true, name: x.profile?.full_name, bio: [x.profile?.bio, x.profile?.location].filter(Boolean).join(' · '), created: x.basics?.ctime * 1000, extra: [proofs && `Proofs: ${proofs}`, wallets && `Wallets: ${wallets}`].filter(Boolean).join(' — ') }
  },
  'Hacker News': async (u) => {
    const j = await getJSON(`https://hacker-news.firebaseio.com/v0/user/${enc(u)}.json`)
    return j ? { url: `https://news.ycombinator.com/user?id=${u}`, found: true, bio: (j.about ?? '').replace(/<[^>]+>/g, ' '), created: j.created * 1000, extra: `karma ${j.karma}` } : { url: `https://news.ycombinator.com/user?id=${u}`, found: false }
  },
  Bluesky: async (u) => {
    const handle = u.includes('.') ? u : `${u}.bsky.social`
    const r = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${enc(handle)}`)
    if (!r.ok) return { url: `https://bsky.app/profile/${handle}`, found: false }
    const j = await r.json()
    return { url: `https://bsky.app/profile/${j.handle}`, found: true, name: j.displayName, bio: j.description, created: Date.parse(j.createdAt), avatar: j.avatar, extra: `${j.followersCount} followers, ${j.postsCount} posts` }
  },
  Lichess: async (u) => {
    const r = await fetch(`https://lichess.org/api/user/${enc(u)}`)
    if (!r.ok) return { url: `https://lichess.org/@/${u}`, found: false }
    const j = await r.json()
    return { url: j.url, found: true, name: j.profile?.realName, bio: [j.profile?.bio, j.profile?.location, j.profile?.flag].filter(Boolean).join(' · '), created: j.createdAt, extra: `seen ${ago(j.seenAt)}` }
  },
  'DEV.to': async (u) => {
    const r = await fetch(`https://dev.to/api/users/by_username?url=${enc(u)}`)
    if (!r.ok) return { url: `https://dev.to/${u}`, found: false }
    const j = await r.json()
    return { url: `https://dev.to/${u}`, found: true, name: j.name, bio: [j.summary, j.location, j.twitter_username && `x.com/${j.twitter_username}`, j.github_username && `github.com/${j.github_username}`].filter(Boolean).join(' · '), avatar: j.profile_image }
  },
  'Mastodon (mastodon.social)': async (u) => {
    const r = await fetch(`https://mastodon.social/api/v1/accounts/lookup?acct=${enc(u)}`)
    if (!r.ok) return { url: `https://mastodon.social/@${u}`, found: false }
    const j = await r.json()
    return { url: j.url, found: true, name: j.display_name, bio: (j.note ?? '').replace(/<[^>]+>/g, ' '), created: Date.parse(j.created_at), avatar: j.avatar, extra: `${j.followers_count} followers` }
  },
  npm: async (u) => {
    const j = await getJSON(`https://registry.npmjs.org/-/v1/search?text=maintainer:${enc(u)}&size=5`)
    const n = j.total ?? 0
    return { url: `https://www.npmjs.com/~${u}`, found: n > 0, extra: n ? `${n} packages, e.g. ${j.objects.map((o: any) => o.package.name).slice(0, 3).join(', ')}` : undefined }
  },
}

// Profile URL templates (Sherlock / WhatsMyName style), opened in a new tab.
const SITES: [string, string, string][] = [
  ['Social', 'X / Twitter', 'https://x.com/{u}'],
  ['Social', 'Instagram', 'https://www.instagram.com/{u}/'],
  ['Social', 'Facebook', 'https://www.facebook.com/{u}'],
  ['Social', 'TikTok', 'https://www.tiktok.com/@{u}'],
  ['Social', 'Threads', 'https://www.threads.net/@{u}'],
  ['Social', 'Snapchat', 'https://www.snapchat.com/add/{u}'],
  ['Social', 'Reddit', 'https://www.reddit.com/user/{u}'],
  ['Social', 'Pinterest', 'https://www.pinterest.com/{u}/'],
  ['Social', 'Tumblr', 'https://{u}.tumblr.com'],
  ['Social', 'VK', 'https://vk.com/{u}'],
  ['Social', 'Telegram', 'https://t.me/{u}'],
  ['Social', 'LinkedIn', 'https://www.linkedin.com/in/{u}'],
  ['Social', 'Quora', 'https://www.quora.com/profile/{u}'],
  ['Social', '9GAG', 'https://9gag.com/u/{u}'],
  ['Social', 'Imgur', 'https://imgur.com/user/{u}'],
  ['Video & audio', 'YouTube', 'https://www.youtube.com/@{u}'],
  ['Video & audio', 'Twitch', 'https://www.twitch.tv/{u}'],
  ['Video & audio', 'Kick', 'https://kick.com/{u}'],
  ['Video & audio', 'Vimeo', 'https://vimeo.com/{u}'],
  ['Video & audio', 'SoundCloud', 'https://soundcloud.com/{u}'],
  ['Video & audio', 'Last.fm', 'https://www.last.fm/user/{u}'],
  ['Video & audio', 'Rumble', 'https://rumble.com/user/{u}'],
  ['Dev & tech', 'GitHub', 'https://github.com/{u}'],
  ['Dev & tech', 'GitLab', 'https://gitlab.com/{u}'],
  ['Dev & tech', 'Bitbucket', 'https://bitbucket.org/{u}/'],
  ['Dev & tech', 'Docker Hub', 'https://hub.docker.com/u/{u}'],
  ['Dev & tech', 'PyPI', 'https://pypi.org/user/{u}/'],
  ['Dev & tech', 'npm', 'https://www.npmjs.com/~{u}'],
  ['Dev & tech', 'Hugging Face', 'https://huggingface.co/{u}'],
  ['Dev & tech', 'Kaggle', 'https://www.kaggle.com/{u}'],
  ['Dev & tech', 'Replit', 'https://replit.com/@{u}'],
  ['Dev & tech', 'CodePen', 'https://codepen.io/{u}'],
  ['Dev & tech', 'LeetCode', 'https://leetcode.com/u/{u}/'],
  ['Dev & tech', 'Codeforces', 'https://codeforces.com/profile/{u}'],
  ['Dev & tech', 'HackerOne', 'https://hackerone.com/{u}'],
  ['Dev & tech', 'TryHackMe', 'https://tryhackme.com/p/{u}'],
  ['Dev & tech', 'Habr', 'https://habr.com/ru/users/{u}/'],
  ['Dev & tech', 'Keybase', 'https://keybase.io/{u}'],
  ['Dev & tech', 'Hacker News', 'https://news.ycombinator.com/user?id={u}'],
  ['Creative', 'Behance', 'https://www.behance.net/{u}'],
  ['Creative', 'Dribbble', 'https://dribbble.com/{u}'],
  ['Creative', 'DeviantArt', 'https://www.deviantart.com/{u}'],
  ['Creative', 'Flickr', 'https://www.flickr.com/people/{u}/'],
  ['Creative', 'Medium', 'https://medium.com/@{u}'],
  ['Creative', 'Substack', 'https://{u}.substack.com'],
  ['Creative', 'WordPress', 'https://{u}.wordpress.com'],
  ['Creative', 'Blogger', 'https://{u}.blogspot.com'],
  ['Creative', 'LiveJournal', 'https://{u}.livejournal.com'],
  ['Creative', 'Letterboxd', 'https://letterboxd.com/{u}/'],
  ['Creative', 'MyAnimeList', 'https://myanimelist.net/profile/{u}'],
  ['Money & commerce', 'PayPal.me', 'https://www.paypal.me/{u}'],
  ['Money & commerce', 'Cash App', 'https://cash.app/${u}'],
  ['Money & commerce', 'Venmo', 'https://account.venmo.com/u/{u}'],
  ['Money & commerce', 'Patreon', 'https://www.patreon.com/{u}'],
  ['Money & commerce', 'Buy Me a Coffee', 'https://buymeacoffee.com/{u}'],
  ['Money & commerce', 'Ko-fi', 'https://ko-fi.com/{u}'],
  ['Money & commerce', 'eBay', 'https://www.ebay.com/usr/{u}'],
  ['Money & commerce', 'Etsy', 'https://www.etsy.com/shop/{u}'],
  ['Money & commerce', 'OpenSea', 'https://opensea.io/{u}'],
  ['Money & commerce', 'Linktree', 'https://linktr.ee/{u}'],
  ['Gaming', 'Steam', 'https://steamcommunity.com/id/{u}'],
  ['Gaming', 'Xbox (gamertag)', 'https://xboxgamertag.com/search/{u}'],
  ['Gaming', 'PSN Profiles', 'https://psnprofiles.com/{u}'],
  ['Gaming', 'Chess.com', 'https://www.chess.com/member/{u}'],
  ['Gaming', 'Lichess', 'https://lichess.org/@/{u}'],
  ['Gaming', 'Speedrun.com', 'https://www.speedrun.com/users/{u}'],
  ['Gaming', 'Duolingo', 'https://www.duolingo.com/profile/{u}'],
  ['Other', 'About.me', 'https://about.me/{u}'],
  ['Other', 'Gravatar', 'https://gravatar.com/{u}'],
  ['Other', 'Internet Archive', 'https://archive.org/details/@{u}'],
  ['Other', 'SlideShare', 'https://www.slideshare.net/{u}'],
  ['Other', 'Trello', 'https://trello.com/{u}'],
  ['Other', 'Untappd', 'https://untappd.com/user/{u}'],
  ['Other', 'Pikabu', 'https://pikabu.ru/@{u}'],
  ['Other', 'Product Hunt', 'https://www.producthunt.com/@{u}'],
]

function variations(u: string): string[] {
  const base = u.replace(/^@/, '')
  const parts = base.split(/[._-]/).filter(Boolean)
  const out = new Set<string>([base, base.toLowerCase()])
  if (parts.length > 1) ['', '.', '_', '-'].forEach((s) => out.add(parts.join(s)))
  ;['1', '01', '123', '_', 'official', 'real'].forEach((s) => out.add(base + s))
  out.add(base.replace(/\d+$/, ''))
  return [...out].filter((x) => x && x !== base).slice(0, 12)
}

export function UsernameTool({ initial = '' }: { initial?: string }) {
  const [q, setQ] = useState(initial)
  const [u, setU] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [busy, setBusy] = useState(false)

  const run = async (value = q) => {
    const name = value.trim().replace(/^@/, '')
    if (!name) return
    setQ(name)
    setU(name)
    setBusy(true)
    setHits(Object.keys(LIVE).map((site) => ({ site, url: '', found: null })))
    await Promise.all(
      Object.entries(LIVE).map(async ([site, fn]) => {
        let h: Hit
        try {
          h = { site, ...(await fn(name)) }
        } catch {
          h = { site, url: '', found: null }
        }
        setHits((prev) => prev.map((x) => (x.site === site ? h : x)))
      }),
    )
    setBusy(false)
  }

  useEffect(() => {
    if (initial) void run(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial])

  const groups = [...new Set(SITES.map((s) => s[0]))].map((g) => ({
    title: g,
    links: SITES.filter((s) => s[0] === g).map(([, label, url]): LinkItem => ({ label, url: url.replace('{u}', u) })),
  }))
  const found = hits.filter((h) => h.found)

  return (
    <div className="tool">
      <ToolHeader
        title="Username"
        desc={`Live checks on ${Object.keys(LIVE).length} platforms with open APIs (profile details, creation date, linked accounts and wallets), direct profile links for ${SITES.length} more, and likely variations.`}
      />
      <QueryBar value={q} onChange={setQ} onRun={() => run()} placeholder="username or @handle" busy={busy} />
      {u && (
        <>
          <Card
            title={`Live checks · ${found.length} found`}
            right={<SaveButton title={`Username ${u}`} markdown={() => found.map((h) => `- **${h.site}**: ${h.url}${h.name ? ` — ${h.name}` : ''}${h.created ? ` (since ${new Date(h.created).toISOString().slice(0, 10)})` : ''}${h.bio ? `\n  ${h.bio}` : ''}`).join('\n') || '_No profiles found on live-checked platforms._'} />}
          >
            <div className="hits">
              {hits.map((h) => (
                <div key={h.site} className={'hit' + (h.found ? ' found' : '')}>
                  <span className="hit-icon">
                    {h.found === null && busy ? <Loader2 size={14} className="spin" /> : h.found ? <CheckCircle2 size={14} /> : h.found === false ? <XCircle size={14} /> : <span className="muted">?</span>}
                  </span>
                  {h.avatar && <img src={h.avatar} alt="" className="hit-avatar" referrerPolicy="no-referrer" />}
                  <div className="hit-body">
                    <div className="row gap6">
                      <b>{h.site}</b>
                      {h.found && (
                        <a href={h.url} target="_blank" rel="noreferrer noopener" className="ellipsis small">
                          {h.url}
                        </a>
                      )}
                      {h.found === false && <span className="muted small">not found</span>}
                      {h.found === null && !busy && <span className="muted small">check failed</span>}
                    </div>
                    {h.found && (
                      <div className="small text2">
                        {[h.name, h.created && `since ${new Date(h.created).toISOString().slice(0, 10)}`, h.extra].filter(Boolean).join(' · ')}
                      </div>
                    )}
                    {h.found && h.bio && <div className="small muted">{h.bio}</div>}
                  </div>
                </div>
              ))}
            </div>
            <CryptoPivots text={found.map((h) => `${h.bio ?? ''} ${h.extra ?? ''}`).join(' ')} />
          </Card>
          <Card title="Variations to try">
            <div className="chips">
              {variations(u).map((v) => (
                <button key={v} className="chip mono" onClick={() => run(v)}>
                  {v}
                </button>
              ))}
            </div>
          </Card>
          <LinkGrid
            groups={[
              {
                title: 'Search engines',
                links: [
                  { label: 'Google: exact username', url: `https://www.google.com/search?q=${enc(`"${u}"`)}` },
                  { label: 'Google: profiles', url: `https://www.google.com/search?q=${enc(`"${u}" (profile OR user OR account)`)}` },
                  { label: 'Bing', url: `https://www.bing.com/search?q=${enc(`"${u}"`)}` },
                  { label: 'Yandex', url: `https://yandex.com/search/?text=${enc(`"${u}"`)}` },
                  { label: 'WhatsMyName (600+ sites)', url: `https://whatsmyname.app/?q=${enc(u)}` },
                ],
              },
              ...groups,
            ]}
          />
        </>
      )}
    </div>
  )
}
