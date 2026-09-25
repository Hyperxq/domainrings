import { describe, expect, it } from 'vitest'
import { contains, EDITOR_CHIP_BOTTOM, fitMap, fitTo, islandInset, LEGEND_ISLAND_WIDTH, MAX_SCALE, MIN_FIT_SCALE, MIN_SCALE, panBy, pinch, toDiagram, visibleRect, zoomAt } from './viewport'
import { currentHexagon, hexagonBounds, layoutMap } from '../layout/map'
import { TWO_SLICES_MAP } from '../model/example'
import type { Point } from '../layout/layout'

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

  it('reserves the open legend island’s column on the right, and gives it back when the legend closes', () => {
    const size = { width: 1440, height: 900 }
    const closed = islandInset(size, true, false)
    const open = islandInset(size, true, true)
    expect(open.right).toBe(LEGEND_ISLAND_WIDTH + 24)
    expect(closed.right).toBe(16)
    const bounds = { x: -500, y: -500, width: 1000, height: 1000 }
    const fit = fitTo(bounds, size.width, size.height, open)
    expect(toDiagram(fit, { x: size.width - open.right, y: 0 }).x).toBeGreaterThanOrEqual(bounds.x + bounds.width - 1e-9)
    expect(fitTo(bounds, size.width, size.height, closed)).not.toEqual(fit)
  })

  it('keeps the fit below the collapsed editor chip, so it never covers the diagram title', () => {
    const size = { width: 1440, height: 900 }
    const inset = islandInset(size, false, false)
    expect(inset.top).toBeGreaterThanOrEqual(EDITOR_CHIP_BOTTOM)
    const bounds = { x: -700, y: -300, width: 1400, height: 600 }
    const fit = fitTo(bounds, size.width, size.height, inset)
    expect(toDiagram(fit, { x: 0, y: EDITOR_CHIP_BOTTOM }).y).toBeLessThanOrEqual(bounds.y + 1e-9)
  })

  it('reserves extra top room on a phone, where the toolbar wraps into two rows (TOOLBAR-PHONE-01)', () => {
    const tablet = islandInset({ width: 700, height: 800 }, false, false)
    const phone = islandInset({ width: 390, height: 844 }, false, false)
    expect(phone.top).toBeGreaterThan(tablet.top)
    expect(phone.right).toBe(tablet.right)
    expect(phone.left).toBe(tablet.left)
  })

  it('fits the whole map when it fits at a usable scale (CANVAS-04.1)', () => {
    const mapBounds = { x: -400, y: -300, width: 800, height: 600 }
    const currentBounds = { x: -400, y: -300, width: 200, height: 200 }
    expect(fitMap(mapBounds, currentBounds, 1000, 800)).toEqual(fitTo(mapBounds, 1000, 800))
  })

  it('falls back to the current hexagon when the whole map would fit below the usable scale (CANVAS-04.2)', () => {
    const mapBounds = { x: -5000, y: -100, width: 10000, height: 200 }
    const currentBounds = { x: -100, y: -100, width: 200, height: 200 }
    const fit = fitMap(mapBounds, currentBounds, 1000, 800)
    expect(fitTo(mapBounds, 1000, 800).scale).toBeLessThan(MIN_FIT_SCALE)
    expect(fit).toEqual(fitTo(currentBounds, 1000, 800))
    const topLeft = toDiagram(fit, { x: 0, y: 0 })
    const bottomRight = toDiagram(fit, { x: 1000, y: 800 })
    expect(topLeft.x).toBeLessThanOrEqual(currentBounds.x)
    expect(topLeft.y).toBeLessThanOrEqual(currentBounds.y)
    expect(bottomRight.x).toBeGreaterThanOrEqual(currentBounds.x + currentBounds.width)
    expect(bottomRight.y).toBeGreaterThanOrEqual(currentBounds.y + currentBounds.height)
  })

  it('fits the whole two-slices example on a laptop screen with the editor open (F-06)', () => {
    const model = layoutMap(TWO_SLICES_MAP)
    const size = { width: 1366, height: 768 }
    const inset = islandInset(size, true, false)
    const fit = fitMap(model.bounds, hexagonBounds(currentHexagon(model, TWO_SLICES_MAP.hexagons[0].id)), size.width, size.height, inset)

    expect(fit.scale).toBeGreaterThanOrEqual(MIN_FIT_SCALE)
    const topLeft = toDiagram(fit, { x: inset.left, y: inset.top })
    const bottomRight = toDiagram(fit, { x: size.width - inset.right, y: size.height - inset.bottom })
    for (const hex of model.hexagons) {
      const bounds = hexagonBounds(hex)
      expect(topLeft.x).toBeLessThanOrEqual(bounds.x + 1e-9)
      expect(topLeft.y).toBeLessThanOrEqual(bounds.y + 1e-9)
      expect(bottomRight.x).toBeGreaterThanOrEqual(bounds.x + bounds.width - 1e-9)
      expect(bottomRight.y).toBeGreaterThanOrEqual(bounds.y + bounds.height - 1e-9)
    }
  })

  it('zooms in when the fingers spread and out when they close, around the same midpoint', () => {
    const from: [Point, Point] = [{ x: 400, y: 300 }, { x: 600, y: 300 }]
    const spread = pinch(v, from, [{ x: 300, y: 300 }, { x: 700, y: 300 }])
    expect(spread.scale).toBeGreaterThan(v.scale)
    const closed = pinch(v, from, [{ x: 450, y: 300 }, { x: 550, y: 300 }])
    expect(closed.scale).toBeLessThan(v.scale)
  })

  it('keeps the diagram point under the midpoint fixed when the midpoint itself does not move', () => {
    const mid = { x: 500, y: 300 }
    const from: [Point, Point] = [{ x: 400, y: 300 }, { x: 600, y: 300 }]
    const to: [Point, Point] = [{ x: 320, y: 300 }, { x: 680, y: 300 }]
    const before = toDiagram(v, mid)
    const after = toDiagram(pinch(v, from, to), mid)
    expect(after.x).toBeCloseTo(before.x, 9)
    expect(after.y).toBeCloseTo(before.y, 9)
  })

  it('is exactly a pan when the finger distance does not change', () => {
    const from: [Point, Point] = [{ x: 400, y: 300 }, { x: 600, y: 340 }]
    const to: [Point, Point] = [{ x: 440, y: 320 }, { x: 640, y: 360 }]
    expect(pinch(v, from, to)).toEqual(panBy(v, 40, 20))
  })

  it('clamps at the zoom limits like zoomAt', () => {
    const from: [Point, Point] = [{ x: 490, y: 300 }, { x: 510, y: 300 }]
    expect(pinch(v, from, [{ x: 0, y: 300 }, { x: 1000, y: 300 }]).scale).toBe(MAX_SCALE)
    expect(pinch(v, from, [{ x: 499.5, y: 300 }, { x: 500.5, y: 300 }]).scale).toBe(MIN_SCALE)
  })

  it('honours a lower floor, so pinching out of a whole-map fit never snaps back above it (FIT-01, ADR-05)', () => {
    const from: [Point, Point] = [{ x: 490, y: 300 }, { x: 510, y: 300 }]
    const closed: [Point, Point] = [{ x: 499.5, y: 300 }, { x: 500.5, y: 300 }]
    expect(pinch({ ...v, scale: 0.05 }, from, closed, 0.03).scale).toBe(0.03)
    expect(pinch({ ...v, scale: 0.05 }, from, from, 0.03).scale).toBe(0.05)
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

  it('accepts a minScale override, fitting a huge map below the usual MIN_SCALE floor (FIT-01.1)', () => {
    const bounds = { x: -50000, y: -100, width: 100000, height: 200 }
    const fit = fitTo(bounds, 1000, 800, undefined, 0)
    expect(fit.scale).toBeLessThan(MIN_SCALE)
    expect(fit.scale).toBeGreaterThan(0)
    const topLeft = toDiagram(fit, { x: 0, y: 0 })
    const bottomRight = toDiagram(fit, { x: 1000, y: 800 })
    expect(topLeft.x).toBeLessThanOrEqual(bounds.x + 1e-6)
    expect(topLeft.y).toBeLessThanOrEqual(bounds.y + 1e-6)
    expect(bottomRight.x).toBeGreaterThanOrEqual(bounds.x + bounds.width - 1e-6)
    expect(bottomRight.y).toBeGreaterThanOrEqual(bounds.y + bounds.height - 1e-6)
  })

  it('defaults minScale to MIN_SCALE when omitted, matching the unclamped-below-0.1 behaviour today', () => {
    const bounds = { x: -50000, y: -100, width: 100000, height: 200 }
    expect(fitTo(bounds, 1000, 800).scale).toBe(MIN_SCALE)
    expect(fitTo(bounds, 1000, 800).scale).toBe(fitTo(bounds, 1000, 800, undefined, MIN_SCALE).scale)
  })

  describe('visibleRect', () => {
    it('is the diagram-space box visible through the stage area, floating panels excluded', () => {
      const v = { x: 100, y: 50, scale: 2 }
      const size = { width: 1000, height: 800 }
      const inset = { top: 60, right: 20, bottom: 10, left: 320 }
      const rect = visibleRect(v, size, inset)
      const topLeft = toDiagram(v, { x: inset.left, y: inset.top })
      const bottomRight = toDiagram(v, { x: size.width - inset.right, y: size.height - inset.bottom })
      expect(rect).toEqual({ x: topLeft.x, y: topLeft.y, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y })
    })

    it('defaults to no inset', () => {
      const v = { x: 0, y: 0, scale: 1 }
      const size = { width: 200, height: 100 }
      expect(visibleRect(v, size)).toEqual({ x: 0, y: 0, width: 200, height: 100 })
    })
  })

  describe('contains', () => {
    const outer = { x: 0, y: 0, width: 100, height: 100 }

    it('is true for a box fully inside, including touching the edges', () => {
      expect(contains(outer, { x: 10, y: 10, width: 20, height: 20 })).toBe(true)
      expect(contains(outer, outer)).toBe(true)
    })

    it('is false for a box that pokes outside on any side', () => {
      expect(contains(outer, { x: -1, y: 10, width: 20, height: 20 })).toBe(false)
      expect(contains(outer, { x: 10, y: 10, width: 95, height: 20 })).toBe(false)
      expect(contains(outer, { x: 10, y: -5, width: 20, height: 20 })).toBe(false)
      expect(contains(outer, { x: 10, y: 10, width: 20, height: 95 })).toBe(false)
    })
  })
})
