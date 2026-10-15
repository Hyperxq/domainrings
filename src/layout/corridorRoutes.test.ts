import { describe, expect, it } from 'vitest'
import type { Diagram } from '../model/schema'
import type { Point } from './geometry'
import { layoutDiagram, type LayoutMode, type LayoutModel, type LayoutNode } from './layout'
import { wallFrame } from './hexagon/walls'

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
const CASES: Array<[string, Diagram]> = [['several adapters on a slanted wall', SEVERAL_ADAPTERS]]

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
