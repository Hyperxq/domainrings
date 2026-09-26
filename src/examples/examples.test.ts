import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { newOnionMap, parseHexa, toHexa } from '../model/hexa'
import { layoutMap } from '../layout/map'
import { layoutOnion } from '../layout/onion'
import { layoutClean } from '../layout/clean'
import { measure } from '../layout/text'
import type { CleanFile, HexaMap, OnionFile, StoredFile } from '../model/schema'

const EXAMPLES_DIR = __dirname

const files = readdirSync(EXAMPLES_DIR)
  .filter((f) => f.endsWith('.hexa'))
  .sort()

const KINDS = ['hexagonal', 'onion', 'clean'] as const

/** The filename prefix before its level suffix (`hexagonal-advanced.hexa` → `hexagonal`) — the file naming
 * convention this whole suite checks documents match consumes must hold that up. */
const kindOfFilename = (file: string): (typeof KINDS)[number] => {
  const kind = KINDS.find((k) => file.startsWith(`${k}-`))
  if (!kind) throw new Error(`"${file}" does not start with a known kind prefix`)
  return kind
}

const readExample = (file: string) => readFileSync(path.join(EXAMPLES_DIR, file), 'utf-8')

/** Every human-facing name in a document, across every kind's own collections — used only to check the three
 * "advanced" files (one per kind) describe the same e-commerce domain, never to validate structure. */
function allNames(map: StoredFile): string[] {
  if (map.kind === 'hexagonal') {
    return map.hexagons.flatMap((h) => [
      h.title,
      ...(h.subtitle ? [h.subtitle] : []),
      ...h.domain.map((d) => d.name),
      ...h.useCases.map((u) => u.name),
      ...h.ports.map((p) => p.name),
      ...h.adapters.map((a) => a.name),
      ...h.actors.map((a) => a.name),
      ...h.externals.map((e) => e.name),
    ])
  }
  return [...map.elements.map((e) => e.name), ...map.actors.map((a) => a.name), ...map.externals.map((e) => e.name)]
}

/** Total modelled items in a document — the "element count" this suite reports per example, kept comparable
 * across kinds even though only the ringed kinds call their items "elements". */
function itemCount(map: StoredFile): number {
  if (map.kind === 'hexagonal') {
    return map.hexagons.reduce(
      (n, h) => n + h.domain.length + h.useCases.length + h.ports.length + h.adapters.length + h.actors.length + h.externals.length,
      0,
    )
  }
  return map.elements.length + map.actors.length + map.externals.length
}

interface Box {
  key: string
  x: number
  y: number
  width: number
  height: number
}

/** Axis-aligned overlap between two centre-anchored boxes — touching does not count (matches `layout.ts`'s own
 * `quadsOverlap` convention), guarded by a small epsilon against floating-point tangency. */
function boxesOverlap(a: Box, b: Box, eps = 1e-6): boolean {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2 - eps && Math.abs(a.y - b.y) < (a.height + b.height) / 2 - eps
}

function overlappingPairs(boxes: Box[]): string[] {
  const pairs: string[] = []
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxesOverlap(boxes[i], boxes[j])) pairs.push(`${boxes[i].key} × ${boxes[j].key}`)
    }
  }
  return pairs
}

// Onion/Clean elements and endpoints carry only their centre point (RingedElementLayout/RingedEndpointLayout) —
// their rendered box comes from render/RingedNodes.tsx's own (module-private) sizing, duplicated here so this
// suite checks the same boxes the SVG actually draws, not an invented approximation.
const RINGED_NAME_METRICS = { size: 13, em: 0.6, tracking: 0 }
const RINGED_PAD_X = 10
const RINGED_NODE_HEIGHT = 26
const RINGED_ENDPOINT_RADIUS = 4

const ringedElementBox = (key: string, name: string, x: number, y: number): Box => ({
  key,
  x,
  y,
  width: measure(name, RINGED_NAME_METRICS) + 2 * RINGED_PAD_X,
  height: RINGED_NODE_HEIGHT,
})

const ringedEndpointBox = (key: string, x: number, y: number): Box => ({
  key,
  x,
  y,
  width: RINGED_ENDPOINT_RADIUS * 2,
  height: RINGED_ENDPOINT_RADIUS * 2,
})

/** Every hexagon's own node boxes (already centre-anchored width/height, per `LayoutNode`) — checked hexagon by
 * hexagon, since `layoutMap` never lets two hexagons' content areas reach each other (REQ's own `MAP_GAP`). */
function hexagonalOverlaps(map: HexaMap): { itemCount: number; overlaps: string[] } {
  const layout = layoutMap(map)
  const overlaps = layout.hexagons.flatMap((hex) => {
    const boxes: Box[] = hex.model.nodes.map((n) => ({ key: `${hex.id}:${n.kind}:${n.ref}`, x: n.x, y: n.y, width: n.width, height: n.height }))
    return overlappingPairs(boxes)
  })
  return { itemCount: itemCount(map), overlaps }
}

function onionOverlaps(doc: OnionFile): { overlaps: string[] } {
  const layout = layoutOnion(doc)
  const boxes: Box[] = [
    ...layout.elements.map((e) => ringedElementBox(`element:${e.ref}`, e.name, e.x, e.y)),
    ...layout.endpoints.map((e) => ringedEndpointBox(`endpoint:${e.ref}`, e.x, e.y)),
  ]
  return { overlaps: overlappingPairs(boxes) }
}

function cleanOverlaps(doc: CleanFile): { overlaps: string[] } {
  const layout = layoutClean(doc)
  const boxes: Box[] = [
    ...layout.elements.map((e) => ringedElementBox(`element:${e.ref}`, e.name, e.x, e.y)),
    ...layout.endpoints.map((e) => ringedEndpointBox(`endpoint:${e.ref}`, e.x, e.y)),
  ]
  return { overlaps: overlappingPairs(boxes) }
}

describe('example .hexa files', () => {
  it('covers exactly the 9 documented example files', () => {
    expect(files).toEqual([
      'clean-advanced.hexa',
      'clean-basic.hexa',
      'clean-stress.hexa',
      'hexagonal-advanced.hexa',
      'hexagonal-basic.hexa',
      'hexagonal-stress.hexa',
      'onion-advanced.hexa',
      'onion-basic.hexa',
      'onion-stress.hexa',
    ])
  })

  for (const file of files) {
    describe(file, () => {
      const text = readExample(file)

      it('parses as a valid version-4 document of the kind its filename names', () => {
        const result = parseHexa(text)
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.map.version).toBe(4)
        expect(result.map.kind).toBe(kindOfFilename(file))
      })

      it('round-trips byte-for-byte through toHexa → parseHexa', () => {
        const parsed = parseHexa(text)
        if (!parsed.ok) throw new Error(`"${file}" failed to parse: ${parsed.errors.join('; ')}`)
        const roundTripped = parseHexa(toHexa(parsed.map))
        expect(roundTripped).toEqual(parsed)
      })
    })
  }

  describe('the three "advanced" files model one shared e-commerce domain', () => {
    for (const file of ['hexagonal-advanced.hexa', 'onion-advanced.hexa', 'clean-advanced.hexa']) {
      it(`${file} names an Order-like and a Payment-like element`, () => {
        const parsed = parseHexa(readExample(file))
        if (!parsed.ok) throw new Error(`"${file}" failed to parse: ${parsed.errors.join('; ')}`)
        const names = allNames(parsed.map)
        expect(names.some((n) => /order/i.test(n))).toBe(true)
        expect(names.some((n) => /payment/i.test(n))).toBe(true)
      })
    }
  })

  it('reports element counts and node-box overlaps from the real layout pipelines', () => {
    const report = files.map((file) => {
      const parsed = parseHexa(readExample(file))
      if (!parsed.ok) throw new Error(`"${file}" failed to parse: ${parsed.errors.join('; ')}`)
      const map = parsed.map
      if (map.kind === 'hexagonal') {
        const { itemCount, overlaps } = hexagonalOverlaps(map)
        return { file, itemCount, overlaps }
      }
      if (map.kind === 'onion') {
        const { overlaps } = onionOverlaps(map)
        return { file, itemCount: itemCount(map), overlaps }
      }
      const { overlaps } = cleanOverlaps(map)
      return { file, itemCount: itemCount(map), overlaps }
    })
    // Informational: layouts must run without throwing, but an overlap is reported, never hidden by thinning the
    // example or patched over by changing layout code — see src/examples/examples.test.ts's own task contract.
    console.log(
      '\nExample layout report:\n' +
        report.map((r) => `  ${r.file}: ${r.itemCount} items, ${r.overlaps.length} overlapping box pair(s)${r.overlaps.length ? ` [${r.overlaps.join(', ')}]` : ''}`).join('\n'),
    )
    expect(report).toHaveLength(files.length)
  })
})

// Onion/Clean ring placement spaced elements evenly by angle and count only, ignoring each element's rendered box
// width — the stress/advanced examples above exposed real overlaps this way. Hexagonal is excluded: its own
// reported "overlaps" are an aggregate's outline around its own members, which is intentional, not a bug.
describe('no two Onion/Clean element or endpoint boxes overlap', () => {
  for (const file of files.filter((f) => f.startsWith('onion-') || f.startsWith('clean-'))) {
    it(`${file} lays out with zero overlapping box pairs`, () => {
      const parsed = parseHexa(readExample(file))
      if (!parsed.ok) throw new Error(`"${file}" failed to parse: ${parsed.errors.join('; ')}`)
      const map = parsed.map
      const { overlaps } = map.kind === 'onion' ? onionOverlaps(map) : cleanOverlaps(map as CleanFile)
      expect(overlaps).toEqual([])
    })
  }

  it('a ring crowded with long-named elements still lays out with zero overlaps (synthetic)', () => {
    const doc: OnionFile = {
      ...newOnionMap('Fresh'),
      elements: [
        { id: 'e1', name: 'A Very Long Bounded Context Element Name', ringRole: 'outer' },
        { id: 'e2', name: 'Another Rather Long Element Name Here', ringRole: 'outer' },
        { id: 'e3', name: 'Yet One More Long Named Domain Element', ringRole: 'outer' },
        { id: 'e4', name: 'And A Fourth Long Named Element Too', ringRole: 'outer' },
      ],
    }
    const { overlaps } = onionOverlaps(doc)
    expect(overlaps).toEqual([])
  })
})
