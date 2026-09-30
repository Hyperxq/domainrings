import { describe, expect, it } from 'vitest'
import { EXAMPLES } from '../model/example'
import projectBuilderRaw from '../model/fixtures/project-builder.hexa?raw'
import { parseHexa } from '../model/hexa'
import { diagramOf } from '../model/map'
import type { HexaMap } from '../model/schema'
import { layoutClean } from './clean'
import { layoutDiagram, type LayoutMode } from './layout'
import { layoutMap } from './map'
import { layoutOnion } from './onion'

// Pins the full output of every layout entry point on the shipped examples, so a structural refactor of the
// layout modules that moves any point, size, text or edge fails here. Numbers are rounded to 6 decimals: coarser
// than the last-bit float noise a reordered sum can introduce (~1e-13 at these magnitudes), far finer than any
// real layout movement (a constant nudged by 0.001 still shows).
const PRECISION = 1e6

const round = (value: unknown): unknown => {
  if (typeof value === 'number') return Math.round(value * PRECISION) / PRECISION + 0
  if (Array.isArray(value)) return value.map(round)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, round(v)]))
  return value
}

const MODES: LayoutMode[] = ['detailed', 'overview']

const projectBuilder = (): HexaMap => {
  const parsed = parseHexa(projectBuilderRaw)
  if (!parsed.ok || parsed.map.kind !== 'hexagonal') throw new Error('project-builder fixture must parse')
  return parsed.map
}

const hexagonalMaps = [
  ...EXAMPLES.filter((e) => e.map.kind === 'hexagonal').map((e) => [e.id, e.map as HexaMap] as const),
  ['project-builder', projectBuilder()] as const,
]

describe('layoutDiagram — every hexagon of every hexagonal example', () => {
  for (const [name, map] of hexagonalMaps) {
    for (const mode of MODES) {
      for (const hexagon of map.hexagons) {
        it(`${name} / ${hexagon.id} in ${mode}`, () => {
          expect(round(layoutDiagram(diagramOf(map, hexagon.id), { mode }))).toMatchSnapshot()
        })
      }
    }
  }
})

describe('layoutMap — project-builder', () => {
  const map = projectBuilder()
  const all = new Set(map.hexagons.map((h) => h.id))
  const cases = [
    ['no current hexagon', {}],
    ['current = first hexagon', { current: map.hexagons[0].id }],
    ['all expanded', { current: map.hexagons[0].id, expanded: all }],
  ] as const
  for (const mode of MODES) {
    it.each(cases)(`%s in ${mode}`, (_, options) => {
      expect(round(layoutMap(map, { mode, ...options }))).toMatchSnapshot()
    })
  }
})

describe('layoutOnion and layoutClean — shipped examples', () => {
  for (const { id, map } of EXAMPLES) {
    if (map.kind === 'onion') it(id, () => expect(round(layoutOnion(map))).toMatchSnapshot())
    if (map.kind === 'clean') it(id, () => expect(round(layoutClean(map))).toMatchSnapshot())
  }
})
