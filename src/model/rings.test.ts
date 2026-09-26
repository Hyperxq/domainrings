import { describe, expect, it } from 'vitest'
import { isInwardOrSame, ringCircumferencePositions } from './rings'

const RINGS = [{ role: 'domain' }, { role: 'domainServices' }, { role: 'application' }, { role: 'outer' }]

describe('isInwardOrSame', () => {
  // Exhaustive 4x4: accepted iff toRole's index <= fromRole's index (same ring or a more inward one).
  for (const from of RINGS) {
    for (const to of RINGS) {
      const fromIndex = RINGS.indexOf(from)
      const toIndex = RINGS.indexOf(to)
      const expected = toIndex <= fromIndex
      it(`${from.role} → ${to.role} is ${expected ? 'accepted' : 'rejected'}`, () => {
        expect(isInwardOrSame(RINGS, from.role, to.role)).toBe(expected)
      })
    }
  }
})

describe('ringCircumferencePositions', () => {
  it('returns 0 positions for 0 elements', () => {
    expect(ringCircumferencePositions(0, { halfWidth: 100 })).toEqual([])
  })

  it('returns N distinct positions, all at the ring radius, for N elements', () => {
    const positions = ringCircumferencePositions(5, { halfWidth: 100 })
    expect(positions).toHaveLength(5)
    for (const p of positions) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(100, 6)
    }
    const uniqueXY = new Set(positions.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`))
    expect(uniqueXY.size).toBe(5)
  })

  it('spreads elements evenly around the circle (equal angular gaps)', () => {
    const positions = ringCircumferencePositions(4, { halfWidth: 50 })
    const angles = positions.map((p) => Math.atan2(p.y, p.x)).sort((a, b) => a - b)
    const gaps = angles.map((a, i) => (i === 0 ? a - angles[angles.length - 1] + 2 * Math.PI : a - angles[i - 1]))
    for (const gap of gaps) expect(gap).toBeCloseTo((2 * Math.PI) / 4, 6)
  })

  it('never places an element directly under the ring title (top, angle -90°)', () => {
    for (const count of [1, 2, 3, 6]) {
      const positions = ringCircumferencePositions(count, { halfWidth: 80 })
      for (const p of positions) expect(Math.hypot(p.x - 0, p.y - -80)).toBeGreaterThan(0.01)
    }
  })
})
