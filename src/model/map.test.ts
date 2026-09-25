import { describe, expect, it } from 'vitest'
import { addLink, contextName, crossHexagonPorts, diagramOf, freeCell, freeSides, neighbour, nextId, placeHexagon, putDiagram, pruneLinks, removeHexagon, removeLink, SIDE_ORDER, UNTITLED_HEXAGON, updateLink, type Cell } from './map'
import { toMap } from './hexa'
import { EXAMPLE_DIAGRAM } from './example'
import type { Diagram, HexaMap, Link, LinkEnd } from './schema'

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

describe('removeHexagon (ADR-02, ADR-03 E2)', () => {
  const twoContextMap = (): HexaMap => ({
    version: 2,
    kind: 'hexagonal',
    title: 'Two',
    contexts: [{ id: 'c1', name: 'Billing' }, { id: 'c2' }],
    hexagons: [emptyHexagon('h1', 'c1', { q: 0, r: 0 }), emptyHexagon('h2', 'c2', { q: 1, r: 0 })],
    links: [],
  })

  it('drops the removed hexagon, keeping every other hexagon by reference', () => {
    const map = twoContextMap()
    const { map: next } = removeHexagon(map, 'h2')
    expect(next.hexagons).toStrictEqual([map.hexagons[0]])
    expect(next.hexagons[0]).toBe(map.hexagons[0])
  })

  it('drops the removed hexagon’s own context once it holds no other hexagon (DEL-03.1)', () => {
    const map = twoContextMap()
    const { map: next } = removeHexagon(map, 'h2')
    expect(next.contexts).toStrictEqual([map.contexts[0]])
  })

  it('keeps a context that still holds another hexagon after the removal', () => {
    const map: HexaMap = { ...twoContextMap(), hexagons: [emptyHexagon('h1', 'c1', { q: 0, r: 0 }), emptyHexagon('h2', 'c1', { q: 1, r: 0 }), emptyHexagon('h3', 'c2', { q: 2, r: 0 })] }
    const { map: next } = removeHexagon(map, 'h2')
    expect(next.contexts).toStrictEqual(map.contexts)
    expect(next.hexagons.map((h) => h.id)).toEqual(['h1', 'h3'])
  })

  it('drops every link with either end on the removed hexagon, keeping links between other hexagons', () => {
    const linkFrom: Link = { id: 'l1', from: { hexagonId: 'h1', portId: 'p1' }, to: { hexagonId: 'h2', portId: 'p2' } }
    const linkTo: Link = { id: 'l2', from: { hexagonId: 'h3', portId: 'p3' }, to: { hexagonId: 'h1', portId: 'p4' } }
    const linkUnrelated: Link = { id: 'l3', from: { hexagonId: 'h2', portId: 'p5' }, to: { hexagonId: 'h3', portId: 'p6' } }
    const map: HexaMap = {
      ...twoContextMap(),
      hexagons: [emptyHexagon('h1', 'c1', { q: 0, r: 0 }), emptyHexagon('h2', 'c1', { q: 1, r: 0 }), emptyHexagon('h3', 'c2', { q: 2, r: 0 })],
      links: [linkFrom, linkTo, linkUnrelated],
    }
    const { map: next, pruned } = removeHexagon(map, 'h1')
    expect(next.links).toStrictEqual([linkUnrelated])
    expect(pruned).toStrictEqual([linkFrom, linkTo])
  })
})

const hexWithPorts = (id: string, contextId: string, cell: Cell, ports: HexaMap['hexagons'][number]['ports'], title?: string) => ({
  ...emptyHexagon(id, contextId, cell, title ?? id),
  ports,
})

describe('crossHexagonPorts (ADR-02)', () => {
  const threeHexMap = (): HexaMap => ({
    version: 2,
    kind: 'hexagonal',
    title: 'Three',
    contexts: [{ id: 'c1' }],
    hexagons: [
      hexWithPorts('h1', 'c1', { q: 0, r: 0 }, [{ id: 'p1-out', name: 'Repository', side: 'driven', wall: 'e' }, { id: 'p1-in', name: 'Submit', side: 'driving' }], 'H1'),
      hexWithPorts('h2', 'c1', { q: 1, r: 0 }, [{ id: 'p2-out', name: 'Notify', side: 'driven', wall: 'e' }], 'H2'),
      hexWithPorts('h3', 'c1', { q: 2, r: 0 }, [{ id: 'p3-in', name: 'Receive', side: 'driving' }], ''),
    ],
    links: [],
  })

  it('lists every port of the given side across the map, paired with its hexagon’s title', () => {
    const map = threeHexMap()
    expect(crossHexagonPorts(map, 'driven')).toEqual([
      { hexagonId: 'h1', hexagonTitle: 'H1', portId: 'p1-out', portName: 'Repository' },
      { hexagonId: 'h2', hexagonTitle: 'H2', portId: 'p2-out', portName: 'Notify' },
    ])
  })

  it('falls back to UNTITLED_HEXAGON for an untitled hexagon', () => {
    const map = threeHexMap()
    expect(crossHexagonPorts(map, 'driving')).toEqual([
      { hexagonId: 'h1', hexagonTitle: 'H1', portId: 'p1-in', portName: 'Submit' },
      { hexagonId: 'h3', hexagonTitle: UNTITLED_HEXAGON, portId: 'p3-in', portName: 'Receive' },
    ])
  })

  it('omits the excluded hexagon’s own ports, keeping every other hexagon’s', () => {
    const map = threeHexMap()
    expect(crossHexagonPorts(map, 'driven', 'h1')).toEqual([{ hexagonId: 'h2', hexagonTitle: 'H2', portId: 'p2-out', portName: 'Notify' }])
  })

  it('returns an empty array when no port of that side exists', () => {
    const map = threeHexMap()
    expect(crossHexagonPorts(map, 'driving', 'h1')).toEqual([{ hexagonId: 'h3', hexagonTitle: UNTITLED_HEXAGON, portId: 'p3-in', portName: 'Receive' }])
    expect(crossHexagonPorts(map, 'driven', 'h1').filter((p) => p.hexagonId === 'h3')).toEqual([])
  })
})

describe('addLink (ADR-02)', () => {
  const twoHex = (): HexaMap => ({
    version: 2,
    kind: 'hexagonal',
    title: 'Two',
    contexts: [{ id: 'c1' }],
    hexagons: [
      hexWithPorts('h1', 'c1', { q: 0, r: 0 }, [{ id: 'p-out', name: 'Repository', side: 'driven', wall: 'e' }]),
      hexWithPorts('h2', 'c1', { q: 1, r: 0 }, [{ id: 'p-in', name: 'Submit', side: 'driving' }]),
    ],
    links: [],
  })

  it('appends a link with a fresh id via nextId, returning the map and the new id', () => {
    const map = twoHex()
    const from: LinkEnd = { hexagonId: 'h1', portId: 'p-out' }
    const to: LinkEnd = { hexagonId: 'h2', portId: 'p-in' }
    const { map: next, linkId } = addLink(map, from, to)
    expect(linkId).toBe('link1')
    expect(next.links).toEqual([{ id: 'link1', from, to }])
  })

  it('assigns sequential ids after the highest existing link suffix', () => {
    const map: HexaMap = { ...twoHex(), links: [{ id: 'link1', from: { hexagonId: 'h1', portId: 'p-out' }, to: { hexagonId: 'h2', portId: 'p-in' } }] }
    const { linkId } = addLink(map, { hexagonId: 'h1', portId: 'p-out' }, { hexagonId: 'h2', portId: 'p-in' })
    expect(linkId).toBe('link2')
  })

  it('returns the candidate map unvalidated — an invalid pair still appends, gating is the store’s job', () => {
    const map = twoHex()
    // Both ends driven: not a valid link, but addLink itself never checks — MapSchema.safeParse is the gate.
    const from: LinkEnd = { hexagonId: 'h1', portId: 'p-out' }
    const to: LinkEnd = { hexagonId: 'h1', portId: 'p-out' }
    const { map: next } = addLink(map, from, to)
    expect(next.links).toEqual([{ id: 'link1', from, to }])
  })

  it('leaves every hexagon untouched by reference', () => {
    const map = twoHex()
    const { map: next } = addLink(map, { hexagonId: 'h1', portId: 'p-out' }, { hexagonId: 'h2', portId: 'p-in' })
    expect(next.hexagons).toBe(map.hexagons)
  })
})

describe('updateLink / removeLink (ADR-02, REQ-LNK-02, REQ-LNK-04)', () => {
  const twoLinksMap = (): HexaMap => ({
    version: 2,
    kind: 'hexagonal',
    title: 'Two links',
    contexts: [{ id: 'c1' }],
    hexagons: [
      { ...hexWithPorts('h1', 'c1', { q: 0, r: 0 }, [{ id: 'p-out', name: 'Repository', side: 'driven', wall: 'e' }]), adapters: [{ id: 'a1', name: 'Knex', portId: 'p-out' }] },
      { ...hexWithPorts('h2', 'c1', { q: 1, r: 0 }, [{ id: 'p-in', name: 'Submit', side: 'driving' }]), adapters: [{ id: 'a2', name: 'Http', portId: 'p-in' }] },
    ],
    links: [
      { id: 'link1', from: { hexagonId: 'h1', portId: 'p-out', adapterId: 'a1' }, to: { hexagonId: 'h2', portId: 'p-in' }, pattern: 'acl' },
      { id: 'link2', from: { hexagonId: 'h1', portId: 'p-out' }, to: { hexagonId: 'h2', portId: 'p-in' } },
    ],
  })

  describe('updateLink', () => {
    it('sets an adapter at an end, leaving the other end and the pattern untouched', () => {
      const map = twoLinksMap()
      const next = updateLink(map, 'link2', { to: { adapterId: 'a2' } })
      expect(next.links[1]).toEqual({ id: 'link2', from: { hexagonId: 'h1', portId: 'p-out' }, to: { hexagonId: 'h2', portId: 'p-in', adapterId: 'a2' } })
    })

    it('clears an adapter with null', () => {
      const map = twoLinksMap()
      const next = updateLink(map, 'link1', { from: { adapterId: null } })
      expect(next.links[0].from).toEqual({ hexagonId: 'h1', portId: 'p-out' })
    })

    it('leaves an end entirely unchanged when its patch key is absent', () => {
      const map = twoLinksMap()
      const next = updateLink(map, 'link1', { pattern: null })
      expect(next.links[0].from).toEqual(map.links[0].from)
      expect(next.links[0].to).toEqual(map.links[0].to)
    })

    it('sets the pattern tag', () => {
      const map = twoLinksMap()
      const next = updateLink(map, 'link2', { pattern: 'ohs-pl' })
      expect(next.links[1].pattern).toBe('ohs-pl')
    })

    it('clears the pattern tag with null', () => {
      const map = twoLinksMap()
      const next = updateLink(map, 'link1', { pattern: null })
      expect(next.links[0].pattern).toBeUndefined()
    })

    it('leaves the pattern unchanged when the patch omits it', () => {
      const map = twoLinksMap()
      const next = updateLink(map, 'link1', { from: { adapterId: null } })
      expect(next.links[0].pattern).toBe('acl')
    })

    it('never touches another link', () => {
      const map = twoLinksMap()
      const next = updateLink(map, 'link1', { pattern: null })
      expect(next.links[1]).toBe(map.links[1])
    })

    it('leaves an adapter untouched when the patch object is present but adapterId is absent', () => {
      const map = twoLinksMap()
      const next = updateLink(map, 'link1', { from: {} })
      expect(next.links[0].from.adapterId).toBe('a1')
    })

    it('updates a non-first link, leaving an earlier one untouched by reference', () => {
      const map = twoLinksMap()
      const next = updateLink(map, 'link2', { pattern: 'ohs-pl' })
      expect(next.links[0]).toBe(map.links[0])
      expect(next.links[1].pattern).toBe('ohs-pl')
    })

    it('never adds a pattern key on an adapter-only edit of a link that never had one', () => {
      const map = twoLinksMap()
      const next = updateLink(map, 'link2', { to: { adapterId: 'a2' } })
      expect('pattern' in next.links[1]).toBe(false)
      expect(next.links[1]).toStrictEqual({ id: 'link2', from: { hexagonId: 'h1', portId: 'p-out' }, to: { hexagonId: 'h2', portId: 'p-in', adapterId: 'a2' } })
    })

    it('removes the pattern key entirely when cleared with null, rather than setting it undefined', () => {
      const map = twoLinksMap()
      const next = updateLink(map, 'link1', { pattern: null })
      expect('pattern' in next.links[0]).toBe(false)
    })

    it('removes the adapterId key entirely when cleared with null, rather than setting it undefined', () => {
      const map = twoLinksMap()
      const next = updateLink(map, 'link1', { from: { adapterId: null } })
      expect('adapterId' in next.links[0].from).toBe(false)
    })
  })

  describe('removeLink', () => {
    it('removes the matching link and returns it', () => {
      const map = twoLinksMap()
      const result = removeLink(map, 'link1')
      expect(result).toBeDefined()
      expect(result!.removed).toEqual(map.links[0])
      expect(result!.map.links).toEqual([map.links[1]])
    })

    it('returns undefined for an unknown id, leaving the map untouched', () => {
      const map = twoLinksMap()
      const result = removeLink(map, 'nope')
      expect(result).toBeUndefined()
    })

    it('never touches another link', () => {
      const map = twoLinksMap()
      const { map: next } = removeLink(map, 'link1')!
      expect(next.links[0]).toBe(map.links[1])
    })

    it('removes a non-first link, leaving an earlier one untouched by reference', () => {
      const map = twoLinksMap()
      const result = removeLink(map, 'link2')
      expect(result!.removed).toEqual(map.links[1])
      expect(result!.map.links).toEqual([map.links[0]])
      expect(result!.map.links[0]).toBe(map.links[0])
    })
  })
})
