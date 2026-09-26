import type { RingRole } from '../model/kinds'
import { arcAngles } from '../model/rings'
import { circle, type LayoutRing, type Outline } from './layout'
import { measure, RING_LABEL, wrapLabel } from './text'

/** Same floor as the Hexagonal rings' MIN_BAND — keeps ring bands visually consistent across kinds. */
const MIN_BAND = 20
const TITLE_LINE = RING_LABEL.size + 4
const SUBTITLE_GAP = 4
/** Padding kept between a curved title's own ends and the rest of its ring's own arc. */
export const TITLE_ARC_PAD = 4
/** The most a ring title's curved arc may span, centred at the top — leaves the lower part of the ring free of
 * title text; a ring only ever grows past MIN_BAND for a title that wouldn't fit even at this generous a span. */
export const TITLE_MAX_SPAN = Math.PI
/** Half the angle a title of arc-length `arcLength` needs at `radius`, capped at `TITLE_MAX_SPAN / 2` — shared by
 * the ring-sizing floor below and `render/Diagram.tsx`'s curved `<textPath>`, so the two never disagree about how
 * wide a title reads. */
export const titleHalfSpan = (arcLength: number, radius: number): number => (radius > 0 ? Math.min(TITLE_MAX_SPAN / 2, arcLength / 2 / radius) : 0)

/** The title's own rendered footprint at `radius` (its final band mid-radius) — an axis-aligned box centred at
 * the top, wide enough for its curved arc's own chord — approximate but built from the SAME `titleHalfSpan` the
 * real `<textPath>` rides, so `ringOutlines` (Decision 5: give a ring's own title room, never covered by an
 * element sharing its band) and the actual render never disagree about where the title sits. */
export function titleFootprintBox(radius: number, titleArc: number): RingedBox {
  const halfSpan = titleHalfSpan(titleArc, radius)
  return { x: 0, y: -radius, width: 2 * radius * Math.sin(halfSpan), height: TITLE_LINE }
}

/** The one place an element's or endpoint's rendered box size is defined — `render/RingedNodes.tsx` draws to
 * these exact numbers, so a ring sized against them never drifts from what actually gets painted. */
export const RINGED_ELEMENT_METRICS = { size: 13, em: 0.6, tracking: 0 }
const ELEMENT_PAD_X = 5
const ELEMENT_PAD_Y = 6
export const RINGED_ELEMENT_HEIGHT = 26
export const RINGED_ENDPOINT_DIAMETER = 8
/** Minimum clearance kept between two adjacent boxes, on top of their own widths/heights. */
const BOX_GAP = 3
/** A long element name wraps onto more than one line rather than forcing every ring around its own single
 * unbroken line (Decision 8, same idea as Decision 7's radial tracks: absorb the crowding in unread space, not
 * in a bigger ring) — a name at or under this many characters never wraps, keeping every existing short name's
 * box pixel-identical to before. */
const ELEMENT_MAX_CHARS = 7
const ELEMENT_LINE_STEP = 15

/** A ringed element's own name, wrapped the same way Hexagonal's own node labels are (`wrapLabel`, layout/text.ts)
 * — camelCase-aware, never breaking inside a word. */
export const ringedElementLines = (name: string): string[] => wrapLabel(name, ELEMENT_MAX_CHARS)

export const ringedElementWidth = (name: string): number => Math.max(...ringedElementLines(name).map((l) => measure(l, RINGED_ELEMENT_METRICS))) + 2 * ELEMENT_PAD_X

/** A single-line name keeps the exact height every existing box always had; only a wrapped name (over
 * `ELEMENT_MAX_CHARS`) grows past it, by `ELEMENT_LINE_STEP` a line. */
export const ringedElementHeight = (name: string): number => {
  const lines = ringedElementLines(name).length
  return lines <= 1 ? RINGED_ELEMENT_HEIGHT : lines * ELEMENT_LINE_STEP + 2 * ELEMENT_PAD_Y
}

/** An actor/external's own name wraps the same way an element's does (Decision 8) — its label runs AWAY from the
 * origin beside a small dot rather than inside a box, but a long single-line name (e.g. "PaymentGatewayAdapter")
 * still reaches just as far outward, forcing the whole diagram's own bounds out with it. */
const ENDPOINT_MAX_CHARS = 10
export const endpointLines = (name: string): string[] => wrapLabel(name, ENDPOINT_MAX_CHARS)
export const endpointLabelWidth = (name: string): number => Math.max(...endpointLines(name).map((l) => measure(l, RINGED_ELEMENT_METRICS)))
export const endpointLabelHeight = (name: string): number => {
  const lines = endpointLines(name).length
  return lines <= 1 ? RINGED_ELEMENT_METRICS.size : lines * ELEMENT_LINE_STEP
}

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
  height: number
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

/** A crowded band tries up to this many concentric radial lanes for the slots actually at risk of colliding with
 * its own title (Decision 7) before settling on whichever needs the smallest ring. Capped low: more lanes than
 * this squeeze each one unreadably thin for no further benefit (`ringOutlines` only ever keeps a lane count that
 * shrinks the result). */
const MAX_TRACKS = 3

/** True while a slot at `angle` sits in the ring's own UPPER half (`arcAngles`/render's `y = radius·sinθ`, top at
 * -π/2) — the only half a title (always centred at the top) can ever reach, whatever the ring's own radius.
 * Everything below stays exactly where it always sat (Decision 7 leaves it alone): staggering a slot the title
 * can never touch would only cost it radial room (a wide box's own corners reach farther from the ring's own mid
 * the closer its lane sits to the inner or outer edge) for zero benefit. */
const risksTitle = (angle: number): boolean => Math.sin(angle) < 0

/** The radius the `k`-th (of a `tracks`-lane split of the ring's own band) slot sits at — round-robin by index,
 * so slots next to each other in that split usually land on different lanes. `tracks === 1` reduces to the one
 * true mid every ring used before (`ringElementRadius` below still gives that same mid, used by the ring's own
 * title and by every slot this module never diverts, Decision 7). */
function slotRadiusAt(outerApex: number, innerApex: number, tracks: number, k: number): number {
  const lane = (outerApex - innerApex) / tracks
  return innerApex + lane * ((k % tracks) + 0.5)
}

/** Every one of a ring's own slots' radius, given its own resolved `tracks` (Decision 7): a slot the title can
 * never reach (`risksTitle`) stays at the ring's one true mid; the slots that can are round-robin split across
 * `tracks` lanes — round-robin among THEMSELVES (their own relative order among just the at-risk slots), so two
 * at-risk slots next to each other in angle usually land on different lanes without disturbing every other slot's
 * own placement. Shared by `ringOutlines`' own sizing search and every "ringed" kind's real element placement
 * (`ringSlotRadius` below), so the two never disagree about where a slot actually lands. */
function slotRadii(outerApex: number, innerApex: number, tracks: number, angles: readonly number[]): number[] {
  const mid = (innerApex + outerApex) / 2
  let riskIndex = 0
  return angles.map((angle) => (risksTitle(angle) ? slotRadiusAt(outerApex, innerApex, tracks, riskIndex++) : mid))
}

/** Radius each of `angles` (a ring's own slots, in the SAME order `ringOutlines` sized that ring against) sits at
 * — the placement half of Decision 7's own sizing; a `ringed` kind (Onion/Clean) calls this once per ring with
 * every one of its own slots' angles, then zips the result back onto its elements. */
export function ringSlotRadii(ring: Pick<LayoutRing, 'apex' | 'tracks'>, inner: Pick<LayoutRing, 'apex'> | undefined, angles: readonly number[]): number[] {
  return slotRadii(ring.apex, inner?.apex ?? 0, ring.tracks ?? 1, angles)
}

/** Ring outline sizing shared by every "ringed" document kind (Onion, Clean — ADR-01): each ring grows from its
 * inner neighbour's edge plus a minimum band, its own title's curved arc length, or however far out its own
 * elements need to be — both for none of their real boxes to overlap at their placement angles, and for every one
 * of them to stay fully inside its own band (`boxWithinBand`) — whichever is largest. A title needs real space
 * near the top regardless of how big the ring gets (`titleFootprintBox`'s own footprint never shrinks below its
 * arc length) — with every element once forced onto one shared mid-band circle, the ones nearest the top always
 * had to out-grow the title however big the ring got. Decision 7: a slot the title can actually reach tries
 * spreading across more than one radial lane before the ring ever grows around it (`slotRadii` above); every
 * other slot (the title can never reach it, `risksTitle`) stays exactly where the single mid-band circle always
 * put it, since diverting it would only cost radial room for a wide box's own corners, never buy anything back.
 * Every ring's title renders at `RING_LABEL` size (the innermost ring keeps sentence case, every other ring
 * uppercase); `slotsOf` returns every element landing on a ring regardless of sub-grouping (Onion: the whole ring
 * is one group; Clean: every sector's own elements, flattened — this is what makes cross-sector wedge-boundary
 * crowding size the ring too, with no sector-specific code here at all). */
export function ringOutlines<Role extends RingRole>(
  rings: readonly { role: Role; name: string }[],
  slotsOf: (role: Role) => readonly RingedSlot[] = () => [],
): LayoutRing[] {
  const last = rings.length - 1
  const allSlots = rings.map((spec) => slotsOf(spec.role))
  const outlines: Outline[] = []
  const tracksUsed: number[] = []
  const boxesAtTracks = (outerApex: number, innerApex: number, tracks: number, slots: readonly RingedSlot[]): RingedBox[] => {
    const radii = slotRadii(outerApex, innerApex, tracks, slots.map((s) => s.angle))
    return slots.map((s, k) => ({ x: radii[k] * Math.cos(s.angle), y: radii[k] * Math.sin(s.angle), width: s.width, height: s.height }))
  }
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
    // The inner ring's own elements, already fixed at its own resolved band (whatever lane count it settled on)
    // — MIN_BAND alone only keeps two ADJACENT rings' circumferences apart, it says nothing about a wide box
    // aligned radially, e.g. two elements both near angle 0, whose combined half-widths can exceed the band.
    const innerTracks = i > 0 ? tracksUsed[i - 1] : 1
    const innerInnerApex = i > 1 ? outlines[i - 2].apex : 0
    const innerBoxes = inner ? boxesAtTracks(inner.apex, innerInnerApex, innerTracks, allSlots[i - 1]) : []
    // Decision 5: an element sharing this ring's own band must never sit under its own curved title — the ring
    // grows (same `noOverlap` idiom as two crowded elements) until every one of its own boxes clears the title's
    // own footprint, not just each other; MIN_BAND/titleFloor alone said nothing about that (the reported
    // innermost-ring boxes covering the curved title).
    const fitsWithTracks = (tracks: number) => (r: number) => {
      const own = boxesAtTracks(r, innerApex, tracks, slots)
      const title = titleFootprintBox(mid(r), titleArc)
      return noOverlap([title, ...own, ...innerBoxes]) && own.every((b) => boxWithinBand(b, innerApex, r))
    }
    if (!slots.length && !innerBoxes.length) {
      outlines[i] = circle(floor)
      tracksUsed[i] = 1
      continue
    }
    // Decision 7: try 1..MAX_TRACKS lanes for the slots actually at risk of the title and keep whichever needs
    // the smallest ring — more lanes give a crowded upper half more room to dodge the title without growing the
    // circumference, but only pays for that when it actually shrinks the result (a ring with room to spare, or
    // none of its slots anywhere near the top, keeps a single lane, matching every existing single-lane case).
    const atRisk = slots.filter((s) => risksTitle(s.angle)).length
    const maxTracks = Math.min(MAX_TRACKS, Math.max(1, atRisk))
    let best = { tracks: 1, radius: growUntilFits(floor, fitsWithTracks(1)) }
    for (let tracks = 2; tracks <= maxTracks; tracks++) {
      const radius = growUntilFits(floor, fitsWithTracks(tracks))
      if (radius < best.radius) best = { tracks, radius }
    }
    outlines[i] = circle(best.radius)
    tracksUsed[i] = best.tracks
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
      tracks: tracksUsed[i],
      labelAt: { x: 0, y: -outlines[i].apex + titleHeight / 2 },
      titleBox: { x: -titleWidth / 2, y: -outlines[i].apex, width: titleWidth, height: titleHeight + SUBTITLE_GAP },
    }
  })
}

/** Square bounds enclosing `outer` plus an optional extra reach (e.g. Onion's endpoint ring) and a margin. */
export function ringedBounds(outer: LayoutRing, extraReach = 0, margin = 6): { x: number; y: number; width: number; height: number } {
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
const ENDPOINT_GAP = 16

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
  // Decision 6: the reach a fresh document's bounds need to cover isn't the 8px dot's own radius — it's each
  // endpoint's rendered NAME label, which `render/RingedNodes.tsx`'s `RingedEndpointNode` draws starting just past
  // the dot and running away from the origin (never toward it), plus the label's own half text-height vertically.
  // Missing this let a long name (e.g. "ShippingAdapter") sit mostly outside `ringedBounds`, clipped on export/fit.
  // Decision 8: the label wraps the same as an element's own name, so a long one (e.g. "PaymentGatewayAdapter")
  // reaches outward by its own widest LINE, never its whole unbroken name.
  const labelReach = endpoints.length
    ? Math.max(
        ...endpoints.map((e) => Math.abs(e.x) + RINGED_ENDPOINT_DIAMETER / 2 + 4 + endpointLabelWidth(e.name)),
        ...endpoints.map((e) => Math.abs(e.y) + endpointLabelHeight(e.name) / 2),
      )
    : 0
  return { endpoints, extraReach: Math.max(radius - outer.apex + 12, labelReach - outer.apex) }
}
