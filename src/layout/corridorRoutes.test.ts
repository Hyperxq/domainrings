import { describe, expect, it } from 'vitest'
import { EXAMPLE_DIAGRAM, STRESS_DIAGRAM } from '../model/example'
import projectBuilderRaw from '../model/fixtures/project-builder.hexa?raw'
import { parseHexa } from '../model/hexa'
import { diagramOf } from '../model/map'
import type { Diagram } from '../model/schema'
import { dot, reach, type Point } from './geometry'
import { layoutDiagram, type LayoutMode, type LayoutModel, type LayoutNode } from './layout'
import { TRACK_GAP } from './hexagon/spacing'
import { WALLS, wallFrame } from './hexagon/walls'

const projectBuilder = () => {
  const parsed = parseHexa(projectBuilderRaw)
  if (!parsed.ok || parsed.map.kind !== 'hexagonal') throw new Error('project-builder fixture must parse')
  return parsed.map
}

const MODES: LayoutMode[] = ['detailed', 'overview']
const base: Diagram = { version: 1, kind: 'hexagonal', title: '', domain: [{ id: 'd1', name: 'Order', type: 'aggregate' }], useCases: [], ports: [], adapters: [], actors: [], externals: [] }
const SEVERAL_ADAPTERS: Diagram = {
  ...base,
  ports: [{ id: 'p1', name: 'Store', side: 'driven', wall: 'se' }],
  adapters: [
    { id: 'a1', name: 'PostgresStore', portId: 'p1' },
    { id: 'a2', name: 'MemoryStore', portId: 'p1' },
    { id: 'a3', name: 'FileStore', portId: 'p1' },
  ],
  externals: [
    { id: 'e1', name: 'Postgres', adapterId: 'a1' },
    { id: 'e2', name: 'Disk', adapterId: 'a3' },
  ],
}
const CASES: Array<[string, Diagram]> = [
  ['example', EXAMPLE_DIAGRAM],
  ['stress', STRESS_DIAGRAM],
  ['several adapters on a slanted wall', SEVERAL_ADAPTERS],
  ...projectBuilder().hexagons.map((h): [string, Diagram] => [`project-builder / ${h.id}`, diagramOf(projectBuilder(), h.id)]),
]

const imports = (m: LayoutModel) => m.edges.filter((e) => e.kind === 'import')
const ends = (m: LayoutModel, key: string) => key.split('->').map((k) => m.nodes.find((n) => n.key === k))
const square = (leg: [Point, Point], node: LayoutNode) => {
  const { n } = wallFrame(node.wall!)
  const run = { x: leg[1].x - leg[0].x, y: leg[1].y - leg[0].y }
  return Math.abs(run.x * n.y - run.y * n.x) < 1e-6
}

describe.each(CASES)('hexagonal routes leave and enter their boxes square to the wall: %s', (_, diagram) => {
  describe.each(MODES)('%s', (mode) => {
    const m = layoutDiagram(diagram, { mode })

    it('starts and ends every edge along the wall normal of the box it meets', () => {
      const crooked: string[] = []
      for (const e of imports(m)) {
        const [from, to] = ends(m, e.key)
        if (from?.wall && !square([e.points[0], e.points[1]], from)) crooked.push(`${e.key} leaving ${from.key}`)
        if (to?.wall && !square([e.points.at(-2)!, e.points.at(-1)!], to)) crooked.push(`${e.key} entering ${to.key}`)
      }
      expect(crooked).toEqual([])
    })

    it('runs no edge through a box it does not connect', () => {
      const through: string[] = []
      for (const e of imports(m)) {
        const own = e.key.split('->')
        for (let i = 1; i < e.points.length; i++) {
          const [a, b] = [e.points[i - 1], e.points[i]]
          for (let t = 0; t <= 40; t++) {
            const p = { x: a.x + ((b.x - a.x) * t) / 40, y: a.y + ((b.y - a.y) * t) / 40 }
            const hit = m.nodes.find((n) => !own.includes(n.key) && n.kind !== 'aggregate' && n.kind !== 'domainItem' && Math.abs(p.x - n.x) < n.width / 2 - 1 && Math.abs(p.y - n.y) < n.height / 2 - 1)
            if (hit) through.push(`${e.key} crosses ${hit.key}`)
          }
        }
      }
      expect([...new Set(through)]).toEqual([])
    })
  })
})

describe('incomplete chains', () => {
  const broken: Array<[string, Diagram]> = [
    ['a driving port with no use case', { ...base, ports: [{ id: 'p', name: 'Api', side: 'driving' }], adapters: [{ id: 'a', name: 'Routes', portId: 'p' }], actors: [{ id: 'x', name: 'Web', adapterId: 'a' }] }],
    ['a port naming a use case that does not exist', { ...base, ports: [{ id: 'p', name: 'Api', side: 'driving', useCaseId: 'gone' }] }],
    ['a driven port with no adapter', { ...base, useCases: [{ id: 'u', name: 'Place' }], ports: [{ id: 'p', name: 'Repo', side: 'driven', useCaseId: 'u' }] }],
    ['an adapter with no port', { ...base, useCases: [{ id: 'u', name: 'Place' }], adapters: [{ id: 'a', name: 'Orphan' }], externals: [{ id: 'x', name: 'Db', adapterId: 'a' }] }],
    ['an external with no adapter', { ...base, useCases: [{ id: 'u', name: 'Place' }], externals: [{ id: 'x', name: 'Db' }] }],
    ['a use case with no ports', { ...base, useCases: [{ id: 'u', name: 'Place' }] }],
    ['several use cases and only some ports', { ...base, useCases: [{ id: 'u', name: 'Place' }, { id: 'v', name: 'Cancel' }], ports: [{ id: 'p', name: 'Api', side: 'driving', useCaseId: 'v', wall: 'nw' }, { id: 'q', name: 'Repo', side: 'driven', wall: 'se' }] }],
  ]
  it.each(broken)('route whatever hops exist without throwing: %s', (_, diagram) => {
    for (const mode of MODES) {
      const m = layoutDiagram(diagram, { mode })
      for (const e of m.edges) for (const p of e.points) expect([p.x, p.y].every(Number.isFinite), e.key).toBe(true)
    }
  })
})

/** How far a point is from the centre along the hexagon's own normals: the apothem of the hexagon it lies on. */
const apothemOf = (p: Point) => Math.max(...WALLS.map((w) => dot(p, wallFrame(w).n)))
const useCasePort = (m: LayoutModel) => imports(m).filter((e) => e.key.includes('useCase:') && e.key.includes('port:'))
const crossings = (m: LayoutModel) => {
  const orientation = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  const es = imports(m)
  let total = 0
  for (let i = 0; i < es.length; i++)
    for (let j = i + 1; j < es.length; j++)
      for (let a = 1; a < es[i].points.length; a++)
        for (let b = 1; b < es[j].points.length; b++) {
          const [p, q, r, s] = [es[i].points[a - 1], es[i].points[a], es[j].points[b - 1], es[j].points[b]]
          if (orientation(p, q, r) * orientation(p, q, s) < -1e-9 && orientation(r, s, p) * orientation(r, s, q) < -1e-9) total++
        }
  return total
}

describe.each(CASES.flatMap(([name, d]) => MODES.map((mode) => [name, d, mode] as const)))('use case to port routes run in the application corridor: %s (%s)', (_, diagram, mode) => {
  const m = layoutDiagram(diagram, { mode })
  const ports = m.nodes.filter((n) => n.kind === 'port')
  const seats = m.nodes.filter((n) => n.kind === 'useCase')
  // The corridor lies between the use cases' outer faces and the ports' inner faces.
  const portFace = Math.min(...ports.map((p) => dot(p, wallFrame(p.wall!).n) - reach(p.width, p.height, wallFrame(p.wall!).n)))
  const seatFace = Math.max(...seats.map((u) => dot(u, wallFrame(u.wall!).n) + reach(u.width, u.height, wallFrame(u.wall!).n)))
  const runs = (e: LayoutModel['edges'][number]) => e.points.slice(1, -1)

  it('draws the application corridor outside every use case, never through one', () => {
    const corridor = m.corridors.at(-2)!
    for (const u of seats) expect(corridor.halfWidth, u.key).toBeGreaterThanOrEqual(dot(u, wallFrame(u.wall!).n) + reach(u.width, u.height, wallFrame(u.wall!).n) - 1e-6)
  })

  it('joins ports and use cases only where it can route them, in either mode', () => {
    // The overview draws no use case to port link, so its corridor is a guide only; with links the checks below apply.
    if (mode === 'overview') expect(useCasePort(m)).toEqual([])
    else if (m.nodes.some((n) => n.kind === 'useCase') && ports.length) expect(useCasePort(m).length).toBeGreaterThan(0)
  })

  it('leaves the port inward and stays between the use cases and the ports except for its hops', () => {
    for (const e of useCasePort(m)) {
      if (e.points.length <= 2) continue
      for (const p of runs(e)) {
        expect(apothemOf(p), `${e.key} at ${p.x},${p.y}`).toBeGreaterThan(seatFace)
        expect(apothemOf(p), `${e.key} at ${p.x},${p.y}`).toBeLessThan(portFace)
      }
    }
  })

  it('keeps parallel runs of different edges a track gap apart', () => {
    const segments = useCasePort(m).flatMap((e) => (e.points.length > 3 ? runs(e).slice(1).map((b, i) => ({ key: e.key, a: runs(e)[i], b })) : []))
    for (const [i, s] of segments.entries())
      for (const t of segments.slice(i + 1)) {
        if (s.key === t.key) continue
        const d = { x: s.b.x - s.a.x, y: s.b.y - s.a.y }
        const len = Math.hypot(d.x, d.y)
        if (len < 1e-6) continue
        const u = { x: d.x / len, y: d.y / len }
        const e = { x: t.b.x - t.a.x, y: t.b.y - t.a.y }
        if (Math.abs(u.x * e.y - u.y * e.x) > 1e-6 * Math.hypot(e.x, e.y)) continue
        const along = [dot(t.a, u), dot(t.b, u)].sort((x, y) => x - y)
        if (Math.min(along[1], dot(s.b, u)) - Math.max(along[0], dot(s.a, u)) < 1) continue
        const across = Math.abs((t.a.x - s.a.x) * u.y - (t.a.y - s.a.y) * u.x)
        expect(across, `${s.key} / ${t.key}`).toBeGreaterThanOrEqual(TRACK_GAP - 1e-6)
      }
  })
})

describe('corridor sizing and crossings', () => {
  const apex = (d: Diagram, mode: LayoutMode) => layoutDiagram(d, { mode }).rings.find((r) => r.role === 'application')!.apex

  it('crosses at most 3 edges on the stress example, where the bus lanes crossed 9', () => {
    expect(crossings(layoutDiagram(STRESS_DIAGRAM))).toBeLessThanOrEqual(3)
  })

  it('crosses no edge on the chat feedback example, where the bus lanes crossed two pairs', () => {
    expect(crossings(layoutDiagram(EXAMPLE_DIAGRAM))).toBe(0)
  })

  // Measured apexes: stress 700.5 / 569.7, chat 588.8 / 507.0 (detailed / overview). The pins sit a hair above them: the
  // ring is searched to within 0.05% of the smallest apex that clears, and the pin is a whole number.
  it('keeps the stress application ring within 702 (the bus lanes made it 1152)', () => {
    expect(apex(STRESS_DIAGRAM, 'detailed')).toBeLessThanOrEqual(702)
  })

  it('keeps the chat feedback application ring within 590 (the bus lanes made it 746)', () => {
    expect(apex(EXAMPLE_DIAGRAM, 'detailed')).toBeLessThanOrEqual(590)
  })

  it('keeps the overview application rings within 570 (stress) and 508 (chat feedback)', () => {
    expect(apex(STRESS_DIAGRAM, 'overview')).toBeLessThanOrEqual(570)
    expect(apex(EXAMPLE_DIAGRAM, 'overview')).toBeLessThanOrEqual(508)
  })
})

describe('corridor hexagons', () => {
  it.each(MODES)('are concentric hexagons between the rings, outermost last (%s)', (mode) => {
    const m = layoutDiagram(STRESS_DIAGRAM, { mode })
    const apothems = m.corridors.map((c) => c.halfWidth)
    expect(apothems).toEqual([...apothems].sort((a, b) => a - b))
    const ring = (role: string) => m.rings.find((r) => r.role === role)!
    expect(apothems.at(-1)!).toBeLessThan(ring('adapters').halfWidth)
    expect(apothems[0]).toBeGreaterThan(m.region!.halfWidth)
    for (const c of m.corridors) expect(c.straight).toBeCloseTo(c.apex / 2, 9)
  })

  it('runs the application corridor through the tracks of the stress example', () => {
    const m = layoutDiagram(STRESS_DIAGRAM)
    const tracks = useCasePort(m).flatMap((e) => (e.points.length > 3 ? e.points.slice(1, -1).map(apothemOf) : []))
    const [low, high] = [Math.min(...tracks), Math.max(...tracks)]
    expect(m.corridors.some((c) => c.halfWidth >= low - 1e-6 && c.halfWidth <= high + 1e-6)).toBe(true)
  })
})
