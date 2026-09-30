import type { Hexagon } from '../model/schema'
import { COMPACT_MAX_SHARE, COMPACT_RADIUS, COMPACT_TITLE, compactBounds } from './compactHexagon'
import { CHIP_FLOOR_PX, CHIP_GAP, CHIP_LINE, REFERENCE_STAGE } from './contextChips'
import { MAP_GAP } from './gap'
import { unionBox, type Box, type Point } from './geometry'
import type { LayoutModel } from './layout'

export interface LaidOutHexagon {
  hexagon: Hexagon
  model: LayoutModel
  compact: boolean
}

/** Where the other hexagons go once the full hexagon `full` claims its box: those at or right of its centre move right,
 * the rest left, each side by the least that clears the nearest hexagon still level with the box. A side moves as one,
 * so no two hexagons on it come closer and a pair on opposite sides only moves apart — clearing one full hexagon after
 * another therefore never undoes the clearance of an earlier one. The lattice keeps its compact pitch. */
function clearFull(centres: Point[], owns: Box[], full: number): Point[] {
  const at = (i: number): Box => ({ ...owns[i], x: owns[i].x + centres[i].x, y: owns[i].y + centres[i].y })
  const box = at(full)
  const level = (i: number) => at(i).y - (box.y + box.height) < MAP_GAP && box.y - (at(i).y + at(i).height) < MAP_GAP
  const east = (i: number) => centres[i].x >= centres[full].x
  const push = (isEast: boolean) =>
    Math.max(0, ...centres.flatMap((_, i) => (i === full || !level(i) || east(i) !== isEast ? [] : [isEast ? box.x + box.width + MAP_GAP - at(i).x : at(i).x + at(i).width - (box.x - MAP_GAP)])))
  const [eastward, westward] = [push(true), push(false)]
  return centres.map((p, i) => (i === full ? p : { x: p.x + (east(i) ? eastward : -westward), y: p.y }))
}

/** A hexagon's position on the affine pointy-top lattice: {0,0} sits at the origin, `e` steps by `pitch.x`,
 * `se`/`sw` by half that plus `pitch.y` down (ADR-01). */
export function cellCentre(cell: { q: number; r: number }, pitch: Point): Point {
  return { x: pitch.x * (cell.q + cell.r / 2), y: pitch.y * cell.r }
}

/** The lattice the hexagons sit on: each one's centre, the pitch between cells, and the scale the compact silhouettes are drawn at. */
export function layLattice(perHexagon: LaidOutHexagon[], compacting: boolean): { pitch: Point; centres: Point[]; unit: number } {
  // The lattice and the hexagons' union for compact hexagons drawn at `unit` scale.
  const place = (unit: number) => {
    const owns = perHexagon.map(({ model, compact }) => (compact ? compactBounds(COMPACT_RADIUS * unit) : model.bounds))
    // Every pair of hexagons that can sit in adjacent cells must clear each other by MAP_GAP on the pitch's axis. With
    // compact neighbours the lattice is sized from the compact footprint alone: each full hexagon claims its room
    // afterwards (`clearFull`) instead of inflating every cell.
    const extents = perHexagon.map(({ compact }, i) => ({ compact, left: -owns[i].x, right: owns[i].x + owns[i].width, top: -owns[i].y, bottom: owns[i].y + owns[i].height }))
    const small = extents.filter((e) => e.compact)
    const pairs = compacting ? [[small, small]] : [[extents, extents]]
    const span = (head: 'right' | 'bottom', tail: 'left' | 'top') =>
      Math.max(...pairs.map(([a, b]) => Math.max(...a.map((e) => e[head])) + Math.max(...b.map((e) => e[tail])))) + MAP_GAP
    // Each axis keeps its box-derived minimum (no overlap). Hull tiles only trace regular hexagons on a regular
    // lattice, so a map drawn with tile hulls grows the shorter axis to the regular √3/2 ratio; compact maps hug
    // footprints instead and keep the tight pitch.
    const boxX = span('right', 'left')
    // A compact hexagon's chip sits above its hull and is as large as its title; two lines are kept free so chips wider
    // than their hexagons can stagger instead of running into each other.
    const boxY = span('bottom', 'top') + (compacting ? COMPACT_TITLE.size * unit * CHIP_LINE * 2 + 2 * CHIP_GAP : 0)
    const pitch: Point = compacting ? { x: boxX, y: boxY } : { x: Math.max(boxX, (boxY * 2) / Math.sqrt(3)), y: Math.max(boxY, (boxX * Math.sqrt(3)) / 2) }
    const cells = perHexagon.map(({ hexagon }) => cellCentre(hexagon.cell, pitch))
    const centres = compacting ? perHexagon.reduce((placed, { compact }, i) => (compact ? placed : clearFull(placed, owns, i)), cells) : cells
    const bounds = unionBox(owns.map((own, i) => ({ ...own, x: own.x + centres[i].x, y: own.y + centres[i].y })))
    return { pitch, centres, bounds }
  }
  // Like the context chips, but only approaching the floor: growing the compact hexagon grows the lattice and so lowers
  // the fit scale the title is sized against, which saturates near 8-9px on screen. More passes never reach
  // CHIP_FLOOR_PX and on large maps keep inflating the silhouette, so the passes stay capped.
  let unit = 1
  if (compacting) {
    const fullHeight = Math.min(...perHexagon.filter(({ compact }) => !compact).map(({ model }) => model.bounds.height))
    const maxUnit = (fullHeight * COMPACT_MAX_SHARE) / (2 * COMPACT_RADIUS)
    for (let pass = 0; pass < 4; pass++) {
      const { bounds } = place(unit)
      const scale = Math.min(REFERENCE_STAGE.width / bounds.width, REFERENCE_STAGE.height / bounds.height)
      unit = Math.max(1, Math.min(maxUnit, CHIP_FLOOR_PX / (COMPACT_TITLE.size * scale)))
    }
  }
  const { pitch, centres } = place(unit)
  return { pitch, centres, unit }
}
