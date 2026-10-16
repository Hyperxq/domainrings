import { describe, expect, it } from 'vitest'
import { footprint } from './contextChips'
import type { MapHexagonLayout } from './map'

describe('footprint', () => {
  it('falls back to the hexagon box when the layout has no rings', () => {
    const model = { rings: [], bounds: { x: -50, y: -40, width: 100, height: 80 } } as unknown as MapHexagonLayout['model']
    const corners = footprint({ id: 'h', contextId: 'c', cell: { q: 0, r: 0 }, centre: { x: 10, y: 20 }, model })
    expect(corners).toHaveLength(4)
    expect(corners.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
    expect(Math.min(...corners.map((p) => p.x))).toBeLessThan(-40 + 10)
    expect(Math.max(...corners.map((p) => p.y))).toBeGreaterThan(60 + 20 - 1)
  })
})
