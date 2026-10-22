// Stores share-link payloads so a link carries a short id instead of the whole map. The payload is already
// encrypted by the app with a key that only lives in the link's fragment, so this store never sees a map.

interface Env {
  DB: {
    prepare(query: string): { bind(...values: unknown[]): { run(): Promise<unknown>; first<T>(): Promise<T | null> } }
  }
  SHARE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> }
}

// Well above the ~8,000-char self-contained link, so maps too large for `#m=` still share, while the free
// plan's daily write quota keeps a flood of maximum-size payloads to a few GB.
export const MAX_SHARE_CHARS = 48 * 1024
const PAYLOAD_PATTERN = /^[A-Za-z0-9_-]+$/
const ID_PATTERN = /^[A-Za-z0-9_-]{11}$/
const CORS = { 'Access-Control-Allow-Origin': '*' }

const reply = (status: number, body: string | null, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { ...CORS, 'Cache-Control': 'no-store', ...headers } })

const newId = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(8)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** Stops reading past `max` bytes, so a body sent without Content-Length cannot be buffered whole first. */
async function readCapped(request: Request, max: number): Promise<string | undefined> {
  const reader = request.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let text = ''
  let size = 0
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    size += chunk.value.byteLength
    if (size > max) {
      await reader.cancel()
      return undefined
    }
    text += decoder.decode(chunk.value, { stream: true })
  }
  return text + decoder.decode()
}

async function create(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  if (env.SHARE_LIMITER && !(await env.SHARE_LIMITER.limit({ key: ip })).success) return reply(429, 'Too many shares, try again in a minute.')
  const payload = await readCapped(request, MAX_SHARE_CHARS)
  if (payload === undefined) return reply(413, 'Payload too large.')
  if (!PAYLOAD_PATTERN.test(payload)) return reply(400, 'Payload must be non-empty base64url.')
  const id = newId()
  try {
    await env.DB.prepare('INSERT INTO shares (id, data) VALUES (?, ?)').bind(id, payload).run()
  } catch {
    // The free plan answers its daily write quota and its storage cap with an error; the app then falls back to a
    // self-contained link.
    return reply(503, 'Share store unavailable.')
  }
  return reply(201, JSON.stringify({ id }), { 'Content-Type': 'application/json' })
}

async function read(id: string, env: Env): Promise<Response> {
  if (!ID_PATTERN.test(id)) return reply(404, 'Not found.')
  const row = await env.DB.prepare('SELECT data FROM shares WHERE id = ?').bind(id).first<{ data: string }>()
  if (!row) return reply(404, 'Not found.')
  // An id is never rewritten, so its payload can be cached for good.
  return reply(200, row.data, { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=31536000, immutable' })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (request.method === 'OPTIONS') return reply(204, null, { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Max-Age': '86400' })
    if (request.method === 'POST' && pathname === '/') return create(request, env)
    if (request.method === 'GET') return read(pathname.slice(1), env)
    return reply(405, 'Method not allowed.')
  },
}
