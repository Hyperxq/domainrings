import { describe, expect, expectTypeOf, it } from 'vitest'
import { COMPACT_FROM, hexagonBounds } from './compactHexagon'
import { cellCentre } from './lattice'
import { currentHexagon, growAnchor, layoutMap, MAP_GAP, type MapLayoutOptions } from './map'
import { pointInRegion } from './hull'
import { CHIP_LABEL, measure, TITLE } from './text'
import { outwardEdgePoint, routeLink } from './links'
import type { Box } from './geometry'
import { layoutDiagram, type LayoutMode } from './layout'
import { parseHexa, toMap } from '../model/hexa'
import { EXAMPLE_DIAGRAM, RETIRED_SEEDS, STRESS_DIAGRAM } from '../model/example'
import { diagramOf, freeCell, freeSides, neighbour, removeHexagon, SIDE_ORDER } from '../model/map'
import { MapSchema, VERSION, type Diagram, type HexaMap, type Hexagon, type Wall } from '../model/schema'
import { contains, fitTo, islandInset, visibleRect } from '../ui/viewport'
import projectBuilder from '../model/fixtures/project-builder.hexa?raw'
import { manyHexagonMap, twoHexagonMap } from '../test/fixtures'

const CORPUS: Array<[string, Diagram]> = [
  ['the seeded example', EXAMPLE_DIAGRAM],
  ['the stress diagram', STRESS_DIAGRAM],
  ...RETIRED_SEEDS.map((seed, i): [string, Diagram] => [`retired seed v${i + 1}`, seed]),
]
const MODES: LayoutMode[] = ['detailed', 'overview']
/** Whether the segment a-b passes through the open interior of `box` (Liang-Barsky clip; grazing an edge is not a hit). */
const segmentHitsBox = (a: { x: number; y: number }, b: { x: number; y: number }, box: Box): boolean => {
  const d = { x: b.x - a.x, y: b.y - a.y }
  let [t0, t1] = [0, 1]
  for (const [p, q] of [[-d.x, a.x - box.x], [d.x, box.x + box.width - a.x], [-d.y, a.y - box.y], [d.y, box.y + box.height - a.y]]) {
    if (p === 0) {
      if (q <= 0) return false
    } else if (p < 0) {
      if (q / p >= t1) return false
      t0 = Math.max(t0, q / p)
    } else {
      if (q / p <= t0) return false
      t1 = Math.min(t1, q / p)
    }
  }
  return t1 > t0
}
const projectBuilderMap = (): HexaMap => {
  const parsed = parseHexa(projectBuilder)
  if (!parsed.ok || parsed.map.kind !== 'hexagonal') throw new Error('project-builder fixture must parse')
  return parsed.map
}

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
      version: VERSION,
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
    version: VERSION,
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
      version: VERSION,
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
    version: VERSION,
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

  it('draws no context for a lone occupied context beside a declared, hexagon-less one', () => {
    const map: HexaMap = { ...oneContextMap(), contexts: [{ id: 'c1' }, { id: 'c2' }], hexagons: [oneContextMap().hexagons[0]] }
    expect(layoutMap(map).contexts).toEqual([])
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
  return { version: VERSION, kind: 'hexagonal', title: `Seed ${seed}`, contexts: [{ id: 'c1' }], hexagons, links: [] }
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
  it('has no `focus` parameter — the current hexagon only decides which hexagons compact, never where a cell sits', () => {
    expectTypeOf<MapLayoutOptions>().not.toHaveProperty('focus')
    expectTypeOf(layoutMap).parameter(1).toEqualTypeOf<MapLayoutOptions | undefined>()
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

describe('growAnchor', () => {
  const MARGIN = 12
  const EPS = 1e-6
  const clearOf = (p: { x: number; y: number }, box: Box) =>
    p.x <= box.x - MARGIN + EPS || p.x >= box.x + box.width + MARGIN - EPS || p.y <= box.y - MARGIN + EPS || p.y >= box.y + box.height + MARGIN - EPS

  for (const mode of MODES) {
    for (const [label, diagram] of CORPUS) {
      it(`sits outside the hexagon's own content bounds on all six sides for ${label} in ${mode} mode`, () => {
        const layout = layoutMap(toMap(diagram), { mode })
        const hex = layout.hexagons[0]
        for (const side of SIDE_ORDER) {
          expect(clearOf(growAnchor(hex, side, layout.pitch, MARGIN), hexagonBounds(hex)), side).toBe(true)
        }
      })
    }
  }

  it('clears the current hexagon and every neighbour on every free side of a compact map', () => {
    for (const map of [manyHexagonMap(12), projectBuilderMap()]) {
      for (const current of map.hexagons) {
        const layout = layoutMap(map, { current: current.id })
        const hex = currentHexagon(layout, current.id)
        for (const side of freeSides(map, hex.cell)) {
          const at = growAnchor(hex, side, layout.pitch, MARGIN)
          for (const other of layout.hexagons) expect(clearOf(at, hexagonBounds(other)), `${current.id} ${side} vs ${other.id}`).toBe(true)
        }
      }
    }
  })

  it('leaves every hexagon of a compact map along the lattice step to that neighbour, however far it was pushed off its cell', () => {
    const layout = layoutMap(projectBuilderMap(), { current: 'h-exec' })
    for (const hex of layout.hexagons) {
      for (const side of SIDE_ORDER) {
        const step = { x: cellCentre(neighbour(hex.cell, side), layout.pitch).x - cellCentre(hex.cell, layout.pitch).x, y: cellCentre(neighbour(hex.cell, side), layout.pitch).y - cellCentre(hex.cell, layout.pitch).y }
        const at = growAnchor(hex, side, layout.pitch, MARGIN)
        const along = { x: at.x - hex.centre.x, y: at.y - hex.centre.y }
        expect(Math.abs(along.x * step.y - along.y * step.x), `${hex.id} ${side}`).toBeLessThan(1e-6 * Math.hypot(along.x, along.y) * Math.hypot(step.x, step.y))
        expect(along.x * step.x + along.y * step.y).toBeGreaterThan(0)
      }
    }
  })

  it('stays on the lattice line toward the neighbour, never past the neighbour itself', () => {
    const layout = layoutMap(toMap(STRESS_DIAGRAM))
    const hex = layout.hexagons[0]
    const east = growAnchor(hex, 'e', layout.pitch, MARGIN)
    expect(east.y).toBe(hex.centre.y)
    expect(east.x).toBeLessThanOrEqual(hex.centre.x + layout.pitch.x)
  })
})

const hex = (id: string, contextId: string, q: number, r: number): Hexagon => ({ id, contextId, cell: { q, r }, title: id, domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] })
const contextMap = (cells: Array<[string, number, number]>, contexts = ['c1', 'c2', 'c3']): HexaMap => ({
  version: VERSION,
  kind: 'hexagonal',
  title: 'Multi context',
  contexts: contexts.map((id) => ({ id })),
  hexagons: cells.map(([contextId, q, r], i) => hex(`h${i + 1}`, contextId, q, r)),
  links: [],
})
/** Three contexts over five hexagons, packed so one context's tiles sit right above another's. */
const HONEYCOMB = contextMap([['c1', 0, 0], ['c1', 1, 0], ['c2', 0, 1], ['c3', 1, 1], ['c3', -1, 2]])

describe('layoutMap — the map title clears every context region and chip', () => {
  it('sits above every hull vertex and every chip on a multi-context map', () => {
    const { title, contexts } = layoutMap(HONEYCOMB)
    const topOfContent = Math.min(...contexts.flatMap((c) => [c.chip.y, ...c.loops.flat().map((p) => p.y)]))
    expect(title!.y).toBeLessThan(topOfContent)
  })

  it('keeps the title inside the map bounds', () => {
    const { title, bounds } = layoutMap(HONEYCOMB)
    expect(title!.y).toBeGreaterThan(bounds.y)
  })
})

describe('layoutMap — a chip anchor is never inside a context region (pointInRegion)', () => {
  it.each([
    ['a packed honeycomb', HONEYCOMB],
    ['a stacked column', contextMap([['c1', 0, 0], ['c2', 0, 1], ['c3', 0, 2]])],
    ['a context ringing another', contextMap([['c1', 0, 0], ['c1', 1, 0], ['c1', -1, 1], ['c1', 0, 1], ['c1', 1, -1], ['c1', -1, 0], ['c2', 0, 2], ['c3', 2, 0]], ['c1', 'c2', 'c3'])],
  ])('%s', (_name, map) => {
    const { contexts } = layoutMap(map)
    for (const c of contexts) {
      for (const other of contexts) expect(pointInRegion(c.chip, other.loops), `${c.id} chip inside ${other.id}`).toBe(false)
    }
  })
})

describe('layoutMap — context chips stay readable when the whole map is fitted', () => {
  // The stage area a default-inset 1440x900 window leaves once the editor and toolbar islands are reserved.
  const fitScale = (b: Box) => Math.min(1100 / b.width, 820 / b.height)

  it('sizes each chip so it renders at about 10px on screen at the fit scale', () => {
    const { contexts, bounds } = layoutMap(HONEYCOMB)
    for (const c of contexts) expect(c.size * fitScale(bounds)).toBeGreaterThanOrEqual(9.5)
  })

  it('never renders a chip smaller than the base label size, however small the map', () => {
    const tiny = layoutMap(contextMap([['c1', 0, 0], ['c2', 1, 0]], ['c1', 'c2']))
    for (const c of tiny.contexts) expect(c.size).toBeGreaterThanOrEqual(12)
  })

  it('grows the bounds by the enlarged chips so none is clipped', () => {
    const { contexts, bounds } = layoutMap(HONEYCOMB)
    for (const c of contexts) expect(c.chip.y - c.size).toBeGreaterThanOrEqual(bounds.y)
  })
})

describe('layoutMap — the map title scales with the chips', () => {
  it('keeps its 2x ratio over the chips, so it is never smaller than a chip', () => {
    const { title, contexts } = layoutMap(HONEYCOMB)
    expect(contexts[0].size).toBeGreaterThan(12)
    expect(title!.size).toBe(contexts[0].size * 2)
  })

  it('reserves room above its baseline for the scaled size', () => {
    const { title, bounds } = layoutMap(HONEYCOMB)
    expect(title!.y - title!.size!).toBeGreaterThanOrEqual(bounds.y)
  })

  it('keeps the base size when there are no contexts', () => {
    expect(layoutMap(contextMap([['c1', 0, 0], ['c1', 1, 0]], ['c1'])).title!.size).toBe(24)
  })
})


describe('layoutMap — the map title width is part of the bounds', () => {
  it('grows the bounds to hold a long title on a narrow multi-context map', () => {
    const narrow = { ...contextMap([['c1', 0, 0], ['c2', 1, 0]], ['c1', 'c2']), title: 'T'.repeat(300) }
    const { title, bounds } = layoutMap(narrow)
    expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(title!.x + measure(narrow.title, { ...TITLE, size: title!.size! }))
  })
})

describe('layoutMap — the chip edge fallback', () => {
  it('lands in clear space when every spot above the region is taken by another region', () => {
    const { contexts } = layoutMap(HONEYCOMB)
    const c2 = contexts.find((c) => c.id === 'c2')!
    for (const v of c2.loops.flat()) {
      const spot = { x: v.x, y: v.y - 12 }
      expect(contexts.some((c) => pointInRegion(spot, c.loops)), 'fixture must force the fallback').toBe(true)
    }
    for (const c of contexts) expect(pointInRegion(c2.chip, c.loops)).toBe(false)
  })
})


describe('layoutMap — compact neighbours from COMPACT_FROM hexagons up', () => {
  const STAGE = { width: 1100, height: 820 }
  const fitScale = (map: HexaMap, current?: string) => fitTo(layoutMap(map, { current }).bounds, STAGE.width, STAGE.height, undefined, 0).scale

  it('starts at four hexagons', () => {
    expect(COMPACT_FROM).toBe(4)
  })

  it('lays out every hexagon in full below the threshold, whichever is current', () => {
    const map = manyHexagonMap(COMPACT_FROM - 1)
    const result = layoutMap(map, { current: 'h2' })
    expect(result.hexagons.every((h) => h.compact === undefined)).toBe(true)
    expect(result).toStrictEqual(layoutMap(map))
  })

  it('keeps the current hexagon full and compacts every other one from the threshold', () => {
    const result = layoutMap(manyHexagonMap(COMPACT_FROM), { current: 'h3' })
    const current = result.hexagons.find((h) => h.id === 'h3')!
    expect(current.compact).toBeUndefined()
    for (const other of result.hexagons.filter((h) => h.id !== 'h3')) {
      expect(other.compact).toMatchObject({ elements: 16, label: 'Slice 1'.replace(/\d$/, other.id.slice(1)) })
      expect(hexagonBounds(other).width).toBeLessThan(hexagonBounds(current).width)
      expect(hexagonBounds(other).height).toBeLessThan(hexagonBounds(current).height)
    }
  })

  it('shortens a title that does not fit the silhouette, ending it with an ellipsis', () => {
    const map = manyHexagonMap(COMPACT_FROM)
    map.hexagons[0].title = 'An extraordinarily long bounded context title'
    const compact = layoutMap(map, { current: 'h2' }).hexagons[0].compact!
    expect(compact.label.endsWith('…')).toBe(true)
    expect(compact.label.length).toBeLessThan(map.hexagons[0].title.length)
  })

  it('never overlaps a compact hexagon with the full one or with another compact one, and keeps MAP_GAP between adjacent boxes', () => {
    const result = layoutMap(manyHexagonMap(12), { current: 'h6' })
    const boxes = result.hexagons.map((h) => ({ h, box: hexagonBounds(h) }))
    for (const a of boxes) {
      for (const b of boxes) {
        if (a.h.id >= b.h.id) continue
        const apartX = Math.max(a.box.x - (b.box.x + b.box.width), b.box.x - (a.box.x + a.box.width))
        const apartY = Math.max(a.box.y - (b.box.y + b.box.height), b.box.y - (a.box.y + a.box.height))
        expect(Math.max(apartX, apartY), `${a.h.id} vs ${b.h.id}`).toBeGreaterThanOrEqual(MAP_GAP - 1e-6)
      }
    }
  })

  it('sizes the lattice from the current hexagon and the compact footprint, not from two full hexagons', () => {
    const map = manyHexagonMap(12)
    const compact = layoutMap(map, { current: 'h6' })
    const full = layoutMap(map)
    expect(compact.pitch.x).toBeLessThan(full.pitch.x)
    expect(compact.pitch.y).toBeLessThan(full.pitch.y)
  })

  it('re-lays out when another hexagon becomes current', () => {
    const map = manyHexagonMap(6)
    map.hexagons[1].externals.push({ id: 'ext-wide', name: 'A Very Long External System Name That Extends Far To The Right'.repeat(4) })
    const first = layoutMap(map, { current: 'h1' })
    const second = layoutMap(map, { current: 'h2' })
    expect(first.hexagons[1].compact).toBeDefined()
    expect(second.hexagons[1].compact).toBeUndefined()
    expect(second.hexagons[0].compact).toBeDefined()
    expect(second.pitch).not.toStrictEqual(first.pitch)
  })

  it('fits a 12-hexagon map at a larger scale than the same map with every hexagon full', () => {
    const map = manyHexagonMap(12)
    const before = fitScale(map)
    const after = fitScale(map, 'h6')
    expect(after).toBeGreaterThan(before * 1.3)
  })

  // Growing the silhouette grows the lattice and so lowers the fit scale the title is sized against: the on-screen
  // size saturates near 8-9px (measured 8.2-8.8 on 4-30 hexagons), short of CHIP_FLOOR_PX, however many passes run.
  it('grows the compact title to about 8px or more at the whole-map fit, without outgrowing the current hexagon', () => {
    const result = layoutMap(manyHexagonMap(12), { current: 'h6' })
    const scale = fitTo(result.bounds, STAGE.width, STAGE.height, undefined, 0).scale
    const compact = result.hexagons.find((h) => h.compact)!
    expect(compact.compact!.size * scale).toBeGreaterThanOrEqual(8)
    expect(hexagonBounds(compact).height).toBeLessThan(hexagonBounds(result.hexagons.find((h) => h.id === 'h6')!).height / 2)
  })

  it('gives a compact hexagon one marker per port, on the wall the port sits on, spread apart when several share a wall', () => {
    const map = manyHexagonMap(6)
    map.hexagons[0].ports = map.hexagons[0].ports.map((p) => (p.side === 'driven' ? { ...p, wall: 'e' as const } : p))
    const hex = layoutMap(map, { current: 'h4' }).hexagons[0]
    expect(hex.compact!.ports.map((m) => m.id)).toEqual(map.hexagons[0].ports.map((p) => p.id))
    const markers = hex.compact!.ports.filter((m) => m.id !== 'p-submit')
    expect(markers).toHaveLength(3)
    expect(markers.every((m) => m.wall === 'e')).toBe(true)
    const apothem = (hex.compact!.radius * Math.sqrt(3)) / 2
    for (const m of markers) expect(m.at.x).toBeCloseTo(apothem, 6)
    expect(new Set(markers.map((m) => m.at.y)).size).toBe(markers.length)
    expect(Math.max(...markers.map((m) => Math.abs(m.at.y)))).toBeLessThan(hex.compact!.radius / 2)
  })

  it('ends a link on the marker of its port on a compact hexagon', () => {
    const result = layoutMap(manyHexagonMap(6), { current: 'h4' })
    const link = result.links[0]
    for (const [end, id, portId] of [[link.points[0], 'h1', 'p-repo'], [link.points.at(-1)!, 'h2', 'p-submit']] as const) {
      const hex = result.hexagons.find((h) => h.id === id)!
      const marker = hex.compact!.ports.find((m) => m.id === portId)!
      expect(end).toStrictEqual({ x: hex.centre.x + marker.at.x, y: hex.centre.y + marker.at.y })
    }
  })

  it('still draws a link whose port on a compact hexagon has no marker, ending it on that hexagon', () => {
    const map = manyHexagonMap(6)
    map.links = [{ id: 'l1', from: { hexagonId: 'h4', portId: 'p-repo' }, to: { hexagonId: 'h2', portId: 'ghost' } }]
    const result = layoutMap(map, { current: 'h4' })
    const h2 = result.hexagons.find((h) => h.id === 'h2')!
    const end = result.links[0].points.at(-1)!
    expect(Math.hypot(end.x - h2.centre.x, end.y - h2.centre.y)).toBeCloseTo((h2.compact!.radius * Math.sqrt(3)) / 2, 6)
  })

  it('ends two links on the same wall of a compact hexagon at different points', () => {
    const map = manyHexagonMap(6)
    map.hexagons[0].ports = map.hexagons[0].ports.map((p) => ({ ...p, wall: 'e' as const }))
    map.links = [
      { id: 'l1', from: { hexagonId: 'h1', portId: 'p-repo' }, to: { hexagonId: 'h2', portId: 'p-submit' } },
      { id: 'l2', from: { hexagonId: 'h1', portId: 'p-notify' }, to: { hexagonId: 'h3', portId: 'p-submit' } },
    ]
    const [a, b] = layoutMap(map, { current: 'h4' }).links
    expect(a.points[0]).not.toStrictEqual(b.points[0])
  })

  it('keeps every context chip out of every hexagon box, including the full current one', () => {
    for (const current of ['h1', 'h6', 'h12']) {
      const result = layoutMap(manyHexagonMap(12), { current })
      for (const c of result.contexts) {
        for (const h of result.hexagons) {
          const box = hexagonBounds(h)
          const inside = c.chip.x > box.x && c.chip.x < box.x + box.width && c.chip.y > box.y && c.chip.y < box.y + box.height
          expect(inside, `chip ${c.id} inside ${h.id} with ${current} current`).toBe(false)
        }
      }
    }
  })
})

// A real map: 6 contexts of one hexagon each, 11-25 elements a hexagon, 9 links between hexagons. Fit is judged the
// way the app does it (1440x900, editor open), against the scales the shared full-hexagon pitch produced.
describe('layoutMap — a real map with one hexagon per context (project-builder)', () => {
  const map = projectBuilderMap()
  const STAGE = { width: 1440, height: 900 }
  const INSET = islandInset(STAGE, true, false)
  // The Fit scale this map had before the lattice was sized from compact hexagons (one shared pitch sized for the
  // full current hexagon), measured by fitTo at the reference stage above with Execution current. The compact
  // layout must at least double it.
  const FULL_PITCH_BASELINE = { detailed: 0.13989, overview: 0.26322 }
  const MODES_UNDER_TEST = ['detailed', 'overview'] as const
  const layoutFor = (mode: LayoutMode, current: string) => layoutMap(map, { mode, current })
  const fit = (mode: LayoutMode, current: string) => fitTo(layoutFor(mode, current).bounds, STAGE.width, STAGE.height, INSET, 0).scale
  const overlap = (a: Box, b: Box) => Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width), a.y - (b.y + b.height), b.y - (a.y + a.height))
  const chipBoxOf = (c: { chip: { x: number; y: number }; label: string; size: number }): Box => {
    const width = measure(c.label, { ...CHIP_LABEL, size: c.size })
    return { x: c.chip.x - width / 2, y: c.chip.y - c.size, width, height: c.size * 1.25 }
  }
  const distanceToLoops = (box: Box, loops: { x: number; y: number }[][]) =>
    Math.min(...loops.flat().map((p) => Math.hypot(Math.max(box.x - p.x, 0, p.x - (box.x + box.width)), Math.max(box.y - p.y, 0, p.y - (box.y + box.height)))))
  const currents = map.hexagons.map((h) => h.id)

  it('lays every hexagon out in Detailed within twice the median hexagon, whatever its seated use cases', () => {
    const sizes = map.hexagons.map((h) => {
      const { width, height } = layoutDiagram(diagramOf(map, h.id), { mode: 'detailed' }).bounds
      return { id: h.id, extent: Math.max(width, height) }
    })
    const median = sizes.map((s) => s.extent).sort((a, b) => a - b)[Math.floor(sizes.length / 2)]
    for (const s of sizes) expect(s.extent, s.id).toBeLessThanOrEqual(median * 2)
  })

  it('keeps every use-case run out of the domain and clear of every box it does not connect, in Detailed', () => {
    const SQRT3 = Math.sqrt(3)
    const crossings: string[] = []
    for (const h of map.hexagons) {
      const m = layoutDiagram(diagramOf(map, h.id), { mode: 'detailed' })
      const domain = m.rings.at(-1)!
      const inDomain = (p: { x: number; y: number }) => Math.abs(p.y) < domain.apex && Math.abs(p.x) < (Math.abs(p.y) <= domain.straight ? domain.halfWidth : domain.halfWidth - (Math.abs(p.y) - domain.straight) * SQRT3)
      const inBox = (n: (typeof m.nodes)[number], p: { x: number; y: number }) => {
        const a = (-(n.rotation ?? 0) * Math.PI) / 180
        const [dx, dy] = [p.x - n.x, p.y - n.y]
        return Math.abs(dx * Math.cos(a) - dy * Math.sin(a)) < n.width / 2 - 1 && Math.abs(dx * Math.sin(a) + dy * Math.cos(a)) < n.height / 2 - 1
      }
      for (const e of m.edges) {
        const ends = e.key.split('->')
        if (!ends.some((k) => k.startsWith('useCase:')) || !ends.some((k) => k.startsWith('port:'))) continue
        const others = m.nodes.filter((n) => !ends.includes(n.key))
        for (let i = 1; i < e.points.length; i++) {
          const [a, b] = [e.points[i - 1], e.points[i]]
          for (let t = 0; t <= 100; t++) {
            const q = { x: a.x + ((b.x - a.x) * t) / 100, y: a.y + ((b.y - a.y) * t) / 100 }
            const hit = inDomain(q) ? 'the domain' : others.find((n) => inBox(n, q))?.key
            if (hit) crossings.push(`${h.id}: ${e.key} crosses ${hit}`)
          }
        }
      }
    }
    expect([...new Set(crossings)]).toEqual([])
  })

  it('never doubles back on a run to a slanted-wall port in Detailed', () => {
    const doubling: string[] = []
    for (const h of map.hexagons) {
      const m = layoutDiagram(diagramOf(map, h.id), { mode: 'detailed' })
      for (const edge of m.edges) {
        const [from, to] = edge.key.split('->').map((k) => m.nodes.find((n) => n.key === k))
        const [useCase, socket] = from?.kind === 'useCase' ? [from, to] : [to, from]
        if (useCase?.kind !== 'useCase' || socket?.kind !== 'port' || !['nw', 'sw', 'ne', 'se'].includes(socket.wall ?? '')) continue
        const run = from === useCase ? edge.points : [...edge.points].reverse()
        const climbs = run.slice(1).map((p, i) => Math.sign(p.y - run[i].y)).filter(Boolean)
        if (new Set(climbs).size > 1) doubling.push(`${h.id}: ${edge.key}`)
      }
    }
    expect(doubling).toEqual([])
  })

  it.each(MODES_UNDER_TEST)('fits %s at least twice as large as the full-pitch baseline, with Execution current', (mode) => {
    const scale = fit(mode, 'h-exec')
    expect(scale).toBeGreaterThanOrEqual(FULL_PITCH_BASELINE[mode] * 2)
  })

  it.each(MODES_UNDER_TEST)('keeps MAP_GAP between every pair of hexagon boxes in %s, whichever hexagon is current', (mode) => {
    for (const current of currents) {
      const boxes = layoutFor(mode, current).hexagons.map((h) => ({ id: h.id, box: hexagonBounds(h) }))
      for (const a of boxes) for (const b of boxes) if (a.id < b.id) expect(overlap(a.box, b.box), `${current}: ${a.id} vs ${b.id}`).toBeGreaterThanOrEqual(MAP_GAP - 1e-6)
    }
  })

  const COMPARABLE_FIT = 0.75
  it('fits Detailed with any hexagon current at a scale comparable to Execution current', () => {
    const reference = fit('detailed', 'h-exec')
    for (const current of currents) {
      expect(fit('detailed', current), current).toBeGreaterThanOrEqual(reference * COMPARABLE_FIT)
    }
  })

  it.each(MODES_UNDER_TEST)('draws each hull around its own hexagon alone, not around a lattice cell, in %s', (mode) => {
    for (const current of currents) {
      const result = layoutFor(mode, current)
      for (const hexagon of result.hexagons) {
        const hull = result.contexts.find((c) => c.id === hexagon.contextId)!
        const box = hexagonBounds(hexagon)
        expect(pointInRegion({ x: hexagon.centre.x, y: hexagon.centre.y }, hull.loops), `${current}: ${hexagon.id} centre`).toBe(true)
        for (const p of hull.loops.flat()) {
          expect(p.x, `${current}: ${hexagon.id} x`).toBeGreaterThanOrEqual(box.x - MAP_GAP / 2)
          expect(p.x).toBeLessThanOrEqual(box.x + box.width + MAP_GAP / 2)
          expect(p.y).toBeGreaterThanOrEqual(box.y - MAP_GAP / 2)
          expect(p.y).toBeLessThanOrEqual(box.y + box.height + MAP_GAP / 2)
        }
      }
    }
  })

  it.each(MODES_UNDER_TEST)('puts every chip beside its own hull and clear of every hexagon in %s', (mode) => {
    for (const current of currents) {
      const result = layoutFor(mode, current)
      const boxes = result.hexagons.map(hexagonBounds)
      for (const context of result.contexts) {
        const chip = chipBoxOf(context)
        boxes.forEach((box, i) => expect(overlap(chip, box), `${current}: chip ${context.id} vs ${result.hexagons[i].id}`).toBeGreaterThan(0))
        for (const other of result.contexts.filter((c) => c !== context)) expect(overlap(chip, chipBoxOf(other)), `${current}: chip ${context.id} vs chip ${other.id}`).toBeGreaterThan(0)
        expect(distanceToLoops(chip, context.loops), `${current}: chip ${context.id} distance`).toBeLessThanOrEqual(context.size * 3)
      }
    }
  })

  const crossings = (mode: LayoutMode, obstacle: 'hexagon' | 'chip') => {
    let count = 0
    for (const current of currents) {
      const result = layoutFor(mode, current)
      const boxes = obstacle === 'chip' ? result.contexts.map((c) => chipBoxOf(c)) : null
      for (const link of map.links) {
        const { points } = result.links.find((l) => l.id === link.id)!
        const ends = [link.from.hexagonId, link.to.hexagonId]
        const obstacles = boxes ?? result.hexagons.filter((h) => !ends.includes(h.id)).map(hexagonBounds)
        for (let i = 0; i < points.length - 1; i++) count += obstacles.filter((box) => segmentHitsBox(points[i], points[i + 1], box)).length
      }
    }
    return count
  }

  it.each(MODES_UNDER_TEST)('has a route for every link in %s', (mode) => {
    for (const current of currents) {
      const ids = layoutFor(mode, current).links.map((l) => l.id)
      expect(ids.sort()).toEqual(map.links.map((l) => l.id).sort())
    }
  })
  it.each(MODES_UNDER_TEST)('routes no link through another hexagon in %s', (mode) => {
    expect(crossings(mode, 'hexagon')).toBe(0)
  })
  it.each(MODES_UNDER_TEST)('routes no link across a chip in %s', (mode) => {
    expect(crossings(mode, 'chip')).toBe(0)
  })
})

describe('layoutMap — several expanded hexagons', () => {
  const map = projectBuilderMap()
  const STAGE = { width: 1440, height: 900 }
  const INSET = islandInset(STAGE, true, false)
  const ids = map.hexagons.map((h) => h.id)
  const SUBSETS: Array<[string, string[]]> = [
    ['only Execution', ['h-exec']],
    ['Execution and one neighbour', ['h-exec', 'h-cat']],
    ['Execution and two far hexagons', ['h-exec', 'h-sel', 'h-run']],
    ['a neighbour without the current one', ['h-auth', 'h-launch']],
    ['every hexagon but one', ids.filter((id) => id !== 'h-auth')],
    ['every hexagon', ids],
  ]
  const layoutWith = (mode: LayoutMode, expanded: string[]) => layoutMap(map, { mode, current: 'h-exec', expanded: new Set(expanded) })
  const gapBetween = (a: Box, b: Box) => Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width), a.y - (b.y + b.height), b.y - (a.y + a.height))
  const portPoint = (hex: ReturnType<typeof layoutMap>['hexagons'][number], portId: string, adapterId?: string) => {
    if (hex.compact) {
      const marker = hex.compact.ports.find((m) => m.id === portId)!
      return { x: hex.centre.x + marker.at.x, y: hex.centre.y + marker.at.y }
    }
    const port = hex.model.nodes.find((n) => n.kind === 'port' && n.ref === portId)!
    if (!adapterId) return { x: port.x + hex.centre.x, y: port.y + hex.centre.y }
    const a = hex.model.nodes.find((n) => n.kind === 'adapter' && n.ref === adapterId)!
    return outwardEdgePoint({ x: a.x - a.width / 2 + hex.centre.x, y: a.y - a.height / 2 + hex.centre.y, width: a.width, height: a.height }, port.wall!)
  }

  it.each(MODES)('lays out every hexagon in full, as the uncompacted layout does, when all are expanded in %s', (mode) => {
    expect(layoutWith(mode, ids)).toStrictEqual(layoutMap(map, { mode }))
  })

  it.each(SUBSETS)('draws exactly the current and the expanded hexagons in full: %s', (_, expanded) => {
    const result = layoutWith('detailed', expanded)
    for (const h of result.hexagons) expect(h.compact === undefined, h.id).toBe(h.id === 'h-exec' || expanded.includes(h.id))
  })

  it.each(SUBSETS)('keeps the current hexagon full however the expanded set is given: %s', (_, expanded) => {
    const without = expanded.filter((id) => id !== 'h-exec')
    expect(layoutWith('detailed', without)).toStrictEqual(layoutWith('detailed', ['h-exec', ...without]))
  })

  describe.each(MODES)('in %s', (mode) => {
    it.each(SUBSETS)('keeps MAP_GAP between every pair of hexagon boxes: %s', (_, expanded) => {
      const boxes = layoutWith(mode, expanded).hexagons.map((h) => ({ id: h.id, box: hexagonBounds(h) }))
      for (const a of boxes) for (const b of boxes) if (a.id < b.id) expect(gapBetween(a.box, b.box), `${a.id} vs ${b.id}`).toBeGreaterThanOrEqual(MAP_GAP - 1e-6)
    })

    it.each(SUBSETS)('ends every link on its own port, or its adapter, or its marker: %s', (_, expanded) => {
      const result = layoutWith(mode, expanded)
      for (const link of map.links) {
        const { points } = result.links.find((l) => l.id === link.id)!
        const [from, to] = [link.from, link.to].map((end) => portPoint(result.hexagons.find((h) => h.id === end.hexagonId)!, end.portId, end.adapterId))
        expect(points[0], `${link.id} from`).toStrictEqual(from)
        expect(points.at(-1), `${link.id} to`).toStrictEqual(to)
      }
    })

    it.each(SUBSETS)('routes every link orthogonally, through no other hexagon and across no chip: %s', (_, expanded) => {
      const result = layoutWith(mode, expanded)
      const chips = result.contexts.map((c): Box => {
        const width = measure(c.label, { ...CHIP_LABEL, size: c.size })
        return { x: c.chip.x - width / 2, y: c.chip.y - c.size, width, height: c.size * 1.25 }
      })
      for (const link of map.links) {
        const { points } = result.links.find((l) => l.id === link.id)!
        const others = result.hexagons.filter((h) => h.id !== link.from.hexagonId && h.id !== link.to.hexagonId).map(hexagonBounds)
        for (let i = 0; i < points.length - 1; i++) {
          expect(points[i].x === points[i + 1].x || points[i].y === points[i + 1].y, `${link.id} segment ${i} is orthogonal`).toBe(true)
          expect([...others, ...chips].some((box) => segmentHitsBox(points[i], points[i + 1], box)), `${link.id} segment ${i}`).toBe(false)
        }
      }
    })

    it.each(SUBSETS)('keeps every point of every link inside the bounds: %s', (_, expanded) => {
      const result = layoutWith(mode, expanded)
      const b = result.bounds
      for (const link of result.links) {
        for (const p of link.points) expect(contains({ x: b.x - 1e-6, y: b.y - 1e-6, width: b.width + 2e-6, height: b.height + 2e-6 }, { ...p, width: 0, height: 0 }), `${link.id} at ${p.x},${p.y}`).toBe(true)
      }
    })

    it.each(SUBSETS)('fits every expanded hexagon on screen: %s', (_, expanded) => {
      const result = layoutWith(mode, expanded)
      const view = fitTo(result.bounds, STAGE.width, STAGE.height, INSET, 0)
      const visible = visibleRect(view, STAGE, INSET)
      for (const h of result.hexagons.filter((x) => !x.compact)) {
        expect(contains(result.bounds, hexagonBounds(h)), `${h.id} in bounds`).toBe(true)
        expect(contains(visible, hexagonBounds(h)), `${h.id} on screen`).toBe(true)
      }
    })

    // With every hexagon expanded the layout is the uncompacted one, whose chips are placed by the tile-hull rule.
    it.each(SUBSETS.slice(0, -1))('draws each hull clear of every hexagon of another context, and every chip clear of every hexagon: %s', (_, expanded) => {
      const result = layoutWith(mode, expanded)
      for (const context of result.contexts) {
        for (const h of result.hexagons) {
          const box = hexagonBounds(h)
          const crosses = h.contextId !== context.id && context.loops.some((loop) => loop.some((a, i) => segmentHitsBox(a, loop[(i + 1) % loop.length], box)))
          expect(crosses, `${context.id} across ${h.id}`).toBe(false)
          const width = measure(context.label, { ...CHIP_LABEL, size: context.size })
          const chip = { x: context.chip.x - width / 2, y: context.chip.y - context.size, width, height: context.size * 1.25 }
          expect(gapBetween(chip, box), `chip ${context.id} vs ${h.id}`).toBeGreaterThan(0)
        }
      }
    })

    it.each(SUBSETS)('puts a grow "+" on every free side of the current hexagon clear of every hexagon: %s', (_, expanded) => {
      const result = layoutWith(mode, expanded)
      const hex = currentHexagon(result, 'h-exec')
      for (const side of freeSides(map, hex.cell)) {
        const at = growAnchor(hex, side, result.pitch, 12)
        for (const other of result.hexagons) {
          const box = hexagonBounds(other)
          const inside = at.x > box.x - 12 + 1e-6 && at.x < box.x + box.width + 12 - 1e-6 && at.y > box.y - 12 + 1e-6 && at.y < box.y + box.height + 12 - 1e-6
          expect(inside, `${side} vs ${other.id}`).toBe(false)
        }
      }
    })
  })

  it('compacts every hexagon but the expanded ones when no current hexagon is given', () => {
    const result = layoutMap(map, { expanded: new Set(['h-cat']) })
    expect(result.hexagons.filter((h) => !h.compact).map((h) => h.id)).toEqual(['h-cat'])
    expect(layoutMap(map, { expanded: new Set() }).hexagons.every((h) => h.compact)).toBe(true)
  })

  it('never lets a compact hexagon outgrow the smallest expanded one', () => {
    const large = manyHexagonMap(30)
    large.hexagons[5].externals.push({ id: 'ext-wide', name: 'A Very Long External System Name That Extends Far To The Right'.repeat(4) })
    large.hexagons[6] = { ...large.hexagons[6], domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] }
    const result = layoutMap(large, { current: 'h6', expanded: new Set(['h7']) })
    const small = hexagonBounds(result.hexagons.find((h) => h.id === 'h7')!)
    for (const h of result.hexagons.filter((x) => x.compact)) expect(hexagonBounds(h).height).toBeLessThan(small.height / 2)
  })

  it('grows the map with each expanded hexagon, and never past the uncompacted layout', () => {
    const area = (expanded: string[]) => {
      const { bounds } = layoutWith('detailed', expanded)
      return bounds.width * bounds.height
    }
    expect(area(['h-exec'])).toBeLessThan(area(['h-exec', 'h-cat']))
    expect(area(['h-exec', 'h-cat'])).toBeLessThan(area(['h-exec', 'h-cat', 'h-sel']))
    expect(area(ids.filter((id) => id !== 'h-auth'))).toBeLessThanOrEqual(area(ids))
  })
})

describe('layoutMap — switching the current hexagon', () => {
  it('moves only the hexagons around a hexagon when another becomes current', () => {
    const wide = manyHexagonMap(12)
    wide.hexagons[6].externals.push({ id: 'ext-wide', name: 'A Very Long External System Name That Extends Far To The Right'.repeat(4) })
    const before = layoutMap(wide, { current: 'h6' })
    const after = layoutMap(wide, { current: 'h7' })
    const far = ['h1', 'h2', 'h5']
    const moved = far.map((id) => {
      const a = before.hexagons.find((h) => h.id === id)!.centre
      const b = after.hexagons.find((h) => h.id === id)!.centre
      return Math.hypot(a.x - b.x, a.y - b.y)
    })
    const shift = Math.abs(hexagonBounds(after.hexagons.find((h) => h.id === 'h7')!).width - hexagonBounds(before.hexagons.find((h) => h.id === 'h6')!).width)
    for (const m of moved) expect(m).toBeLessThanOrEqual(shift / 2 + 1)
  })
})

describe('layoutMap — a hull on a compact map never crosses a hexagon of another context', () => {
  // Two adjacent hexagons of one context sit either side of the current hexagon's column, so pushing them apart
  // stretches their shared hull into a band across it.
  const straddling = (): HexaMap => {
    const base = manyHexagonMap(5)
    const cells = [{ q: 0, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 }, { q: -1, r: 0 }, { q: 1, r: 0 }]
    const contexts = ['c-current', 'c-band', 'c-band', 'c-west', 'c-east']
    return { ...base, contexts: [{ id: 'c-current' }, { id: 'c-band' }, { id: 'c-west' }, { id: 'c-east' }], hexagons: base.hexagons.map((h, i) => ({ ...h, cell: cells[i], contextId: contexts[i] })), links: [] }
  }
  const crossesBox = (loops: { x: number; y: number }[][], box: Box) => loops.some((loop) => loop.some((a, i) => segmentHitsBox(a, loop[(i + 1) % loop.length], box)))

  it('draws a context whose hexagons straddle the current one as separate loops around each', () => {
    const result = layoutMap(straddling(), { current: 'h1' })
    for (const context of result.contexts) {
      for (const hexagon of result.hexagons.filter((h) => h.contextId !== context.id)) {
        const box = hexagonBounds(hexagon)
        expect(crossesBox(context.loops, box), `${context.id} across ${hexagon.id}`).toBe(false)
        expect(pointInRegion({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, context.loops), `${context.id} around ${hexagon.id}`).toBe(false)
      }
    }
    expect(result.contexts.find((c) => c.id === 'c-band')!.loops).toHaveLength(2)
  })
})
