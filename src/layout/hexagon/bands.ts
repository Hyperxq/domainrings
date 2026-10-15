import { quadsOverlap, reach, rectCorners, type Box } from '../geometry'
import { COS30, SQRT3 } from '../outline'
import type { Element } from './elements'
import { growToClear } from './ringGrowth'
import type { RingTitles } from './ringTitles'
import { GAP, LABEL_PAD_X, TRACK_GAP } from './spacing'
import { wallFrame } from './walls'

/** Room kept clear on each side of a corridor's outermost tracks. */
export const MARGIN = 16
/**
 * Room between a box and the band's corridor, on top of the corridor's own margin. Tight on purpose: a hop between a
 * box face and its corridor is where the edge labels sit, and below 6 the project-builder map drops more labels than it did at 16.
 */
export const BOX_CLEAR = 6
/** Room left between two boxes that are not on the same wall. */
const CLASH_GAP = 6
/** Room between the domain title and the region under it. */
const TITLE_CLEAR = 8
const T30 = 1 / SQRT3

/** Half the width a corridor takes for `tracks` tracks, margins included. */
export const corridorHalf = (tracks: number) => (Math.max(1, tracks) - 1) * (TRACK_GAP / 2) + MARGIN

/** The ring titles belong to: use cases to the domain, ports to the application, adapters to the infrastructure. */
const RING_OF: Record<number, number | undefined> = { 1: 2, 2: 1, 3: 0 }

export interface BandInput {
  elements: Element[]
  /** What already stands inside the domain ring, to keep every box off. */
  inside: Box[]
  /** Apothem and apex of the domain model region. */
  core: { halfWidth: number; apex: number }
  /** Tracks in each corridor, innermost first. */
  tracks: number[]
  titles: RingTitles
}

/**
 * The apothem of every wall, innermost first: the domain model, the domain, the application, the infrastructure and
 * the external systems. Each band holds half a box of each neighbouring layer, a margin and its corridor in the middle,
 * so it is twice the largest extent of the layer pair plus margins plus half the tracks. A layer whose boxes need more
 * room along their wall, or that would touch a neighbour or a ring title, grows until they do not.
 */
export function sizeBands({ elements, inside, core, tracks, titles }: BandInput): number[] {
  const extent = (layer: number) => Math.max(0, ...elements.filter((e) => e.layer === layer).map((e) => reach(e.frame.width, e.frame.height, wallFrame(e.wall).n)))
  const z = [1, 2, 3, 4].map((layer) => Math.max(extent(layer - 1 || 1), extent(layer)) + BOX_CLEAR)
  const radii = [core.halfWidth]

  const rectOf = (e: Element, apothem: number): Box => {
    const { n, dir } = wallFrame(e.wall)
    return { x: n.x * apothem + dir.x * e.u - e.frame.width / 2, y: n.y * apothem + dir.y * e.u - e.frame.height / 2, width: e.frame.width, height: e.frame.height }
  }
  const quad = (b: Box, pad = 0) => rectCorners(b.x + b.width / 2, b.y + b.height / 2, b.width + pad, b.height + pad)

  for (let layer = 1; layer <= 4; layer++) {
    const half = corridorHalf(tracks[layer - 1])
    const base = radii[layer - 1] + 2 * (z[layer - 1] + half)
    const ring = RING_OF[layer]
    // The title must fit between the sides of its ring, and under the inner ring's top.
    const floor =
      ring === undefined
        ? 0
        : Math.max(
            titles.titleWidth(ring) / 2 + LABEL_PAD_X,
            (layer === 1 ? core.apex + titles.depthOf(ring) + titles.titleHeight(ring) + TITLE_CLEAR : radii[layer - 1] / COS30 + GAP + titles.titleHeight(ring) + titles.titleDepth) * COS30,
          )
    const mine = elements.filter((e) => e.layer === layer)
    const before = elements.filter((e) => e.layer < layer)
    const clashes = (apex: number) => {
      const apothem = apex * COS30
      const placed = [...before.map((e) => ({ e, box: rectOf(e, radii[e.layer]) })), ...mine.map((e) => ({ e, box: rectOf(e, apothem) }))]
      // Along its wall a box stays within the shortest wall it hops to: the innermost track of the corridor inside.
      const inner = (radii[layer - 1] + apothem) / 2 - (Math.max(1, tracks[layer - 1]) - 1) * (TRACK_GAP / 2)
      if (mine.some((e) => Math.abs(e.u) > inner * T30 - CLASH_GAP)) return true
      const crowd = placed.slice(before.length).some(({ box }, i) => {
        const q = quad(box, CLASH_GAP)
        return placed.some((o, j) => (j < before.length + i) && quadsOverlap(q, quad(o.box))) || inside.some((b) => quadsOverlap(q, quad(b)))
      })
      if (crowd) return true
      if (ring === undefined) return false
      const topY = -apex + titles.depthOf(ring)
      const title = rectCorners(0, topY + titles.titleHeight(ring) / 2, titles.titleWidth(ring) + CLASH_GAP, titles.titleHeight(ring))
      return placed.some(({ e, box }) => (e.layer === layer || e.layer === layer - 1) && quadsOverlap(quad(box), title))
    }
    const start = Math.max(base, floor) / COS30
    radii.push(growToClear(clashes, start).apex * COS30)
  }
  return radii
}

