import { describe, expect, it } from 'vitest'
import { EXAMPLES, EXAMPLE_DIAGRAM, STRESS_DIAGRAM } from '../model/example'
import projectBuilderRaw from '../model/fixtures/project-builder.hexa?raw'
import { parseHexa } from '../model/hexa'
import { diagramOf } from '../model/map'
import type { Diagram, HexaMap } from '../model/schema'
import { hairline, quadsOverlap, rectCorners, type Point } from './geometry'
import { WALLS, wallFrame } from './hexagon/walls'
import { layoutDiagram, type LayoutMode, type LayoutModel } from './layout'

const MODES: LayoutMode[] = ['detailed', 'overview']
const advanced = diagramOf(EXAMPLES.find((e) => e.id === 'hexagonal-advanced')!.map as HexaMap, 'h1')
const parsed = parseHexa(projectBuilderRaw)
if (!parsed.ok || parsed.map.kind !== 'hexagonal') throw new Error('project-builder fixture must parse')
const projectBuilder = parsed.map

const CASES: Array<[string, Diagram]> = [
  ['chat-feedback', EXAMPLE_DIAGRAM],
  ['stress', STRESS_DIAGRAM],
  ['e-commerce advanced', advanced],
  ...projectBuilder.hexagons.map((h): [string, Diagram] => [`project-builder / ${h.id}`, diagramOf(projectBuilder, h.id)]),
]
const EACH = CASES.flatMap(([name, d]) => MODES.map((mode) => [name, d, mode] as const))

const insideApothem = (p: Point, apothem: number) => WALLS.every((w) => p.x * wallFrame(w).n.x + p.y * wallFrame(w).n.y < apothem - 0.01)
const samples = (a: Point, b: Point) => Array.from({ length: 51 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / 50, y: a.y + ((b.y - a.y) * i) / 50 }))

describe.each(EACH)('composition wiring: %s (%s)', (_, d, mode) => {
  const m: LayoutModel = layoutDiagram(d, { mode })
  const wiring = m.edges.filter((e) => e.kind === 'wiring')
  const branches = wiring.filter((e) => !e.key.startsWith('composition->trunk:'))
  const hasComposition = m.nodes.some((n) => n.kind === 'composition')

  it('stays out of the application band', () => {
    const apothem = m.rings[1].halfWidth
    const hits = wiring.filter((e) => e.points.slice(1).some((b, i) => samples(e.points[i], b).some((p) => insideApothem(p, apothem))))
    expect(hits.map((e) => e.key)).toEqual([])
  })

  it('draws a branch as one straight run in along the wall, with at most one turn into the adapter', () => {
    const bent = branches.filter((e) => e.points.length > 3)
    expect(bent.map((e) => `${e.key}: ${e.points.length}`)).toEqual([])
  })

  it('crosses no box but the adapter it feeds', () => {
    const hits = wiring.flatMap((e) =>
      m.nodes
        .filter((n) => n.kind !== 'composition' && e.key !== `composition->${n.key}`)
        .filter((n) => e.points.slice(1).some((b, i) => quadsOverlap(rectCorners(n.x, n.y, n.width, n.height), hairline(e.points[i], b))))
        .map((n) => `${e.key} / ${n.key}`),
    )
    expect(hits).toEqual([])
  })

  it('feeds every adapter when there is a composition root', () => {
    const adapters = m.nodes.filter((n) => n.kind === 'adapter')
    expect(hasComposition ? branches.length : 0).toBe(hasComposition ? adapters.length : 0)
  })
})
