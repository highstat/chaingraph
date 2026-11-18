/**
 * ChainGraph mark: a faceted hexagonal crystal whose facets are the edges of a
 * graph meeting in a central hub. Drawn with currentColor, so it always
 * follows the accent color; facet seams use the theme background.
 */
export const LOGO_FACETS: [string, number][] = [
  ['M12 12 12 1.8 20.8 6.9Z', 1],
  ['M12 12 20.8 6.9 20.8 17.1Z', 0.7],
  ['M12 12 20.8 17.1 12 22.2Z', 0.46],
  ['M12 12 12 22.2 3.2 17.1Z', 0.58],
  ['M12 12 3.2 17.1 3.2 6.9Z', 0.8],
  ['M12 12 3.2 6.9 12 1.8Z', 0.9],
]

export function Logo({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={'logo-mark ' + className} role="img" aria-label="ChainGraph">
      <g stroke="var(--bg)" strokeWidth="0.9" strokeLinejoin="round">
        {LOGO_FACETS.map(([d, o]) => (
          <path key={d} d={d} fill="currentColor" fillOpacity={o} />
        ))}
      </g>
      <circle cx="12" cy="12" r="2.3" fill="var(--bg)" />
      <circle cx="12" cy="12" r="1.15" fill="currentColor" />
    </svg>
  )
}

/** Standalone SVG (for the favicon) in a given accent on a given background. */
export function logoSvg(accent: string, bg: string): string {
  const facets = LOGO_FACETS.map(([d, o]) => `<path d="${d}" fill="${accent}" fill-opacity="${o}"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 -3 30 30"><rect x="-3" y="-3" width="30" height="30" rx="7" fill="${bg}"/><g stroke="${bg}" stroke-width="0.9" stroke-linejoin="round">${facets}</g><circle cx="12" cy="12" r="2.3" fill="${bg}"/><circle cx="12" cy="12" r="1.15" fill="${accent}"/></svg>`
}
