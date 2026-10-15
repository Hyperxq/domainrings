import { describe, expect, it } from 'vitest'
import { EXAMPLE_DIAGRAM, STRESS_DIAGRAM } from '../model/example'
import projectBuilderRaw from '../model/fixtures/project-builder.hexa?raw'
import { parseHexa } from '../model/hexa'
import { diagramOf } from '../model/map'
import type { Diagram, Port, UseCase, Wall } from '../model/schema'
import { dot, reach } from './geometry'
import { layoutDiagram, type LayoutMode } from './layout'
import { WALLS, wallFrame } from './hexagon/walls'

const MODES: LayoutMode[] = ['detailed', 'overview']
const parsed = parseHexa(projectBuilderRaw)
if (!parsed.ok || parsed.map.kind !== 'hexagonal') throw new Error('project-builder fixture must parse')
const projectBuilder = parsed.map

const base: Diagram = { version: 1, kind: 'hexagonal', title: '', domain: [{ id: 'd1', name: 'Order', type: 'aggregate' }], useCases: [], ports: [], adapters: [], actors: [], externals: [] }
const port = (id: string, useCaseId: string, side: Port['side'], wall: Wall): Port => ({ id, name: `op${id}`, side, useCaseId, wall })
const useCase = (id: string): UseCase => ({ id, name: `Handle${id}` })

const CASES: Array<[string, Diagram]> = [
  ['example', EXAMPLE_DIAGRAM],
  ['stress', STRESS_DIAGRAM],
  ['sockets off the centre of one wall', { ...base, useCases: [useCase('u1')], ports: [port('a', 'u1', 'driven', 'ne'), port('b', 'u1', 'driven', 'ne'), port('c', 'u1', 'driven', 'ne'), port('d', 'u1', 'driving', 'w')] }],
  ['several use cases on one wall', { ...base, useCases: [useCase('u1'), useCase('u2'), useCase('u3')], ports: ['u1', 'u2', 'u3'].map((u, i) => port(`p${i}`, u, 'driving', 'nw')) }],
  ...projectBuilder.hexagons.map((h): [string, Diagram] => [`project-builder / ${h.id}`, diagramOf(projectBuilder, h.id)]),
]

describe('seats centred on their wall', () => {
  it.each(CASES.flatMap(([name, d]) => MODES.map((mode) => [name, d, mode] as const)))('%s centres the use cases of each wall as a group (%s)', (_, d, mode) => {
    const m = layoutDiagram(d, { mode })
    for (const wall of WALLS) {
      const { dir } = wallFrame(wall)
      const here = m.nodes.filter((n) => n.kind === 'useCase' && n.wall === wall)
      if (!here.length) continue
      const lo = Math.min(...here.map((n) => dot(n, dir) - reach(n.width, n.height, dir)))
      const hi = Math.max(...here.map((n) => dot(n, dir) + reach(n.width, n.height, dir)))
      expect((lo + hi) / 2, wall).toBeCloseTo(0, 6)
    }
  })

  it('seats a lone use case at the middle of its wall, whatever wall its sockets stand on', () => {
    const m = layoutDiagram(CASES[2][1])
    const seat = m.nodes.find((n) => n.kind === 'useCase')!
    expect(dot(seat, wallFrame(seat.wall!).dir)).toBeCloseTo(0, 6)
  })
})
