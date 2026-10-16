import { describe, expect, it } from 'vitest'
import { diagramOf } from '../model/map'
import type { HexaMap } from '../model/schema'
import { threadsOf } from '../model/threads'
import { layoutDiagram, type LayoutEdge } from './layout'
import { dotsReach, TRACK_GAP } from './hexagon/spacing'
import { lineWidth } from './text'

const both = ['uc-assign', 'uc-track']
const shared = {
  app: 'domainrings',
  version: 5,
  kind: 'hexagonal',
  title: 'Shared',
  contexts: [{ id: 'c1', name: 'Growth' }],
  hexagons: [
    {
      id: 'h1',
      contextId: 'c1',
      cell: { q: 0, r: 0 },
      title: 'Experiments',
      domain: [],
      useCases: [
        { id: 'uc-assign', name: 'AssignExperiment', placement: 'nw' },
        { id: 'uc-track', name: 'TrackExperimentMetric', placement: 'sw' },
      ],
      ports: [
        { id: 'p-clock', name: 'Clock', side: 'driven', wall: 'se', useCaseIds: both },
        { id: 'p-report', name: 'ReportChannel', side: 'driven', wall: 'se', useCaseIds: both },
      ],
      adapters: [
        { id: 'a-clock', name: 'SystemClock', portId: 'p-clock' },
        { id: 'a-report', name: 'makeReportChannel', portId: 'p-report' },
      ],
      actors: [],
      externals: [
        { id: 'ext-runtime', name: 'Runtime clock', adapterId: 'a-clock' },
        { id: 'ext-logger', name: 'Root logger', adapterId: 'a-report' },
      ],
    },
  ],
  links: [],
} as unknown as HexaMap

const placed = (a?: string, b?: string) => {
  const [h] = (shared as any).hexagons
  return { ...shared, hexagons: [{ ...h, useCases: [{ ...h.useCases[0], placement: a }, { ...h.useCases[1], placement: b }] }] } as HexaMap
}
const modelOf = (map: HexaMap) => {
  const threads = threadsOf(map, 'h1')
  return { threads, model: layoutDiagram(diagramOf(map, 'h1'), { threads }) }
}
const { threads, model } = modelOf(shared)
const slotOf = (id: string) => threads.find((t) => t.useCaseId === id)!.slot

type Seg = [{ x: number; y: number }, { x: number; y: number }]
const segments = (e: LayoutEdge): Seg[] => e.points.slice(1).map((p, i) => [e.points[i], p])

/** The smallest perpendicular distance at which two segments run side by side over a shared stretch; Infinity when they never do. */
function parallelGap([a, b]: Seg, [c, d]: Seg): number {
  const [ux, uy] = [b.x - a.x, b.y - a.y]
  const len = Math.hypot(ux, uy)
  const vlen = Math.hypot(d.x - c.x, d.y - c.y)
  if (len < 1 || vlen < 1) return Infinity
  const cross = (ux * (d.y - c.y) - uy * (d.x - c.x)) / (len * vlen)
  if (Math.abs(cross) > 0.01) return Infinity
  const along = (p: { x: number; y: number }) => ((p.x - a.x) * ux + (p.y - a.y) * uy) / len
  const overlap = Math.min(len, Math.max(along(c), along(d))) - Math.max(0, Math.min(along(c), along(d)))
  return overlap > 1 ? Math.abs(((c.x - a.x) * uy - (c.y - a.y) * ux) / len) : Infinity
}

describe('threads sharing a port', () => {
  it('draws the adapter chain once per thread, each in its own colour', () => {
    for (const [from, to] of [['a-clock', 'ext-runtime'], ['a-report', 'ext-logger'], ['a-clock', 'p-clock'], ['a-report', 'p-report']]) {
      const lines = model.edges.filter((e) => e.from === from && e.to === to)
      expect(lines.map((e) => e.thread), `${from}->${to}`).toEqual(both.map((id) => ({ id, slot: slotOf(id) })))
    }
  })

  it.each([['nw', 'sw'], [undefined, undefined], ['top', 'top'], ['sw', 'nw'], ['ne', 'se'], ['w', 'e'], ['top', 'sw']])('keeps every pair of different threads apart wherever they run side by side (%s, %s)', (a, b) => {
    const lines = modelOf(placed(a, b)).model.edges.filter((e) => e.thread)
    for (const [i, x] of lines.entries())
      for (const y of lines.slice(i + 1)) {
        if (x.thread!.id === y.thread!.id) continue
        for (const s of segments(x)) for (const t of segments(y)) expect(parallelGap(s, t), `${x.key} / ${y.key}`).toBeGreaterThanOrEqual(TRACK_GAP - 0.5)
      }
  })

  it('leaves room beside the kind label for every thread dot', () => {
    for (const node of model.nodes.filter((n) => n.threads && n.threads.length > 1 && n.kind !== 'useCase')) {
      const label = lineWidth(node.lines[0])
      expect(node.width / 2 - label / 2, node.key).toBeGreaterThanOrEqual(dotsReach(node.threads!.length) - 1e-6)
    }
  })
})
