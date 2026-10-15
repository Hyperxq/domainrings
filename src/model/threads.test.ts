import { describe, expect, it } from 'vitest'
import { EXAMPLES } from './example'
import { toMap } from './hexa'
import { DiagramSchema, type Diagram, type HexaMap } from './schema'
import { distinctSlots, THREAD_SLOTS, threadColour } from './threadPalette'
import { threadSlots, threadsOf } from './threads'

const diagram = (fields: Partial<Diagram>): Diagram => ({ version: 1, kind: 'hexagonal', title: 't', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [], ...fields })
/** n use cases, each with a driving port on `walls[i]`. */
const onWalls = (walls: (string | undefined)[]): Diagram =>
  diagram({
    useCases: walls.map((_, i) => ({ id: `u${i}`, name: `U${i}` })),
    ports: walls.map((wall, i) => ({ id: `p${i}`, name: `p${i}`, side: 'driving' as const, useCaseId: `u${i}`, ...(wall ? { wall: wall as 'w' } : {}) })),
  })
/** `d` with every use case's effective slot written down. */
const withThreadSlots = (d: Diagram): Diagram => ({ ...d, useCases: d.useCases.map((u) => ({ ...u, colour: threadSlots(d).get(u.id)! })) })
const slotsOf = (d: Diagram) => [...threadSlots(d).values()]

describe('threadColour', () => {
  it('has 50 slots with a hex colour per mode, differing between modes', () => {
    expect(THREAD_SLOTS).toBe(50)
    for (let slot = 0; slot < THREAD_SLOTS; slot++) {
      expect(threadColour(slot, 'light')).toMatch(/^#[0-9a-f]{6}$/)
      expect(threadColour(slot, 'dark')).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect(threadColour(0, 'light')).not.toBe(threadColour(0, 'dark'))
  })

  it('keeps every run of 4 consecutive slots pairwise distinct', () => {
    for (let slot = 0; slot + 3 < THREAD_SLOTS; slot++) {
      for (let a = slot; a < slot + 4; a++) for (let b = a + 1; b < slot + 4; b++) expect(distinctSlots(a, b)).toBe(true)
    }
  })

  it('never calls a slot distinct from itself', () => {
    expect(distinctSlots(7, 7)).toBe(false)
  })
})

describe('threadSlots', () => {
  it('keeps every persisted slot, even when it clashes with a neighbour', () => {
    const d = onWalls(['w', 'w'])
    d.useCases[0].colour = 5
    d.useCases[1].colour = 5
    expect([...threadSlots(d).entries()]).toEqual([['u0', 5], ['u1', 5]])
  })

  it('fills a missing slot in use case order with the lowest slot', () => {
    expect(slotsOf(onWalls(['w', 'e', 'nw']))).toEqual([0, 0, 0])
  })

  it('gives up to 4 use cases that share a wall pairwise distinct colours', () => {
    const slots = slotsOf(onWalls(['w', 'w', 'w', 'w']))
    for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) expect(distinctSlots(slots[i], slots[j])).toBe(true)
  })

  it('still tells 6 use cases on one wall apart by slot when no 6 colours are all distinct', () => {
    expect(new Set(slotsOf(onWalls(['w', 'w', 'w', 'w', 'w', 'w']))).size).toBe(6)
  })

  it('treats a port with no wall as sitting on its side default wall', () => {
    const slots = slotsOf(onWalls([undefined, 'w']))
    expect(distinctSlots(slots[0], slots[1])).toBe(true)
  })

  it('treats a seat placement as a wall the use case occupies', () => {
    const d = onWalls(['w', 'e'])
    d.useCases[1].placement = 'w'
    const slots = slotsOf(d)
    expect(distinctSlots(slots[0], slots[1])).toBe(true)
  })

  it('treats a shared aggregate as a conflict', () => {
    const d = onWalls(['w', 'e'])
    d.domain = [{ id: 'agg', name: 'Order', type: 'aggregate' }]
    d.useCases.forEach((u) => (u.aggregateIds = ['agg']))
    const slots = slotsOf(d)
    expect(distinctSlots(slots[0], slots[1])).toBe(true)
  })

  it('is deterministic', () => {
    const d = onWalls(['w', 'w', 'e', 'w'])
    expect(threadSlots(d)).toEqual(threadSlots(structuredClone(d)))
  })

  it('never repaints a persisted slot when a use case is added or removed', () => {
    const d = withThreadSlots(onWalls(['w', 'w', 'w']))
    const before = threadSlots(d)
    const added = { ...d, useCases: [{ id: 'u9', name: 'U9' }, ...d.useCases], ports: [...d.ports, { id: 'p9', name: 'p9', side: 'driving' as const, useCaseId: 'u9', wall: 'w' as const }] }
    const after = threadSlots(added)
    for (const [id, slot] of before) expect(after.get(id)).toBe(slot)
    const removed = { ...d, useCases: d.useCases.slice(1) }
    for (const u of removed.useCases) expect(threadSlots(removed).get(u.id)).toBe(before.get(u.id))
    expect(distinctSlots(after.get('u9')!, before.get('u0')!)).toBe(true)
  })
})

describe('colour in the schema', () => {
  const parse = (colour: unknown) => DiagramSchema.safeParse(diagram({ useCases: [{ id: 'u', name: 'U', colour } as never] }))
  it('accepts integers 0 to 49', () => {
    expect(parse(0).success).toBe(true)
    expect(parse(49).success).toBe(true)
  })
  it.each([50, -1, 1.5, '3'])('rejects %s', (colour) => {
    expect(parse(colour).success).toBe(false)
  })
  it('is optional', () => {
    expect(DiagramSchema.safeParse(diagram({ useCases: [{ id: 'u', name: 'U' }] })).success).toBe(true)
  })
})

describe('threadsOf', () => {
  const map = EXAMPLES.find((e) => e.id === 'hexagonal-basic')!.map as HexaMap
  it('lists one thread per use case with the refs of its flow inside the hexagon', () => {
    const [h] = map.hexagons
    const threads = threadsOf(map, h.id)
    expect(threads.map((t) => t.useCaseId)).toEqual(h.useCases.map((u) => u.id))
    const submit = threads.find((t) => t.useCaseId === 'uc-submit')!
    expect(submit.refs.has('uc-submit')).toBe(true)
    expect(submit.refs.has(h.ports.find((p) => p.useCaseId === 'uc-submit')!.id)).toBe(true)
    expect(Number.isInteger(submit.slot)).toBe(true)
  })

  it('leaves out the steps in other hexagons', () => {
    const adv = EXAMPLES.find((e) => e.id === 'hexagonal-advanced')!.map as HexaMap
    const place = threadsOf(adv, 'h1').find((t) => t.useCaseId === 'uc-place')!
    expect(place.refs.has('p-charge-in')).toBe(false)
  })

  it('reads a diagram without links the same way', () => {
    const d = onWalls(['w'])
    expect(threadsOf(toMap(d), 'h1')[0].refs).toEqual(new Set(['u0', 'p0']))
  })
})
