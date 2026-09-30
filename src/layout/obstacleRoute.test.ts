import { describe, expect, it } from 'vitest'
import type { Box, Point } from './layout'
import { crossesBox, routeAround, type Scene } from './obstacleRoute'

const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height })
const WORLD = box(-500, -500, 1000, 1000)
const scene = (hexagons: Box[], chips: Box[] = [], within: Box = WORLD): Scene => ({ hexagons, chips, within })
const bends = (points: Point[]) => points.slice(2).filter((p, i) => (p.x === points[i + 1].x) !== (points[i + 1].x === points[i].x)).length

describe('crossesBox', () => {
  const obstacle = box(0, 0, 100, 100)

  it('finds a segment through the box and one ending inside it', () => {
    expect(crossesBox([{ x: -50, y: 50 }, { x: 150, y: 50 }], [obstacle])).toBe(true)
    expect(crossesBox([{ x: 50, y: -50 }, { x: 50, y: 50 }], [obstacle])).toBe(true)
  })

  it('finds a segment running along the box within the clearance, but not one beyond it', () => {
    expect(crossesBox([{ x: -0.5, y: -50 }, { x: -0.5, y: 150 }], [obstacle])).toBe(true)
    expect(crossesBox([{ x: -10, y: -50 }, { x: -10, y: 150 }], [obstacle])).toBe(false)
  })

  it('checks every segment of the route', () => {
    const route = [{ x: -50, y: -50 }, { x: 150, y: -50 }, { x: 150, y: 50 }, { x: 50, y: 50 }]
    expect(crossesBox(route, [obstacle])).toBe(true)
    expect(crossesBox(route.slice(0, 3), [obstacle])).toBe(false)
  })
})

describe('routeAround', () => {
  const start = { x: -200, y: 0 }
  const goal = { x: 200, y: 0 }

  it('joins the two points with one straight run when nothing is in the way', () => {
    expect(routeAround([start], [goal], scene([]))).toEqual([start, goal])
  })

  it('goes round a box in the way with two bends, every segment axis-aligned and clear of it', () => {
    const wall = box(-50, -100, 100, 200)
    const route = routeAround([start], [goal], scene([wall]))!
    expect(route[0]).toEqual(start)
    expect(route.at(-1)).toEqual(goal)
    expect(route.slice(1).every((p, i) => p.x === route[i].x || p.y === route[i].y)).toBe(true)
    expect(crossesBox(route, [wall])).toBe(false)
    expect(bends(route)).toBe(2)
  })

  it('takes the corridor between two boxes instead of the long way round', () => {
    const above = box(-50, -400, 100, 330)
    const below = box(-50, 30, 100, 400)
    const route = routeAround([{ x: -200, y: -300 }], [{ x: 200, y: 300 }], scene([above, below]))!
    expect(crossesBox(route, [above, below])).toBe(false)
    expect(route.some((p) => p.y > -70 && p.y < 30)).toBe(true)
  })

  it('goes round a chip the same way', () => {
    const chip = box(-40, -10, 80, 20)
    const route = routeAround([start], [goal], scene([], [chip]))!
    expect(crossesBox(route, [chip])).toBe(false)
    expect(bends(route)).toBe(2)
  })

  it('stays within one channel of the area it is given', () => {
    const wall = box(-50, -400, 100, 800)
    const within = box(-300, -420, 600, 840)
    const route = routeAround([start], [goal], scene([wall], [], within))!
    for (const p of route) {
      expect(p.x).toBeGreaterThanOrEqual(within.x - 30)
      expect(p.x).toBeLessThanOrEqual(within.x + within.width + 30)
      expect(p.y).toBeGreaterThanOrEqual(within.y - 30)
      expect(p.y).toBeLessThanOrEqual(within.y + within.height + 30)
    }
    expect(crossesBox(route, [wall])).toBe(false)
  })

  it('finds no route when the area leaves no way round', () => {
    const wall = box(-50, -400, 100, 800)
    expect(routeAround([start], [goal], scene([wall], [], box(-300, -300, 600, 600)))).toBeUndefined()
  })

  it('finds no route from a point sealed inside the obstacles', () => {
    const ring = [box(-60, -60, 120, 20), box(-60, 40, 120, 20), box(-60, -60, 20, 120), box(40, -60, 20, 120)]
    expect(routeAround([{ x: 0, y: 0 }], [goal], scene(ring))).toBeUndefined()
  })

  it('shifts a route through a channel by the lane offset', () => {
    const wall = box(-50, -400, 100, 330)
    const base = routeAround([{ x: -200, y: -300 }], [{ x: 200, y: -300 }], scene([wall]))!
    const lane = routeAround([{ x: -200, y: -300 }], [{ x: 200, y: -300 }], scene([wall], [], WORLD), 10)!
    expect(lane).not.toEqual(base)
    expect(crossesBox(lane, [wall])).toBe(false)
  })

  it('starts from whichever start point gives the shorter route', () => {
    const wall = box(-50, -100, 100, 200)
    const route = routeAround([{ x: -200, y: 0 }, { x: -200, y: -250 }], [goal], scene([wall]))!
    expect(route[0]).toEqual({ x: -200, y: -250 })
    expect(bends(route)).toBeLessThan(3)
  })

  it('starts from another start point when the first is sealed in', () => {
    const chip = box(-230, -30, 60, 60)
    const route = routeAround([start, { x: -200, y: -100 }], [goal], scene([], [chip]))!
    expect(route[0]).toEqual({ x: -200, y: -100 })
    expect(crossesBox(route, [chip])).toBe(false)
  })

  it('ends at whichever end point is open', () => {
    const chip = box(170, -30, 60, 60)
    const route = routeAround([start], [goal, { x: 200, y: 100 }], scene([], [chip]))!
    expect(route.at(-1)).toEqual({ x: 200, y: 100 })
    expect(crossesBox(route, [chip])).toBe(false)
  })

  it('returns the same route every time', () => {
    const obstacles = [box(-50, -100, 100, 200), box(100, -300, 80, 120)]
    expect(routeAround([start], [goal], scene(obstacles))).toEqual(routeAround([start], [goal], scene(obstacles)))
  })

  it('returns a single point when both ends coincide', () => {
    expect(routeAround([start], [start], scene([]))).toEqual([start])
  })
})
