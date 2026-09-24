import { describe, expect, it } from 'vitest'
import { diagramOf, putDiagram, pruneLinks } from './map'
import { toMap } from './hexa'
import { EXAMPLE_DIAGRAM } from './example'
import type { HexaMap } from './schema'

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

describe('pruneLinks', () => {
  // h1's driven port p-out (adapter a-out attached) links to h2's driving port p-in; p-unrelated exists so an
  // unrelated deletion has something to remove. h2's port shares p-out's name, to prove cross-hexagon isolation.
  const baseMap = (): HexaMap => ({
    version: 2,
    kind: 'hexagonal',
    title: 'Map',
    contexts: [{ id: 'c1' }],
    hexagons: [
      {
        id: 'h1',
        contextId: 'c1',
        cell: { q: 0, r: 0 },
        title: 'H1',
        domain: [],
        useCases: [],
        ports: [
          { id: 'p-out', name: 'Repository', side: 'driven', wall: 'e' },
          { id: 'p-unrelated', name: 'Other', side: 'driving' },
        ],
        adapters: [{ id: 'a-out', name: 'Adapter', portId: 'p-out' }],
        actors: [],
        externals: [],
      },
      {
        id: 'h2',
        contextId: 'c1',
        cell: { q: 1, r: 0 },
        title: 'H2',
        domain: [],
        useCases: [],
        ports: [{ id: 'p-in', name: 'Repository', side: 'driving' }],
        adapters: [],
        actors: [],
        externals: [],
      },
    ],
    links: [{ id: 'link-1', from: { hexagonId: 'h1', portId: 'p-out', adapterId: 'a-out' }, to: { hexagonId: 'h2', portId: 'p-in' } }],
  })

  it('is a no-op, returning the same references, when the edit does not touch a linked port', () => {
    const map = baseMap()
    const { map: next, pruned } = pruneLinks(map, 'h1')
    expect(next).toBe(map)
    expect(pruned).toEqual([])
  })

  it('prunes the link when its port is deleted on the edited hexagon (LINK-01.1)', () => {
    const map = baseMap()
    const edited: HexaMap = { ...map, hexagons: [{ ...map.hexagons[0], ports: [map.hexagons[0].ports[1]], adapters: [] }, map.hexagons[1]] }
    const { map: next, pruned } = pruneLinks(edited, 'h1')
    expect(next.links).toEqual([])
    expect(pruned).toEqual(map.links)
  })

  it('prunes the link when its port moves to the other side (LINK-01.2)', () => {
    const map = baseMap()
    const flipped: HexaMap = {
      ...map,
      hexagons: [{ ...map.hexagons[0], ports: map.hexagons[0].ports.map((p) => (p.id === 'p-out' ? { ...p, side: 'driving', wall: 'w' } : p)) }, map.hexagons[1]],
    }
    const { map: next, pruned } = pruneLinks(flipped, 'h1')
    expect(next.links).toEqual([])
    expect(pruned).toHaveLength(1)
  })

  it('keeps the link for a same-side wall change, a rename, or an unrelated deletion (LINK-01.3)', () => {
    const map = baseMap()
    const wallChanged: HexaMap = {
      ...map,
      hexagons: [{ ...map.hexagons[0], ports: map.hexagons[0].ports.map((p) => (p.id === 'p-out' ? { ...p, wall: 'se' } : p)) }, map.hexagons[1]],
    }
    const wallResult = pruneLinks(wallChanged, 'h1')
    expect(wallResult.map).toBe(wallChanged)
    expect(wallResult.pruned).toEqual([])

    const renamed: HexaMap = {
      ...map,
      hexagons: [{ ...map.hexagons[0], ports: map.hexagons[0].ports.map((p) => (p.id === 'p-out' ? { ...p, name: 'Renamed' } : p)) }, map.hexagons[1]],
    }
    const renamedResult = pruneLinks(renamed, 'h1')
    expect(renamedResult.map).toBe(renamed)
    expect(renamedResult.pruned).toEqual([])

    const unrelatedDeleted: HexaMap = { ...map, hexagons: [{ ...map.hexagons[0], ports: map.hexagons[0].ports.filter((p) => p.id !== 'p-unrelated') }, map.hexagons[1]] }
    const unrelatedResult = pruneLinks(unrelatedDeleted, 'h1')
    expect(unrelatedResult.map).toBe(unrelatedDeleted)
    expect(unrelatedResult.pruned).toEqual([])
  })

  it('keeps the link and clears adapterId when the linked end’s own adapter is deleted or re-pointed (LINK-01.3)', () => {
    const map = baseMap()
    const adapterDeleted: HexaMap = { ...map, hexagons: [{ ...map.hexagons[0], adapters: [] }, map.hexagons[1]] }
    const deletedResult = pruneLinks(adapterDeleted, 'h1')
    expect(deletedResult.pruned).toEqual([])
    expect(deletedResult.map.links[0].from.adapterId).toBeUndefined()

    const rePointed: HexaMap = {
      ...map,
      hexagons: [
        {
          ...map.hexagons[0],
          ports: [...map.hexagons[0].ports, { id: 'p-other-out', name: 'Other repo', side: 'driven' as const, wall: 'ne' as const }],
          adapters: [{ id: 'a-out', name: 'Adapter', portId: 'p-other-out' }],
        },
        map.hexagons[1],
      ],
    }
    const rePointedResult = pruneLinks(rePointed, 'h1')
    expect(rePointedResult.pruned).toEqual([])
    expect(rePointedResult.map.links[0].from.adapterId).toBeUndefined()
  })

  it('never touches the hexagons array (LINK-01.4: the other hexagon is untouched by construction)', () => {
    const map = baseMap()
    const edited: HexaMap = { ...map, hexagons: [{ ...map.hexagons[0], ports: [map.hexagons[0].ports[1]], adapters: [] }, map.hexagons[1]] }
    const { map: next } = pruneLinks(edited, 'h1')
    expect(next.hexagons).toBe(edited.hexagons)
  })
})
