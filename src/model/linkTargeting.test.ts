import { describe, expect, it } from 'vitest'
import { canLink, isCrossTarget, targetsByHexagon } from './linkTargeting'
import { diagramOf } from './map'
import { VERSION, type HexaMap } from './schema'

type Hexagon = HexaMap['hexagons'][number]
type Cell = Hexagon['cell']

const hexagon = (id: string, cell: Cell, patch: Partial<Hexagon> = {}): Hexagon => ({
  id,
  contextId: 'c1',
  cell,
  title: id,
  domain: [],
  useCases: [],
  ports: [],
  adapters: [],
  actors: [],
  externals: [],
  ...patch,
})

const mapOf = (...hexagons: Hexagon[]): HexaMap => ({ version: VERSION, kind: 'hexagonal', title: 'Map', contexts: [{ id: 'c1' }], hexagons, links: [] })

describe('canLink', () => {
  it('is true for a port when another use case in its own hexagon can own it', () => {
    const map = mapOf(hexagon('h1', { q: 0, r: 0 }, { useCases: [{ id: 'uc', name: 'Place' }], ports: [{ id: 'p', name: 'Api', side: 'driving' }] }))
    expect(canLink(map, diagramOf(map, 'h1'), 'h1', 'p')).toBe(true)
  })

  it('is true for a port with no same-hexagon target when another hexagon holds a port of the opposite side', () => {
    const map = mapOf(
      hexagon('h1', { q: 0, r: 0 }, { ports: [{ id: 'p', name: 'Out', side: 'driven' }] }),
      hexagon('h2', { q: 1, r: 0 }, { ports: [{ id: 'q', name: 'In', side: 'driving' }] }),
    )
    expect(canLink(map, diagramOf(map, 'h1'), 'h1', 'p')).toBe(true)
  })

  it('is false when the only other-hexagon ports share the ref’s side', () => {
    const map = mapOf(
      hexagon('h1', { q: 0, r: 0 }, { ports: [{ id: 'p', name: 'Out', side: 'driven' }] }),
      hexagon('h2', { q: 1, r: 0 }, { ports: [{ id: 'q', name: 'Out', side: 'driven' }] }),
    )
    expect(canLink(map, diagramOf(map, 'h1'), 'h1', 'p')).toBe(false)
  })

  it('never counts the hexagon’s own opposite-side ports as cross-hexagon targets', () => {
    const map = mapOf(hexagon('h1', { q: 0, r: 0 }, { ports: [{ id: 'p', name: 'Out', side: 'driven' }, { id: 'q', name: 'In', side: 'driving' }] }))
    expect(canLink(map, diagramOf(map, 'h1'), 'h1', 'p')).toBe(false)
  })

  it('is false for a ref that is not a port and has no same-hexagon target, even when other hexagons have ports', () => {
    const map = mapOf(
      hexagon('h1', { q: 0, r: 0 }, { domain: [{ id: 'agg', name: 'Order', type: 'aggregate' }] }),
      hexagon('h2', { q: 1, r: 0 }, { ports: [{ id: 'q', name: 'In', side: 'driving' }] }),
    )
    expect(canLink(map, diagramOf(map, 'h1'), 'h1', 'agg')).toBe(false)
    expect(canLink(map, diagramOf(map, 'h1'), 'h1', 'missing')).toBe(false)
  })
})

describe('targetsByHexagon', () => {
  it('is empty without targets', () => {
    expect(targetsByHexagon([])).toEqual(new Map())
  })

  it('groups port ids under the hexagon that owns them, keeping a colliding id separate per hexagon', () => {
    const ref = (hexagonId: string, portId: string) => ({ hexagonId, hexagonTitle: hexagonId, portId, portName: portId })
    expect(targetsByHexagon([ref('h2', 'p'), ref('h3', 'p'), ref('h2', 'q')])).toEqual(
      new Map([
        ['h2', new Set(['p', 'q'])],
        ['h3', new Set(['p'])],
      ]),
    )
  })

  it('collapses a repeated target', () => {
    const t = { hexagonId: 'h2', hexagonTitle: 'h2', portId: 'p', portName: 'p' }
    expect(targetsByHexagon([t, t]).get('h2')).toEqual(new Set(['p']))
  })
})

describe('isCrossTarget', () => {
  const targets = [{ hexagonId: 'h2', hexagonTitle: 'h2', portId: 'p', portName: 'p' }]

  it('is true for a listed port clicked inside another hexagon', () => {
    expect(isCrossTarget(targets, 'h1', 'h2', 'p')).toBe(true)
  })

  it('is false without a clicked ref or hexagon', () => {
    expect(isCrossTarget(targets, 'h1', 'h2', null)).toBe(false)
    expect(isCrossTarget(targets, 'h1', null, 'p')).toBe(false)
    expect(isCrossTarget(targets, 'h1', undefined, 'p')).toBe(false)
  })

  it('treats an empty ref or hexagon id as no click, even against a target with an empty id', () => {
    const blank = [
      { hexagonId: 'h2', hexagonTitle: 'h2', portId: '', portName: '' },
      { hexagonId: '', hexagonTitle: '', portId: 'p', portName: 'p' },
    ]
    expect(isCrossTarget(blank, 'h1', 'h2', '')).toBe(false)
    expect(isCrossTarget(blank, 'h1', '', 'p')).toBe(false)
  })

  it('is false inside the current hexagon, even for a listed id', () => {
    expect(isCrossTarget([{ ...targets[0], hexagonId: 'h1' }], 'h1', 'h1', 'p')).toBe(false)
  })

  it('is false for a decoy port that shares the target’s id on a different hexagon', () => {
    expect(isCrossTarget(targets, 'h1', 'h3', 'p')).toBe(false)
  })

  it('is false for an unlisted port of the target’s hexagon', () => {
    expect(isCrossTarget(targets, 'h1', 'h2', 'other')).toBe(false)
  })
})
