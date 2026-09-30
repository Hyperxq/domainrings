import type { Wall } from '../../model/schema'
import type { Point } from '../geometry'
import { COS30, SQRT3 } from '../outline'

/** Every wall-hosted box stays this far inside its wall's 60° sector, so the spokes run clear of it. */
const SECTOR_CLEAR = 8

// Wall frames of a pointy-top hexagon (y down): n is the outward normal, dir runs along the wall. A wall's midpoint
// sits at the apothem along n, so any wall-hosted point is (apothem + v)·n + u·dir.
export const SLANTED_WALLS: ReadonlySet<Wall> = new Set(['nw', 'sw', 'ne', 'se'])
export const WALLS: Wall[] = ['nw', 'w', 'sw', 'ne', 'e', 'se']
// Exact unit vectors (0, ±½, ±1, ±cos30) rather than trig, so axis-aligned runs come out exactly axis-aligned and
// both ends of a shared edge land on identical coordinates.
const WALL_NORMAL: Record<Wall, Point> = {
  e: { x: 1, y: 0 },
  se: { x: 0.5, y: COS30 },
  sw: { x: -0.5, y: COS30 },
  w: { x: -1, y: 0 },
  nw: { x: -0.5, y: -COS30 },
  ne: { x: 0.5, y: -COS30 },
}
/** Hexagon vertices on the unit circle, clockwise from the top. */
export const VERTEX: Point[] = [
  { x: 0, y: -1 },
  { x: COS30, y: -0.5 },
  { x: COS30, y: 0.5 },
  { x: 0, y: 1 },
  { x: -COS30, y: 0.5 },
  { x: -COS30, y: -0.5 },
]
export function wallFrame(wall: Wall) {
  const n = WALL_NORMAL[wall]
  return { n, dir: { x: -n.y === 0 ? 0 : -n.y, y: n.x } }
}
/** The wall's line angle in degrees, folded into (−90, 90]. */
export const wallAngle = (wall: Wall) => {
  const { dir } = wallFrame(wall)
  return (((Math.atan2(dir.y, dir.x) * 180) / Math.PI + 450) % 180) - 90
}
/** Smallest apothem keeping a local point (u along the wall, v off its line) inside the wall's sector. */
export const sectorApothem = (u: number, v: number) => (Math.abs(u) + SECTOR_CLEAR / COS30) * SQRT3 - v
