import { describe, expect, it } from 'vitest'
import { EXAMPLE_DIAGRAM, STRESS_DIAGRAM } from '../model/example'
import type { Diagram, Port, UseCase, Wall } from '../model/schema'
import { layoutDiagram, type LayoutModel, type LayoutNode } from './layout'

const base: Diagram = { version: 1, kind: 'hexagonal', title: '', domain: [{ id: 'd1', name: 'Order', type: 'entity' }], useCases: [], ports: [], adapters: [], actors: [], externals: [] }
const port = (id: string, useCaseId: string, side: Port['side'], wall?: Wall): Port => ({ id, name: `op${id}`, side, useCaseId, ...(wall ? { wall } : {}) })
const useCase = (id: string, placement?: UseCase['placement']): UseCase => ({ id, name: `Handle${id}`, ...(placement ? { placement } : {}) })
const wallsOf = (d: Diagram, mode: 'detailed' | 'overview' = 'detailed') =>
  Object.fromEntries(layoutDiagram(d, { mode }).nodes.filter((n) => n.kind === 'useCase').map((n) => [n.ref, n.wall]))

describe('seating every use case on a domain wall', () => {
  describe.each([
    ['example', EXAMPLE_DIAGRAM],
    ['stress', STRESS_DIAGRAM],
  ])('%s', (_, diagram) => {
    it.each(['detailed', 'overview'] as const)('stacks no use case under the title (%s)', (mode) => {
      const m = layoutDiagram(diagram, { mode })
      const nodes = m.nodes.filter((n) => n.kind === 'useCase')
      expect(nodes).toHaveLength(diagram.useCases.length)
      expect(nodes.filter((n) => !n.wall).map((n) => n.ref)).toEqual([])
    })
  })

  describe('wall derived from the ports', () => {
    it('takes the wall holding most of its ports', () => {
      const d = { ...base, useCases: [useCase('u1')], ports: [port('a', 'u1', 'driven', 'ne'), port('b', 'u1', 'driven', 'ne'), port('c', 'u1', 'driving', 'w')] }
      expect(wallsOf(d)).toEqual({ u1: 'ne' })
    })

    it('counts a port without a wall on its side default', () => {
      const d = { ...base, useCases: [useCase('u1')], ports: [port('a', 'u1', 'driven'), port('b', 'u1', 'driven'), port('c', 'u1', 'driving', 'nw')] }
      expect(wallsOf(d)).toEqual({ u1: 'e' })
    })

    it('breaks a tie toward the wall of its driving port', () => {
      const d = { ...base, useCases: [useCase('u1')], ports: [port('a', 'u1', 'driven', 'e'), port('b', 'u1', 'driving', 'sw')] }
      expect(wallsOf(d)).toEqual({ u1: 'sw' })
    })

    it('breaks a tie between driving ports by wall order', () => {
      const d = { ...base, useCases: [useCase('u1')], ports: [port('a', 'u1', 'driving', 'sw'), port('b', 'u1', 'driving', 'nw'), port('c', 'u1', 'driven', 'e')] }
      expect(wallsOf(d)).toEqual({ u1: 'nw' })
    })

    it('breaks a tie with no driving port by wall order', () => {
      const d = { ...base, useCases: [useCase('u1')], ports: [port('a', 'u1', 'driven', 'se'), port('b', 'u1', 'driven', 'e')] }
      expect(wallsOf(d)).toEqual({ u1: 'e' })
    })

    it('treats top like an unplaced use case', () => {
      const d = { ...base, useCases: [useCase('u1', 'top')], ports: [port('a', 'u1', 'driven', 'se')] }
      expect(wallsOf(d)).toEqual({ u1: 'se' })
    })

    it('lets an explicit wall win over its ports', () => {
      const d = { ...base, useCases: [useCase('u1', 'sw')], ports: [port('a', 'u1', 'driven', 'ne'), port('b', 'u1', 'driven', 'ne')] }
      expect(wallsOf(d)).toEqual({ u1: 'sw' })
    })
  })

  describe('without ports', () => {
    it('goes to the least occupied wall, counting the use cases already seated', () => {
      const d = { ...base, useCases: [useCase('u0', 'nw'), useCase('u1'), useCase('u2'), useCase('u3')] }
      expect(wallsOf(d)).toEqual({ u0: 'nw', u1: 'w', u2: 'sw', u3: 'ne' })
    })

    it('fills every wall before doubling up', () => {
      const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
      const walls = wallsOf({ ...base, useCases: ids.map((id) => useCase(id)) })
      expect(ids.map((id) => walls[id])).toEqual(['nw', 'w', 'sw', 'ne', 'e', 'se', 'nw'])
    })
  })

  describe('several use cases on one wall', () => {
    const apart = (a: LayoutNode, b: LayoutNode) =>
      Math.abs(a.x - b.x) >= (a.width + b.width) / 2 || Math.abs(a.y - b.y) >= (a.height + b.height) / 2
    const crowded: Diagram = {
      ...base,
      useCases: ['PlaceTheOrderAndReserveStock', 'CancelAnOrderAfterShipment', 'RefundTheCustomerInFull'].map((name, i) => ({ id: `u${i}`, name })),
      ports: [0, 1, 2].map((i) => port(`p${i}`, `u${i}`, 'driving', 'nw')),
    }

    it.each(['detailed', 'overview'] as const)('packs them along the wall without overlap (%s)', (mode) => {
      const m: LayoutModel = layoutDiagram(crowded, { mode })
      const boxes = m.nodes.filter((n) => n.kind === 'useCase')
      expect(boxes.map((b) => b.wall)).toEqual(['nw', 'nw', 'nw'])
      for (const [i, a] of boxes.entries()) for (const b of boxes.slice(i + 1)) expect(apart(a, b), `${a.ref} / ${b.ref}`).toBe(true)
    })

    it.each(['detailed', 'overview'] as const)('keeps them clear of every port, port name and ring title (%s)', (mode) => {
      const m = layoutDiagram(crowded, { mode })
      const others = [...m.nodes.filter((n) => n.kind !== 'useCase' && n.kind !== 'actor' && n.kind !== 'external'), ...m.rings.map((r) => ({ ...r.titleBox, x: r.titleBox.x + r.titleBox.width / 2, y: r.titleBox.y + r.titleBox.height / 2 }))]
      for (const u of m.nodes.filter((n) => n.kind === 'useCase')) for (const o of others) expect(apart(u, o as LayoutNode), `${u.ref} / ${(o as LayoutNode).key ?? 'title'}`).toBe(true)
    })
  })
})
