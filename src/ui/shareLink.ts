import { toHexa } from '../model/hexa'
import type { StoredFile } from '../model/fileFormat'

// REQ-01/07: the codec for a share link's payload — deflate-raw + base64url over the unchanged `.hexa` JSON
// text. No model knowledge here: parseHexa remains the single validation gateway for the decoded text.
export const SHARE_HASH_PREFIX = '#m='
export const SHARE_LINK_MAX_CHARS = 8000 // full-link budget — ADR-01
// A stored link: `#s=<id>,<key>`. The key only ever lives in the fragment, which browsers never send, so the
// share store holds ciphertext it cannot read.
export const STORED_HASH_PREFIX = '#s='
// Covers a Worker cold start plus a 48 KB upload on a slow mobile link; past it the self-contained link is used.
const UPLOAD_TIMEOUT_MS = 5000
const DOWNLOAD_TIMEOUT_MS = 10000
const IV_BYTES = 12

export function isOversizedShareLink(url: string): boolean {
  return url.length > SHARE_LINK_MAX_CHARS
}

export function shareLinkURL(origin: string, pathname: string, payload: string, prefix = SHARE_HASH_PREFIX): string {
  return `${origin}${pathname}${prefix}${payload}`
}

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromBase64Url = (payload: string): Uint8Array<ArrayBuffer> => {
  const restored = payload.replace(/-/g, '+').replace(/_/g, '/')
  const padded = restored + '='.repeat((4 - (restored.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

// jsdom's Blob has no `.stream()` (confirmed empirically — Node's own Blob does), so the codec builds the
// ReadableStream directly from bytes instead of routing through Blob. The exact `Uint8Array<ArrayBuffer>`
// param matches what Compression/DecompressionStream's `writable` accepts.
const streamOf = (bytes: Uint8Array<ArrayBuffer>): ReadableStream<Uint8Array<ArrayBuffer>> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })

const deflate = async (text: string): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(await new Response(streamOf(new TextEncoder().encode(text)).pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())

const inflate = (bytes: Uint8Array<ArrayBuffer>): Promise<string> =>
  new Response(streamOf(bytes).pipeThrough(new DecompressionStream('deflate-raw'))).text()

export async function encodeSharePayload(file: StoredFile): Promise<string> {
  return toBase64Url(await deflate(toHexa(file)))
}

/** `undefined` means the payload could not be decoded — malformed base64url or a corrupt deflate stream. */
export async function decodeSharePayload(payload: string): Promise<string | undefined> {
  try {
    return await inflate(fromBase64Url(payload))
  } catch {
    return undefined
  }
}

const shareStore = (): string | undefined => (import.meta.env.VITE_SHARE_API_URL as string | undefined)?.replace(/\/+$/, '')

/** The `<id>,<key>` that follows `#s=`, or `undefined` when no store is configured, it refuses the map or it does
 * not answer in time — the caller then falls back to a self-contained link. */
export async function storeSharePayload(file: StoredFile): Promise<string | undefined> {
  const store = shareStore()
  if (!store) return undefined
  try {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 128 }, true, ['encrypt'])
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, await deflate(toHexa(file))))
    const sealed = new Uint8Array(IV_BYTES + cipher.length)
    sealed.set(iv)
    sealed.set(cipher, IV_BYTES)
    const response = await fetch(`${store}/`, { method: 'POST', body: toBase64Url(sealed), signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) })
    if (!response.ok) return undefined
    const { id } = (await response.json()) as { id?: unknown }
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) return undefined
    return `${id},${toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', key)))}`
  } catch {
    return undefined
  }
}

/** `undefined` means the stored map could not be fetched or decrypted — unknown id, wrong key, store down. */
export async function fetchStoredPayload(token: string): Promise<string | undefined> {
  const store = shareStore()
  const [id, key] = token.split(',')
  if (!store || !id || !key) return undefined
  try {
    const response = await fetch(`${store}/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
    if (!response.ok) return undefined
    const sealed = fromBase64Url(await response.text())
    const cryptoKey = await crypto.subtle.importKey('raw', fromBase64Url(key), 'AES-GCM', false, ['decrypt'])
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.slice(0, IV_BYTES) }, cryptoKey, sealed.slice(IV_BYTES))
    return await inflate(new Uint8Array(plain))
  } catch {
    return undefined
  }
}
