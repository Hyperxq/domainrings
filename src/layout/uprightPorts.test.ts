import { describe, expect, it } from 'vitest'
import { STRESS_DIAGRAM } from '../model/example'
import projectBuilderRaw from '../model/fixtures/project-builder.hexa?raw'
import { parseHexa } from '../model/hexa'
import { diagramOf } from '../model/map'
import type { Diagram } from '../model/schema'
import { dot, type Point } from './geometry'
import { layoutDiagram, type LayoutMode, type LayoutNode } from './layout'
import { SLANTED_WALLS, wallFrame } from './hexagon/walls'

const projectBuilder = () => {
  const parsed = parseHexa(projectBuilderRaw)
  if (!parsed.ok || parsed.map.kind !== 'hexagonal') throw new Error('project-builder fixture must parse')
  return parsed.map
}

const MODES: LayoutMode[] = ['detailed', 'overview']
const CASES: Array<[string, Diagram]> = [
  ['stress', STRESS_DIAGRAM],
  ...projectBuilder().hexagons.map((h): [string, Diagram] => [`project-builder / ${h.id}`, diagramOf(projectBuilder(), h.id)]),
]

type Rect = { x: number; y: number; width: number; height: number }
const apart = (a: Rect, b: Rect) =>
  a.x + a.width / 2 <= b.x - b.width / 2 + 1e-6 ||
  b.x + b.width / 2 <= a.x - a.width / 2 + 1e-6 ||
  a.y + a.height / 2 <= b.y - b.height / 2 + 1e-6 ||
  b.y + b.height / 2 <= a.y - a.height / 2 + 1e-6
/** A ring title box is anchored at its top-left corner. */
const centred = (b: Rect): Rect => ({ x: b.x + b.width / 2, y: b.y + b.height / 2, width: b.width, height: b.height })
const onBoundary = (n: Rect, p: Point) => {
  const [dx, dy] = [Math.abs(p.x - n.x), Math.abs(p.y - n.y)]
  const within = dx <= n.width / 2 + 1e-6 && dy <= n.height / 2 + 1e-6
  return within && (Math.abs(dx - n.width / 2) < 1e-6 || Math.abs(dy - n.height / 2) < 1e-6)
}
const slanted = (n: LayoutNode) => n.kind === 'port' && SLANTED_WALLS.has(n.wall!)

describe.each(CASES)('ports on slanted walls stay upright: %s', (_, diagram) => {
  describe.each(MODES)('%s', (mode) => {
    const m = layoutDiagram(diagram, { mode })
    const ports = m.nodes.filter(slanted)

    it('turns no box', () => {
      expect(m.nodes.filter((n) => (n as { rotation?: unknown }).rotation !== undefined).map((n) => n.key)).toEqual([])
    })

    it('keeps each slanted port clear of every other box and every ring title', () => {
      const others = m.nodes.filter((n) => n.kind !== 'aggregate')
      for (const p of ports) {
        for (const o of others) if (o !== p) expect(apart(p, o) ? 'apart' : `${p.key} overlaps ${o.key}`).toBe('apart')
        for (const r of m.rings) expect(apart(p, centred(r.titleBox)) ? 'apart' : `${p.key} overlaps the ${r.role} title`).toBe('apart')
      }
    })

    it('keeps every port name clear of every ring title', () => {
      for (const l of m.nodes.filter((n) => n.kind === 'portLabel')) {
        for (const r of m.rings) expect(apart(l, centred(r.titleBox)) ? 'apart' : `${l.key} overlaps the ${r.role} title`).toBe('apart')
      }
    })

    it('meets every edge on the port box, along the wall normal', () => {
      for (const e of m.edges) {
        const [from, to] = e.key.split('->')
        for (const p of ports) {
          const first = from === p.key
          const last = to === p.key
          if (!first && !last) continue
          const [a, b] = last ? [e.points.at(-2)!, e.points.at(-1)!] : [e.points[1], e.points[0]]
          const { n } = wallFrame(p.wall!)
          const run = { x: b.x - a.x, y: b.y - a.y }
          expect(onBoundary(p, b) ? 'on the box' : `${e.key} misses ${p.key}`).toBe('on the box')
          expect(Math.abs(run.x * n.y - run.y * n.x)).toBeLessThan(1e-6)
          expect(Math.abs(dot(run, n))).toBeGreaterThan(0)
        }
      }
    })
  })
})

describe('a slanted port with several adapters', () => {
  const several: Diagram = {
    version: 1,
    kind: 'hexagonal',
    title: '',
    domain: [{ id: 'd1', name: 'Order', type: 'entity' }],
    useCases: [],
    ports: [{ id: 'p1', name: 'Store', side: 'driven', wall: 'se' }],
    adapters: [
      { id: 'a1', name: 'PostgresStore', portId: 'p1' },
      { id: 'a2', name: 'MemoryStore', portId: 'p1' },
      { id: 'a3', name: 'FileStore', portId: 'p1' },
    ],
    actors: [],
    externals: [{ id: 'e1', name: 'Postgres', adapterId: 'a1' }, { id: 'e2', name: 'Disk', adapterId: 'a3' }],
  }

  describe.each(MODES)('%s', (mode) => {
    const m = layoutDiagram(several, { mode })

    it('keeps the port box clear of its adapters and every edge on a box', () => {
      const [port, ...rest] = [m.nodes.find((n) => n.kind === 'port')!, ...m.nodes.filter((n) => n.kind !== 'port' && n.kind !== 'aggregate')]
      for (const o of rest) expect(apart(port, o) ? 'apart' : `${port.key} overlaps ${o.key}`).toBe('apart')
      for (const e of m.edges.filter((e) => e.kind === 'import')) {
        const [from, to] = e.key.split('->').map((k) => m.nodes.find((n) => n.key === k)!)
        expect(e.points.length, e.key).toBeGreaterThanOrEqual(2)
        expect(onBoundary(from, e.points[0]) ? 'on the box' : `${e.key} starts off ${from.key}`).toBe('on the box')
        expect(onBoundary(to, e.points.at(-1)!) ? 'on the box' : `${e.key} ends off ${to.key}`).toBe('on the box')
      }
    })

    it('runs no edge through a box it does not connect', () => {
      for (const e of m.edges) {
        const ends = e.key.split('->')
        for (let i = 1; i < e.points.length; i++) {
          const [a, b] = [e.points[i - 1], e.points[i]]
          for (let t = 0; t <= 50; t++) {
            const p = { x: a.x + ((b.x - a.x) * t) / 50, y: a.y + ((b.y - a.y) * t) / 50 }
            const hit = m.nodes.find((n) => !ends.includes(n.key) && n.kind !== 'aggregate' && Math.abs(p.x - n.x) < n.width / 2 - 1 && Math.abs(p.y - n.y) < n.height / 2 - 1)
            expect(hit ? `${e.key} crosses ${hit.key}` : 'clear').toBe('clear')
          }
        }
      }
    })
  })
})
