import { contextName, occupiedContexts } from '../model/map'
import type { HexaMap } from '../model/schema'
import { CHIP_FLOOR_PX, CHIP_GAP, CHIP_LINE, REFERENCE_STAGE } from './chipFit'
import { MAP_GAP } from './gap'
import { unionBox, type Box, type Point } from './geometry'
import { footprintRegions, pointInRegion } from './hull'
import { hexagonBounds } from './lattice'
import type { MapContextLayout, MapHexagonLayout } from './map'
import { CHIP_LABEL, measure } from './text'

/** How far a context's hull stands off the footprints of the hexagons it outlines. */
const HULL_PAD = MAP_GAP / 3
/** How far from its region a chip on a crowded map may sit, nearest first. */
const CHIP_REACHES = [1, 2, 3, 4, 5, 6, 7].map((k) => k * CHIP_GAP)
/** How far a chip on a crowded map may slide sideways along its region, as fractions of its text width. */
const CHIP_SLIDES = [0, -0.25, 0.25, -0.5, 0.5]

/** Above the region's highest vertex (min y, then min x) whose spot is clear of every context's region and every
 * hexagon's box — the plain topmost vertex can sit under a neighbouring context's tiles, and the full current
 * hexagon can reach past its own tile. When every such spot is taken, the highest boundary-edge midpoint pushed off
 * the region into clear space; the topmost vertex only if nothing is clear.
 *
 * With the chip's `text` extent, "clear" covers all of the text rather than just its baseline point, and a crowded
 * map also gets spots further out (`CHIP_REACHES`) and slid sideways (`CHIP_SLIDES`) — a name wider than the
 * hexagon it labels would otherwise always run into the neighbour beside it. When nothing above is clear, a crowded
 * map falls back to spots below the region. */
function chipAnchor(loops: Point[][], all: Point[][][], hexagons: Box[], text?: { width: number; size: number }): Point {
  const inBox = (p: Point, b: Box) => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height
  const keepOut = hexagons.map((b): Box =>
    text ? { x: b.x - text.width / 2, y: b.y - text.size / 4, width: b.width + text.width, height: b.height + text.size * CHIP_LINE } : { ...b, y: b.y - CHIP_GAP, height: b.height + CHIP_GAP },
  )
  const probes = (p: Point): Point[] =>
    text ? [p, { x: p.x - text.width / 2, y: p.y - text.size }, { x: p.x + text.width / 2, y: p.y - text.size }, { x: p.x - text.width / 2, y: p.y }, { x: p.x + text.width / 2, y: p.y }, { x: p.x, y: p.y - text.size }] : [p]
  const inText = (v: Point, p: Point) => text !== undefined && Math.abs(v.x - p.x) <= text.width / 2 && v.y >= p.y - text.size && v.y <= p.y
  const clear = (p: Point) =>
    !probes(p).some((q) => all.some((region) => pointInRegion(q, region))) && !all.some((region) => region.flat().some((v) => inText(v, p))) && !keepOut.some((b) => inBox(p, b))
  const byHeight = (a: Point, b: Point) => a.y - b.y || a.x - b.x
  const vertices = loops.flat().sort(byHeight)
  const edgeSpots = (gap: number) =>
    loops
      .flatMap((loop) =>
        loop.flatMap((a, i) => {
          const b = loop[(i + 1) % loop.length]
          const len = Math.hypot(b.x - a.x, b.y - a.y)
          if (len === 0) return []
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
          const normal = { x: (a.y - b.y) / len, y: (b.x - a.x) / len }
          return [1, -1].map((sign): Point => ({ x: mid.x + normal.x * sign * gap, y: mid.y + normal.y * sign * gap }))
        }),
      )
      .sort(byHeight)
  const above = (dx: number, gap: number) => vertices.map((v): Point => ({ x: v.x + dx, y: v.y - gap })).find(clear) ?? edgeSpots(gap).map((p): Point => ({ x: p.x + dx, y: p.y })).find(clear)
  for (const dx of text ? CHIP_SLIDES.map((k) => k * text.width) : [0]) {
    for (const gap of text ? CHIP_REACHES : [CHIP_GAP]) {
      const spot = above(dx, gap)
      if (spot) return spot
    }
  }
  // A full hexagon's box can stand off its ring by more than the fixed reaches, since the region hugs the ring.
  if (text) {
    for (const gap of [text.size / 2, text.size]) {
      const spot = above(0, gap)
      if (spot) return spot
    }
  }
  // A region hemmed in between tall full hexagons has no clear spot above it, but its underside can be free.
  if (text) {
    for (const gap of CHIP_REACHES) {
      const spot = [...vertices].reverse().map((v): Point => ({ x: v.x, y: v.y + gap + text.size })).find(clear)
      if (spot) return spot
    }
  }
  return { x: vertices[0].x, y: vertices[0].y - CHIP_GAP }
}

/** A chip's approximate footprint (the text rises `size` above its baseline), so a long context name still grows
 * the map's bounds to include it. */
export function chipBox(chip: Point, label: string, size: number): Box {
  return { x: chip.x - measure(label, { ...CHIP_LABEL, size }) / 2, y: chip.y - size, width: measure(label, { ...CHIP_LABEL, size }), height: size * CHIP_LINE }
}

/** The corners of the area a context's hull keeps around `hex`: its outer ring's own hexagon (the silhouette's when
 * compact), stood off by `HULL_PAD`. */
function footprint(hex: MapHexagonLayout): Point[] {
  const { halfWidth, straight, apex } = hex.compact
    ? { halfWidth: (hex.compact.radius * Math.sqrt(3)) / 2, straight: hex.compact.radius / 2, apex: hex.compact.radius }
    : hex.model.rings[0]
  // Moving the slanted sides out by HULL_PAD shifts the apex and the shoulders along the vertical sides by a multiple of it.
  const slant = Math.hypot(halfWidth, apex - straight)
  const w = halfWidth + HULL_PAD
  const h = straight + (HULL_PAD * (slant - (apex - straight))) / halfWidth
  const a = apex + (HULL_PAD * slant) / halfWidth
  // The top apex also reaches the box's own top, which can stand past the ring: a chip anchored on it then sits above
  // the lane links take over the box instead of in it.
  const top = Math.min(hex.centre.y - a, hexagonBounds(hex).y - HULL_PAD)
  const at = (x: number, y: number): Point => ({ x: hex.centre.x + x, y: hex.centre.y + y })
  return [{ x: hex.centre.x, y: top }, at(w, -h), at(w, h), at(0, a), at(-w, h), at(-w, -h)]
}

/** The context regions and their name chips, from two occupied contexts up; `bounds` grows to hold them. A lone
 * context over 2+ hexagons gets its region as a nameless `outline` instead: canvas-only, so neither the bounds nor an
 * export change. A declared context owning no hexagon doesn't count. */
export function layContexts(
  map: HexaMap,
  hexagons: MapHexagonLayout[],
  boxes: Box[],
  compacting: boolean,
  bounds: Box,
): { contexts: MapContextLayout[]; outline?: Point[][]; bounds: Box } {
  const occupied = occupiedContexts(map)
  const contexts: MapContextLayout[] = []
  if (occupied.length && (occupied.length >= 2 || hexagons.length > 1)) {
    // Each hull hugs its hexagons' own footprints, and a compact map's chip must keep its whole text (not just its
    // baseline point) off every hexagon.
    const regions = footprintRegions(hexagons.map((h) => ({ cell: h.cell, contextId: h.contextId, outline: footprint(h) })))
    if (occupied.length === 1) return { contexts, outline: regions.get(occupied[0].id), bounds }
    for (const context of map.contexts) {
      const loops = regions.get(context.id) ?? []
      if (!loops.length) continue // a context declared with no hexagons (schema allows it, the store never creates one) draws nothing
      contexts.push({ id: context.id, label: contextName(map, context.id), loops, chip: loops[0][0], size: CHIP_LABEL.size }) // the chip is only a placeholder: `placeChips` positions it
    }
    const placeChips = (size: number) => {
      const taken: Box[] = []
      for (const c of contexts) {
        c.chip = chipAnchor(c.loops, [...regions.values()], [...boxes, ...taken], { width: measure(c.label, { ...CHIP_LABEL, size }), size })
        if (compacting) taken.push(chipBox(c.chip, c.label, size))
      }
    }
    const contentBounds = unionBox([bounds, ...contexts.flatMap((c) => c.loops.flat().map((p): Box => ({ x: p.x, y: p.y, width: 0, height: 0 })))])
    const boundsWith = (size: number) => unionBox([contentBounds, ...contexts.map((c) => chipBox(c.chip, c.label, size))])
    // Growing a chip grows the bounds and so lowers the fit scale it is sized against: a few passes settle it.
    let size: number = CHIP_LABEL.size
    for (let pass = 0; pass < 4; pass++) {
      placeChips(size)
      const b = boundsWith(size)
      const scale = Math.min(REFERENCE_STAGE.width / b.width, REFERENCE_STAGE.height / b.height)
      size = Math.max(CHIP_LABEL.size, CHIP_FLOOR_PX / scale)
    }
    placeChips(size)
    for (const c of contexts) c.size = size
    bounds = boundsWith(size)
  }
  return { contexts, bounds }
}
