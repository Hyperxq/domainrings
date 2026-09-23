import { describe, expect, it } from 'vitest'
import { parseHexa, toHexa, toMap } from './hexa'
import { EXAMPLE_DIAGRAM, RETIRED_SEEDS, STRESS_DIAGRAM } from './example'
import type { Diagram } from './schema'

const errorsOf = (text: string) => {
  const result = parseHexa(text)
  if (result.ok) throw new Error('expected parse to fail')
  return result.errors
}

describe('toMap', () => {
  it('migrates a v1 diagram to a single-hexagon map, deterministically', () => {
    const map = toMap(EXAMPLE_DIAGRAM)
    expect(map).toStrictEqual({
      version: 2,
      kind: EXAMPLE_DIAGRAM.kind,
      title: EXAMPLE_DIAGRAM.title,
      contexts: [{ id: 'c1' }],
      hexagons: [
        {
          id: 'h1',
          contextId: 'c1',
          cell: { q: 0, r: 0 },
          title: EXAMPLE_DIAGRAM.title,
          subtitle: EXAMPLE_DIAGRAM.subtitle,
          domain: EXAMPLE_DIAGRAM.domain,
          useCases: EXAMPLE_DIAGRAM.useCases,
          ports: EXAMPLE_DIAGRAM.ports,
          adapters: EXAMPLE_DIAGRAM.adapters,
          actors: EXAMPLE_DIAGRAM.actors,
          externals: EXAMPLE_DIAGRAM.externals,
          composition: EXAMPLE_DIAGRAM.composition,
        },
      ],
      links: [],
    })
  })

  it('invents nothing the old diagram lacked: no kind, no version on the hexagon, no layers when absent', () => {
    const hexagon = toMap(EXAMPLE_DIAGRAM).hexagons[0]
    expect('kind' in hexagon).toBe(false)
    expect('version' in hexagon).toBe(false)
    expect('layers' in hexagon).toBe(false)
    expect(toMap(EXAMPLE_DIAGRAM).contexts[0]).toStrictEqual({ id: 'c1' })
  })

  it('is deterministic: migrating the same diagram twice yields identical ids', () => {
    expect(toMap(EXAMPLE_DIAGRAM)).toStrictEqual(toMap(EXAMPLE_DIAGRAM))
  })
})

describe('.hexa v2 serialization', () => {
  it('round-trips a migrated map: migrate, serialise, parse back identical', () => {
    const map = toMap(EXAMPLE_DIAGRAM)
    expect(parseHexa(toHexa(map))).toEqual({ ok: true, map })
  })

  it('tags the file with the app marker and version 2', () => {
    expect(JSON.parse(toHexa(toMap(EXAMPLE_DIAGRAM)))).toMatchObject({ app: 'domainrings', version: 2 })
  })

  it.each([
    ['the seeded example', EXAMPLE_DIAGRAM],
    ['the stress diagram', STRESS_DIAGRAM],
    ...RETIRED_SEEDS.map((seed, i): [string, Diagram] => [`retired seed v${i + 1}`, seed]),
  ])('migrate∘migrate is idempotent for %s', (_label, diagram) => {
    const once = toMap(diagram)
    expect(parseHexa(toHexa(once))).toEqual({ ok: true, map: once })
  })
})

describe('.hexa v1 migration on open', () => {
  it('opens a v1 file as a single-hexagon map', () => {
    const text = JSON.stringify({ app: 'domainrings', ...EXAMPLE_DIAGRAM })
    const result = parseHexa(text)
    expect(result).toEqual({ ok: true, map: toMap(EXAMPLE_DIAGRAM), v1: EXAMPLE_DIAGRAM })
  })

  it('opens a file saved under the legacy app name the same way', () => {
    const text = JSON.stringify({ app: 'archviz', ...EXAMPLE_DIAGRAM })
    const result = parseHexa(text)
    expect(result).toEqual({ ok: true, map: toMap(EXAMPLE_DIAGRAM), v1: EXAMPLE_DIAGRAM })
  })

  it('opening the same v1 file twice is deterministic', () => {
    const text = JSON.stringify({ app: 'domainrings', ...EXAMPLE_DIAGRAM })
    expect(parseHexa(text)).toEqual(parseHexa(text))
  })
})

describe('refusals (happy-path gateway only — the full matrix lands in a later slice)', () => {
  it('rejects a file from another app', () => {
    expect(errorsOf(JSON.stringify({ ...EXAMPLE_DIAGRAM, app: 'excalidraw' }))).toEqual(['This is not a domainrings file.'])
  })

  it('rejects a file without the app marker', () => {
    expect(errorsOf(JSON.stringify(EXAMPLE_DIAGRAM))).toEqual(['This is not a domainrings file.'])
  })

  it('rejects malformed JSON', () => {
    expect(errorsOf('{ not json')).toEqual([expect.stringMatching(/^The file is not valid JSON/)])
  })

  it('refuses a file made by a newer version, by name', () => {
    const result = parseHexa(JSON.stringify({ app: 'domainrings', version: 99 }))
    expect(result).toEqual({ ok: false, reason: 'newer', errors: [expect.stringMatching(/newer version/)] })
  })
})
