import type { RingRole } from '../model/kinds'
import { arcAngles } from '../model/rings'
import { circle, type LayoutRing, type Outline } from './layout'
import { DOMAIN_TITLE, measure, RING_LABEL } from './text'

/** Same floor as the Hexagonal rings' MIN_BAND — keeps ring bands visually consistent across kinds. */
const MIN_BAND = 36
const LABEL_PAD_X = 8
const TITLE_LINE = RING_LABEL.size + 4
const SUBTITLE_GAP = 4

/** The one place an element's or endpoint's rendered box size is defined — `render/RingedNodes.tsx` draws to
 * these exact numbers, so a ring sized against them never drifts from what actually gets painted. */
export const RINGED_ELEMENT_METRICS = { size: 13, em: 0.6, tracking: 0 }
const ELEMENT_PAD_X = 10
export const RINGED_ELEMENT_HEIGHT = 26
export const RINGED_ENDPOINT_DIAMETER = 8
/** Minimum clearance kept between two adjacent boxes, on top of their own widths/heights. */
const BOX_GAP = 8

export const ringedElementWidth = (name: string) => measure(name, RINGED_ELEMENT_METRICS) + 2 * ELEMENT_PAD_X

export interface RingedBox {
  x: number
  y: number
  width: number
  height: number
}

/** Smallest `t` (whatever radius `place` treats it as) at which no two boxes `place(t)` returns overlap by less
 * than `BOX_GAP` — the same "grow it until its contents fit" idiom as `fitRing` (layout.ts), but by binary search
 * against the real axis-aligned box test rather than a closed-form Need list: unlike a hexagon's straight sides,
 * boxes spread around an arc (evenly or not, one ring or mixed with another) have no such formula. Only ever
 * grows `t`, never shrinks it below `minT`, so a ring already large enough for its title pays nothing extra. */
function growUntilFits(minT: number, place: (t: number) => RingedBox[]): number {
  const fits = (t: number) => {
    const boxes = place(t)
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i], boxes[j]]
        if (Math.abs(a.x - b.x) < (a.width + b.width) / 2 + BOX_GAP && Math.abs(a.y - b.y) < (a.height + b.height) / 2 + BOX_GAP) return false
      }
    }
    return true
  }
  if (fits(minT)) return minT
  let hi = Math.max(minT, 1)
  while (!fits(hi)) hi *= 2
  let lo = minT
  for (let n = 0; n < 50; n++) {
    const mid = (lo + hi) / 2
    if (fits(mid)) hi = mid
    else lo = mid
  }
  return hi
}

/** An element about to be placed at `angle` on some ring, before that ring's radius is known. */
export interface RingedSlot {
  angle: number
  width: number
}

/** Smallest radius at which a label of half-width `halfWidth` (already padded), centred `offset` below the
 * ring's own apex (`labelAt`, below), still fits inside THIS ring's own circular chord at that height. A ring's
 * band is a filled disc/annulus (`render/band.ts`'s `bandPath`); the next ring out is painted afterward, so
 * anything the label pokes past this ring's own curve gets covered by that later fill — the reported "Domain
 * Mod", "MAIN SERVIC" clipping. The circle's chord half-width at distance `offset` below the pole is
 * `sqrt(2·r·offset − offset²)` (Pythagoras on the radius, the pole-to-label distance `r − offset`, and the
 * chord); requiring that ≥ `halfWidth` and solving for `r` gives this formula — always ≥ the plain `halfWidth`
 * floor a straight-sided ring would need, since a circle only narrows as it curves toward its own pole. */
function labelRadius(halfWidth: number, offset: number): number {
  return (halfWidth * halfWidth + offset * offset) / (2 * offset)
}

const titleHeightOf = (innermost: boolean) => (innermost ? DOMAIN_TITLE.size + 4 : TITLE_LINE)

/** Ring outline sizing shared by every "ringed" document kind (Onion, Clean — ADR-01): each ring grows from its
 * own title width, its inner neighbour's edge plus a minimum band, or — new — however far out its own elements
 * need to be for none of their real boxes to overlap at their placement angles, whichever is largest. The
 * innermost ring's title renders sentence-case, every other ring's uppercase. `slotsOf` returns every element
 * landing on a ring regardless of sub-grouping (Onion: the whole ring is one group; Clean: every sector's own
 * elements, flattened — this is what makes cross-sector wedge-boundary crowding size the ring too, with no
 * sector-specific code here at all). */
export function ringOutlines<Role extends RingRole>(
  rings: readonly { role: Role; name: string }[],
  slotsOf: (role: Role) => readonly RingedSlot[] = () => [],
): LayoutRing[] {
  const last = rings.length - 1
  const allSlots = rings.map((spec) => slotsOf(spec.role))
  const outlines: Outline[] = []
  const boxesAt = (radius: number, slots: readonly RingedSlot[]): RingedBox[] =>
    slots.map((s) => ({ x: radius * Math.cos(s.angle), y: radius * Math.sin(s.angle), width: s.width, height: RINGED_ELEMENT_HEIGHT }))
  for (let i = 0; i <= last; i++) {
    const spec = rings[i]
    const innermost = i === 0
    const metrics = innermost ? DOMAIN_TITLE : RING_LABEL
    const titleRadius = labelRadius(measure(spec.name, metrics) / 2 + LABEL_PAD_X, titleHeightOf(innermost) / 2)
    const inner = outlines[i - 1]
    const floor = Math.max(inner ? inner.apex + MIN_BAND : 0, titleRadius)
    const slots = allSlots[i]
    // The inner ring's own elements, already fixed at its resolved radius (MIN_BAND alone only keeps two ADJACENT
    // rings' circumferences apart — it says nothing about a wide box aligned radially, e.g. two elements both
    // near angle 0, whose combined half-widths can exceed the band).
    const innerBoxes = inner ? boxesAt(inner.apex, allSlots[i - 1]) : []
    const radius = slots.length || innerBoxes.length ? growUntilFits(floor, (r) => [...boxesAt(r, slots), ...innerBoxes]) : floor
    outlines[i] = circle(radius)
  }
  return rings.map((spec, i) => {
    const innermost = i === 0
    const title = innermost ? spec.name : spec.name.toUpperCase()
    const titleWidth = measure(title, innermost ? DOMAIN_TITLE : RING_LABEL)
    const titleHeight = titleHeightOf(innermost)
    return {
      key: `ring:${spec.role}`,
      role: spec.role,
      title,
      ...outlines[i],
      labelAt: { x: 0, y: -outlines[i].apex + titleHeight / 2 },
      titleBox: { x: -titleWidth / 2, y: -outlines[i].apex, width: titleWidth, height: titleHeight + SUBTITLE_GAP },
    }
  })
}

/** Square bounds enclosing `outer` plus an optional extra reach (e.g. Onion's endpoint ring) and a margin. */
export function ringedBounds(outer: LayoutRing, extraReach = 0, margin = 16): { x: number; y: number; width: number; height: number } {
  const reach = outer.apex + extraReach
  return { x: -reach - margin, y: -reach - margin, width: 2 * (reach + margin), height: 2 * (reach + margin) }
}

interface RingedEndpointSpec {
  id: string
  name: string
  targetId?: string
}

export interface RingedEndpointPlacement {
  key: string
  ref: string
  kind: 'actor' | 'external'
  name: string
  targetId?: string
  x: number
  y: number
}

/** How far outside the outer ring an actor/external sits — no port/adapter concept exists for either kind. */
const ENDPOINT_GAP = 56

/** Actors and externals share one virtual ring outside the outer ring (REQ-05/REQ-07) — identical placement for
 * Onion and Clean (ADR-01). `outerElements` are the outer ring's own already-placed elements (fixed boxes, at
 * their real radius): an endpoint whose angle happens to land close to one, at the default `ENDPOINT_GAP`, can
 * still clip a wide element's box, so the same `growUntilFits` that sizes a ring against its own elements also
 * grows the endpoint radius against both the outer elements and every other endpoint. Returns the extra reach the
 * endpoint ring needs added to `ringedBounds`, so a fresh document with none pays no bounds cost. */
export function endpointLayout(
  actors: readonly RingedEndpointSpec[],
  externals: readonly RingedEndpointSpec[],
  outer: LayoutRing,
  outerElements: readonly RingedBox[] = [],
): { endpoints: RingedEndpointPlacement[]; extraReach: number } {
  const specs: { item: RingedEndpointSpec; kind: 'actor' | 'external' }[] = [
    ...actors.map((item) => ({ item, kind: 'actor' as const })),
    ...externals.map((item) => ({ item, kind: 'external' as const })),
  ]
  if (!specs.length) return { endpoints: [], extraReach: 0 }
  const angles = arcAngles(specs.length, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI)
  const radius = growUntilFits(outer.apex + ENDPOINT_GAP, (r) => [
    ...angles.map((angle) => ({ x: r * Math.cos(angle), y: r * Math.sin(angle), width: RINGED_ENDPOINT_DIAMETER, height: RINGED_ENDPOINT_DIAMETER })),
    ...outerElements,
  ])
  const endpoints: RingedEndpointPlacement[] = specs.map(({ item, kind }, k) => ({
    key: `endpoint:${item.id}`,
    ref: item.id,
    kind,
    name: item.name,
    targetId: item.targetId,
    x: radius * Math.cos(angles[k]),
    y: radius * Math.sin(angles[k]),
  }))
  return { endpoints, extraReach: radius - outer.apex + 24 }
}
