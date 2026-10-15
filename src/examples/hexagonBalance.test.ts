import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { layoutDiagram } from '../layout/layout'
import { parseHexa } from '../model/hexa'
import { diagramOf } from '../model/map'
import { EXAMPLE_DIAGRAM, STRESS_DIAGRAM } from '../model/example'
import type { Diagram } from '../model/schema'

const MAX_OFFSET = 0.2

const advanced = parseHexa(readFileSync(path.join(__dirname, 'hexagonal-advanced.hexa'), 'utf-8'))
if (!advanced.ok || advanced.map.kind !== 'hexagonal') throw new Error('hexagonal-advanced.hexa must parse as a hexagonal map')
const map = advanced.map

const examples: [string, Diagram][] = [
  ['Chat feedback slice', EXAMPLE_DIAGRAM],
  ['Stress test', STRESS_DIAGRAM],
  ...map.hexagons.map((h): [string, Diagram] => [`E-commerce · ${h.title}`, diagramOf(map, h.id)]),
]

/** Centroid height of the wall-hosted boxes, as a fraction of half the layout height: 0 is level with the hexagon centre. */
const verticalOffset = (diagram: Diagram, mode: 'detailed' | 'overview') => {
  const { nodes, bounds } = layoutDiagram(diagram, { mode })
  const hosted = nodes.filter((n) => n.wall)
  return Math.abs(hosted.reduce((sum, n) => sum + n.y, 0) / hosted.length) / (bounds.height / 2)
}

describe('hexagon examples read balanced, not bunched on the lower walls', () => {
  describe.each(examples)('%s', (_, diagram) => {
    it.each(['detailed', 'overview'] as const)(`keeps the wall boxes within ${MAX_OFFSET} of the centre (%s)`, (mode) => {
      expect(verticalOffset(diagram, mode)).toBeLessThan(MAX_OFFSET)
    })
  })
})
