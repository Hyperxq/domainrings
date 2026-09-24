import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { parseHexa, toHexa, toMap } from './hexa'
import { EXAMPLE_DIAGRAM, RETIRED_SEEDS, STRESS_DIAGRAM, TWO_SLICES_MAP } from './example'
import { HexaFileV2Schema, VERSION, type Diagram, type HexaMap } from './schema'
import v1Minimal from './fixtures/v1-minimal.hexa?raw'
import v1Maximal from './fixtures/v1-maximal.hexa?raw'
import v2TwoSlices from './fixtures/v2-two-slices.hexa?raw'
import v2SchemaSnapshot from './fixtures/v2.schema.json?raw'

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

// --- SEAM-01: committed fixtures + JSON-schema snapshot ------------------------------------------------------

describe('committed v1 fixtures (MIG-01.1, 01.2, 01.4, 04.1)', () => {
  it('migrates the minimal v1 fixture (no optional fields) to a single-hexagon map with exactly those fields', () => {
    const result = parseHexa(v1Minimal)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.map).toStrictEqual({
      version: 2,
      kind: 'hexagonal',
      title: 'Minimal',
      contexts: [{ id: 'c1' }],
      hexagons: [{ id: 'h1', contextId: 'c1', cell: { q: 0, r: 0 }, title: 'Minimal', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] }],
      links: [],
    })
    expect(Object.keys(result.map.hexagons[0]).sort()).toEqual(['actors', 'adapters', 'cell', 'contextId', 'domain', 'externals', 'id', 'ports', 'title', 'useCases'])
  })

  it('migrates the maximal v1 fixture (every optional field, plus unknown keys and seedVersion) losslessly, dropping only what the map format does not track', () => {
    // seedVersion and the unknown "extra" key are present in the source file...
    expect(v1Maximal).toContain('"seedVersion"')
    expect(v1Maximal).toContain('"extra"')
    const result = parseHexa(v1Maximal)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // ...but survive nowhere in the migrated map: Zod strips unrecognized keys by default.
    expect(result.map).toStrictEqual({
      version: 2,
      kind: 'hexagonal',
      title: 'Maximal',
      contexts: [{ id: 'c1' }],
      hexagons: [
        {
          id: 'h1',
          contextId: 'c1',
          cell: { q: 0, r: 0 },
          title: 'Maximal',
          subtitle: 'Every optional field present',
          domain: [
            { id: 'd-root', name: 'Root', type: 'aggregate', note: 'root note' },
            { id: 'd-child', name: 'Child', type: 'entity', parentId: 'd-root', note: 'child note' },
          ],
          useCases: [{ id: 'uc-1', name: 'DoThing', placement: 'nw', note: 'uc note' }],
          ports: [
            { id: 'p-in', name: 'in', side: 'driving', wall: 'nw', useCaseId: 'uc-1', note: 'port note' },
            { id: 'p-out', name: 'out', side: 'driven', wall: 'se', note: 'out note' },
          ],
          adapters: [{ id: 'a-1', name: 'Adapter1', portId: 'p-in', note: 'adapter note' }],
          actors: [{ id: 'act-1', name: 'Actor1', adapterId: 'a-1', note: 'actor note' }],
          externals: [{ id: 'ext-1', name: 'External1', adapterId: 'a-1', note: 'external note' }],
          composition: { name: 'composition.ts', note: 'comp note' },
          layers: { application: { title: 'App', subtitle: 'use cases' }, domain: { title: 'Domain' } },
        },
      ],
      links: [],
    })
  })
})

describe('committed v2 corpus (MIG-03.2)', () => {
  it('every fixtures/v2-*.hexa file parses ok', () => {
    expect(parseHexa(v2TwoSlices)).toEqual({ ok: true, map: TWO_SLICES_MAP })
  })

  it('the v2 JSON-schema snapshot matches z.toJSONSchema(HexaFileV2Schema) while VERSION === 2', () => {
    expect(VERSION).toBe(2)
    expect(JSON.parse(v2SchemaSnapshot)).toEqual(z.toJSONSchema(HexaFileV2Schema))
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

// --- MIG-02 / MIG-03: the 18-cell refusal matrix ------------------------------------------------------------
//
// A single, schema-valid v2 file every cell mutates in exactly one place. h1 carries a spare driven port+adapter
// (p-extra/a-extra) and a spare driving port (p-in-h1) so the "adapter not on port" and "intra-hexagon link"
// cells can each be produced by rewriting the link's `from`/`to`/`adapterId` alone, without touching a hexagon
// or port that the valid base's own link depends on.
const VALID_BASE: Omit<HexaMap, 'version'> & { app: string; version: number } = {
  app: 'domainrings',
  version: 2,
  kind: 'hexagonal',
  title: 'Base',
  contexts: [{ id: 'c1' }],
  hexagons: [
    {
      id: 'h1',
      contextId: 'c1',
      cell: { q: 0, r: 0 },
      title: 'A',
      domain: [],
      useCases: [],
      ports: [
        { id: 'p-out', name: 'out', side: 'driven' },
        { id: 'p-extra', name: 'extra', side: 'driven' },
        { id: 'p-in-h1', name: 'in-h1', side: 'driving' },
      ],
      adapters: [
        { id: 'a-out', name: 'Out adapter', portId: 'p-out' },
        { id: 'a-extra', name: 'Extra adapter', portId: 'p-extra' },
      ],
      actors: [],
      externals: [],
    },
    { id: 'h2', contextId: 'c1', cell: { q: 1, r: 0 }, title: 'B', domain: [], useCases: [], ports: [{ id: 'p-in', name: 'in', side: 'driving' }], adapters: [], actors: [], externals: [] },
  ],
  links: [{ id: 'l1', from: { hexagonId: 'h1', portId: 'p-out', adapterId: 'a-out' }, to: { hexagonId: 'h2', portId: 'p-in' } }],
}

type Base = typeof VALID_BASE
const mutated = (fn: (base: Base) => Base): string => JSON.stringify(fn(structuredClone(VALID_BASE)))

it('the base fixture the refusal matrix mutates is itself valid', () => {
  expect(parseHexa(JSON.stringify(VALID_BASE)).ok).toBe(true)
})

describe('the 18-cell refusal matrix (MIG-02, MIG-03)', () => {
  const cells: [string, 'invalid' | 'newer', string | RegExp][] = [
    ['not JSON', 'invalid', /not valid JSON/],
    ['not a domainrings file', 'invalid', 'This is not a domainrings file.'],
    ['app "archviz" on a v2 file (archviz is a v1-only alias)', 'invalid', /app/],
    ['no version number', 'invalid', 'The file has no version number.'],
    ['unknown version number', 'invalid', 'Unknown file version "0"'],
    ['version 1 with a v2-shaped body', 'invalid', /Version 1 file/],
    ['zero hexagons', 'invalid', /hexagons/],
    ['two contexts sharing an id', 'invalid', 'Duplicate context id "c1"'],
    ['two hexagons sharing an id', 'invalid', 'Duplicate hexagon id "h1"'],
    ['two hexagons sharing a cell', 'invalid', 'Two hexagons share cell (0, 0)'],
    ['a hexagon naming a context that does not exist', 'invalid', 'Unknown context id "nope"'],
    ['two links sharing an id', 'invalid', 'Duplicate link id "l1"'],
    ['a link naming a hexagon that does not exist', 'invalid', 'Unknown hexagon id "nope"'],
    ['a link naming a port that does not exist', 'invalid', 'Unknown port id "nope" on hexagon "h1"'],
    ['a link\'s driven end pointing at a driving port', 'invalid', 'The from end of a link must be a driven port'],
    ['a link\'s driving end pointing at a driven port', 'invalid', 'The to end of a link must be a driving port'],
    ['a link\'s adapter attached to a different port', 'invalid', 'Adapter "a-extra" is not attached to port "p-out"'],
    ['more than one hexagon with a non-hexagonal kind', 'invalid', 'A map with more than one hexagon must be hexagonal'],
    ['a link joining a hexagon to itself', 'invalid', 'A link cannot join a hexagon to itself'],
    ['two links between the same two ports', 'invalid', 'Duplicate link between the same two ports'],
    ['a pattern on a link within the same context', 'invalid', 'A pattern only applies to a link crossing contexts'],
    ['made by a newer version', 'newer', /newer version/],
  ]

  const textOf: Record<string, string> = {
    'not JSON': '{ not json',
    'not a domainrings file': JSON.stringify({ ...VALID_BASE, app: 'excalidraw' }),
    'app "archviz" on a v2 file (archviz is a v1-only alias)': JSON.stringify({ ...VALID_BASE, app: 'archviz' }),
    'no version number': JSON.stringify((() => { const { version: _version, ...rest } = VALID_BASE; return rest })()),
    'unknown version number': JSON.stringify({ ...VALID_BASE, version: 0 }),
    'version 1 with a v2-shaped body': JSON.stringify({ app: 'domainrings', version: 1, kind: 'hexagonal', title: 'Base', contexts: VALID_BASE.contexts, hexagons: VALID_BASE.hexagons, links: VALID_BASE.links }),
    'zero hexagons': mutated((b) => ({ ...b, hexagons: [] })),
    'two contexts sharing an id': mutated((b) => ({ ...b, contexts: [...b.contexts, { id: 'c1' }] })),
    'two hexagons sharing an id': mutated((b) => ({ ...b, hexagons: [...b.hexagons, { ...b.hexagons[0], id: 'h1', cell: { q: 2, r: 0 } }] })),
    'two hexagons sharing a cell': mutated((b) => ({ ...b, hexagons: [...b.hexagons, { ...b.hexagons[0], id: 'h3', cell: { q: 0, r: 0 } }] })),
    'a hexagon naming a context that does not exist': mutated((b) => ({ ...b, hexagons: [{ ...b.hexagons[0], contextId: 'nope' }, b.hexagons[1]] })),
    'two links sharing an id': mutated((b) => ({ ...b, links: [b.links[0], { ...b.links[0], from: { hexagonId: 'h1', portId: 'p-extra', adapterId: 'a-extra' } }] })),
    'a link naming a hexagon that does not exist': mutated((b) => ({ ...b, links: [{ ...b.links[0], from: { hexagonId: 'nope', portId: 'p-out', adapterId: undefined } }] })),
    'a link naming a port that does not exist': mutated((b) => ({ ...b, links: [{ ...b.links[0], from: { hexagonId: 'h1', portId: 'nope', adapterId: undefined } }] })),
    "a link's driven end pointing at a driving port": mutated((b) => ({ ...b, links: [{ ...b.links[0], from: { hexagonId: 'h2', portId: 'p-in', adapterId: undefined } }] })),
    "a link's driving end pointing at a driven port": mutated((b) => ({ ...b, links: [{ ...b.links[0], to: { hexagonId: 'h1', portId: 'p-out' } }] })),
    "a link's adapter attached to a different port": mutated((b) => ({ ...b, links: [{ ...b.links[0], from: { ...b.links[0].from, adapterId: 'a-extra' } }] })),
    'more than one hexagon with a non-hexagonal kind': mutated((b) => ({ ...b, kind: 'clean' })),
    'a link joining a hexagon to itself': mutated((b) => ({ ...b, links: [{ ...b.links[0], to: { hexagonId: 'h1', portId: 'p-in-h1' } }] })),
    'two links between the same two ports': mutated((b) => ({ ...b, links: [b.links[0], { id: 'l2', from: { hexagonId: 'h1', portId: 'p-out' }, to: { hexagonId: 'h2', portId: 'p-in' } }] })),
    'a pattern on a link within the same context': mutated((b) => ({ ...b, links: [{ ...b.links[0], pattern: 'acl' }] })),
    'made by a newer version': mutated((b) => ({ ...b, version: 99 })),
  }

  it.each(cells)('%s → reason %s', (label, reason, messageMatch) => {
    const result = parseHexa(textOf[label])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe(reason)
    const matches = (e: string) => (typeof messageMatch === 'string' ? e.includes(messageMatch) : messageMatch.test(e))
    expect(result.errors.some(matches)).toBe(true)
  })

  it("a newer-version file's message never says the file could not be opened", () => {
    const result = parseHexa(textOf['made by a newer version'])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((e) => /could not be opened/.test(e))).toBe(false)
  })

  it('never repairs a structurally invalid file — the same map, unmodified, is refused every time', () => {
    const once = parseHexa(textOf['two hexagons sharing an id'])
    const twice = parseHexa(textOf['two hexagons sharing an id'])
    expect(once).toEqual(twice)
    expect(once.ok).toBe(false)
  })
})

// Discrimination proof (strict TDD): every branch these cells exercise (pre-Zod dispatch in `parseHexa`, and
// `checkMap`'s structural refinements) was written in S-000 for schema soundness, so the matrix above passes on
// first run rather than starting RED. Four representative mutants were applied one at a time (`npx vitest run
// src/model/hexa.test.ts src/model/schema.test.ts`), observed red, then reverted — not part of the suite;
// recorded here for the apply-progress artefact only:
//   Group 1 (pre-Zod dispatch, hexa.ts):        `if (version > VERSION)` → `if (false && version > VERSION)`
//                                                 broke exactly one cell: "made by a newer version" (fell through
//                                                 to "Unknown file version \"99\"", reason flipped newer→invalid).
//   Group 2 (Zod-validated v1/v2 body, hexa.ts): swapping `HexaFileV1Schema` for `HexaFileV2Schema` in the
//                                                 version===1 branch left all 18 matrix cells green (the
//                                                 "version 1 with a v2-shaped body" cell fails under either
//                                                 schema, so it doesn't discriminate this line) — but broke 2
//                                                 tests elsewhere in the same file ("opens a v1 file..." /
//                                                 "...under the legacy app name"), proving the dispatch matters;
//                                                 the matrix's own coverage of this line is redundant with those.
//   Group 3 (checkMap structural checks):        `if (m.hexagons.length > 1 && m.kind !== 'hexagonal')` →
//                                                 `if (false && ...)` broke exactly one cell: "more than one
//                                                 hexagon with a non-hexagonal kind" — every other cell stayed
//                                                 green, confirming each checkMap block guards only its own cell.
//   Group 4 (linkEndProblem):                    `wantSide = role === 'from' ? 'driven' : 'driving'` → hard-coded
//                                                 `'driven'` broke the base fixture itself (its own valid 'to'
//                                                 end now fails) plus 2 matrix cells ("driving end pointing at a
//                                                 driven port" and "link joining a hexagon to itself", whose
//                                                 mutation reuses the port `wantSide` now misjudges) — broader
//                                                 than a single cell because the base fixture depends on the same
//                                                 line, which is itself proof the line is load-bearing.
