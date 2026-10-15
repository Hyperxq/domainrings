import { describe, expect, it } from 'vitest'
import { dot } from '../geometry'
import { COS30 } from '../outline'
import { CYCLE, onWall, travel } from './corridors'
import { wallFrame } from './walls'

const apothemOf = (p: { x: number; y: number }) => Math.max(...CYCLE.map((w) => dot(p, wallFrame(w).n)))

describe('travel', () => {
  it('runs straight along one wall', () => {
    expect(travel('e', -20, 'e', 30, 100)).toEqual([onWall('e', 100, -20), onWall('e', 100, 30)])
  })

  it('goes round the hexagon, every point on the track', () => {
    const run = travel('e', 10, 'sw', -5, 100)
    expect(run).toHaveLength(4)
    for (const p of run) expect(apothemOf(p)).toBeCloseTo(100, 6)
  })

  it('turns at the vertex of the hexagon of its own apothem', () => {
    const [, corner] = travel('e', 0, 'se', 0, 100)
    expect(Math.hypot(corner.x, corner.y)).toBeCloseTo(100 / COS30, 6)
  })

  it('takes the shorter way round', () => {
    expect(travel('ne', 40, 'e', 10, 100)).toHaveLength(3)
    expect(travel('e', 10, 'ne', 40, 100)).toHaveLength(3)
  })

  it('prefers the way clear of the top vertex when both are as long', () => {
    expect(travel('w', 0, 'e', 0, 100).every((p) => p.y >= -1e-6)).toBe(true)
    expect(travel('e', 0, 'w', 0, 100).every((p) => p.y >= -1e-6)).toBe(true)
  })
})
