const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function encode(bytes: Uint8Array): string {
  let n = 0n
  for (const b of bytes) n = n * 256n + BigInt(b)
  let s = ''
  while (n > 0n) {
    s = ALPHABET[Number(n % 58n)] + s
    n /= 58n
  }
  for (const b of bytes) {
    if (b !== 0) break
    s = '1' + s
  }
  return s
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource))
}

const cache = new Map<string, string>()

/** TRON hex address (41…) → base58check (T…). */
export async function tronHexToBase58(hex: string): Promise<string> {
  const h = hex.toLowerCase()
  const hit = cache.get(h)
  if (hit) return hit
  const payload = hexToBytes(h)
  const check = (await sha256(await sha256(payload))).slice(0, 4)
  const full = new Uint8Array(payload.length + 4)
  full.set(payload)
  full.set(check, payload.length)
  const out = encode(full)
  cache.set(h, out)
  return out
}
