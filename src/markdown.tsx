import type { ReactNode } from 'react'

/**
 * Tiny, safe markdown subset for notes: headings, lists, quotes, **bold**,
 * *italic*, `code`, [text](url) and Obsidian-style [[wikilinks]] to case nodes.
 * Produces React elements, never raw HTML.
 */
export function renderNote(src: string, onLink: (target: string) => void): ReactNode[] {
  const lines = src.split('\n')
  const out: ReactNode[] = []
  let list: ReactNode[] = []
  const flush = () => {
    if (list.length) out.push(<ul key={`ul${out.length}`}>{list}</ul>)
    list = []
  }
  lines.forEach((line, i) => {
    const li = line.match(/^\s*[-*]\s+(.*)/)
    if (li) {
      list.push(<li key={i}>{inline(li[1], onLink)}</li>)
      return
    }
    flush()
    const h = line.match(/^(#{1,3})\s+(.*)/)
    if (h) {
      const Tag = (`h${h[1].length + 2}`) as 'h3' | 'h4' | 'h5'
      out.push(<Tag key={i}>{inline(h[2], onLink)}</Tag>)
    } else if (line.startsWith('> ')) {
      out.push(<blockquote key={i}>{inline(line.slice(2), onLink)}</blockquote>)
    } else if (line.trim()) {
      out.push(<p key={i}>{inline(line, onLink)}</p>)
    }
  })
  flush()
  return out
}

const TOKEN = /(\[\[[^\]]+\]\]|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g

function inline(text: string, onLink: (t: string) => void): ReactNode[] {
  return text.split(TOKEN).map((part, i) => {
    if (!part) return null
    if (part.startsWith('[[')) {
      const target = part.slice(2, -2)
      return (
        <a key={i} className="wikilink" onClick={() => onLink(target)}>
          {target}
        </a>
      )
    }
    if (part.startsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>
    if (part.startsWith('*') && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/)
    if (link)
      return (
        <a key={i} href={link[2]} target="_blank" rel="noreferrer noopener">
          {link[1]}
        </a>
      )
    return part
  })
}
