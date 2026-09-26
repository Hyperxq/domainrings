import { describe, expect, it } from 'vitest'
import { countCrossings, type CrossingEdge } from './crossings'

const edge = (fromRef: string, toRef: string, from: { x: number; y: number }, to: { x: number; y: number }): CrossingEdge => ({ fromRef, toRef, from, to })

describe('countCrossings', () => {
  it('counts one crossing for two chords that visibly cross (an X)', () => {
    const edges = [edge('a', 'b', { x: -10, y: 0 }, { x: 10, y: 0 }), edge('c', 'd', { x: 0, y: -10 }, { x: 0, y: 10 })]
    expect(countCrossings(edges)).toBe(1)
  })

  it('counts zero crossings for two parallel, non-intersecting chords', () => {
    const edges = [edge('a', 'b', { x: -10, y: 0 }, { x: 10, y: 0 }), edge('c', 'd', { x: -10, y: 5 }, { x: 10, y: 5 })]
    expect(countCrossings(edges)).toBe(0)
  })

  it('never counts two edges that share an endpoint ref, even if their chords would otherwise meet', () => {
    const edges = [edge('a', 'b', { x: -10, y: 0 }, { x: 0, y: 0 }), edge('b', 'c', { x: 0, y: 0 }, { x: 10, y: 0 })]
    expect(countCrossings(edges)).toBe(0)
  })

  it('counts every crossing pair among 3 mutually crossing chords', () => {
    const edges = [
      edge('a', 'b', { x: -10, y: -1 }, { x: 10, y: 1 }),
      edge('c', 'd', { x: -10, y: 1 }, { x: 10, y: -1 }),
      edge('e', 'f', { x: 0, y: -10 }, { x: 0, y: 10 }),
    ]
    expect(countCrossings(edges)).toBe(3)
  })
})
