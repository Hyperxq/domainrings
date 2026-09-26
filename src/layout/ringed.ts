import type { RingRole } from '../model/kinds'
import { arcAngles } from '../model/rings'
import { circle, type LayoutRing, type Outline } from './layout'
import { measure, RING_LABEL } from './text'

/** Same floor as the Hexagonal rings' MIN_BAND — keeps ring bands visually consistent across kinds. */
const MIN_BAND = 36
const TITLE_LINE = RING_LABEL.size + 4
const SUBTITLE_GAP = 4
/** Padding kept between a curved title's own ends and the rest of its ring's own arc. */
export const TITLE_ARC_PAD = 8
/** The most a ring title's curved arc may span, centred at the top — leaves the lower part of the ring free of
 * title text; a ring only ever grows past MIN_BAND for a title that wouldn't fit even at this generous a span. */
export const TITLE_MAX_SPAN = Math.PI
/** Half the angle a title of arc-length `arcLength` needs at `radius`, capped at `TITLE_MAX_SPAN / 2` — shared by
 * the ring-sizing floor below and `render/Diagram.tsx`'s curved `<textPath>`, so the two never disagree about how
 * wide a title reads. */
export const titleHalfSpan = (arcLength: number, radius: number): number => (radius > 0 ? Math.min(TITLE_MAX_SPAN / 2, arcLength / 2 / radius) : 0)

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

/** True while no two boxes overlap by less than `BOX_GAP`. */
function noOverlap(boxes: readonly RingedBox[]): boolean {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]]
      if (Math.abs(a.x - b.x) < (a.width + b.width) / 2 + BOX_GAP && Math.abs(a.y - b.y) < (a.height + b.height) / 2 + BOX_GAP) return false
    }
  }
  return true
}

/** Smallest `t` (whatever radius `fits` treats it as) satisfying `fits` — the same "grow it until its contents
 * fit" idiom as `fitRing` (layout.ts), but by binary search rather than a closed-form Need list: unlike a
 * hexagon's straight sides, boxes spread around an arc (evenly or not, one ring or mixed with another) have no
 * such formula. Only ever grows `t`, never shrinks it below `minT`, so a ring already large enough for its title
 * and its own elements pays nothing extra. `fits` need not be strictly monotonic in `t` — every `hi` this ever
 * returns is one `fits` already confirmed true, so the result is always safe, if not always the smallest. */
function growUntilFits(minT: number, fits: (t: number) => boolean): number {
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

/** Radius at which a ring's OWN elements (and, via `titleHalfSpan` above, its own curved title) sit: the middle
 * of its band, between its inner neighbour's own edge (or the origin, for the innermost ring/disc) and this
 * ring's own outer edge — never at the outer edge itself, which is exactly the line the next ring out paints
 * over (the reported straddling "NewElement" box, and before it the clipped "Domain Mod"/"MAIN SERVIC" titles). */
export function ringElementRadius(ring: Pick<LayoutRing, 'apex'>, inner?: Pick<LayoutRing, 'apex'>): number {
  return ((inner?.apex ?? 0) + ring.apex) / 2
}

/** True when every corner of an axis-aligned box centred at `(x, y)` lies within `[inner, outer]` distance from
 * the origin (touching either edge allowed) — the EXACT test, not a same-direction radial projection: a box not
 * centred on an axis has corners that reach further from the origin than its centre-plus-projection alone would
 * suggest (Pythagoras combines the radial and tangential offsets), so only checking the actual farthest and
 * nearest corners is safe. */
function boxWithinBand(box: RingedBox, inner: number, outer: number): boolean {
  const [ax, ay] = [Math.abs(box.x), Math.abs(box.y)]
  const [hw, hh] = [box.width / 2, box.height / 2]
  const farthest = Math.hypot(ax + hw, ay + hh)
  const nearest = Math.hypot(Math.max(0, ax - hw), Math.max(0, ay - hh))
  return farthest <= outer + 1e-9 && nearest >= inner - 1e-9
}

/** Ring outline sizing shared by every "ringed" document kind (Onion, Clean — ADR-01): each ring grows from its
 * inner neighbour's edge plus a minimum band, its own title's curved arc length, or however far out its own
 * elements need to be — both for none of their real boxes to overlap at their placement angles, and for every one
 * of them to stay fully inside its own band (`boxWithinBand`) — whichever is largest. Every ring's title renders
 * at `RING_LABEL` size (the innermost ring keeps sentence case, every other ring uppercase); `slotsOf` returns
 * every element landing on a ring regardless of sub-grouping (Onion: the whole ring is one group; Clean: every
 * sector's own elements, flattened — this is what makes cross-sector wedge-boundary crowding size the ring too,
 * with no sector-specific code here at all). */
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
    const title = innermost ? spec.name : spec.name.toUpperCase()
    const inner = outlines[i - 1]
    const innerApex = inner ? inner.apex : 0
    const mid = (r: number) => (innerApex + r) / 2
    // Smallest OUTER radius `r` whose mid-band radius, `mid(r)`, gives the title's own curved arc length enough
    // room within TITLE_MAX_SPAN — the inverse of `titleHalfSpan` above, so sizing and rendering never disagree.
    const titleArc = measure(title, RING_LABEL) + 2 * TITLE_ARC_PAD
    const titleFloor = 2 * (titleArc / TITLE_MAX_SPAN) - innerApex
    const slots = allSlots[i]
    const floor = Math.max(inner ? inner.apex + MIN_BAND : 0, titleFloor)
    // The inner ring's own elements, already fixed at its own resolved mid-band radius (MIN_BAND alone only keeps
    // two ADJACENT rings' circumferences apart — it says nothing about a wide box aligned radially, e.g. two
    // elements both near angle 0, whose combined half-widths can exceed the band).
    const innerMid = inner ? ringElementRadius(inner, outlines[i - 2]) : 0
    const innerBoxes = inner ? boxesAt(innerMid, allSlots[i - 1]) : []
    const fits = (r: number) => {
      const own = boxesAt(mid(r), slots)
      return noOverlap([...own, ...innerBoxes]) && own.every((b) => boxWithinBand(b, innerApex, r))
    }
    const radius = slots.length || innerBoxes.length ? growUntilFits(floor, fits) : floor
    outlines[i] = circle(radius)
  }
  return rings.map((spec, i) => {
    const innermost = i === 0
    const title = innermost ? spec.name : spec.name.toUpperCase()
    const titleWidth = measure(title, RING_LABEL)
    const titleHeight = TITLE_LINE
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
  const radius = growUntilFits(outer.apex + ENDPOINT_GAP, (r) =>
    noOverlap([
      ...angles.map((angle) => ({ x: r * Math.cos(angle), y: r * Math.sin(angle), width: RINGED_ENDPOINT_DIAMETER, height: RINGED_ENDPOINT_DIAMETER })),
      ...outerElements,
    ]),
  )
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
