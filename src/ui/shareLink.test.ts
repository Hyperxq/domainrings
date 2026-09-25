import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CompressionStream, DecompressionStream } from 'node:stream/web'
import { parseHexa, toHexa, toMap } from '../model/hexa'
import { EXAMPLE_DIAGRAM } from '../model/example'
import { decodeSharePayload, encodeSharePayload } from './shareLink'
import v2Honeycomb from '../model/fixtures/v2-honeycomb.hexa?raw'

// jsdom does not expose CompressionStream/DecompressionStream (explore's platform probe) — Node's real
// implementation is available via node:stream/web and needs no hand-rolled fake compression.
beforeEach(() => {
  vi.stubGlobal('CompressionStream', CompressionStream)
  vi.stubGlobal('DecompressionStream', DecompressionStream)
})
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
