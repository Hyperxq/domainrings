import { MAP_GAP } from './gap'
import type { Box, Point } from './geometry'

/** What a route must keep off: every hexagon's box and every context chip. It runs inside the map's own `within` area,
 * or one channel beyond it — the way round a hexagon on the map's edge. */
export interface Scene {
  hexagons: Box[]
  chips: Box[]
  within: Box
}

/** Half of `MAP_GAP`: a line this far off a hexagon's edge is the midline of the gap to its neighbour. */
const CHANNEL = MAP_GAP / 2
/** A chip is small text, so a route may pass closer to it than to a hexagon. */
const CHIP_MARGIN = 8
/** How near a route may run to a box before it counts as touching it. */
const CLEARANCE = 1
/** What a bend costs, in the units of length: a route prefers a few long runs to a staircase. */
const BEND_COST = 40

/** Whether any segment of `points` passes within `CLEARANCE` of a box — the bounding-box test is exact because every
 * route this module works with is axis-aligned. */
export function crossesBox(points: readonly Point[], boxes: readonly Box[]): boolean {
  return points.slice(1).some((p, i) => {
    const q = points[i]
    return boxes.some(
      (b) =>
        Math.max(p.x, q.x) > b.x - CLEARANCE &&
        Math.min(p.x, q.x) < b.x + b.width + CLEARANCE &&
        Math.max(p.y, q.y) > b.y - CLEARANCE &&
        Math.min(p.y, q.y) < b.y + b.height + CLEARANCE,
    )
  })
}

const STEPS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
] as const
/** A search state's entry direction when it has none yet, so the first run is no bend. */
const NOT_ENTERED = STEPS.length
const STATES_PER_CELL = STEPS.length + 1

/** A binary min-heap of `[priority, value]` pairs. */
class Heap<T> {
  private items: Array<[number, T]> = []

  get size() {
    return this.items.length
  }

  push(priority: number, value: T) {
    const items = this.items
    let i = items.push([priority, value]) - 1
    while (i > 0 && items[(i - 1) >> 1][0] > priority) {
      ;[items[i], items[(i - 1) >> 1]] = [items[(i - 1) >> 1], items[i]]
      i = (i - 1) >> 1
    }
  }

  pop(): T {
    const items = this.items
    const top = items[0]
    const last = items.pop()!
    if (items.length) {
      items[0] = last
      for (let i = 0; ; ) {
        const left = 2 * i + 1
        const child = left + 1 < items.length && items[left + 1][0] < items[left][0] ? left + 1 : left
        if (child >= items.length || items[child][0] >= last[0]) break
        ;[items[i], items[child]] = [items[child], items[i]]
        i = child
      }
    }
    return top[1]
  }
}

/**
 * An orthogonal route from one of the `from` points to one of the `to` points that keeps clear of every box in `scene`,
 * or `undefined` when there is none — a point sealed in by boxes is simply never the one used.
 * The route runs along the lines a hexagon's edge leaves `CHANNEL` away — the midline of the gap to the next hexagon,
 * shifted by `lane` so parallel links stay apart — and `CHIP_MARGIN` off a chip's edge, searched A*-style with
 * `BEND_COST` per bend. The lines only need to exist where a route may turn, so the graph is never built: a node is
 * a crossing of one x line and one y line, and its neighbours are the next crossings along each line.
 */
export function routeAround(from: readonly Point[], to: readonly Point[], { hexagons, chips, within }: Scene, lane = 0): Point[] | undefined {
  const boxes = [...hexagons, ...chips]
  const lines = (pos: 'x' | 'y', len: 'width' | 'height') => {
    const [min, max] = [within[pos] - CHANNEL, within[pos] + within[len] + CHANNEL]
    const near = [
      ...hexagons.flatMap((b) => [b[pos] - CHANNEL + lane, b[pos] + b[len] + CHANNEL + lane]),
      ...chips.flatMap((b) => [b[pos] - CHIP_MARGIN, b[pos] + b[len] + CHIP_MARGIN]),
    ].filter((v) => v >= min && v <= max)
    return [...new Set([...from.map((p) => p[pos]), ...to.map((p) => p[pos]), ...near])].sort((a, b) => a - b)
  }
  const xs = lines('x', 'width')
  const ys = lines('y', 'height')
  const at = (i: number, j: number): Point => ({ x: xs[i], y: ys[j] })
  const goals = to.map((p) => ({ i: xs.indexOf(p.x), j: ys.indexOf(p.y), at: p }))
  const distance = (i: number, j: number) => Math.min(...to.map((p) => Math.abs(xs[i] - p.x) + Math.abs(ys[j] - p.y)))

  // A search state is a crossing plus the way it was entered.
  const state = (i: number, j: number, step: number) => (i * ys.length + j) * STATES_PER_CELL + step
  const cost = new Map<number, number>()
  const parent = new Map<number, number>()
  const open = new Heap<{ i: number; j: number; step: number; cost: number }>()
  for (const p of from) {
    const start = { i: xs.indexOf(p.x), j: ys.indexOf(p.y), step: NOT_ENTERED, cost: 0 }
    cost.set(state(start.i, start.j, start.step), 0)
    open.push(distance(start.i, start.j), start)
  }

  while (open.size) {
    const here = open.pop()
    const key = state(here.i, here.j, here.step)
    if (here.cost > cost.get(key)!) continue
    if (goals.some((g) => g.i === here.i && g.j === here.j)) {
      const route: Point[] = []
      for (let k: number | undefined = key; k !== undefined; k = parent.get(k)) {
        const cell = (k - (k % STATES_PER_CELL)) / STATES_PER_CELL
        route.push(at((cell - (cell % ys.length)) / ys.length, cell % ys.length))
      }
      return route.reverse().filter((p, i, all) => i === 0 || i === all.length - 1 || !((p.x === all[i - 1].x && p.x === all[i + 1].x) || (p.y === all[i - 1].y && p.y === all[i + 1].y)))
    }
    STEPS.forEach(({ dx, dy }, step) => {
      const [i, j] = [here.i + dx, here.j + dy]
      if (i < 0 || j < 0 || i >= xs.length || j >= ys.length || crossesBox([at(here.i, here.j), at(i, j)], boxes)) return
      const next = here.cost + Math.abs(xs[i] - xs[here.i]) + Math.abs(ys[j] - ys[here.j]) + (here.step !== NOT_ENTERED && here.step !== step ? BEND_COST : 0)
      const nextKey = state(i, j, step)
      if (next >= (cost.get(nextKey) ?? Infinity)) return
      cost.set(nextKey, next)
      parent.set(nextKey, key)
      open.push(next + distance(i, j), { i, j, step, cost: next })
    })
  }
  return undefined
}
