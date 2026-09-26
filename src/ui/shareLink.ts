import { toHexa } from '../model/hexa'
import type { StoredFile } from '../model/schema'

// REQ-01/07: the codec for a share link's payload — deflate-raw + base64url over the unchanged `.hexa` JSON
// text. No model knowledge here: parseHexa remains the single validation gateway for the decoded text.
export const SHARE_HASH_PREFIX = '#m='
export const SHARE_LINK_MAX_CHARS = 8000 // full-link budget — ADR-01

export function isOversizedShareLink(url: string): boolean {
  return url.length > SHARE_LINK_MAX_CHARS
}

export function shareLinkURL(origin: string, pathname: string, payload: string): string {
  return `${origin}${pathname}${SHARE_HASH_PREFIX}${payload}`
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

export async function encodeSharePayload(file: StoredFile): Promise<string> {
  const compressed = streamOf(new TextEncoder().encode(toHexa(file))).pipeThrough(new CompressionStream('deflate-raw'))
  const bytes = new Uint8Array(await new Response(compressed).arrayBuffer())
  return toBase64Url(bytes)
}

/** `undefined` means the payload could not be decoded — malformed base64url or a corrupt deflate stream. */
export async function decodeSharePayload(payload: string): Promise<string | undefined> {
  try {
    const decompressed = streamOf(fromBase64Url(payload)).pipeThrough(new DecompressionStream('deflate-raw'))
    return await new Response(decompressed).text()
  } catch {
    return undefined
  }
}
