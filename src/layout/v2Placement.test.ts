import { describe, expect, it } from 'vitest'
import { EXAMPLES, EXAMPLE_DIAGRAM, STRESS_DIAGRAM } from '../model/example'
import projectBuilderRaw from '../model/fixtures/project-builder.hexa?raw'
import { parseHexa } from '../model/hexa'
import { diagramOf } from '../model/map'
import type { Diagram, HexaMap } from '../model/schema'
import { dot, quadsOverlap, reach, rectCorners } from './geometry'
import { GAP } from './hexagon/spacing'
import { wallFrame } from './hexagon/walls'
import { layoutDiagram, type LayoutMode, type LayoutModel, type LayoutNode } from './layout'

const MODES: LayoutMode[] = ['detailed', 'overview']
const advanced = EXAMPLES.find((e) => e.id === 'hexagonal-advanced')!.map as HexaMap
const parsed = parseHexa(projectBuilderRaw)
if (!parsed.ok || parsed.map.kind !== 'hexagonal') throw new Error('project-builder fixture must parse')
const projectBuilder = parsed.map

/** A hexagon small enough that no wall needs more room than the bands give: its bands are exactly the v2 formula. */
const SMALL: Diagram = {
  version: 1,
  kind: 'hexagonal',
  title: '',
  domain: [{ id: 'g', name: 'Order', type: 'aggregate' }],
  useCases: [{ id: 'u', name: 'Place', aggregateIds: ['g'] }],
  ports: [
    { id: 'in', name: 'api', side: 'driving', useCaseId: 'u' },
    { id: 'out', name: 'Repo', side: 'driven', useCaseId: 'u' },
  ],
  adapters: [
    { id: 'ai', name: 'routes', portId: 'in' },
    { id: 'ao', name: 'Knex', portId: 'out' },
  ],
  actors: [{ id: 'act', name: 'Web', adapterId: 'ai' }],
  externals: [{ id: 'ext', name: 'Postgres', adapterId: 'ao' }],
}

const CASES: Array<[string, Diagram]> = [
  ['example', EXAMPLE_DIAGRAM],
  ['stress', STRESS_DIAGRAM],
  ['advanced', diagramOf(advanced, 'h1')],
  ['small', SMALL],
  ...projectBuilder.hexagons.map((h): [string, Diagram] => [`project-builder / ${h.id}`, diagramOf(projectBuilder, h.id)]),
]
const EACH = CASES.flatMap(([name, d]) => MODES.map((mode) => [name, d, mode] as const))

const BOXES = new Set<LayoutNode['kind']>(['useCase', 'port', 'adapter', 'actor', 'external'])
const normal = (n: LayoutNode) => wallFrame(n.wall!).n
/** The apothem of the wall a kind of box is centred on. */
const wallApothem = (m: LayoutModel, kind: LayoutNode['kind']) =>
  kind === 'useCase' ? m.rings[2].halfWidth : kind === 'port' ? m.rings[1].halfWidth : kind === 'adapter' ? m.rings[0].halfWidth : m.externalWall.halfWidth
const along = (n: LayoutNode) => dot(n, wallFrame(n.wall!).dir)

describe('every box straddles its own wall', () => {
  it.each(EACH)('%s: centres sit on the ring wall of their layer (%s)', (_, d, mode) => {
    const m = layoutDiagram(d, { mode })
    const off = m.nodes.filter((n) => BOXES.has(n.kind)).filter((n) => !n.wall || Math.abs(dot(n, normal(n)) - wallApothem(m, n.kind)) > 0.01)
    expect(off.map((n) => n.key)).toEqual([])
  })
})

describe('radial chains', () => {
  it.each(EACH)('%s: a port, its adapter and the endpoint share a wall and the place along it (%s)', (_, d, mode) => {
    const m = layoutDiagram(d, { mode })
    const byKey = new Map(m.nodes.map((n) => [n.key, n]))
    const lone = (items: Array<{ adapterId?: string; portId?: string }>, id: string) => items.filter((i) => (i.adapterId ?? i.portId) === id).length === 1
    const mismatches: string[] = []
    for (const a of d.adapters) {
      const port = byKey.get(`port:${a.portId}`)
      const adapter = byKey.get(`adapter:${a.id}`)
      if (!port || !adapter) continue
      if (adapter.wall !== port.wall) mismatches.push(`${a.id} wall`)
      if (lone(d.adapters, a.portId!) && Math.abs(along(adapter) - along(port)) > 0.01) mismatches.push(`${a.id} u`)
      for (const e of [...d.actors, ...d.externals].filter((e) => e.adapterId === a.id)) {
        const leaf = byKey.get(`${d.actors.includes(e) ? 'actor' : 'external'}:${e.id}`)!
        if (leaf.wall !== adapter.wall) mismatches.push(`${e.id} wall`)
        if (lone([...d.actors, ...d.externals], a.id) && Math.abs(along(leaf) - along(adapter)) > 0.01) mismatches.push(`${e.id} u`)
      }
    }
    expect(mismatches).toEqual([])
  })

  it('spreads the ports of the stress example over their own walls instead of two columns', () => {
    const ports = layoutDiagram(STRESS_DIAGRAM).nodes.filter((n) => n.kind === 'port')
    expect(new Set(ports.map((n) => n.wall)).size).toBe(6)
  })

  it('keeps boxes of one layer apart', () => {
    const touching: string[] = []
    for (const [name, d] of CASES) {
      const nodes = layoutDiagram(d).nodes.filter((n) => BOXES.has(n.kind))
      nodes.forEach((a, i) => nodes.slice(i + 1).forEach((b) => quadsOverlap(rectCorners(a.x, a.y, a.width, a.height), rectCorners(b.x, b.y, b.width, b.height)) && touching.push(`${name}: ${a.key} / ${b.key}`)))
    }
    expect(touching).toEqual([])
  })
})

describe('bands as v2 sizes them', () => {
  const M = 16
  /** Half the largest extent of the boxes of each layer along their wall normals. */
  const extent = (m: LayoutModel, kinds: LayoutNode['kind'][]) => Math.max(0, ...m.nodes.filter((n) => kinds.includes(n.kind)).map((n) => reach(n.width, n.height, normal(n))))

  it('sizes the small hexagon exactly by the formula, at every ring', () => {
    const m = layoutDiagram(SMALL)
    const [uc, port, adapter, ext] = [extent(m, ['useCase']), extent(m, ['port']), extent(m, ['adapter']), extent(m, ['actor', 'external'])]
    const walls = [m.region!.halfWidth, m.rings[2].halfWidth, m.rings[1].halfWidth, m.rings[0].halfWidth, m.externalWall.halfWidth]
    const z = [uc, Math.max(uc, port), Math.max(port, adapter), Math.max(adapter, ext)].map((e) => e + M)
    const bands = walls.slice(1).map((w, i) => w - walls[i])
    // One thread per corridor: a single track, so its half-width is the margin alone.
    bands.forEach((band, i) => expect(band, `band ${i}`).toBeCloseTo(2 * (z[i] + M), 4))
  })

  it.each(EACH)('%s: no band is thinner than the formula (%s)', (_, d, mode) => {
    const m = layoutDiagram(d, { mode })
    const [uc, port, adapter, ext] = [extent(m, ['useCase']), extent(m, ['port']), extent(m, ['adapter']), extent(m, ['actor', 'external'])]
    const walls = [m.region?.halfWidth ?? 0, m.rings[2].halfWidth, m.rings[1].halfWidth, m.rings[0].halfWidth, m.externalWall.halfWidth]
    const z = [uc, Math.max(uc, port), Math.max(port, adapter), Math.max(adapter, ext)].map((e) => e + M)
    const bands = walls.slice(1).map((w, i) => w - walls[i])
    bands.slice(1).forEach((band, i) => expect(band, `band ${i + 1}`).toBeGreaterThanOrEqual(2 * (z[i + 1] + M) - 0.01))
  })

  it('draws the external wall as a hexagon about the rings', () => {
    const m = layoutDiagram(SMALL)
    expect(m.externalWall.apex).toBeGreaterThan(m.rings[0].apex)
  })
})

describe('Overview keeps every box and edge of Detailed', () => {
  const withoutCards = (m: LayoutModel) => m.nodes.filter((n) => n.kind !== 'aggregate' && n.kind !== 'domainItem')
  it.each(CASES)('%s: same walls, places and sizes', (_, d) => {
    const [detailed, overview] = [layoutDiagram(d), layoutDiagram(d, { mode: 'overview' })]
    const shape = (n: LayoutNode) => `${n.key} ${n.wall} ${along(n).toFixed(2)} ${n.width.toFixed(2)}x${n.height.toFixed(2)}`
    expect(withoutCards(overview).map((n) => (n.wall ? shape(n) : n.key))).toEqual(withoutCards(detailed).map((n) => (n.wall ? shape(n) : n.key)))
  })

  it.each(CASES)('%s: draws the same edges between boxes', (_, d) => {
    const keys = (m: LayoutModel) => m.edges.filter((e) => e.kind === 'import').map((e) => e.key).sort()
    expect(keys(layoutDiagram(d, { mode: 'overview' }))).toEqual(keys(layoutDiagram(d)))
  })

  it('draws the use case to port edges in Overview', () => {
    const m = layoutDiagram(STRESS_DIAGRAM, { mode: 'overview' })
    expect(m.edges.filter((e) => e.from === 'uc-place' || e.to === 'uc-place').length).toBeGreaterThan(2)
  })

  it('shows ports as full boxes with no notch or separate name', () => {
    const m = layoutDiagram(STRESS_DIAGRAM, { mode: 'overview' })
    expect(m.nodes.filter((n) => n.kind === 'portLabel')).toEqual([])
    for (const port of m.nodes.filter((n) => n.kind === 'port')) {
      expect(port.width).toBeGreaterThan(60)
      expect(port.lines.length).toBeGreaterThan(1)
    }
  })
})

describe('the rings that pinned the empty bands', () => {
  const apex = (d: Diagram, mode: LayoutMode) => {
    const m = layoutDiagram(d, { mode })
    return { app: Math.round(m.rings[1].apex), infra: Math.round(m.rings[0].apex) }
  }
  it('reports the application and infrastructure apex of the pinned examples', () => {
    const got = Object.fromEntries(
      [['chat-feedback', EXAMPLE_DIAGRAM], ['stress', STRESS_DIAGRAM], ['advanced', diagramOf(advanced, 'h1')]].flatMap(([name, d]) => MODES.map((mode) => [`${name} ${mode}`, apex(d as Diagram, mode)])),
    )
    expect(got).toMatchInlineSnapshot(`
      {
        "advanced detailed": {
          "app": 649,
          "infra": 931,
        },
        "advanced overview": {
          "app": 552,
          "infra": 834,
        },
        "chat-feedback detailed": {
          "app": 685,
          "infra": 967,
        },
        "chat-feedback overview": {
          "app": 597,
          "infra": 879,
        },
        "stress detailed": {
          "app": 822,
          "infra": 1104,
        },
        "stress overview": {
          "app": 664,
          "infra": 946,
        },
      }
    `)
  })
})

void GAP
