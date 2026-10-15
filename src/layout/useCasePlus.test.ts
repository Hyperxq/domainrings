import { describe, expect, it } from 'vitest'
import { EXAMPLES, EXAMPLE_DIAGRAM, STRESS_DIAGRAM } from '../model/example'
import projectBuilderRaw from '../model/fixtures/project-builder.hexa?raw'
import { parseHexa } from '../model/hexa'
import { diagramOf } from '../model/map'
import type { Diagram, HexaMap } from '../model/schema'
import { insertionPoints } from './insertion'
import { layoutDiagram, type LayoutMode } from './layout'

const p = parseHexa(projectBuilderRaw)
if (!p.ok || p.map.kind !== 'hexagonal') throw new Error()
const pb = p.map
const adv = EXAMPLES.find((e) => e.id === 'hexagonal-advanced')!.map as HexaMap
const MANY: Diagram = {
  ...EXAMPLE_DIAGRAM,
  useCases: Array.from({ length: 14 }, (_, i) => ({ id: `u${i}`, name: `Use case number ${i}`, aggregateIds: [] })),
  ports: Array.from({ length: 14 }, (_, i) => ({ id: `p${i}`, name: `PortWithLongName${i}`, side: 'driving' as const, wall: 'w' as const, useCaseId: `u${i}` })),
  adapters: [],
  actors: [],
  externals: [],
}
const cases: Array<[string, Diagram]> = [['fourteen use cases', MANY], ['chat', EXAMPLE_DIAGRAM], ['stress', STRESS_DIAGRAM], ...adv.hexagons.map((h): [string, Diagram] => ['adv ' + h.id, diagramOf(adv, h.id)]), ...pb.hexagons.map((h): [string, Diagram] => ['pb ' + h.id, diagramOf(pb, h.id)])]
describe.each(cases.flatMap(([n, d]) => (['detailed', 'overview'] as LayoutMode[]).map((m) => [n, d, m] as const)))('use case plus: %s (%s)', (_, d, mode) => {
  it('is offered', () => {
    expect(insertionPoints(layoutDiagram(d, { mode }), d).filter((x) => x.action.kind === 'useCase').length).toBeGreaterThan(0)
  })
})
