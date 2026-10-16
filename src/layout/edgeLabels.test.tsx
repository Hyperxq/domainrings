import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { HEXAGONAL_KIND } from '../model/kinds'
import { EXAMPLES, EXAMPLE_DIAGRAM, STRESS_DIAGRAM } from '../model/example'
import projectBuilderRaw from '../model/fixtures/project-builder.hexa?raw'
import { parseHexa } from '../model/hexa'
import { diagramOf } from '../model/map'
import type { Diagram, HexaMap } from '../model/schema'
import { HexagonBody } from '../render/HexagonBody'
import { hairline, quadsOverlap, rectCorners, type Box, type Point } from './geometry'
import { layoutDiagram, type LayoutEdge, type LayoutMode, type LayoutModel } from './layout'
import { placeEdgeLabels } from './hexagon/edgeLabels'
import { EDGE_LABEL, measure } from './text'

afterEach(cleanup)

const MODES: LayoutMode[] = ['detailed', 'overview']
const advanced = EXAMPLES.find((e) => e.id === 'hexagonal-advanced')!.map as HexaMap
const parsed = parseHexa(projectBuilderRaw)
if (!parsed.ok || parsed.map.kind !== 'hexagonal') throw new Error('project-builder fixture must parse')
const projectBuilder = parsed.map

const CASES: Array<[string, Diagram]> = [
  ['chat-feedback', EXAMPLE_DIAGRAM],
  ['stress', STRESS_DIAGRAM],
  ['e-commerce advanced', diagramOf(advanced, 'h1')],
  ...projectBuilder.hexagons.map((h): [string, Diagram] => [`project-builder / ${h.id}`, diagramOf(projectBuilder, h.id)]),
]
const EACH = CASES.flatMap(([name, d]) => MODES.map((mode) => [name, d, mode] as const))

const { labels } = HEXAGONAL_KIND
const LABEL_H = EDGE_LABEL.size + 4
const labelled = (m: LayoutModel) => m.edges.filter((e) => e.label)
const placed = (m: LayoutModel) => labelled(m).filter((e) => e.labelAt)
const rect = (e: LayoutEdge): Box => {
  const w = measure(e.label!, EDGE_LABEL)
  return { x: e.labelAt!.x - w / 2, y: e.labelAt!.y - LABEL_H / 2, width: w, height: LABEL_H }
}
const quad = (b: Box) => rectCorners(b.x + b.width / 2, b.y + b.height / 2, b.width, b.height)
const clash = (a: Box, b: Box) => quadsOverlap(quad(a), quad(b))
const segments = (e: LayoutEdge): Array<[Point, Point]> => e.points.slice(1).map((p, i) => [e.points[i], p])

describe.each(EACH)('edge labels: %s (%s)', (_, d, mode) => {
  const m = layoutDiagram(d, { mode })

  it('places at least one label', () => {
    expect(placed(m).length).toBeGreaterThan(0)
  })

  it('overlaps no node, card or ring title', () => {
    const obstacles = [...m.nodes.map((n) => ({ key: n.key, box: { x: n.x - n.width / 2, y: n.y - n.height / 2, width: n.width, height: n.height } })), ...m.rings.map((r) => ({ key: r.role, box: r.titleBox }))]
    const hits = placed(m).flatMap((e) => obstacles.filter((o) => clash(rect(e), o.box)).map((o) => `${e.key} / ${o.key}`))
    expect(hits).toEqual([])
  })

  it('overlaps no other label', () => {
    const all = placed(m)
    const hits = all.flatMap((a, i) => all.slice(i + 1).filter((b) => clash(rect(a), rect(b))).map((b) => `${a.key} / ${b.key}`))
    expect(hits).toEqual([])
  })

  it('keeps clear of its neighbours end to end, so two never read as one line', () => {
    const all = placed(m)
    const wide = (e: LayoutEdge): Box => ({ ...rect(e), x: rect(e).x - 8, width: rect(e).width + 16 })
    const hits = all.flatMap((a, i) => all.slice(i + 1).filter((b) => clash(wide(a), wide(b))).map((b) => `${a.key} / ${b.key}`))
    expect(hits).toEqual([])
  })

  it('crosses no segment of any edge', () => {
    const hits = placed(m).flatMap((e) =>
      m.edges.flatMap((other) => segments(other).filter(([a, b]) => quadsOverlap(quad(rect(e)), hairline(a, b))).map(() => `${e.key} / ${other.key}`)),
    )
    expect(hits).toEqual([])
  })

  it('sits beside a segment of its own run', () => {
    const off = placed(m).filter((e) => {
      const w = measure(e.label!, EDGE_LABEL)
      return !segments(e).some(([a, b]) => {
        const len = Math.hypot(b.x - a.x, b.y - a.y)
        const [dx, dy] = [(b.x - a.x) / len, (b.y - a.y) / len]
        const [px, py] = [e.labelAt!.x - a.x, e.labelAt!.y - a.y]
        const [along, across] = [px * dx + py * dy, Math.abs(-px * dy + py * dx)]
        const extent = w * Math.abs(dx) + LABEL_H * Math.abs(dy)
        return along >= extent / 2 - 0.01 && along <= len - extent / 2 + 0.01 && across <= (w * Math.abs(dy) + LABEL_H * Math.abs(dx)) / 2 + 4
      })
    })
    expect(off.map((e) => e.key)).toEqual([])
  })

  it('keeps a label at most once per edge, and none without text', () => {
    expect(m.edges.filter((e) => e.labelAt && !e.label)).toEqual([])
  })
})

const edge = (y: number, label = labels.runs, x1 = 0, x2 = 400): LayoutEdge => ({ key: `e${y}`, kind: 'import', points: [{ x: x1, y }, { x: x2, y }], label })

describe('placing a label on a run', () => {
  it('skips a segment shorter than the label, keeping the label for a hover title', () => {
    const short = edge(0, labels.runs, 0, 30)
    placeEdgeLabels([short], [])
    expect(short.label).toBe(labels.runs)
    expect(short.labelAt).toBeUndefined()
  })

  it('writes it flat beside a segment that is long enough', () => {
    const long = edge(0)
    placeEdgeLabels([long], [])
    expect(long.labelAt!.x).toBeCloseTo(200, 6)
    expect(Math.abs(long.labelAt!.y)).toBeGreaterThan(LABEL_H / 2)
  })

  it('uses the longest corridor segment before a hop', () => {
    const run: LayoutEdge = { key: 'r', kind: 'import', label: labels.runs, points: [{ x: 0, y: 0 }, { x: 0, y: -300 }, { x: 400, y: -300 }, { x: 400, y: -240 }] }
    placeEdgeLabels([run], [])
    expect(run.labelAt!.y).toBeLessThan(-280)
    expect(run.labelAt!.x).toBeGreaterThan(100)
    expect(run.labelAt!.x).toBeLessThan(300)
  })

  it('falls back to a hop when no corridor segment has room', () => {
    const run: LayoutEdge = { key: 'r', kind: 'import', label: labels.runs, points: [{ x: 0, y: 0 }, { x: 0, y: -200 }, { x: 40, y: -200 }, { x: 40, y: -140 }] }
    placeEdgeLabels([run], [])
    expect(run.labelAt!.y).toBeGreaterThan(-190)
    expect(run.labelAt!.x).toBeLessThan(40 + 2 * LABEL_H)
  })

  it('never lands on an obstacle', () => {
    const run = edge(0)
    placeEdgeLabels([run], [{ x: 150, y: -40, width: 100, height: 80 }])
    const box = rect(run)
    expect(clash(box, { x: 150, y: -40, width: 100, height: 80 })).toBe(false)
  })

  it('staggers the labels of parallel runs along the segment', () => {
    const [a, b] = [edge(0), edge(30)]
    placeEdgeLabels([a, b], [])
    const [ra, rb] = [rect(a), rect(b)]
    const wide = (r: Box): Box => ({ ...r, x: r.x - 8, width: r.width + 16 })
    expect(clash(wide(ra), wide(rb))).toBe(false)
  })

  it('drops a run squeezed between tracks that leave no room for text', () => {
    const [a, b, c] = [edge(0), edge(6), edge(12)]
    placeEdgeLabels([a, b, c], [])
    expect(b.labelAt).toBeUndefined()
    expect(b.label).toBe(labels.runs)
  })
})

// The chat-feedback layout with three runs squeezed between tracks, so the middle one has no room for its text.
const withDroppedLabel = () => {
  const model = layoutDiagram(EXAMPLE_DIAGRAM)
  const squeezed = [edge(0), edge(6), edge(12)]
  placeEdgeLabels(squeezed, [])
  return { model: { ...model, edges: [...model.edges, ...squeezed] }, dropped: squeezed[1] }
}

describe('labels that cannot be placed', () => {
  it('stay on the edge without a position', () => {
    const { model, dropped } = withDroppedLabel()
    expect(labelled(model).filter((e) => !e.labelAt)).toEqual([dropped])
  })

  it('render as a title on the edge so they show on hover', () => {
    const { model, dropped } = withDroppedLabel()
    const { container } = render(
      <svg>
        <HexagonBody model={model} showGuides={false} selected={null} linkTargets={new Set()} chain={undefined} interactive notes={new Map()} planned={new Set()} />
      </svg>,
    )
    const titles = [...container.querySelectorAll('path.edge > title')].map((t) => t.textContent)
    expect(titles).toEqual([dropped.label])
    expect(container.querySelectorAll('text.edge-label').length).toBe(placed(model).length)
  })
})

describe('a label on the domain', () => {
  it('carries the on-domain class only when its edge runs wholly on the domain', () => {
    const [onDomain, onBand] = [{ ...edge(0), intoDomain: 0 }, edge(60)]
    placeEdgeLabels([onDomain, onBand], [])
    const model = { ...layoutDiagram(EXAMPLE_DIAGRAM), edges: [onDomain, onBand] }
    const { container } = render(
      <svg>
        <HexagonBody model={model} showGuides={false} selected={null} linkTargets={new Set()} chain={undefined} interactive notes={new Map()} planned={new Set()} />
      </svg>,
    )
    expect([...container.querySelectorAll('text.edge-label')].map((t) => t.classList.contains('on-domain'))).toEqual([true, false])
  })
})

describe('what a label says', () => {
  const diagram = (verb?: string): Diagram => ({
    version: 1,
    kind: 'hexagonal',
    title: '',
    domain: [{ id: 'g', name: 'Order', type: 'aggregate' }],
    useCases: [{ id: 'u', name: 'Place', aggregateIds: ['g'] }],
    ports: [
      { id: 'in', name: 'api', side: 'driving', useCaseId: 'u' },
      { id: 'out', name: 'Repo', side: 'driven', useCaseId: 'u', ...(verb ? { verb } : {}) },
    ],
    adapters: [],
    actors: [],
    externals: [],
  })
  const driven = (m: LayoutModel) => m.edges.find((e) => e.key === 'useCase:u->port:out')!

  it('a driven run reads the port verb when it has one', () => {
    expect(driven(layoutDiagram(diagram('charge'))).label).toBe('charge')
  })

  it('a driven run says "uses" otherwise', () => {
    expect(driven(layoutDiagram(diagram())).label).toBe(labels.uses)
  })

  it('a driving run says it runs the use case', () => {
    expect(layoutDiagram(diagram()).edges.find((e) => e.key === 'port:in->useCase:u')!.label).toBe(labels.runs)
  })

  it.each(MODES)('a use case asks the domain (%s)', (mode) => {
    const asks = layoutDiagram(diagram(), { mode }).edges.filter((e) => e.label === labels.asks)
    expect(asks.map((e) => e.key)).toEqual(['useCase:u->aggregate:g'])
  })

  it.each(MODES)('a use case that names no aggregate asks the domain as a whole (%s)', (mode) => {
    const bare: Diagram = { ...diagram(), domain: [{ id: 'v', name: 'Money', type: 'valueObject' }], useCases: [{ id: 'u', name: 'Place', aggregateIds: [] }] }
    expect(layoutDiagram(bare, { mode }).edges.find((e) => e.key === 'useCase:u->domain')!.label).toBe(labels.asks)
  })

  it('names each use case once when it asks several aggregates', () => {
    const two: Diagram = { ...diagram(), domain: [{ id: 'g', name: 'Order', type: 'aggregate' }, { id: 'h', name: 'Cart', type: 'aggregate' }], useCases: [{ id: 'u', name: 'Place', aggregateIds: ['g', 'h'] }] }
    const asks = layoutDiagram(two).edges.filter((e) => e.label === labels.asks)
    expect(asks).toHaveLength(1)
  })

  it('Overview labels the same edges as Detailed', () => {
    const [detailed, overview] = [layoutDiagram(STRESS_DIAGRAM), layoutDiagram(STRESS_DIAGRAM, { mode: 'overview' })]
    expect(overview.edges.filter((e) => e.label).map((e) => e.key)).toEqual(detailed.edges.filter((e) => e.label).map((e) => e.key))
  })
})
