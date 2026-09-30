import { describe, expect, it } from 'vitest'
import { layoutMap } from './map'
import type { LayoutMode } from './layout'
import type { HexaMap, Link } from '../model/schema'
import { linkedTwoHexMap, manyHexagonMap } from '../test/fixtures'

const link = (id: string, from: string, fromPort: string, to: string, toPort: string, adapters: { from?: string; to?: string } = {}): Link => ({
  id,
  from: { hexagonId: from, portId: fromPort, ...(adapters.from ? { adapterId: adapters.from } : {}) },
  to: { hexagonId: to, portId: toPort, ...(adapters.to ? { adapterId: adapters.to } : {}) },
})

const LINKS: Link[] = [
  link('l-a', 'h1', 'p-repo', 'h2', 'p-submit'),
  link('l-b', 'h1', 'p-notify', 'h2', 'p-submit'),
  link('l-c', 'h2', 'p-users', 'h3', 'p-submit', { from: 'a-legacy' }),
  link('l-d', 'h3', 'p-repo', 'h1', 'p-submit', { from: 'a-knex', to: 'a-http' }),
  link('l-e', 'h1', 'p-repo', 'h3', 'p-notify'),
]
const threeHexagons = (cells: Array<[number, number]>, links: Link[]): HexaMap => {
  const base = manyHexagonMap(3)
  return { ...base, hexagons: base.hexagons.map((h, i) => ({ ...h, cell: { q: cells[i][0], r: cells[i][1] } })), links }
}

const SMALL_MAPS: Array<[string, HexaMap]> = [
  ['two linked hexagons', linkedTwoHexMap()],
  ['three hexagons in a triangle', threeHexagons([[0, 0], [1, 0], [0, 1]], LINKS)],
  ['three hexagons in a row, neighbours linked', threeHexagons([[0, 0], [1, 0], [2, 0]], LINKS.slice(0, 3))],
  ['three hexagons in a row, the ends linked', threeHexagons([[0, 0], [1, 0], [2, 0]], LINKS.slice(4))],
]

// Recorded before link routing learned about third hexagons and chips: maps below COMPACT_FROM hexagons keep these routes.
describe('layoutMap — links on maps of one to three hexagons', () => {
  describe.each(['detailed', 'overview'] as LayoutMode[])('in %s', (mode) => {
    it.each(SMALL_MAPS)('routes %s as it always has', (_, map) => {
      expect(layoutMap(map, { mode }).links).toMatchSnapshot()
    })
    it.each(SMALL_MAPS)('routes %s the same with a current hexagon', (_, map) => {
      expect(layoutMap(map, { mode, current: 'h1' }).links).toMatchSnapshot()
    })
  })
})
