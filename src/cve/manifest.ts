// Dependency-manifest parsing for the stack audit.

import type { OsvQuery } from './sources'

const clean = (v: string) => v.replace(/^[\^~>=<v\s]+/, '').split(/[\s,|]/)[0]

/** Detect the manifest format and extract (ecosystem, name, version) triples. */
export function parseManifest(text: string): { queries: OsvQuery[]; products: string[]; format: string } {
  const t = text.trim()
  const queries: OsvQuery[] = []
  const products: string[] = []
  if (t.startsWith('{')) {
    try {
      const j = JSON.parse(t)
      if (j.packages && typeof j.packages === 'object') {
        // package-lock.json v2/v3
        for (const [path, p] of Object.entries<any>(j.packages)) {
          if (!path || !p.version) continue
          queries.push({ ecosystem: 'npm', name: path.replace(/^.*node_modules\//, ''), version: p.version })
        }
        return { queries, products, format: 'package-lock.json' }
      }
      if (j.dependencies || j.devDependencies) {
        for (const [name, v] of Object.entries<string>({ ...j.dependencies, ...j.devDependencies })) if (/\d/.test(v)) queries.push({ ecosystem: 'npm', name, version: clean(v) })
        return { queries, products, format: 'package.json (declared ranges)' }
      }
      if (j.packages || j['packages-dev']) {
        for (const p of [...(j.packages ?? []), ...(j['packages-dev'] ?? [])]) queries.push({ ecosystem: 'Packagist', name: p.name, version: clean(p.version) })
        return { queries, products, format: 'composer.lock' }
      }
    } catch {
      /* not JSON */
    }
  }
  const lines = t.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('//'))
  if (/^module\s/m.test(t) || lines.some((l) => /^require\s*\(/.test(l))) {
    for (const l of lines) {
      const m = l.match(/^(?:require\s+)?([\w./-]+\.[\w./-]+)\s+(v[\d.]+[\w.+-]*)/)
      if (m) queries.push({ ecosystem: 'Go', name: m[1], version: m[2] })
    }
    return { queries, products, format: 'go.mod' }
  }
  if (lines.some((l) => /^\[\[package\]\]/.test(l))) {
    let name = ''
    for (const l of lines) {
      const n = l.match(/^name\s*=\s*"(.+)"/)
      const v = l.match(/^version\s*=\s*"(.+)"/)
      if (n) name = n[1]
      if (v && name) queries.push({ ecosystem: 'crates.io', name, version: v[1] })
    }
    return { queries, products, format: 'Cargo.lock' }
  }
  for (const l of lines) {
    const py = l.match(/^([A-Za-z0-9_.-]+)(?:\[.*\])?\s*==\s*([\w.+-]+)/)
    if (py) {
      queries.push({ ecosystem: 'PyPI', name: py[1], version: py[2] })
      continue
    }
    const gem = l.match(/^([a-z0-9_-]+) \(([\d.]+)\)$/i)
    if (gem) {
      queries.push({ ecosystem: 'RubyGems', name: gem[1], version: gem[2] })
      continue
    }
    const eco = l.match(/^(npm|pypi|go|maven|nuget|rubygems|packagist|crates\.io):([^@\s]+)@([\w.+-]+)$/i)
    if (eco) {
      const map: Record<string, string> = { npm: 'npm', pypi: 'PyPI', go: 'Go', maven: 'Maven', nuget: 'NuGet', rubygems: 'RubyGems', packagist: 'Packagist', 'crates.io': 'crates.io' }
      queries.push({ ecosystem: map[eco[1].toLowerCase()], name: eco[2], version: eco[3] })
      continue
    }
    if (/\d+\.\d+/.test(l)) products.push(l.replace(/[/:]/g, ' ').replace(/\s+/g, ' '))
  }
  return { queries, products, format: queries.length ? 'requirements / list' : 'product list' }
}
