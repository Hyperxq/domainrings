import { describe, expect, it } from 'vitest'
import { EXAMPLES, EXAMPLE_DIAGRAM, STRESS_DIAGRAM } from '../model/example'
import projectBuilderRaw from '../model/fixtures/project-builder.hexa?raw'
import { parseHexa } from '../model/hexa'
import { diagramOf } from '../model/map'
import type { Diagram, HexaMap } from '../model/schema'
import { threadsOf, type Thread } from '../model/threads'
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
const LAYER_OF: Partial<Record<LayoutNode['kind'], number>> = { aggregate: 0, useCase: 1, port: 2, adapter: 3, actor: 4, external: 4 }

/** The shipped examples with the flows of their use cases, which is what the canvas draws. */
const example = (id: string) => EXAMPLES.find((e) => e.id === id)!.map as HexaMap
const THREADED = (['hexagonal-basic', 'hexagonal-stress', 'hexagonal-advanced'] as const).map((id): [string, Diagram, Thread[]] => {
  const map = example(id)
  return [id, diagramOf(map, map.hexagons[0].id), threadsOf(map, map.hexagons[0].id)]
})

describe('corridors run through the middle of their bands', () => {
  describe.each(CASES.flatMap(([name, d]) => MODES.map((mode) => [name, d, mode] as const)))('%s (%s)', (_, diagram, mode) => {
    const m = layoutDiagram(diagram, { mode })
    const walls = [m.region?.halfWidth ?? 0, m.rings[2].halfWidth, m.rings[1].halfWidth, m.rings[0].halfWidth, m.externalWall.halfWidth]
    const mid = [0, 1, 2, 3].map((i) => (walls[i] + walls[i + 1]) / 2)

    it('draws four concentric guide hexagons at the middle of each band, innermost first', () => {
      expect(m.corridors).toHaveLength(4)
      m.corridors.forEach((c, i) => {
        // Without a region there is no wall to measure the domain corridor from.
        if (i > 0 || m.region) expect(c.halfWidth, `corridor ${i}`).toBeCloseTo(mid[i], 6)
        expect(c.straight).toBeCloseTo(c.apex / 2, 9)
      })
    })

    it('centres the tracks of every corridor on that line, a track gap apart', () => {
      for (let c = 0; c < 4; c++) {
        const tracks = new Set<number>()
        for (const e of imports(m)) {
          const [from, to] = ends(m, e.key)
          const layers = [from, to].map((n) => (n ? LAYER_OF[n.kind] : 0))
          if (e.key.endsWith('->domain')) layers[1] = 0
          if (Math.min(...(layers as number[])) !== c || e.points.length <= 2) continue
          tracks.add(Math.round(apothemOf(e.points[1]) * 1e6) / 1e6)
        }
        if (!tracks.size) continue
        const sorted = [...tracks].sort((a, b) => a - b)
        if (c > 0 || m.region) expect(sorted.reduce((sum, t) => sum + t, 0) / sorted.length, `corridor ${c}`).toBeCloseTo(mid[c], 0)
        sorted.slice(1).forEach((t, i) => expect(t - sorted[i], `corridor ${c}`).toBeCloseTo(TRACK_GAP, 6))
      }
    })
  })
})

describe('every box is reached where it sits, whichever the edge', () => {
  it.each(CASES.flatMap(([name, d]) => MODES.map((mode) => [name, d, mode] as const)))('%s (%s): joins every port with its use case', (_, diagram, mode) => {
    const m = layoutDiagram(diagram, { mode })
    const wanted = diagram.ports.filter((p) => p.useCaseId && diagram.useCases.some((u) => u.id === p.useCaseId))
    expect(imports(m).filter((e) => e.key.includes('useCase:') && e.key.includes('port:'))).toHaveLength(wanted.length)
  })
})

describe.each(THREADED)('threads read as continuous lines: %s', (_, diagram, threads) => {
  describe.each(MODES)('%s', (mode) => {
    const m = layoutDiagram(diagram, { mode, threads })
    const byRef = (ref: string) => m.nodes.find((n) => n.ref === ref && n.kind !== 'domainItem')!
    const ofThread = (id: string) => imports(m).filter((e) => e.thread?.id === id)
    const lateral = (p: Point, node: LayoutNode) => dot(p, wallFrame(node.wall!).dir)

    it('meets each box at one lateral place, whichever face the thread uses', () => {
      const off: string[] = []
      for (const t of threads) {
        const seen = new Map<string, number[]>()
        for (const e of ofThread(t.useCaseId)) {
          const [start, end] = [e.points[0], e.points.at(-1)!]
          seen.set(e.from!, [...(seen.get(e.from!) ?? []), lateral(start, byRef(e.from!))])
          if (e.to) seen.set(e.to, [...(seen.get(e.to) ?? []), lateral(end, byRef(e.to))])
        }
        for (const [ref, places] of seen) {
          const node = byRef(ref)
          if (Math.max(...places) - Math.min(...places) > 0.5 + 1e-6) off.push(`${t.useCaseId} at ${ref}: ${places.map((p) => p.toFixed(1)).join(' / ')}`)
          for (const p of places) if (Math.abs(p - lateral(node, node)) > reach(node.width, node.height, wallFrame(node.wall!).dir) + 1e-6) off.push(`${t.useCaseId} leaves the face of ${ref}`)
        }
      }
      expect(off).toEqual([])
    })

    it('keeps two threads on one face a track gap apart, parallel through the corridor', () => {
      const close: string[] = []
      const edges = imports(m).filter((e) => e.thread)
      const segments = edges.flatMap((e) => e.points.slice(1).map((b, i) => ({ thread: e.thread!.id, key: e.key, a: e.points[i], b })))
      for (const [i, s] of segments.entries())
        for (const t of segments.slice(i + 1)) {
          if (s.thread === t.thread) continue
          const d = { x: s.b.x - s.a.x, y: s.b.y - s.a.y }
          const len = Math.hypot(d.x, d.y)
          const e = { x: t.b.x - t.a.x, y: t.b.y - t.a.y }
          if (len < 1e-6 || Math.abs(d.x * e.y - d.y * e.x) > 1e-6 * len * Math.hypot(e.x, e.y)) continue
          const u = { x: d.x / len, y: d.y / len }
          const along = [dot(t.a, u), dot(t.b, u)].sort((x, y) => x - y)
          if (Math.min(along[1], dot(s.b, u)) - Math.max(along[0], dot(s.a, u)) < 1) continue
          const across = Math.abs((t.a.x - s.a.x) * u.y - (t.a.y - s.a.y) * u.x)
          if (across < TRACK_GAP - 1e-6) close.push(`${s.key} / ${t.key}: ${across.toFixed(2)}`)
        }
      expect(close).toEqual([])
    })
  })
})

describe('several threads on one card', () => {
  it('enters the card at points a track gap apart, one per thread', () => {
    const map = example('hexagonal-stress')
    const [hexagon] = map.hexagons
    const aggregate = hexagon.domain.find((i) => i.type === 'aggregate')!.id
    const shared = { ...map, hexagons: [{ ...hexagon, useCases: hexagon.useCases.map((u) => ({ ...u, aggregateIds: [aggregate] })) }, ...map.hexagons.slice(1)] }
    const m = layoutDiagram(diagramOf(shared, hexagon.id), { threads: threadsOf(shared, hexagon.id) })
    const entries = m.edges.filter((e) => e.to === aggregate && e.thread).map((e) => e.points.at(-1)!)
    expect(entries).toHaveLength(hexagon.useCases.length)
    const card = m.nodes.find((n) => n.kind === 'aggregate' && n.ref === aggregate)!
    const along = entries.map((p) => dot(p, wallFrame(card.wall!).dir)).sort((a, b) => a - b)
    along.slice(1).forEach((u, i) => expect(u - along[i]).toBeGreaterThanOrEqual(TRACK_GAP - 1e-6))
  })
})
