export function short(addr: string, head = 6, tail = 4): string {
  if (addr.length <= head + tail + 1) return addr
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`
}

export function amt(n: number): string {
  if (!isFinite(n)) return '—'
  const a = Math.abs(n)
  if (a === 0) return '0'
  if (a >= 1e12) return n.toExponential(1).replace('+', '')
  if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (a >= 1e4) return (n / 1e3).toFixed(1) + 'K'
  if (a >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return n.toPrecision(3).replace(/\.?0+$/, '')
}

export const usd = (n: number | undefined) => (n == null ? '' : `$${amt(n)}`)

export function date(ms: number): string {
  return new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function day(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ')

export function download(name: string, data: string | Blob, type = 'application/json') {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
