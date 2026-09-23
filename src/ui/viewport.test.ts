import { describe, expect, it } from 'vitest'
import { fitTo, MAX_SCALE, panBy, toDiagram, zoomAt } from './viewport'

describe('viewport', () => {
  const v = { x: -100, y: -50, scale: 2 }

  it('keeps the diagram point under the cursor fixed while zooming', () => {
    const cursor = { x: 300, y: 120 }
    const before = toDiagram(v, cursor)
    const after = toDiagram(zoomAt(v, 1.7, cursor), cursor)
    expect(after.x).toBeCloseTo(before.x, 9)
    expect(after.y).toBeCloseTo(before.y, 9)
  })

  it('clamps the zoom level', () => {
    expect(zoomAt(v, 1000, { x: 0, y: 0 }).scale).toBe(MAX_SCALE)
  })

  it('pans opposite to the drag in diagram units', () => {
    expect(panBy(v, 40, -20)).toEqual({ x: -120, y: -40, scale: 2 })
  })

  it('fits the bounds centred inside the stage', () => {
    const bounds = { x: -400, y: -300, width: 800, height: 600 }
    const fit = fitTo(bounds, 1000, 500)
    const topLeft = toDiagram(fit, { x: 0, y: 0 })
    const bottomRight = toDiagram(fit, { x: 1000, y: 500 })
    expect(topLeft.x).toBeLessThanOrEqual(bounds.x)
    expect(topLeft.y).toBeLessThanOrEqual(bounds.y)
    expect(bottomRight.x).toBeGreaterThanOrEqual(bounds.x + bounds.width)
    expect(bottomRight.y).toBeGreaterThanOrEqual(bounds.y + bounds.height)
    expect((topLeft.x + bottomRight.x) / 2).toBeCloseTo(0, 9)
    expect((topLeft.y + bottomRight.y) / 2).toBeCloseTo(0, 9)
  })

  it('fits inside the area left free by floating panels', () => {
    const bounds = { x: 0, y: 0, width: 400, height: 400 }
    const inset = { top: 60, right: 0, bottom: 0, left: 320 }
    const fit = fitTo(bounds, 1000, 800, inset)
    const topLeft = toDiagram(fit, { x: inset.left, y: inset.top })
    const bottomRight = toDiagram(fit, { x: 1000, y: 800 })
    expect(topLeft.x).toBeLessThanOrEqual(0)
    expect(topLeft.y).toBeLessThanOrEqual(0)
    expect(bottomRight.x).toBeGreaterThanOrEqual(400)
    expect(bottomRight.y).toBeGreaterThanOrEqual(400)
    expect((topLeft.x + bottomRight.x) / 2).toBeCloseTo(200, 9)
  })
})
