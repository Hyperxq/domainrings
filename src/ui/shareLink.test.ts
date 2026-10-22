import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseHexa, toHexa, toMap } from '../model/hexa'
import { EXAMPLE_DIAGRAM } from '../model/example'
import { decodeSharePayload, encodeSharePayload, fetchStoredPayload, isOversizedShareLink, SHARE_LINK_MAX_CHARS, storeSharePayload } from './shareLink'
import { installCompressionStreamPolyfill, installShareStore, SHARE_STORE_URL } from '../test/fixtures'
import v2Honeycomb from '../model/fixtures/v2-honeycomb.hexa?raw'

beforeEach(installCompressionStreamPolyfill)
afterEach(() => vi.unstubAllGlobals())

describe('encodeSharePayload / decodeSharePayload round trip (REQ-07)', () => {
  it('reproduces a small map exactly', async () => {
    const map = toMap(EXAMPLE_DIAGRAM)

    const payload = await encodeSharePayload(map)
    const text = await decodeSharePayload(payload)

    expect(text).not.toBeUndefined()
    const result = parseHexa(text!)
    expect(result.ok).toBe(true)
    expect(result.ok && result.map).toEqual(map)
  })

  it('reproduces the largest real fixture (v2-honeycomb) exactly', async () => {
    const result = parseHexa(v2Honeycomb)
    if (!result.ok) throw new Error('fixture failed to parse')

    const payload = await encodeSharePayload(result.map)
    const text = await decodeSharePayload(payload)

    expect(text).toBe(toHexa(result.map))
  })
})

describe('decodeSharePayload on undecodable input', () => {
  it('returns undefined instead of throwing', async () => {
    await expect(decodeSharePayload('not-a-real-payload!!')).resolves.toBeUndefined()
  })
})

describe('isOversizedShareLink (REQ-06)', () => {
  it('flags a link over the 8,000-char budget', () => {
    expect(isOversizedShareLink('x'.repeat(SHARE_LINK_MAX_CHARS + 1))).toBe(true)
  })

  it('does not flag a link at or under the 8,000-char budget', () => {
    expect(isOversizedShareLink('x'.repeat(SHARE_LINK_MAX_CHARS))).toBe(false)
  })
})

describe('storeSharePayload / fetchStoredPayload (stored links)', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('round-trips a map through the store, which only ever holds ciphertext', async () => {
    const { rows } = installShareStore()
    const map = toMap(EXAMPLE_DIAGRAM)

    const token = await storeSharePayload(map)
    const text = await fetchStoredPayload(token!)

    expect(token).toMatch(/^[A-Za-z0-9_-]{11},[A-Za-z0-9_-]{22}$/)
    expect(text).toBe(toHexa(map))
    expect([...rows.values()].join()).not.toContain(map.title)
  })

  it('does not reach any store when none is configured', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await expect(storeSharePayload(toMap(EXAMPLE_DIAGRAM))).resolves.toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns undefined when the store fails or is unreachable', async () => {
    vi.stubEnv('VITE_SHARE_API_URL', SHARE_STORE_URL)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Share store unavailable.', { status: 503 })))
    await expect(storeSharePayload(toMap(EXAMPLE_DIAGRAM))).resolves.toBeUndefined()

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(storeSharePayload(toMap(EXAMPLE_DIAGRAM))).resolves.toBeUndefined()
  })

  it('treats a store reply without a usable id as a failure', async () => {
    vi.stubEnv('VITE_SHARE_API_URL', SHARE_STORE_URL)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ id: '../x' }, { status: 201 })))

    await expect(storeSharePayload(toMap(EXAMPLE_DIAGRAM))).resolves.toBeUndefined()
  })

  it('gives up on a stored link whose store stops answering', async () => {
    vi.stubEnv('VITE_SHARE_API_URL', SHARE_STORE_URL)
    const fetchSpy = vi.fn().mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'))
    vi.stubGlobal('fetch', fetchSpy)

    await expect(fetchStoredPayload('AAAAAAAAAAA,AAAAAAAAAAAAAAAAAAAAAA')).resolves.toBeUndefined()
    expect(fetchSpy.mock.calls[0][1].signal).toBeDefined()
  })

  it('returns undefined for an unknown id or the wrong key', async () => {
    installShareStore()
    const token = (await storeSharePayload(toMap(EXAMPLE_DIAGRAM)))!
    const [id] = token.split(',')
    const otherKey = (await storeSharePayload(toMap(EXAMPLE_DIAGRAM)))!.split(',')[1]

    await expect(fetchStoredPayload(`AAAAAAAAAAA,${otherKey}`)).resolves.toBeUndefined()
    await expect(fetchStoredPayload(`${id},${otherKey}`)).resolves.toBeUndefined()
    await expect(fetchStoredPayload(id)).resolves.toBeUndefined()
  })
})
