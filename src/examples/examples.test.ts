import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { newCleanMap, newOnionMap, parseHexa, toHexa, toMap } from '../model/hexa'
import { layoutMap } from '../layout/map'
import { layoutOnion } from '../layout/onion'
import { layoutClean } from '../layout/clean'
import { countCrossings } from '../layout/crossings'
import { boxWithinBand, RING_TITLE_PAD, ringedElementHeight, ringedElementWidth, TITLE_LINE } from '../layout/ringed'
import { fitTo, islandInset } from '../ui/viewport'
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
// their rendered box comes from `layout/ringed`'s own sizing (Decision 8: a long name wraps onto more than one
// line, so its box is no longer a fixed height), imported directly rather than re-derived so this suite checks
// the SAME box the SVG actually draws, never a stale approximation of it.
const RINGED_ENDPOINT_RADIUS = 4

const ringedElementBox = (key: string, name: string, x: number, y: number): Box => ({
  key,
  x,
  y,
  width: ringedElementWidth(name),
  height: ringedElementHeight(name),
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
// Reuses `layout/ringed.ts`'s own `boxWithinBand` (never a local reimplementation) so this test and the sizing
// search it gates can never quietly drift apart on what "fully inside its own band" means (the reported "Pricing
// Service"/"Place Order Service"/"Order Controller" straddling their own ring, onion-basic.hexa: the old duplicate
// check here and the layout's own zero-margin search always agreed on paper, since both allowed bare touching —
// the render didn't, because the ring itself paints as a stroke ON that exact boundary).
const boxInsideBand = (box: Box, innerApex: number, outerApex: number): boolean => boxWithinBand(box, innerApex, outerApex)

describe('every Onion/Clean element box lies fully inside its own ring band', () => {
  function elementsOutsideTheirBand(rings: { role: string; apex: number }[], elements: { key: string; ringRole: string; x: number; y: number; name: string }[]): string[] {
    const apexOf = new Map(rings.map((r, i) => [r.role, { inner: i > 0 ? rings[i - 1].apex : 0, outer: r.apex }]))
    return elements.flatMap((e) => {
      const band = apexOf.get(e.ringRole)!
      const box = ringedElementBox(e.key, e.name, e.x, e.y)
      return boxInsideBand(box, band.inner, band.outer) ? [] : [e.key]
    })
  }

  for (const file of files.filter((f) => f.startsWith('onion-') || f.startsWith('clean-'))) {
    it(`${file}: every element sits fully inside its own ring's band`, () => {
      const parsed = parseHexa(readExample(file))
      if (!parsed.ok) throw new Error(`"${file}" failed to parse: ${parsed.errors.join('; ')}`)
      const map = parsed.map
      const model = map.kind === 'onion' ? layoutOnion(map) : layoutClean(map as CleanFile)
      expect(elementsOutsideTheirBand(model.rings, model.elements)).toEqual([])
    })
  }

  it('a synthetic Onion element on a crowded outer ring still sits inside its own band', () => {
    const doc: OnionFile = {
      ...newOnionMap('Fresh'),
      elements: [
        { id: 'e1', name: 'A Very Long Bounded Context Element Name', ringRole: 'outer' },
        { id: 'e2', name: 'Order', ringRole: 'domain' },
        { id: 'e3', name: 'NewElement', ringRole: 'domain' },
      ],
    }
    const model = layoutOnion(doc)
    expect(elementsOutsideTheirBand(model.rings, model.elements)).toEqual([])
  })

  it('a synthetic Clean element in a narrow sector still sits inside its own band', () => {
    const doc: CleanFile = {
      ...newCleanMap('Fresh'),
      sectors: [
        { id: 's1', name: 'Billing', ringRole: 'domain' },
        { id: 's2', name: 'Catalog', ringRole: 'domain' },
        { id: 's3', name: 'Shipping', ringRole: 'domain' },
      ],
      elements: [{ id: 'e1', name: 'Invoice', sectorId: 's1' }],
    }
    const model = layoutClean(doc)
    expect(elementsOutsideTheirBand(model.rings, model.elements)).toEqual([])
  })
})

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

// Decision 3 (barycentric crossing minimisation) + measure, don't guess: the BEFORE counts here are the raw
// document-order layout's own crossing count, captured with `countCrossings` before Decision 3 existed; AFTER is
// pinned to the real, current layout's own count, gated by `layoutOnion`/`layoutClean`'s own "never worse than
// the untouched order" fallback (`buildOnionModel`/`buildCleanModel`), so this can never silently regress.
describe('Onion/Clean crossing counts (Decision 3) — after must never exceed before', () => {
  const BEFORE: Record<string, number> = {
    'onion-basic.hexa': 0,
    'onion-advanced.hexa': 5,
    'onion-stress.hexa': 24,
    'clean-basic.hexa': 0,
    'clean-advanced.hexa': 9,
    'clean-stress.hexa': 33,
  }
  const AFTER: Record<string, number> = {
    'onion-basic.hexa': 0,
    'onion-advanced.hexa': 4,
    'onion-stress.hexa': 21,
    'clean-basic.hexa': 0,
    'clean-advanced.hexa': 9,
    // 22 → 24: Decision 5's own per-sector label clearance used to be checked only for a LONE sector (exactly one
    // element) — every one of clean-stress's own multi-element sectors never had its own name's real clearance
    // checked at all. Registering every sector (never just lone ones, `clean.ts`'s own `extraLabelsOf`) moves a
    // few elements onto a different radial lane than before to clear their own sector's curved name, changing
    // which edge PAIRS happen to cross — still comfortably under this file's own 33-crossing BEFORE.
    'clean-stress.hexa': 24,
  }

  for (const file of files.filter((f) => f.startsWith('onion-') || f.startsWith('clean-'))) {
    it(`${file}: crossings ${BEFORE[file]} → ${AFTER[file]}`, () => {
      const parsed = parseHexa(readExample(file))
      if (!parsed.ok) throw new Error(`"${file}" failed to parse: ${parsed.errors.join('; ')}`)
      const map = parsed.map
      const model = map.kind === 'onion' ? layoutOnion(map) : layoutClean(map as CleanFile)
      const after = countCrossings(model.edges)
      expect(after).toBeLessThanOrEqual(BEFORE[file])
      expect(after).toBe(AFTER[file])
    })
  }
})

// A diagram nobody can read without zooming in isn't readable — a crowded ring used to grow far past what its own
// content needed (every element forced onto one circumference, dodging the ring's own title), leaving a fit at
// 1440×900 as low as ~34%. Pinned against the app's own real fit math (`fitTo` + `islandInset`, RingedStage's
// default collapsed-editor/closed-legend framing) so this never regresses back to microscopic text.
describe('Onion/Clean examples read at a usable size when fit to a 1440×900 stage', () => {
  const STAGE = { width: 1440, height: 900 }
  const INSET = islandInset(STAGE, false, false)
  const MIN_FIT_PERCENT: Record<string, number> = {
    'onion-advanced.hexa': 70,
    'onion-stress.hexa': 55,
    'clean-advanced.hexa': 68,
    // 55 → 50: Decision 5's own per-sector label clearance now checks EVERY sector, not only a lone one (see the
    // crossing-count pin above) — a few of clean-stress's own crowded sectors genuinely need a touch more radius
    // to keep their own curved name clear of their own elements, real clearance a title must never trade away for
    // a bigger fit percentage. Still nowhere near the ~34% af5734e-era blow-up this floor itself guards against.
    'clean-stress.hexa': 50,
  }

  for (const [file, minPercent] of Object.entries(MIN_FIT_PERCENT)) {
    it(`${file}: fits at ${minPercent}% or more`, () => {
      const parsed = parseHexa(readExample(file))
      if (!parsed.ok) throw new Error(`"${file}" failed to parse: ${parsed.errors.join('; ')}`)
      const map = parsed.map
      const model = map.kind === 'onion' ? layoutOnion(map as OnionFile) : layoutClean(map as CleanFile)
      const { scale } = fitTo(model.bounds, STAGE.width, STAGE.height, INSET)
      expect(scale * 100).toBeGreaterThanOrEqual(minPercent)
    })
  }
})

// An empty file's bands used to sit at a flat MIN_BAND (20px) — thinner than a ring title's own rendered line
// height (TITLE_LINE, 17px) plus any real clearance, so a wide uppercase title (e.g. "INTERFACE ADAPTERS") spilled
// past its own band into the next one out, and two adjacent short titles (e.g. "APPLICATION SERVICES"/"DOMAIN
// SERVICES") touched. Every ring's own band — the gap between its own outer apex and its inner neighbour's — must
// hold at least the title's own line height plus `RING_TITLE_PAD` clearance on each side.
describe('every Onion/Clean ring band is thick enough for its own title (empty file)', () => {
  const MIN_THICKNESS = TITLE_LINE + 2 * RING_TITLE_PAD

  function bandThicknesses(rings: { apex: number }[]): number[] {
    return rings.map((r, i) => r.apex - (i > 0 ? rings[i - 1].apex : 0))
  }

  it('an empty Onion file: every ring band holds its own title', () => {
    const model = layoutOnion(newOnionMap('Fresh'))
    for (const thickness of bandThicknesses(model.rings)) expect(thickness).toBeGreaterThanOrEqual(MIN_THICKNESS - 1e-6)
  })

  it('an empty Clean file: every ring band holds its own title', () => {
    const model = layoutClean(newCleanMap('Fresh'))
    for (const thickness of bandThicknesses(model.rings)) expect(thickness).toBeGreaterThanOrEqual(MIN_THICKNESS - 1e-6)
  })
})

// The font constants (RING_LABEL) are identical across kinds, so the same title text should read at roughly the
// same on-screen size everywhere — but an empty Onion/Clean's own world used to be so much smaller than an empty
// Hexagonal's that fitting it to a 1440×900 stage zoomed it to ~190%, nearly twice Hexagonal's own ~100%, making
// the text look twice as big despite sharing the exact same font size in diagram space.
describe('an empty Onion/Clean fits at a scale comparable to an empty Hexagonal (same font, same on-screen size)', () => {
  const STAGE = { width: 1440, height: 900 }
  const INSET = islandInset(STAGE, false, false)
  const emptyHexagon = toMap({ version: 1, kind: 'hexagonal', title: 'Untitled architecture', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] })

  const fitScalePercent = (bounds: { x: number; y: number; width: number; height: number }) => fitTo(bounds, STAGE.width, STAGE.height, INSET).scale * 100

  it('empty Onion/Clean fit within ±25% of empty Hexagonal\'s own fit scale', () => {
    const hexagonalScale = fitScalePercent(layoutMap(emptyHexagon).bounds)
    const onionScale = fitScalePercent(layoutOnion(newOnionMap('Fresh')).bounds)
    const cleanScale = fitScalePercent(layoutClean(newCleanMap('Fresh')).bounds)
    for (const scale of [onionScale, cleanScale]) {
      expect(scale).toBeGreaterThanOrEqual(hexagonalScale * 0.75)
      expect(scale).toBeLessThanOrEqual(hexagonalScale * 1.25)
    }
  })
})
