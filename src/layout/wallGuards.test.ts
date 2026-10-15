import { describe, expect, it } from 'vitest'
import { EXAMPLES, EXAMPLE_DIAGRAM, STRESS_DIAGRAM } from '../model/example'
import { diagramOf } from '../model/map'
import type { Diagram, HexaMap, Wall } from '../model/schema'
import { dot, quadsOverlap, reach, rectCorners, type Box, type Point } from './geometry'
import { SQRT3 } from './outline'
import { wallFrame } from './hexagon/walls'
import { insertionPoints } from './insertion'
import { layoutDiagram, type LayoutMode, type LayoutModel, type LayoutNode } from './layout'

const MODES: LayoutMode[] = ['detailed', 'overview']
const advanced = diagramOf(EXAMPLES.find((e) => e.id === 'hexagonal-advanced')!.map as HexaMap, 'h1')

/** Six ports on one wall, five with an adapter and an endpoint, one with none: the most a single wall is asked to hold. */
const CROWDED: Diagram = {
  version: 1,
  kind: 'hexagonal',
  title: '',
  domain: [{ id: 'g', name: 'Order', type: 'aggregate' }],
  useCases: Array.from({ length: 6 }, (_, i) => ({ id: `u${i}`, name: `Use case number ${i}`, aggregateIds: ['g'] })),
  ports: Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `PortWithLongName${i}`, side: 'driving' as const, wall: 'w' as const, useCaseId: `u${i}` })),
  adapters: Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, name: `AdapterWithLongName${i}`, portId: `p${i}` })),
  actors: Array.from({ length: 5 }, (_, i) => ({ id: `x${i}`, name: `Actor ${i}`, adapterId: `a${i}` })),
  externals: [],
}

const CASES: Array<[string, Diagram]> = [
  ['chat-feedback', EXAMPLE_DIAGRAM],
  ['stress', STRESS_DIAGRAM],
  ['e-commerce advanced', advanced],
  ['six ports on one wall', CROWDED],
]
const EACH = CASES.flatMap(([name, d]) => MODES.map((mode) => [name, d, mode] as const))

const HOSTED = new Set<LayoutNode['kind']>(['useCase', 'port', 'adapter', 'actor', 'external'])
const wallApothem = (m: LayoutModel, kind: LayoutNode['kind']) =>
  kind === 'useCase' ? m.rings[2].halfWidth : kind === 'port' ? m.rings[1].halfWidth : kind === 'adapter' ? m.rings[0].halfWidth : m.externalWall.halfWidth
const quad = (b: Box) => rectCorners(b.x + b.width / 2, b.y + b.height / 2, b.width, b.height)
const centred = (n: LayoutNode): Box => ({ x: n.x - n.width / 2, y: n.y - n.height / 2, width: n.width, height: n.height })
const clash = (a: Box, b: Box) => quadsOverlap(quad(a), quad(b))

describe.each(EACH)('wall boxes: %s (%s)', (_, d, mode) => {
  const m = layoutDiagram(d, { mode })
  const hosted = m.nodes.filter((n) => HOSTED.has(n.kind))

  it('stays within the extent of its wall', () => {
    const past = hosted.filter((n) => {
      const { dir } = wallFrame(n.wall!)
      return Math.abs(dot(n, dir)) + reach(n.width, n.height, dir) > wallApothem(m, n.kind) / SQRT3 + 0.01
    })
    expect(past.map((n) => n.key)).toEqual([])
  })

  it('overlaps no other box', () => {
    const boxes = m.nodes.filter((n) => n.kind !== 'aggregate')
    const hits = boxes.flatMap((a, i) => boxes.slice(i + 1).filter((b) => clash(centred(a), centred(b))).map((b) => `${a.key} / ${b.key}`))
    expect(hits).toEqual([])
  })

  it('overlaps no ring title', () => {
    const hits = hosted.flatMap((n) => m.rings.filter((r) => clash(centred(n), r.titleBox)).map((r) => `${n.key} / ${r.role}`))
    expect(hits).toEqual([])
  })
})

describe.each(EACH)('the adapter "+": %s (%s)', (_, d, mode) => {
  const m = layoutDiagram(d, { mode })
  const PLUS = 24
  const adds = insertionPoints(m, d).filter((p) => p.action.kind === 'adapter')
  const sign = (p: Point): Box => ({ x: p.x - PLUS / 2, y: p.y - PLUS / 2, width: PLUS, height: PLUS })
  const wallOf = (p: (typeof adds)[number]): Wall => {
    const action = p.action as { side: 'driving' | 'driven'; portId?: string }
    return action.portId ? m.nodes.find((n) => n.key === `port:${action.portId}`)!.wall! : action.side === 'driving' ? 'w' : 'e'
  }

  it('is offered', () => {
    expect(adds.length).toBeGreaterThan(0)
  })

  it('is clear of every adapter and every ring title', () => {
    const hits = adds.flatMap((p) => [...m.nodes.filter((n) => n.kind === 'adapter').map((n) => ({ key: n.key, box: centred(n) })), ...m.rings.map((r) => ({ key: r.role, box: r.titleBox }))].filter((o) => clash(sign(p.at), o.box)).map((o) => `${p.key} / ${o.key}`))
    expect(hits).toEqual([])
  })

  it('stays within the end of its wall', () => {
    const past = adds.filter((p) => {
      const { dir } = wallFrame(wallOf(p))
      return Math.abs(dot(p.at, dir)) + PLUS / 2 > m.rings[0].halfWidth / SQRT3 + 0.01
    })
    expect(past.map((p) => p.key)).toEqual([])
  })
})
