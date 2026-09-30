import { describe, expect, it } from 'vitest'
import { hexagonBounds } from './lattice'
import { layoutMap } from './map'
import { crossesBox } from './obstacleRoute'
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

const CLEAR_MAPS: Array<[string, HexaMap]> = [
  ['two linked hexagons', linkedTwoHexMap()],
  ['three hexagons in a triangle', threeHexagons([[0, 0], [1, 0], [0, 1]], LINKS)],
  ['three hexagons in a row, neighbours linked', threeHexagons([[0, 0], [1, 0], [2, 0]], LINKS.slice(0, 3))],
]

// Recorded from the routes `layoutMap` drew before it routed round third hexagons and chips. None of these maps has a
// link in the way of another hexagon or a chip, so routing round them must leave every point where it was.
describe('layoutMap — links that are already clear on maps of two or three hexagons', () => {
  describe.each(['detailed', 'overview'] as LayoutMode[])('in %s', (mode) => {
    it.each(CLEAR_MAPS)('keeps the routes of %s', (_, map) => {
      expect(layoutMap(map, { mode }).links).toMatchSnapshot()
    })
    it.each(CLEAR_MAPS)('keeps the routes of %s with a current hexagon', (_, map) => {
      expect(layoutMap(map, { mode, current: 'h1' }).links).toMatchSnapshot()
    })
  })
})

describe('layoutMap — a link between the ends of a row of three hexagons', () => {
  const row = threeHexagons([[0, 0], [1, 0], [2, 0]], LINKS.slice(4))
  it.each(['detailed', 'overview'] as LayoutMode[])('does not cross the hexagon between them in %s', (mode) => {
    const result = layoutMap(row, { mode })
    const middle = hexagonBounds(result.hexagons.find((h) => h.id === 'h2')!)
    expect(crossesBox(result.links[0].points, [middle])).toBe(false)
  })
})
