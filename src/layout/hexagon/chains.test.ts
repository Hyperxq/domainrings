import { describe, expect, it } from 'vitest'
import type { Adapter, Diagram, Endpoint, Port, Side, Wall } from '../../model/schema'
import { reach } from '../geometry'
import { planChains, type ChainFrames, type ChainSlot } from './chains'
import { wallFrame } from './walls'

const box = (width: number, height: number) => ({ lines: [], width, height })
const frames: ChainFrames = { port: () => box(100, 40), adapter: () => box(120, 50), leaf: () => box(80, 30) }
const empty: Diagram = { version: 1, kind: 'hexagonal', title: '', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] }
const port = (id: string, side: Side, wall?: Wall): Port => ({ id, name: id, side, ...(wall ? { wall } : {}) })
const adapter = (id: string, portId?: string): Adapter => ({ id, name: id, ...(portId ? { portId } : {}) })
const endpoint = (id: string, adapterId?: string): Endpoint => ({ id, name: id, ...(adapterId ? { adapterId } : {}) })
const slots = (d: Partial<Diagram>) => new Map(planChains({ ...empty, ...d }, frames).map((s) => [s.key, s]))
const along = (s: ChainSlot, f = frames) => {
  const { dir } = wallFrame(s.wall)
  const b = s.kind === 'port' ? f.port({} as Port) : s.kind === 'adapter' ? f.adapter({} as Adapter, s.side) : f.leaf({} as Endpoint, s.side)
  return reach(b.width, b.height, dir)
}

describe('planChains', () => {
  const chain: Partial<Diagram> = {
    ports: [port('p', 'driven', 'se')],
    adapters: [adapter('a', 'p')],
    externals: [endpoint('x', 'a')],
  }

  it('puts a port on its own wall, or its side default', () => {
    const s = slots({ ports: [port('a', 'driving'), port('b', 'driven'), port('c', 'driven', 'ne')] })
    expect([s.get('port:a')!.wall, s.get('port:b')!.wall, s.get('port:c')!.wall]).toEqual(['w', 'e', 'ne'])
  })

  it('lines its adapter and external up radially with the port', () => {
    const s = slots(chain)
    for (const key of ['adapter:a', 'external:x']) {
      expect(s.get(key)!.wall).toBe('se')
      expect(s.get(key)!.u).toBeCloseTo(s.get('port:p')!.u, 6)
    }
  })

  it('does the same for a driving chain with an actor', () => {
    const s = slots({ ports: [port('p', 'driving', 'nw')], adapters: [adapter('a', 'p')], actors: [endpoint('x', 'a')] })
    expect([s.get('adapter:a')!.wall, s.get('actor:x')!.wall]).toEqual(['nw', 'nw'])
    expect(s.get('actor:x')!.u).toBeCloseTo(s.get('port:p')!.u, 6)
  })

  it('spreads several adapters symmetrically around their port', () => {
    const s = slots({ ports: [port('p', 'driven', 'e')], adapters: [adapter('a', 'p'), adapter('b', 'p'), adapter('c', 'p')], externals: [endpoint('x', 'a'), endpoint('y', 'b'), endpoint('z', 'c')] })
    const us = ['a', 'b', 'c'].map((id) => s.get(`adapter:${id}`)!.u)
    expect(us[1]).toBeCloseTo(s.get('port:p')!.u, 6)
    expect(us[0] + us[2]).toBeCloseTo(2 * us[1], 6)
    expect(us[0]).toBeLessThan(us[1])
    for (const id of ['x', 'y', 'z']) expect(s.get(`external:${id}`)!.u).toBeCloseTo(s.get(`adapter:${id === 'x' ? 'a' : id === 'y' ? 'b' : 'c'}`)!.u, 6)
  })

  it('centres the chains of a wall, in model order, without overlap', () => {
    const s = slots({ ports: [port('a', 'driven', 'e'), port('b', 'driven', 'e'), port('c', 'driven', 'e')], adapters: [adapter('x', 'a'), adapter('y', 'b'), adapter('z', 'c')] })
    const us = ['a', 'b', 'c'].map((id) => s.get(`port:${id}`)!.u)
    expect(us[0]).toBeLessThan(us[1])
    expect(us[1]).toBeLessThan(us[2])
    expect(us[0] + us[2]).toBeCloseTo(0, 6)
    const widest = (id: string) => Math.max(along(s.get(`port:${id}`)!), along(s.get(`adapter:${id === 'a' ? 'x' : id === 'b' ? 'y' : 'z'}`)!))
    expect(us[1] - us[0]).toBeGreaterThanOrEqual(widest('a') + widest('b'))
  })

  it('keeps the boxes of one layer apart along a wall', () => {
    const s = slots({
      ports: [port('a', 'driven', 'e'), port('b', 'driven', 'e')],
      adapters: [adapter('x', 'a'), adapter('y', 'a'), adapter('z', 'b')],
      externals: [endpoint('e1', 'x'), endpoint('e2', 'x'), endpoint('e3', 'z')],
    })
    for (const kind of ['port', 'adapter', 'external'] as const) {
      const row = [...s.values()].filter((x) => x.kind === kind).sort((p, q) => p.u - q.u)
      row.slice(1).forEach((x, i) => expect(x.u - row[i].u).toBeGreaterThanOrEqual(along(x) + along(row[i])))
    }
  })

  it('sends a chain-less adapter to the least crowded wall of its side', () => {
    const s = slots({ ports: [port('p', 'driven', 'ne'), port('q', 'driven', 'e')], adapters: [adapter('lonely')], externals: [endpoint('x', 'lonely')] })
    expect(s.get('adapter:lonely')!.wall).toBe('se')
    expect(s.get('external:x')!.wall).toBe('se')
  })

  it('breaks a tie between walls by wall order, and puts a loose actor on the driving half', () => {
    const s = slots({ actors: [endpoint('loose')], externals: [endpoint('stray')] })
    expect([s.get('actor:loose')!.wall, s.get('external:stray')!.wall]).toEqual(['nw', 'ne'])
  })

  it('is deterministic', () => {
    expect(planChains({ ...empty, ...chain }, frames)).toEqual(planChains({ ...empty, ...chain }, frames))
  })
})
