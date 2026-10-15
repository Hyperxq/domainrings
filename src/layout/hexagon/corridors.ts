import type { Wall } from '../../model/schema'
import type { Point } from '../geometry'
import { SQRT3 } from '../outline'
import { wallFrame } from './walls'

const T30 = 1 / SQRT3

/** The walls in the order they come round the hexagon: neighbours share a vertex, wall i and i + 1 the one at the end of i along its direction. */
export const CYCLE: Wall[] = ['e', 'se', 'sw', 'w', 'nw', 'ne']
/** The wall pair that meets at the top vertex. */
const TOP = [CYCLE.indexOf('nw'), CYCLE.indexOf('ne')]

/** The point `u` along wall `wall` of the hexagon of apothem `apothem`. */
export const onWall = (wall: Wall, apothem: number, u: number): Point => {
  const { n, dir } = wallFrame(wall)
  return { x: n.x * apothem + dir.x * u, y: n.y * apothem + dir.y * u }
}

const length = (points: Point[]) => points.reduce((sum, p, i) => (i ? sum + Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) : 0), 0)

/**
 * The run along the hexagon of apothem `apothem` from `u1` on wall `from` to `u2` on wall `to`, the shorter way round.
 * When both ways cross as many walls it avoids the top vertex, where the ring titles sit, even if that way is longer.
 */
export function travel(from: Wall, u1: number, to: Wall, u2: number, apothem: number): Point[] {
  const [a, b] = [CYCLE.indexOf(from), CYCLE.indexOf(to)]
  if (a === b) return [onWall(from, apothem, u1), onWall(to, apothem, u2)]
  const walk = (step: 1 | -1) => {
    const points = [onWall(from, apothem, u1)]
    let crossesTop = false
    for (let i = a; i !== b; i = (i + step + 6) % 6) {
      const next = (i + step + 6) % 6
      points.push(onWall(CYCLE[i], apothem, step * apothem * T30))
      crossesTop ||= (i === TOP[0] && next === TOP[1]) || (i === TOP[1] && next === TOP[0])
    }
    points.push(onWall(to, apothem, u2))
    return { points, crossesTop, walls: points.length, length: length(points) }
  }
  const [cw, ccw] = [walk(1), walk(-1)]
  if (cw.walls === ccw.walls && cw.crossesTop !== ccw.crossesTop) return (cw.crossesTop ? ccw : cw).points
  return (cw.length < ccw.length ? cw : ccw).points
}
