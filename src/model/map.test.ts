import { describe, expect, it } from 'vitest'
import { contextName, diagramOf, freeCell, freeSides, neighbour, nextId, placeHexagon, putDiagram, pruneLinks, SIDE_ORDER, UNTITLED_HEXAGON, type Cell } from './map'
import { toMap } from './hexa'
import { EXAMPLE_DIAGRAM } from './example'
import type { Diagram, HexaMap } from './schema'

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

const emptyHexagon = (id: string, contextId: string, cell: Cell, title = id) => ({
  id,
  contextId,
  cell,
  title,
  domain: [],
  useCases: [],
  ports: [],
  adapters: [],
  actors: [],
  externals: [],
})

const oneHexMap = (): HexaMap => ({
  version: 2,
  kind: 'hexagonal',
  title: 'One',
  contexts: [{ id: 'c1', name: 'Billing' }],
  hexagons: [emptyHexagon('h1', 'c1', { q: 0, r: 0 })],
  links: [],
})

describe('SIDE_ORDER / neighbour (ADR-02)', () => {
  it('pins the clockwise-from-east search order', () => {
    expect(SIDE_ORDER).toEqual(['e', 'se', 'sw', 'w', 'nw', 'ne'])
  })

  it.each([
    ['e', { q: 1, r: 0 }],
    ['w', { q: -1, r: 0 }],
    ['ne', { q: 1, r: -1 }],
    ['nw', { q: 0, r: -1 }],
    ['se', { q: 0, r: 1 }],
    ['sw', { q: -1, r: 1 }],
  ] as const)('%s steps to %o from the origin', (side, delta) => {
    expect(neighbour({ q: 0, r: 0 }, side)).toStrictEqual(delta)
  })

  it('composes from a non-origin cell', () => {
    expect(neighbour({ q: 2, r: -1 }, 'se')).toStrictEqual({ q: 2, r: 0 })
  })

  it('every side’s neighbour, read back through its own opposite side, returns to the origin', () => {
    const opposite: Record<string, string> = { e: 'w', w: 'e', ne: 'sw', sw: 'ne', nw: 'se', se: 'nw' }
    for (const side of SIDE_ORDER) {
      expect(neighbour(neighbour({ q: 0, r: 0 }, side), opposite[side] as (typeof SIDE_ORDER)[number])).toStrictEqual({ q: 0, r: 0 })
    }
  })
})

describe('freeSides (ADR-02)', () => {
  it('offers all six sides for a lone hexagon, in SIDE_ORDER', () => {
    const map = oneHexMap()
    expect(freeSides(map, map.hexagons[0].cell)).toEqual(SIDE_ORDER)
  })

  it('excludes exactly the one side that already has a neighbour', () => {
    const map = oneHexMap()
    const occupied: HexaMap = { ...map, hexagons: [...map.hexagons, emptyHexagon('h2', 'c1', neighbour({ q: 0, r: 0 }, 'e'))] }
    expect(freeSides(occupied, { q: 0, r: 0 })).toEqual(['se', 'sw', 'w', 'nw', 'ne'])
  })

  it('returns [] once every side has a neighbour', () => {
    const map = oneHexMap()
    const ring: HexaMap = { ...map, hexagons: [...map.hexagons, ...SIDE_ORDER.map((s, i) => emptyHexagon(`h${i + 2}`, 'c1', neighbour({ q: 0, r: 0 }, s)))] }
    expect(freeSides(ring, { q: 0, r: 0 })).toEqual([])
  })
})

describe('freeCell (ADR-02)', () => {
  it('finds the first free ring-1 cell around a lone hexagon', () => {
    const map = oneHexMap()
    expect(freeCell(map, { q: 0, r: 0 })).toStrictEqual(neighbour({ q: 0, r: 0 }, 'e'))
  })

  it('never returns an occupied cell, and skips outward once ring 1 fills up', () => {
    const map = oneHexMap()
    const ring1Full: HexaMap = { ...map, hexagons: [...map.hexagons, ...SIDE_ORDER.map((s, i) => emptyHexagon(`h${i + 2}`, 'c1', neighbour({ q: 0, r: 0 }, s)))] }
    const found = freeCell(ring1Full, { q: 0, r: 0 })
    expect(ring1Full.hexagons.some((h) => h.cell.q === found.q && h.cell.r === found.r)).toBe(false)
    // Every ring-1 cell is 1 axial step from the origin; a ring-2 cell is at least 2.
    const dist = Math.abs(found.q) + Math.abs(found.q + found.r) + Math.abs(found.r)
    expect(dist).toBeGreaterThan(2)
  })
})

describe('nextId (ADR-03)', () => {
  it('returns the next number after the highest existing suffix', () => {
    expect(nextId(['h1', 'h2', 'h5'], 'h')).toBe('h6')
  })

  it('starts at 1 with no matching ids', () => {
    expect(nextId([], 'h')).toBe('h1')
    expect(nextId(['c-foreign', 'other'], 'c')).toBe('c1')
  })

  it('ignores ids under a different prefix', () => {
    expect(nextId(['h1', 'c9'], 'h')).toBe('h2')
  })
})

describe('contextName (ADR-03)', () => {
  it('returns the context’s own name when it has one', () => {
    const map = { contexts: [{ id: 'c1', name: 'Billing' }] }
    expect(contextName(map, 'c1')).toBe('Billing')
  })

  it('falls back to "Context {n}" from the id’s numeric suffix when unnamed', () => {
    const map = { contexts: [{ id: 'c1' }, { id: 'c2' }] }
    expect(contextName(map, 'c2')).toBe('Context 2')
  })

  it('falls back to 1-based array position for a foreign, non-numeric id', () => {
    const map = { contexts: [{ id: 'imported-ctx' }, { id: 'c2' }] }
    expect(contextName(map, 'imported-ctx')).toBe('Context 1')
  })

  it('stays fixed once assigned, even after an earlier context is deleted (CB-03.2)', () => {
    const full = { contexts: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }] }
    const afterDeletingC1 = { contexts: [{ id: 'c2' }, { id: 'c3' }] }
    expect(contextName(full, 'c3')).toBe('Context 3')
    expect(contextName(afterDeletingC1, 'c3')).toBe('Context 3')
  })
})

describe('placeHexagon (ADR-02)', () => {
  const view: Diagram = { version: 1, kind: 'hexagonal', title: 'Grown', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] }

  it('appends the hexagon into an existing context when contextId is given, never creating a new one', () => {
    const map = oneHexMap()
    const { map: next, hexId } = placeHexagon(map, view, { cell: { q: 1, r: 0 }, contextId: 'c1' })
    expect(next.contexts).toStrictEqual(map.contexts)
    expect(next.hexagons).toHaveLength(2)
    expect(next.hexagons[1]).toStrictEqual({ id: hexId, contextId: 'c1', cell: { q: 1, r: 0 }, title: 'Grown', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] })
  })

  it('creates a new context in the same transition when contextId is omitted — never a zero-hexagon context', () => {
    const map = oneHexMap()
    const { map: next, hexId } = placeHexagon(map, view, { cell: { q: 1, r: 0 } })
    expect(next.contexts).toHaveLength(2)
    const newContext = next.contexts[1]
    expect(next.hexagons.filter((h) => h.contextId === newContext.id)).toHaveLength(1)
    expect(next.hexagons.find((h) => h.id === hexId)?.contextId).toBe(newContext.id)
  })

  it('always returns kind hexagonal, converting a Clean/Onion map', () => {
    const clean: HexaMap = { ...oneHexMap(), kind: 'clean' }
    const { map: next } = placeHexagon(clean, view, { cell: { q: 1, r: 0 } })
    expect(next.kind).toBe('hexagonal')
  })

  it('assigns a fresh id via nextId and drops version/kind from the view, like putDiagram', () => {
    const map = oneHexMap()
    const { hexId, map: next } = placeHexagon(map, view, { cell: { q: 1, r: 0 }, contextId: 'c1' })
    expect(hexId).toBe('h2')
    const hexagon = next.hexagons[1]
    expect('version' in hexagon).toBe(false)
    expect('kind' in hexagon).toBe(false)
  })

  it('produces an untitled hexagon when the view carries the default title, matching UNTITLED_HEXAGON', () => {
    const map = oneHexMap()
    const untitledView: Diagram = { ...view, title: UNTITLED_HEXAGON }
    const { map: next, hexId } = placeHexagon(map, untitledView, { cell: { q: 1, r: 0 }, contextId: 'c1' })
    expect(next.hexagons.find((h) => h.id === hexId)?.title).toBe(UNTITLED_HEXAGON)
  })
})
