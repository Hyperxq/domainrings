import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { parseHexa, toHexa, toMap } from './hexa'
import { EXAMPLE_DIAGRAM, RETIRED_SEEDS, STRESS_DIAGRAM, TWO_SLICES_MAP } from './example'
import { diagramOf, freeCell, placeHexagon } from './map'
import { HexaFileV2Schema, MapSchema, VERSION, type Diagram, type HexaMap } from './schema'
import v1Minimal from './fixtures/v1-minimal.hexa?raw'
import v1Maximal from './fixtures/v1-maximal.hexa?raw'
import v1Clean from './fixtures/v1-clean.hexa?raw'
import v1Onion from './fixtures/v1-onion.hexa?raw'
import v2TwoSlices from './fixtures/v2-two-slices.hexa?raw'
import v2Honeycomb from './fixtures/v2-honeycomb.hexa?raw'
import v2EmptyContext from './fixtures/v2-empty-context.hexa?raw'
import v2SchemaSnapshot from './fixtures/v2.schema.json?raw'
import v3OnionExample from './fixtures/v3-onion-example.hexa?raw'
import v4CleanExample from './fixtures/v4-clean-example.hexa?raw'

const errorsOf = (text: string) => {
  const result = parseHexa(text)
  if (result.ok) throw new Error('expected parse to fail')
  return result.errors
}

describe('toMap', () => {
  it('migrates a v1 diagram to a single-hexagon map, deterministically', () => {
    const map = toMap(EXAMPLE_DIAGRAM)
    expect(map).toStrictEqual({
      version: VERSION,
      kind: 'hexagonal',
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
    if (!result.ok || result.map.kind !== 'hexagonal') return
    expect(result.map).toStrictEqual({
      version: VERSION,
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
      version: VERSION,
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

// Carried followup from native-onion's verify final (obs #7473): REQ-06's v1-format branch had no fixture whose
// stored `kind` is genuinely non-hexagonal (only the v2 branch was fixture-tested) — these two close that gap.
describe('committed v1 fixtures with a non-hexagonal stored kind (REQ-06)', () => {
  it('a v1 file whose stored kind is "clean" opens as Hexagonal, the kind never carried forward', () => {
    const result = parseHexa(v1Clean)
    expect(result.ok).toBe(true)
    if (!result.ok || result.map.kind !== 'hexagonal') return
    expect(result.map.title).toBe('Legacy Clean skin')
    expect(result.v1?.kind).toBe('clean') // the raw v1 diagram still remembers its old stored kind...
    expect('kind' in result.map.hexagons[0]).toBe(false) // ...but the migrated hexagon never carries it
  })

  it('a v1 file whose stored kind is "onion" opens as Hexagonal, the kind never carried forward', () => {
    const result = parseHexa(v1Onion)
    expect(result.ok).toBe(true)
    if (!result.ok || result.map.kind !== 'hexagonal') return
    expect(result.map.title).toBe('Legacy Onion skin')
    expect(result.v1?.kind).toBe('onion')
    expect('kind' in result.map.hexagons[0]).toBe(false)
  })
})

describe('committed v2 corpus (MIG-03.2)', () => {
  it('every fixtures/v2-*.hexa file parses ok', () => {
    expect(parseHexa(v2TwoSlices)).toEqual({ ok: true, map: TWO_SLICES_MAP })
  })

  // The honeycomb corpus fixture (8 hexagons, r≠0 cells, a split context, an unnamed context, a 6-ring around a
  // foreign hexagon, a link, one named context, STRESS-like content) parses cleanly — proving the schema/reader
  // handles the full shape the corpus exercises.
  it('parses the honeycomb corpus fixture', () => {
    const result = parseHexa(v2Honeycomb)
    expect(result.ok).toBe(true)
  })

  it('parses the empty-context fixture', () => {
    const result = parseHexa(v2EmptyContext)
    expect(result.ok).toBe(true)
  })

  // HexaFileV2Schema is frozen at version 2 regardless of VERSION (now 4, the current/v4 format) — the snapshot
  // proves that freeze holds, independent of whichever version the app currently writes.
  it('the v2 JSON-schema snapshot matches z.toJSONSchema(HexaFileV2Schema)', () => {
    expect(JSON.parse(v2SchemaSnapshot)).toEqual(z.toJSONSchema(HexaFileV2Schema))
  })

  it('VERSION is the current (v4) format — v1, v2 and v3 stay frozen at their own literals', () => {
    expect(VERSION).toBe(4)
  })
})

describe('the honeycomb fixture round-trips exactly', () => {
  // A v2 file is upgraded to the current (v3) version on open (REQ-06 applies the same "never trust the stored
  // kind" coercion to version too) — so re-saving it no longer reproduces the v2 source byte-for-byte; that
  // invariant now belongs to a v3-saved file re-parsing to the same map, which the next test covers.
  it('opening the v2 fixture upgrades it to the current version, hexagonal, everything else unchanged', () => {
    const result = parseHexa(v2Honeycomb)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.map.version).toBe(VERSION)
    expect(result.map.kind).toBe('hexagonal')
    const reparsed = parseHexa(toHexa(result.map))
    expect(reparsed).toEqual(result)
  })

  it('parseHexa(toHexa(map)).map toStrictEqual map after a real import onto the honeycomb', () => {
    const result = parseHexa(v2Honeycomb)
    expect(result.ok).toBe(true)
    if (!result.ok || result.map.kind !== 'hexagonal') return
    const map = result.map
    const view: import('./schema').Diagram = { version: 1, kind: 'hexagonal', title: 'Payments', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] }
    const { map: imported } = placeHexagon(map, view, { cell: freeCell(map, map.hexagons[0].cell) })

    const reopened = parseHexa(toHexa(imported))

    expect(reopened).toEqual({ ok: true, map: imported })
  })
})

describe('whole-map round trip: contexts, hexagon content, and links all survive save/reopen (CB-04.3)', () => {
  it('every context keeps its name or placeholder, every hexagon its cell and content, and every link its two ends', () => {
    const before = parseHexa(v2Honeycomb)
    expect(before.ok).toBe(true)
    if (!before.ok || before.map.kind !== 'hexagonal') return
    const beforeMap = before.map

    const reopened = parseHexa(toHexa(beforeMap))
    expect(reopened.ok).toBe(true)
    if (!reopened.ok || reopened.map.kind !== 'hexagonal') return
    const after = reopened.map

    // Contexts: the named one keeps its name, the unnamed one is still absent a name (its placeholder is derived,
    // not stored — CB-03).
    expect(after.contexts).toHaveLength(2)
    expect(after.contexts.find((c) => c.id === 'c1')?.name).toBe('Core')
    expect('name' in after.contexts.find((c) => c.id === 'c2')!).toBe(false)

    // Hexagons: same cells, same content — including the STRESS-shaped one, whose domain/ports/adapters are the
    // richest content in the fixture.
    expect(after.hexagons).toHaveLength(beforeMap.hexagons.length)
    for (const hexagon of beforeMap.hexagons) {
      const reopenedHexagon = after.hexagons.find((h) => h.id === hexagon.id)
      expect(reopenedHexagon).toStrictEqual(hexagon)
    }

    // Links: the same two hexagons, same ports, on both ends.
    expect(after.links).toStrictEqual(beforeMap.links)
    expect(after.links).toHaveLength(1)
    expect(after.links[0]).toMatchObject({ from: { hexagonId: 'h1', portId: 'p-out' }, to: { hexagonId: 'h4', portId: 'p-in' } })
  })
})

describe('.hexa round-trip preserves several links, mixed adapters, and a pattern tag (REQ-LNK-08.2, 08.3)', () => {
  // h1/h2 cross contexts (link1 carries both adapters and a pattern tag); h1/h3 share a context (link2 has
  // neither) — a single fixture proving both cases survive the same save/reopen.
  const richLinksMap = (): HexaMap => ({
    version: VERSION,
    kind: 'hexagonal',
    title: 'Release readiness',
    contexts: [{ id: 'c1', name: 'Billing' }, { id: 'c2' }],
    hexagons: [
      {
        id: 'h1',
        contextId: 'c1',
        cell: { q: 0, r: 0 },
        title: 'H1',
        domain: [],
        useCases: [],
        ports: [
          { id: 'p1a', name: 'Repository', side: 'driven', wall: 'e' },
          { id: 'p1b', name: 'Cache', side: 'driven', wall: 'ne' },
        ],
        adapters: [{ id: 'a1', name: 'Knex', portId: 'p1a' }],
        actors: [],
        externals: [],
      },
      {
        id: 'h2',
        contextId: 'c2',
        cell: { q: 1, r: 0 },
        title: 'H2',
        domain: [],
        useCases: [],
        ports: [{ id: 'p2', name: 'Submit', side: 'driving', wall: 'w' }],
        adapters: [{ id: 'a2', name: 'Http', portId: 'p2' }],
        actors: [],
        externals: [],
      },
      {
        id: 'h3',
        contextId: 'c1',
        cell: { q: 0, r: 1 },
        title: 'H3',
        domain: [],
        useCases: [],
        ports: [{ id: 'p3', name: 'Notify', side: 'driving' }],
        adapters: [],
        actors: [],
        externals: [],
      },
    ],
    links: [
      { id: 'link1', from: { hexagonId: 'h1', portId: 'p1a', adapterId: 'a1' }, to: { hexagonId: 'h2', portId: 'p2', adapterId: 'a2' }, pattern: 'acl' },
      { id: 'link2', from: { hexagonId: 'h1', portId: 'p1b' }, to: { hexagonId: 'h3', portId: 'p3' } },
    ],
  })

  it('every link keeps its ends, adapters, and pattern exactly, and the file stays at the current VERSION', () => {
    const map = richLinksMap()
    expect(MapSchema.safeParse(map).success).toBe(true)

    const reopened = parseHexa(toHexa(map))

    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    expect(reopened.map).toStrictEqual(map)
    expect(reopened.map.version).toBe(VERSION)
  })
})

describe('the empty-context fixture is fully authored (IMP-02 regression)', () => {
  // The fixture's stored kind is "onion" (a v2-era file) — REQ-06 means it now opens as Hexagonal, same as any
  // other legacy Onion/Clean file, rather than keeping its own historical kind.
  it('carries a named context, a second EMPTY context, opens as hexagonal (REQ-06), and title "Legacy System"', () => {
    const result = parseHexa(v2EmptyContext)
    expect(result.ok).toBe(true)
    if (!result.ok || result.map.kind !== 'hexagonal') return
    expect(result.map.kind).toBe('hexagonal')
    expect(result.map.title).toBe('Legacy System')
    expect(result.map.contexts).toHaveLength(2)
    const [named, empty] = result.map.contexts
    expect(named.name).toBe('Ledger')
    expect('name' in empty).toBe(false)
    expect(result.map.hexagons.every((h) => h.contextId === named.id)).toBe(true)
    expect(result.map.hexagons.some((h) => h.contextId === empty.id)).toBe(false)
  })

  it('still imports cleanly via the same gateway ordinary imports use (IMP-02 regression)', () => {
    const result = parseHexa(v2EmptyContext)
    expect(result.ok).toBe(true)
    if (!result.ok || result.map.kind !== 'hexagonal') return
    const target = toMap(EXAMPLE_DIAGRAM)
    const view = diagramOf(result.map, result.map.hexagons[0].id)
    const { map: imported } = placeHexagon(target, view, { cell: freeCell(target, target.hexagons[0].cell) })
    expect(imported.hexagons).toHaveLength(2)
    expect(imported.kind).toBe('hexagonal') // placeHexagon always yields hexagonal (ADR-02)
  })
})

describe('.hexa v3 serialization', () => {
  it('round-trips a migrated map: migrate, serialise, parse back identical', () => {
    const map = toMap(EXAMPLE_DIAGRAM)
    expect(parseHexa(toHexa(map))).toEqual({ ok: true, map })
  })

  it('tags the file with the app marker and the current version', () => {
    expect(JSON.parse(toHexa(toMap(EXAMPLE_DIAGRAM)))).toMatchObject({ app: 'domainrings', version: VERSION })
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

describe('committed (frozen) v3 onion fixture (REQ-02, REQ-04, REQ-05 shape)', () => {
  // v3 is frozen (ADR-03) — same upgrade-on-open convention the v2 honeycomb fixture exercises above: the fixture
  // parses via HexaFileV3Schema, then the version number moves to VERSION on open (kind/rings/elements untouched,
  // since v3 already discriminated kind properly — unlike v1/v2's REQ-06 coercion).
  it('parses as kind onion with its 4 rings intact, upgraded to the current version on open', () => {
    const result = parseHexa(v3OnionExample)
    expect(result.ok).toBe(true)
    if (!result.ok || result.map.kind !== 'onion') throw new Error('fixture failed to parse as onion')
    expect(result.map.version).toBe(VERSION)
    expect(result.map.rings.map((r) => r.role)).toEqual(['domain', 'domainServices', 'application', 'outer'])
    expect(result.map.elements).toHaveLength(2)
    expect(result.map.dependencies).toHaveLength(1)
    expect(result.map.actors).toHaveLength(1)
  })

  it('re-saving the upgraded map round-trips (no longer byte-identical to the frozen v3 source — its version moved)', () => {
    const result = parseHexa(v3OnionExample)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const reparsed = parseHexa(toHexa(result.map))
    expect(reparsed).toEqual(result)
  })
})

describe('current (v4) clean fixture (REQ-02, REQ-03, REQ-04, REQ-06, REQ-07, REQ-08 shape)', () => {
  it('parses as kind clean with its 4 rings, 3 sectors (one empty), 2 elements, 1 dependency, an actor and an external', () => {
    const result = parseHexa(v4CleanExample)
    expect(result.ok).toBe(true)
    if (!result.ok || result.map.kind !== 'clean') throw new Error('fixture failed to parse as clean')
    expect(result.map.version).toBe(VERSION)
    expect(result.map.rings.map((r) => r.role)).toEqual(['domain', 'application', 'adapters', 'outer'])
    expect(result.map.sectors).toHaveLength(3)
    const elementSectorIds = new Set(result.map.elements.map((e) => e.sectorId))
    expect(result.map.sectors.filter((s) => !elementSectorIds.has(s.id))).toHaveLength(1)
    expect(result.map.elements).toHaveLength(2)
    expect(result.map.dependencies).toHaveLength(1)
    expect(result.map.actors).toHaveLength(1)
    expect(result.map.externals).toHaveLength(1)
  })

  it('round-trips: re-saving the parsed map and re-parsing it yields the same result', () => {
    const result = parseHexa(v4CleanExample)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const reparsed = parseHexa(toHexa(result.map))
    expect(reparsed).toEqual(result)
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
// The refusal matrix exercises the frozen v2 file shape (any of the 3 kinds) via parseHexa's version===2
// branch — HexaMap's own `kind` is narrowed to 'hexagonal' only (v3), so this borrows HexaFileV2Schema's type.
const VALID_BASE: Omit<z.infer<typeof HexaFileV2Schema>, 'version'> & { version: number } = {
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

// Discrimination proof: the matrix above exercises both the pre-Zod dispatch in `parseHexa` and `checkMap`'s
// structural refinements. Four representative mutants were applied one at a time, observed red, then reverted,
// to confirm each guarded line is actually covered by its own cell (not just incidentally green):
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
