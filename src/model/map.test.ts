import { describe, expect, it } from 'vitest'
import { diagramOf, putDiagram } from './map'
import { toMap } from './hexa'
import { EXAMPLE_DIAGRAM } from './example'

describe('diagramOf', () => {
  it('builds the v1-shaped view of a hexagon, with the map kind and no id/contextId/cell', () => {
    const map = toMap(EXAMPLE_DIAGRAM)
    const view = diagramOf(map, 'h1')
    expect(view).toStrictEqual(EXAMPLE_DIAGRAM)
  })

  it('throws for an unknown hexagon id', () => {
    const map = toMap(EXAMPLE_DIAGRAM)
    expect(() => diagramOf(map, 'nope')).toThrow(/Unknown hexagon/)
  })
})

describe('putDiagram', () => {
  it('writes an edited diagram back onto its hexagon, dropping version and kind', () => {
    const map = toMap(EXAMPLE_DIAGRAM)
    const edited = { ...diagramOf(map, 'h1'), title: 'Renamed' }
    const next = putDiagram(map, 'h1', edited)
    expect(next.hexagons[0]).toStrictEqual({ ...map.hexagons[0], title: 'Renamed' })
    expect('kind' in next.hexagons[0]).toBe(false)
    expect('version' in next.hexagons[0]).toBe(false)
  })

  it('leaves every other hexagon untouched by reference', () => {
    const map = toMap(EXAMPLE_DIAGRAM)
    const untouched = { ...map, hexagons: [...map.hexagons, { ...map.hexagons[0], id: 'h2', cell: { q: 1, r: 0 } }] }
    const edited = { ...diagramOf(untouched, 'h1'), title: 'Renamed' }
    const next = putDiagram(untouched, 'h1', edited)
    expect(next.hexagons[1]).toBe(untouched.hexagons[1])
  })

  it('round-trips through diagramOf: put(view) reproduces the original hexagon', () => {
    const map = toMap(EXAMPLE_DIAGRAM)
    const next = putDiagram(map, 'h1', diagramOf(map, 'h1'))
    expect(next).toStrictEqual(map)
  })
})
