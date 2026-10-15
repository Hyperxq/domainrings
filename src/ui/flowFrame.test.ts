import { describe, expect, it } from 'vitest'
import { TWO_SLICES_MAP } from '../model/example'
import type { HexaMap } from '../model/schema'
import { unionBox } from '../layout/geometry'
import { hexagonBounds } from '../layout/lattice'
import { layoutMap } from '../layout/map'
import { flowFrame } from './flowFrame'

// Orders (h1) PlaceOrder calls Shipping (h2) through link-order-placed; Billing (h3) is a bystander linked to Shipping.
const [orders, shipping] = TWO_SLICES_MAP.hexagons
const billing = { ...shipping, id: 'h3', title: 'Billing', cell: { q: 0, r: 1 }, useCases: [{ id: 'uc-bill', name: 'Bill' }], ports: [{ id: 'p-bill', name: 'Bill', side: 'driving' as const, useCaseId: 'uc-bill' }], adapters: [] }
const map: HexaMap = {
  ...TWO_SLICES_MAP,
  hexagons: [{ ...orders, ports: orders.ports.map((p) => ({ ...p, useCaseId: 'uc-place' })) }, shipping, billing],
  links: [
    ...TWO_SLICES_MAP.links,
    { id: 'link-other', from: { hexagonId: 'h2', portId: 'p-receive-order' }, to: { hexagonId: 'h3', portId: 'p-bill' } },
  ],
}
const layout = layoutMap(map, { mode: 'detailed', current: 'h1', expanded: new Set() })
const frame = (useCaseId: string, guides = false, owner = 'h1') => flowFrame(map, owner, useCaseId, layout.hexagons, guides)

describe('flowFrame', () => {
  it('holds exactly the hexagons the flow touches and the links between them', () => {
    const framed = frame('uc-place')!
    expect([...framed.only].sort()).toEqual(['h1', 'h2'])
    expect([...framed.links]).toEqual(['link-order-placed'])
  })

  it('frames the union of those hexagons, not the whole map', () => {
    const { bounds } = frame('uc-place')!
    const own = layout.hexagons.filter((h) => h.id !== 'h3').map(hexagonBounds)
    expect(bounds).toEqual(unionBox(own))
    expect(bounds.width * bounds.height).toBeLessThan(layout.bounds.width * layout.bounds.height)
  })

  it('frames just the one hexagon of a flow that stays inside it', () => {
    const framed = flowFrame({ ...map, links: TWO_SLICES_MAP.links }, 'h3', 'uc-bill', layout.hexagons, false)!
    expect([...framed.only]).toEqual(['h3'])
    expect(framed.links.size).toBe(0)
  })

  it('grows the frame to hold the corridor guides when they are shown', () => {
    const plain = frame('uc-place')!.bounds
    const guided = frame('uc-place', true)!.bounds
    expect(guided.width * guided.height).toBeGreaterThanOrEqual(plain.width * plain.height)
  })

  it('has no frame for an unknown flow', () => {
    expect(frame('uc-nope')).toBeUndefined()
  })
})
