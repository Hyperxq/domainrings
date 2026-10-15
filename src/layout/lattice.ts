import type { Cell } from '../model/map'
import type { Hexagon } from '../model/schema'
import { CHIP_FLOOR_PX, CHIP_GAP, CHIP_LINE, REFERENCE_STAGE } from './chipFit'
import { COMPACT_MAX_SHARE, COMPACT_RADIUS, COMPACT_TITLE, compactBounds } from './compactHexagon'
import { MAP_GAP } from './gap'
import { unionBox, type Box, type Point } from './geometry'
import type { LayoutModel } from './layout'
import type { MapHexagonLayout } from './map'
import { CHIP_LABEL, measure } from './text'

export interface LaidOutHexagon {
  hexagon: Hexagon
  model: LayoutModel
  compact: boolean
  /** The name on the chip of this hexagon's context, when the map draws chips: a compact hexagon keeps the width of its chip clear. */
  chipLabel?: string
}

/** The chip is sized again once the lattice is laid out, and comes out a little larger than the lattice allowed for. */
const CHIP_GROWTH = 1.15

/** A compact hexagon's box grown up to the chip of its context, which hangs above it, so a full hexagon level with the chip
 * counts as level with the hexagon. The chip is often wider than the hexagon but slides sideways along its region to clear
 * a neighbour, so the box only widens to it where full hexagons hem it in on both sides. */
function withChip({ compact, chipLabel }: LaidOutHexagon, own: Box, chipSize: number, hemmed: boolean): Box {
  if (!compact || !chipLabel) return own
  const half = hemmed ? measure(chipLabel, { ...CHIP_LABEL, size: chipSize * CHIP_GROWTH }) / 2 : 0
  const [left, right] = [Math.min(own.x, -half), Math.max(own.x + own.width, half)]
  const rise = chipSize * CHIP_LINE + CHIP_GAP
  return { x: left, y: own.y - rise, width: right - left, height: own.height + rise }
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

/** Where the hexagons go when every one is in full: each lattice row is packed on its own, so row neighbours sit exactly
 * `MAP_GAP` apart whatever their sizes (a missing cell leaves a slot as wide as its two neighbours). A row is then
 * shifted as a whole to interlock with the row above: a hexagon below sits at least half a gap past the right edge of
 * its upper-left neighbour's centre and at most the same before its upper-right neighbour's, measured by the upper
 * hexagon's extent alone so a large hexagon below never pushes its upper neighbours apart. When those bounds disagree the
 * row takes their midpoint; a row with no upper neighbour keeps the lattice's spacing from the row above. Rows keep one
 * centre y, spaced by the least that keeps every pair of boxes that are close in x at least `MAP_GAP` apart. A row is
 * placed from the rows above it alone, so growing or adding a hexagon never moves a row above it. The first hexagon
 * stays at the origin. */
function packRows(owns: readonly Box[], cells: readonly Cell[]): Point[] {
  const left = (i: number) => -owns[i].x
  const right = (i: number) => owns[i].x + owns[i].width
  const top = (i: number) => -owns[i].y
  const bottom = (i: number) => owns[i].y + owns[i].height
  const byRow = new Map<number, number[]>()
  cells.forEach((cell, i) => byRow.set(cell.r, [...(byRow.get(cell.r) ?? []), i]))
  const rows = [...byRow].sort(([a], [b]) => a - b).map(([r, members]) => ({ r, members: members.sort((a, b) => cells[a].q - cells[b].q || a - b) }))
  const x: number[] = []
  const rowY: number[] = []
  rows.forEach(({ r, members }, k) => {
    const packed = members.map(() => 0)
    for (let j = 1; j < members.length; j++) {
      const [a, b] = [members[j - 1], members[j]]
      const slot = (owns[a].width + owns[b].width) / 2 + MAP_GAP
      packed[j] = packed[j - 1] + right(a) + left(b) + MAP_GAP + (cells[b].q - cells[a].q - 1) * slot
    }
    const above = rows[k - 1]?.r === r - 1 ? rows[k - 1].members : []
    let [lo, hi] = [-Infinity, Infinity]
    members.forEach((l, j) => {
      for (const u of above) {
        if (cells[u].q === cells[l].q) lo = Math.max(lo, x[u] + right(u) + MAP_GAP / 2 - packed[j])
        else if (cells[u].q === cells[l].q + 1) hi = Math.min(hi, x[u] - left(u) - MAP_GAP / 2 - packed[j])
      }
    })
    const lattice = (i: number) => cells[i].q + cells[i].r / 2
    const nominal = members.reduce((sum, i) => sum + left(i) + right(i) + MAP_GAP, 0) / members.length
    const free = k === 0 ? 0 : x[rows[k - 1].members[0]] + (lattice(members[0]) - lattice(rows[k - 1].members[0])) * nominal - packed[0]
    const shift = Number.isFinite(lo) && Number.isFinite(hi) ? (lo + hi) / 2 : Number.isFinite(lo) ? lo : Number.isFinite(hi) ? hi : free
    members.forEach((i, j) => (x[i] = packed[j] + shift))

    const gapX = (a: number, b: number) => Math.max(x[b] - left(b) - (x[a] + right(a)), x[a] - left(a) - (x[b] + right(b)))
    let y = 0
    if (k > 0) {
      const prev = rows[k - 1]
      // Rows never merge, even when nothing above is close in x.
      y = rowY[k - 1] + (r - prev.r) * (Math.min(...prev.members.map(bottom)) + Math.min(...members.map(top)) + MAP_GAP)
      rows.slice(0, k).forEach(({ members: upper }, m) => {
        for (const a of upper) for (const b of members) if (gapX(a, b) < MAP_GAP) y = Math.max(y, rowY[m] + bottom(a) + top(b) + MAP_GAP)
      })
    }
    rowY.push(y)
  })
  const at = (i: number): Point => ({ x: x[i], y: rowY[rows.findIndex(({ r }) => r === cells[i].r)] })
  const origin = at(0)
  return cells.map((_, i) => ({ x: at(i).x - origin.x, y: at(i).y - origin.y }))
}

/** A hexagon's own (untranslated) bounds — its silhouette when compact — shifted onto the map by its `centre` (ADR-04). */
export const hexagonBounds = (hex: Pick<MapHexagonLayout, 'model' | 'centre' | 'compact'>): Box => {
  const own = hex.compact ? compactBounds(hex.compact.radius) : hex.model.bounds
  return { x: own.x + hex.centre.x, y: own.y + hex.centre.y, width: own.width, height: own.height }
}

/** A hexagon's position on the affine pointy-top lattice: {0,0} sits at the origin, `e` steps by `pitch.x`,
 * `se`/`sw` by half that plus `pitch.y` down (ADR-01). */
export function cellCentre(cell: { q: number; r: number }, pitch: Point): Point {
  return { x: pitch.x * (cell.q + cell.r / 2), y: pitch.y * cell.r }
}

/** The lattice the hexagons sit on: each one's centre, the pitch between cells, and the scale the compact silhouettes are drawn at. */
export function layLattice(perHexagon: LaidOutHexagon[], compacting: boolean): { pitch: Point; centres: Point[]; unit: number } {
  // The lattice and the hexagons' union for compact hexagons drawn at `unit` scale.
  const place = (unit: number, chipSize: number) => {
    const owns = perHexagon.map(({ model, compact }) => (compact ? compactBounds(COMPACT_RADIUS * unit) : model.bounds))
    // The lattice step: with compact neighbours it sizes the cells (each full hexagon claims its room afterwards with
    // `clearFull` instead of inflating every cell); with every hexagon in full it only gives the direction of a grow "+",
    // since `packRows` places the hexagons themselves.
    const extents = perHexagon.map(({ compact }, i) => ({ compact, left: -owns[i].x, right: owns[i].x + owns[i].width, top: -owns[i].y, bottom: owns[i].y + owns[i].height }))
    const small = extents.filter((e) => e.compact)
    const pairs = compacting ? [[small, small]] : [[extents, extents]]
    const span = (head: 'right' | 'bottom', tail: 'left' | 'top') =>
      Math.max(...pairs.map(([a, b]) => Math.max(...a.map((e) => e[head])) + Math.max(...b.map((e) => e[tail])))) + MAP_GAP
    const boxX = span('right', 'left')
    // A compact hexagon's chip sits above its hull and is as large as its title; two lines are kept free so chips wider
    // than their hexagons can stagger instead of running into each other.
    const boxY = span('bottom', 'top') + (compacting ? Math.max(COMPACT_TITLE.size * unit, chipSize) * CHIP_LINE * 2 + 2 * CHIP_GAP : 0)
    const pitch: Point = { x: boxX, y: boxY }
    const hemmedIn = (placed: Point[], boxes: Box[], k: number, size: number) => {
      const at = (i: number): Box => ({ ...boxes[i], x: boxes[i].x + placed[i].x, y: boxes[i].y + placed[i].y })
      const reach = size * CHIP_LINE + CHIP_GAP
      const beside = perHexagon.flatMap(({ compact }, i) => (compact || i === k || at(i).y > at(k).y + at(k).height + MAP_GAP || at(k).y - reach - MAP_GAP > at(i).y + at(i).height ? [] : [placed[i].x - placed[k].x]))
      return beside.some((dx) => dx < 0) && beside.some((dx) => dx > 0)
    }
    const centres = compacting
      ? perHexagon.reduce((placed, { compact }, i) => (compact ? placed : clearFull(placed, owns.map((own, k) => withChip(perHexagon[k], own, chipSize, hemmedIn(placed, owns, k, chipSize))), i)), perHexagon.map(({ hexagon }) => cellCentre(hexagon.cell, pitch)))
      : packRows(owns, perHexagon.map(({ hexagon }) => hexagon.cell))
    const bounds = unionBox(owns.map((own, i) => ({ ...own, x: own.x + centres[i].x, y: own.y + centres[i].y })))
    return { pitch, centres, bounds }
  }
  // Like the context chips, but only approaching the floor: growing the compact hexagon grows the lattice and so lowers
  // the fit scale the title is sized against, which saturates near 8-9px on screen. More passes never reach
  // CHIP_FLOOR_PX and on large maps keep inflating the silhouette, so the passes stay capped.
  let unit = 1
  let chipSize: number = CHIP_LABEL.size
  if (compacting) {
    const fullHeight = Math.min(...perHexagon.filter(({ compact }) => !compact).map(({ model }) => model.bounds.height))
    const maxUnit = (fullHeight * COMPACT_MAX_SHARE) / (2 * COMPACT_RADIUS)
    for (let pass = 0; pass < 4; pass++) {
      const { bounds } = place(unit, chipSize)
      const scale = Math.min(REFERENCE_STAGE.width / bounds.width, REFERENCE_STAGE.height / bounds.height)
      unit = Math.max(1, Math.min(maxUnit, CHIP_FLOOR_PX / (COMPACT_TITLE.size * scale)))
      chipSize = Math.max(CHIP_LABEL.size, CHIP_FLOOR_PX / scale)
    }
  }
  const { pitch, centres } = place(unit, chipSize)
  return { pitch, centres, unit }
}
