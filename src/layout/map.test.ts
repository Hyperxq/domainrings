import { describe, expect, expectTypeOf, it } from 'vitest'
import { cellCentre, hexagonBounds, layoutMap, MAP_GAP } from './map'
import { outwardEdgePoint, routeLink } from './links'
import { layoutDiagram, type Box, type LayoutMode, type LayoutOptions } from './layout'
import { toMap } from '../model/hexa'
import { EXAMPLE_DIAGRAM, RETIRED_SEEDS, STRESS_DIAGRAM } from '../model/example'
import { freeCell, removeHexagon } from '../model/map'
import { MapSchema, type Diagram, type HexaMap, type Hexagon, type Wall } from '../model/schema'
import { twoHexagonMap } from '../test/fixtures'

const CORPUS: Array<[string, Diagram]> = [
  ['the seeded example', EXAMPLE_DIAGRAM],
  ['the stress diagram', STRESS_DIAGRAM],
  ...RETIRED_SEEDS.map((seed, i): [string, Diagram] => [`retired seed v${i + 1}`, seed]),
]
const MODES: LayoutMode[] = ['detailed', 'overview']

describe('layoutMap — one-hexagon equivalence (MIG-05)', () => {
  for (const mode of MODES) {
    for (const [label, diagram] of CORPUS) {
      it(`matches layoutDiagram for ${label} in ${mode} mode`, () => {
        const map = toMap(diagram)
        const result = layoutMap(map, { mode })
        const expected = layoutDiagram(diagram, { mode })
        expect(result.hexagons).toHaveLength(1)
        expect(result.hexagons[0].model).toStrictEqual(expected)
        expect(result.hexagons[0].centre).toStrictEqual({ x: 0, y: 0 })
        expect(result.bounds).toStrictEqual(expected.bounds)
        expect(result.title).toBeUndefined()
        expect(result.links).toEqual([])
      })
    }
  }
})

describe('layoutMap — multi-hexagon placement (CANVAS-01, CANVAS-02)', () => {
  it('places two hexagons on a row without overlapping shifted bounds', () => {
    const result = layoutMap(twoHexagonMap())
    expect(result.hexagons).toHaveLength(2)
    const [a, b] = result.hexagons
    expect(a.centre).toStrictEqual({ x: 0, y: 0 })
    expect(b.centre.x).toBeGreaterThan(0)
    const boxA = { left: a.model.bounds.x + a.centre.x, right: a.model.bounds.x + a.centre.x + a.model.bounds.width }
    const boxB = { left: b.model.bounds.x + b.centre.x, right: b.model.bounds.x + b.centre.x + b.model.bounds.width }
    expect(boxA.right).toBeLessThan(boxB.left)
  })

  it('renders a map title only when there is more than one hexagon', () => {
    const result = layoutMap(twoHexagonMap())
    expect(result.title).toMatchObject({ text: 'Two slices, one link', style: 'title' })
  })

  it('never overlaps two lopsided hexagons — one whose content reaches far right, the other far left (CANVAS-01.1)', () => {
    // h1's driven external stretches its content to the RIGHT of its own centre; h2's driving actor stretches
    // its content to the LEFT of its own centre — the exact combination a uniform pitch (based on width alone)
    // cannot space correctly, since it ignores which side each hexagon's extent actually falls on.
    const map: HexaMap = {
      version: 2,
      kind: 'hexagonal',
      title: 'Lopsided pair',
      contexts: [{ id: 'c1' }],
      hexagons: [
        {
          id: 'h1',
          contextId: 'c1',
          cell: { q: 0, r: 0 },
          title: 'Right heavy',
          domain: [],
          useCases: [],
          ports: [{ id: 'p-drv', name: 'drv', side: 'driven' }],
          adapters: [{ id: 'a1', name: 'Adapter', portId: 'p-drv' }],
          actors: [],
          externals: [{ id: 'e1', name: 'A Very Long External System Name That Extends Far To The Right', adapterId: 'a1' }],
        },
        {
          id: 'h2',
          contextId: 'c1',
          cell: { q: 1, r: 0 },
          title: 'Left heavy',
          domain: [],
          useCases: [],
          ports: [{ id: 'p-drg', name: 'drg', side: 'driving' }],
          adapters: [{ id: 'a2', name: 'Adapter', portId: 'p-drg' }],
          actors: [{ id: 'ac1', name: 'A Very Long Actor Name That Extends Far To The Left', adapterId: 'a2' }],
          externals: [],
        },
      ],
      links: [],
    }

    const result = layoutMap(map)
    const [a, b] = result.hexagons
    const boxA = { left: a.model.bounds.x + a.centre.x, right: a.model.bounds.x + a.centre.x + a.model.bounds.width }
    const boxB = { left: b.model.bounds.x + b.centre.x, right: b.model.bounds.x + b.centre.x + b.model.bounds.width }
    expect(boxB.left - boxA.right).toBeGreaterThanOrEqual(MAP_GAP)
  })

  it('draws the link via routeLink, crossing through the gap between the from and to hexagon boxes (ADR-01)', () => {
    const map = twoHexagonMap()
    const result = layoutMap(map)
    const [a, b] = result.hexagons
    const outNode = a.model.nodes.find((n) => n.kind === 'port' && n.ref === 'p-out')!
    const inNode = b.model.nodes.find((n) => n.kind === 'port' && n.ref === 'p-in')!
    const fromPoint = { x: outNode.x + a.centre.x, y: outNode.y + a.centre.y }
    const toPoint = { x: inNode.x + b.centre.x, y: inNode.y + b.centre.y }

    const expected = routeLink(
      { point: fromPoint, wall: outNode.wall!, box: hexagonBounds(a), clear: [] },
      { point: toPoint, wall: inNode.wall!, box: hexagonBounds(b), clear: [] },
    )

    expect(result.links).toEqual([{ id: 'l1', points: expected.points }])
    expect(result.links[0].points[0]).toEqual(fromPoint)
    expect(result.links[0].points.at(-1)).toEqual(toPoint)
  })

  it('a lone link on its own gap (the only member of its lane group) routes with laneOffset 0 explicitly, byte-identical to the no-lane route (REQ-LNK-05.5)', () => {
    const map = twoHexagonMap()
    const result = layoutMap(map)
    const [a, b] = result.hexagons
    const outNode = a.model.nodes.find((n) => n.kind === 'port' && n.ref === 'p-out')!
    const inNode = b.model.nodes.find((n) => n.kind === 'port' && n.ref === 'p-in')!
    const fromPoint = { x: outNode.x + a.centre.x, y: outNode.y + a.centre.y }
    const toPoint = { x: inNode.x + b.centre.x, y: inNode.y + b.centre.y }

    const expected = routeLink(
      { point: fromPoint, wall: outNode.wall!, box: hexagonBounds(a), clear: [] },
      { point: toPoint, wall: inNode.wall!, box: hexagonBounds(b), clear: [] },
      0,
    )

    expect(result.links[0].points).toEqual(expected.points)
  })

  it('omits pattern/label when the link’s two hexagons share a context', () => {
    const result = layoutMap(twoHexagonMap())
    expect(result.links[0].pattern).toBeUndefined()
    expect(result.links[0].label).toBeUndefined()
  })

  it('carries pattern + the route’s channel label only when the link’s two hexagons are in different contexts', () => {
    const map: HexaMap = {
      ...twoHexagonMap(),
      contexts: [{ id: 'c1' }, { id: 'c2' }],
      hexagons: twoHexagonMap().hexagons.map((h, i) => (i === 1 ? { ...h, contextId: 'c2' } : h)),
      links: [{ id: 'l1', from: { hexagonId: 'h1', portId: 'p-out' }, to: { hexagonId: 'h2', portId: 'p-in' }, pattern: 'acl' }],
    }

    const result = layoutMap(map)

    expect(result.links[0].pattern).toBe('acl')
    const [a, b] = result.hexagons
    const route = routeLink(
      { point: result.links[0].points[0], wall: a.model.nodes.find((n) => n.kind === 'port' && n.ref === 'p-out')!.wall!, box: hexagonBounds(a), clear: [] },
      { point: result.links[0].points.at(-1)!, wall: b.model.nodes.find((n) => n.kind === 'port' && n.ref === 'p-in')!.wall!, box: hexagonBounds(b), clear: [] },
    )
    expect(result.links[0].label).toStrictEqual(route.label)
  })
})

describe('layoutMap — a pattern label stays inside the gap when its link is lane-offset (REQ-LNK-06.1, REQ-LNK-05.5)', () => {
  it('keeps the labeled link’s label.at strictly between the two hexagon boxes, on its own shifted midline, even when lane-shifted', () => {
    const base = twoHexagonMap()
    const hexagons = base.hexagons.map((h) =>
      h.id === 'h1'
        ? { ...h, ports: [...h.ports, { id: 'p-out2', name: 'out2', side: 'driven' as const }] }
        : { ...h, contextId: 'c2', ports: [...h.ports, { id: 'p-in2', name: 'in2', side: 'driving' as const }] },
    )
    const links = [
      { id: 'link-a', from: { hexagonId: 'h1', portId: 'p-out' }, to: { hexagonId: 'h2', portId: 'p-in' } },
      { id: 'link-b', from: { hexagonId: 'h1', portId: 'p-out2' }, to: { hexagonId: 'h2', portId: 'p-in2' }, pattern: 'acl' as const },
    ]
    const map: HexaMap = { ...base, contexts: [{ id: 'c1' }, { id: 'c2' }], hexagons, links }
    // Two links on the same hexagon pair, but on DIFFERENT ports — unlike a duplicate-port pair, MapSchema accepts
    // this (only an identical from/to port pair is rejected), so the fixture doubles as a schema-validity check.
    expect(MapSchema.safeParse(map).success).toBe(true)

    const result = layoutMap(map)
    const labeled = result.links.find((l) => l.id === 'link-b')!
    expect(labeled.label).toBeDefined()

    const [a, b] = result.hexagons
    const boxA = hexagonBounds(a)
    const boxB = hexagonBounds(b)
    // The two boxes are separated on x (side by side) — the label sits strictly between their facing edges,
    // regardless of which lane its link landed in.
    expect(labeled.label!.at.x).toBeGreaterThan(boxA.x + boxA.width)
    expect(labeled.label!.at.x).toBeLessThan(boxB.x)

    // A solo run of the SAME link (no sibling sharing its gap) lands its lane group at size 1 — offset 0 by
    // construction. The difference from the shared-gap run isolates the lane shift as the only variable: link-b
    // is rank 1 of 2 (lexicographically after link-a), so its offset is +LANE_PITCH/2.
    const solo = layoutMap({ ...map, links: [links[1]] })
    const soloLabel = solo.links.find((l) => l.id === 'link-b')!.label!
    expect(labeled.label!.at.x - soloLabel.at.x).toBe(5)
  })
})

/** `twoHexagonMap`, with the given `end`'s hexagon's port moved onto `wall` and given an adapter — lets the
 * adapter-anchor case be exercised on every wall, not just the two default straight ones. */
function mapWithAdapterOnWall(wall: Wall, end: 'from' | 'to'): HexaMap {
  const base = twoHexagonMap()
  const portId = end === 'from' ? 'p-out' : 'p-in'
  const adapterId = end === 'from' ? 'a-out' : 'a-in'
  const hexagons = base.hexagons.map((h) => {
    if ((end === 'from' && h.id !== 'h1') || (end === 'to' && h.id !== 'h2')) return h
    return { ...h, ports: h.ports.map((p) => (p.id === portId ? { ...p, wall } : p)), adapters: [{ id: adapterId, name: 'Adapter', portId }] }
  })
  const link = end === 'from' ? { ...base.links[0], from: { ...base.links[0].from, adapterId } } : { ...base.links[0], to: { ...base.links[0].to, adapterId } }
  return { ...base, hexagons, links: [link] }
}

describe('layoutMap — anchors a link end on its adapter’s outer edge on every wall (REQ-LNK-05.3, REQ-LNK-05.4)', () => {
  const CASES: Array<[Wall, 'from' | 'to']> = [
    ['e', 'from'],
    ['w', 'to'],
    ['ne', 'from'],
    ['nw', 'to'],
    ['se', 'from'],
    ['sw', 'to'],
  ]

  for (const [wall, end] of CASES) {
    it(`wall '${wall}' (${end} end)`, () => {
      const map = mapWithAdapterOnWall(wall, end)
      const result = layoutMap(map)
      const hex = result.hexagons.find((h) => h.id === (end === 'from' ? 'h1' : 'h2'))!
      const adapterId = end === 'from' ? 'a-out' : 'a-in'
      const portId = end === 'from' ? 'p-out' : 'p-in'
      const adapter = hex.model.nodes.find((n) => n.kind === 'adapter' && n.ref === adapterId)!
      const port = hex.model.nodes.find((n) => n.kind === 'port' && n.ref === portId)!
      const adapterBox = { x: adapter.x - adapter.width / 2 + hex.centre.x, y: adapter.y - adapter.height / 2 + hex.centre.y, width: adapter.width, height: adapter.height }
      const expectedPoint = outwardEdgePoint(adapterBox, wall)
      const portPoint = { x: port.x + hex.centre.x, y: port.y + hex.centre.y }
      const linkPoint = end === 'from' ? result.links[0].points[0] : result.links[0].points.at(-1)!

      expect(adapter.wall).toBe(wall)
      expect(linkPoint).toEqual(expectedPoint)
      expect(linkPoint).not.toEqual(portPoint)
    })
  }
})

describe('layoutMap — the escape walk’s obstacle set is this hexagon’s OTHER node boxes, excluding the anchor (REQ-LNK-05.1)', () => {
  it('a leaf sitting outward of an adapter, on the same wall, forces a jog around it — the adapter’s own anchor point is unaffected', () => {
    const base = twoHexagonMap()
    const withoutLeaf: HexaMap = {
      ...base,
      hexagons: [{ ...base.hexagons[0], adapters: [{ id: 'a-out', name: 'Adapter', portId: 'p-out' }] }, base.hexagons[1]],
      links: [{ ...base.links[0], from: { ...base.links[0].from, adapterId: 'a-out' } }],
    }
    const withLeaf: HexaMap = {
      ...withoutLeaf,
      hexagons: [{ ...withoutLeaf.hexagons[0], externals: [{ id: 'e-leaf', name: 'Leaf', adapterId: 'a-out' }] }, withoutLeaf.hexagons[1]],
    }

    const baseline = layoutMap(withoutLeaf).links[0]
    const withObstacle = layoutMap(withLeaf).links[0]

    // Same anchor point either way — the leaf, added AFTER the anchor on the escape walk, never moves it.
    expect(withObstacle.points[0]).toEqual(baseline.points[0])
    // A jog was inserted (at least the two points it takes: advance to the leaf's near edge, then step past it) —
    // a longer, different route than the no-obstacle case.
    expect(withObstacle.points.length).toBeGreaterThanOrEqual(baseline.points.length + 2)
    expect(withObstacle.points).not.toEqual(baseline.points)
    // The jog actually left the anchor's own y (row) to clear the leaf, on the way to point index 2.
    expect(withObstacle.points[2].y).not.toBe(withObstacle.points[0].y)
    // Still axis-aligned throughout (REQ-LNK-05.4): the advance leg (index 0→1) moves only x, the jog leg
    // (index 1→2) moves only y.
    expect(withObstacle.points[1].y).toBe(withObstacle.points[0].y)
    expect(withObstacle.points[2].x).toBe(withObstacle.points[1].x)
  })

  it('excludes the anchor’s own port from the obstacle set — an adapter-anchored end never jogs around the port it sits in front of', () => {
    const base = twoHexagonMap()
    const map: HexaMap = {
      ...base,
      hexagons: [{ ...base.hexagons[0], adapters: [{ id: 'a-out', name: 'Adapter', portId: 'p-out' }] }, base.hexagons[1]],
      links: [{ ...base.links[0], from: { ...base.links[0].from, adapterId: 'a-out' } }],
    }

    const result = layoutMap(map)
    const [a] = result.hexagons
    const adapter = a.model.nodes.find((n) => n.kind === 'adapter' && n.ref === 'a-out')!
    const adapterEdgePoint = { x: adapter.x + adapter.width / 2 + a.centre.x, y: adapter.y + a.centre.y }

    // No jog inserted before the gap crossing: exactly the plain [anchor, stub, ...] shape, same as the port-only
    // case — the port sitting behind the adapter on the same wall was correctly excluded as an obstacle.
    expect(result.links[0].points[0]).toEqual(adapterEdgePoint)
    expect(result.links[0].points[1].y).toBe(adapterEdgePoint.y)
  })
})

describe('cellCentre — affine pointy-top lattice (ADR-01)', () => {
  const pitch = { x: 100, y: 80 }

  it('places {0,0} at the origin regardless of pitch', () => {
    expect(cellCentre({ q: 0, r: 0 }, pitch)).toStrictEqual({ x: 0, y: 0 })
  })

  it('steps by pitch.x along q, with no y movement', () => {
    expect(cellCentre({ q: 2, r: 0 }, pitch)).toStrictEqual({ x: 200, y: 0 })
  })

  it('steps by pitch.y along r, skewing x by half a step per r — a pointy-top lattice, not a rectangular grid', () => {
    expect(cellCentre({ q: 0, r: 1 }, pitch)).toStrictEqual({ x: 50, y: 80 })
    expect(cellCentre({ q: 0, r: -2 }, pitch)).toStrictEqual({ x: -100, y: -160 })
  })
})

describe('layoutMap — honeycomb lattice placement (ADR-01)', () => {
  const twoCellColumn = (): HexaMap => ({
    version: 2,
    kind: 'hexagonal',
    title: 'Two on a column',
    contexts: [{ id: 'c1' }],
    hexagons: [
      { id: 'h1', contextId: 'c1', cell: { q: 0, r: 0 }, title: 'North', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] },
      { id: 'h2', contextId: 'c1', cell: { q: 0, r: 1 }, title: 'South', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] },
    ],
    links: [],
  })

  it('derives pitch from the map’s own max extents + MAP_GAP and places {0,1} at half a pitch.x, one pitch.y down', () => {
    const result = layoutMap(twoCellColumn())
    const [a, b] = result.hexagons
    // Both hexagons share the same (empty) content, so either model's bounds already are the map's max extents.
    // Expected values are literal arithmetic on that independently-derived pitch, never calling cellCentre —
    // otherwise a mutation to cellCentre's own formula would cancel out on both sides of the assertion.
    const left = -a.model.bounds.x
    const right = a.model.bounds.x + a.model.bounds.width
    const top = -a.model.bounds.y
    const bottom = a.model.bounds.y + a.model.bounds.height
    const boxX = left + right + MAP_GAP
    const boxY = top + bottom + MAP_GAP
    const pitchX = Math.max(boxX, (boxY * 2) / Math.sqrt(3))
    const pitchY = Math.max(boxY, (boxX * Math.sqrt(3)) / 2)
    expect(a.centre).toStrictEqual({ x: 0, y: 0 })
    expect(b.centre).toStrictEqual({ x: pitchX * 0.5, y: pitchY })
  })

  it('keeps the lattice regular (pitch.y = pitch.x·√3/2), so context hulls trace regular hexagons', () => {
    const { pitch } = layoutMap(twoCellColumn())
    expect(pitch.y / pitch.x).toBeCloseTo(Math.sqrt(3) / 2, 10)
  })

  it('keeps the two boxes disjoint by at least MAP_GAP', () => {
    const result = layoutMap(twoCellColumn())
    const [a, b] = result.hexagons
    const boxA = hexagonBounds(a)
    const boxB = hexagonBounds(b)
    expect(boxB.y - (boxA.y + boxA.height)).toBeGreaterThanOrEqual(MAP_GAP)
  })

  it('exposes the pitch it computed, so a caller can place a not-yet-existing neighbour cell (SEAM-04)', () => {
    const result = layoutMap(twoCellColumn())
    const [, b] = result.hexagons
    // b sits at cell {0,1} = cellCentre({0,1}, pitch); reading the pitch back off that relation, independent of cellCentre itself.
    expect(result.pitch).toStrictEqual({ x: b.centre.x * 2, y: b.centre.y })
  })

  // The two prior tests use hexagons with IDENTICAL (empty) content, so a pitch computed from `perHexagon[0]`'s
  // extents alone happens to match `Math.max(...)` over every hexagon — neither test can tell the two
  // implementations apart. Here h1 (first in the array) is tiny and h2 is STRESS-sized, so a first-hexagon-only
  // pitch would be far too small and the boxes would overlap.
  it('derives pitch from the map-wide max extents, not the first hexagon’s own (CANVAS-01.4 hardening)', () => {
    const map: HexaMap = {
      version: 2,
      kind: 'hexagonal',
      title: 'Small then stress',
      contexts: [{ id: 'c1' }],
      hexagons: [
        { id: 'h1', contextId: 'c1', cell: { q: 0, r: 0 }, title: 'Small', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] },
        {
          id: 'h2',
          contextId: 'c1',
          cell: { q: 1, r: 0 },
          title: STRESS_DIAGRAM.title,
          domain: STRESS_DIAGRAM.domain,
          useCases: STRESS_DIAGRAM.useCases,
          ports: STRESS_DIAGRAM.ports,
          adapters: STRESS_DIAGRAM.adapters,
          actors: STRESS_DIAGRAM.actors,
          externals: STRESS_DIAGRAM.externals,
        },
      ],
      links: [],
    }
    const result = layoutMap(map)
    const [a, b] = result.hexagons
    const boxA = hexagonBounds(a)
    const boxB = hexagonBounds(b)
    expect(boxB.x - (boxA.x + boxA.width)).toBeGreaterThanOrEqual(MAP_GAP)
  })
})

describe('layoutMap — contexts (CB-01.1, ADR-04, SEAM-04)', () => {
  const oneContextMap = (): HexaMap => ({
    version: 2,
    kind: 'hexagonal',
    title: 'One context',
    contexts: [{ id: 'c1' }],
    hexagons: [
      { id: 'h1', contextId: 'c1', cell: { q: 0, r: 0 }, title: 'A', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] },
      { id: 'h2', contextId: 'c1', cell: { q: 1, r: 0 }, title: 'B', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] },
    ],
    links: [],
  })

  const twoContextMap = (): HexaMap => ({
    ...oneContextMap(),
    contexts: [{ id: 'c1', name: 'Billing' }, { id: 'c2' }],
    hexagons: [
      { id: 'h1', contextId: 'c1', cell: { q: 0, r: 0 }, title: 'A', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] },
      { id: 'h2', contextId: 'c2', cell: { q: 6, r: 6 }, title: 'B', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] },
    ],
  })

  it('exposes no contexts below two (CB-01.1)', () => {
    const result = layoutMap(oneContextMap())
    expect(result.contexts).toEqual([])
  })

  it('exposes one entry per context, with its display label, from two contexts up', () => {
    const result = layoutMap(twoContextMap())
    expect(result.contexts.map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(result.contexts.find((c) => c.id === 'c1')?.label).toBe('Billing')
    expect(result.contexts.find((c) => c.id === 'c2')?.label).toBe('Context 2')
    for (const c of result.contexts) expect(c.loops.length).toBeGreaterThan(0)
  })

  it('grows bounds to include the hull loops and chips once contexts are drawn', () => {
    const withoutContexts = layoutMap(oneContextMap())
    const withContexts = layoutMap(twoContextMap())
    // h2 sits at a distant cell {6,6} — its hull loop and chip push the bounds far beyond the two close hexagons alone.
    expect(withContexts.bounds.width).toBeGreaterThan(withoutContexts.bounds.width * 3)
  })

  it('removes hulls and chips when removeHexagon drops the map back to one context (CB-01.3)', () => {
    const grown = twoContextMap()
    expect(layoutMap(grown).contexts).toHaveLength(2)

    const { map: backToOne } = removeHexagon(grown, 'h2')

    expect(layoutMap(backToOne).contexts).toHaveLength(0)
  })

  it('grows bounds to include a long chip label even when the hull loops alone would not need it', () => {
    // Adjacent cells keep the hull loops tight; only a long context name should force the bounds wider.
    const adjacent = (contexts: HexaMap['contexts']): HexaMap => ({
      ...oneContextMap(),
      contexts,
      hexagons: [
        { id: 'h1', contextId: 'c1', cell: { q: 0, r: 0 }, title: 'A', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] },
        { id: 'h2', contextId: 'c2', cell: { q: 1, r: 0 }, title: 'B', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] },
      ],
    })
    const shortLabel = layoutMap(adjacent([{ id: 'c1' }, { id: 'c2' }]))
    const longLabel = layoutMap(adjacent([{ id: 'c1', name: 'B'.repeat(200) }, { id: 'c2' }]))

    expect(longLabel.bounds.width).toBeGreaterThan(shortLabel.bounds.width)
  })
})

// --- The full no-overlap property, for any N up to 30, incl. STRESS content, both modes ------------------------

/** A small seeded LCG — deterministic across runs/platforms, no new dependency (numeric recipe: Numerical
 * Recipes' constants), so a failing seed can be reproduced exactly from the printed seed alone. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

/** N hexagons (N includes at least one STRESS-content hexagon), grown from a random already-placed hexagon each
 * time via the real `freeCell` search — the same topology grow-the-map itself produces — so the corpus covers
 * branches, not just a straight line. Content mix: one forced STRESS hexagon, ~30% EXAMPLE-shaped, the rest empty. */
function seededHoneycomb(seed: number, n: number): HexaMap {
  const rng = makeRng(seed)
  const stressAt = Math.floor(rng() * n)
  const hexagons: Hexagon[] = []
  for (let i = 0; i < n; i++) {
    const cell = i === 0 ? { q: 0, r: 0 } : freeCell({ hexagons }, hexagons[Math.floor(rng() * hexagons.length)].cell)
    const base = i === stressAt ? STRESS_DIAGRAM : rng() < 0.3 ? EXAMPLE_DIAGRAM : undefined
    const hexagon: Hexagon = base
      ? {
          id: `h${i + 1}`,
          contextId: 'c1',
          cell,
          title: base.title,
          subtitle: base.subtitle,
          domain: base.domain,
          useCases: base.useCases,
          ports: base.ports,
          adapters: base.adapters,
          actors: base.actors,
          externals: base.externals,
          composition: base.composition,
        }
      : { id: `h${i + 1}`, contextId: 'c1', cell, title: `H${i + 1}`, domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] }
    hexagons.push(hexagon)
  }
  return { version: 2, kind: 'hexagonal', title: `Seed ${seed}`, contexts: [{ id: 'c1' }], hexagons, links: [] }
}

/** The largest gap the two boxes are separated by on either axis — positive iff they are truly disjoint on that
 * axis by at least that much (mirrors the lopsided-hexagons test's own `left - right` idiom, generalised to
 * both axes so it also catches an overlap that only shows up on y). */
function separation(a: Box, b: Box): number {
  const dx = Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width)
  const dy = Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height)
  return Math.max(dx, dy)
}

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8]
const SIZES = [2, 5, 12, 30]

describe('layoutMap — full no-overlap property (CANVAS-01.2–01.4)', () => {
  it('has no `focus` parameter — position never depends on which hexagon is current', () => {
    expectTypeOf<LayoutOptions>().not.toHaveProperty('focus')
    expectTypeOf(layoutMap).parameter(1).toEqualTypeOf<LayoutOptions | undefined>()
  })

  it('is a pure function of (map, options): the same map lays out identically on repeated calls, regardless of anything focus-shaped', () => {
    const map = seededHoneycomb(1, 8)
    const first = layoutMap(map, { mode: 'detailed' })
    const second = layoutMap(map, { mode: 'detailed' })
    expect(second).toStrictEqual(first)
  })

  for (const mode of MODES) {
    for (const seed of SEEDS) {
      for (const n of SIZES) {
        it(`seed ${seed}, N=${n}, ${mode}: every pair of hexagon boxes stays separated by at least MAP_GAP`, () => {
          const map = seededHoneycomb(seed, n)
          const result = layoutMap(map, { mode })
          expect(result.hexagons).toHaveLength(n)
          for (let i = 0; i < result.hexagons.length; i++) {
            for (let j = i + 1; j < result.hexagons.length; j++) {
              const gap = separation(hexagonBounds(result.hexagons[i]), hexagonBounds(result.hexagons[j]))
              expect(gap).toBeGreaterThanOrEqual(MAP_GAP - 1e-6)
            }
          }
        })
      }
    }
  }

  it('positions are stable across a focus change: laying out the SAME map before and after calling setFocus on a live store leaves every centre untouched (CANVAS-01.3)', async () => {
    const { useMapStore } = await import('../model/store')
    const map = seededHoneycomb(2, 6)
    useMapStore.getState().replace(map)
    const before = layoutMap(useMapStore.getState().map, { mode: 'detailed' })

    useMapStore.getState().setFocus(useMapStore.getState().map.hexagons[3].id)

    const after = layoutMap(useMapStore.getState().map, { mode: 'detailed' })
    expect(after.hexagons.map((h) => h.centre)).toStrictEqual(before.hexagons.map((h) => h.centre))
  })

  it('a content-growth-triggered pitch change never introduces an overlap (CANVAS-01.4)', () => {
    // h1 starts small; growing its content past every other hexagon forces `pitch` itself to change — the same
    // CANVAS-01.4 hardening as the test above, at property scale instead of one pair.
    const base = seededHoneycomb(3, 10)
    const { version: _version, kind: _kind, title, ...stressFields } = STRESS_DIAGRAM
    const grown: HexaMap = {
      ...base,
      hexagons: base.hexagons.map((h, i): Hexagon => (i === 0 ? { ...h, title, ...stressFields } : h)),
    }
    const result = layoutMap(grown)
    for (let i = 0; i < result.hexagons.length; i++) {
      for (let j = i + 1; j < result.hexagons.length; j++) {
        const gap = separation(hexagonBounds(result.hexagons[i]), hexagonBounds(result.hexagons[j]))
        expect(gap).toBeGreaterThanOrEqual(MAP_GAP - 1e-6)
      }
    }
  })
})
