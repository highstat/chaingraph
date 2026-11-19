// Browser bindings for the CVE engine: IndexedDB cache, DNS over HTTPS and the
// NVD key from settings. Imported once by the /cve page and the Radar poller.

import { createStore, get as idbGet, set as idbSet } from 'idb-keyval'
import { doh } from '../osint/util'
import { setCveEnv, type HttpOptions, type HttpResult } from './env'
import { useCveSettings } from './settings'

const store = createStore('chaingraph-cve', 'cache')

// Best-effort active HTTP from the browser. A same-origin or CORS-permissive
// target is read fully; otherwise the browser blocks reading the response, so a
// no-cors request only tells us the host answered (opaque). Full active probing
// (TLS, open ports, header reads of arbitrary sites) needs the MCP server.
async function browserHttp(url: string, opts: HttpOptions = {}): Promise<HttpResult> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 12000)
  const started = Date.now()
  try {
    const res = await fetch(url, { method: opts.method ?? 'GET', headers: opts.headers, redirect: opts.redirect === false ? 'manual' : 'follow', signal: ctl.signal })
    const headers: Record<string, string> = {}
    res.headers.forEach((v, k) => (headers[k] = v))
    const body = (opts.maxBytes ?? 65536) > 0 ? (await res.text().catch(() => '')).slice(0, opts.maxBytes ?? 65536) : ''
    return { status: res.status, finalUrl: res.url || url, redirects: res.redirected ? 1 : 0, headers, body, timeMs: Date.now() - started }
  } catch {
    // CORS blocked the readable request: retry opaque just to confirm the host is alive.
    try {
      await fetch(url, { method: opts.method ?? 'GET', mode: 'no-cors', signal: ctl.signal })
      return { status: 0, finalUrl: url, redirects: 0, headers: {}, body: '', timeMs: Date.now() - started, opaque: true }
    } catch (e) {
      throw e instanceof Error ? e : new Error('request failed')
    }
  } finally {
    clearTimeout(timer)
  }
}

setCveEnv({
  browser: true,
  cacheGet: (k) => idbGet(k, store).catch(() => undefined),
  cacheSet: (k, v) => idbSet(k, v, store).catch(() => {}),
  dns: (name, type) => doh(name, type),
  nvdKey: () => useCveSettings.getState().nvdKey.trim(),
  active: { http: browserHttp },
})
