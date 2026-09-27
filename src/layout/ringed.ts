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

/** A curved label's own rendered footprint at `radius`, centred at ANY `centerAngle` — not just the ring's own
 * top title (the special case `titleFootprintBox` below reduces to). Built in the label's own local frame (radial
 * "outward", tangential "along the arc") — a simple `halfThick`×`halfChord` rectangle there — then its 4 corners
 * are rotated into global coordinates and enclosed in an axis-aligned box, the correctly general version of the
 * old top-only shortcut (which took the two chord ENDPOINT corners and assumed they were always the box's own
 * farthest reach — true only at the top, where radial and tangential already line up with global y/x; at any
 * other centre angle a wide-enough arc's own MIDPOINT reaches farther outward than either endpoint corner, e.g. a
 * sector label centred at 3 o'clock, which the endpoint-only version measured as having almost no width at all).
 * Shared by `ringOutlines` (Decision 5, and Clean's own per-sector labels) and the real render (`ringedArcPath`),
 * so sizing and the curved `<textPath>` it rides never disagree about where a label actually sits. */
export function arcLabelFootprintBox(radius: number, centerAngle: number, halfSpan: number): RingedBox {
  const radial = { x: Math.cos(centerAngle), y: Math.sin(centerAngle) }
  const tangential = { x: -Math.sin(centerAngle), y: Math.cos(centerAngle) }
  const center = { x: radius * radial.x, y: radius * radial.y }
  const halfChord = radius * Math.sin(halfSpan)
  const halfThick = TITLE_LINE / 2
  const corners = [-1, 1].flatMap((dr) =>
    [-1, 1].map((dt) => ({
      x: center.x + dr * halfThick * radial.x + dt * halfChord * tangential.x,
      y: center.y + dr * halfThick * radial.y + dt * halfChord * tangential.y,
    })),
  )
  const xs = corners.map((c) => c.x)
  const ys = corners.map((c) => c.y)
  const [xMin, xMax] = [Math.min(...xs), Math.max(...xs)]
  const [yMin, yMax] = [Math.min(...ys), Math.max(...ys)]
  return { x: (xMin + xMax) / 2, y: (yMin + yMax) / 2, width: xMax - xMin, height: yMax - yMin }
}

/** The ring's own title footprint (always centred at the top, `-π/2`) — the one `arcLabelFootprintBox` case every
 * ring needed before Clean's own per-sector labels (Decision 5: give a ring's own title room, never covered by an
 * element sharing its band); `ringOutlines` and the real render (`render/Diagram.tsx`'s curved `<textPath>`) both
 * build it from the SAME `titleHalfSpan`, so sizing and rendering never disagree about how wide a title reads. */
export function titleFootprintBox(radius: number, titleArc: number): RingedBox {
  return arcLabelFootprintBox(radius, -Math.PI / 2, titleHalfSpan(titleArc, radius))
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
 * box pixel-identical to before. Raised from an earlier, much stricter 7 (which shattered "OrderLine" into
 * "Order"/"Line" and "CarrierApiClient" into "Carrier"/"Api"/"Client" one word per line) just enough to keep a
 * short compound name on one line and a two-word one to two — going further to also guarantee a THIRD long token
 * ("FraudDetectionService", "ArrangeShipmentService", …) never exceeds 2 lines widens every box on an already
 * crowded ring at once, measured (`examples.test.ts`'s own fit-% suite) to cost far more circumference than the
 * extra line it buys back: it drove onion-advanced's fit from 72.9% to 61.3%, well under its own 70% floor. A
 * handful of three-token names stay at 3 lines of legible whole words — a smaller compromise than a ring wide
 * enough that nothing fits the stage at all. */
const ELEMENT_MAX_CHARS = 9
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

/** True while two boxes keep at least `BOX_GAP` between them. */
function boxesTooClose(a: RingedBox, b: RingedBox): boolean {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2 + BOX_GAP && Math.abs(a.y - b.y) < (a.height + b.height) / 2 + BOX_GAP
}

/** True while no two boxes overlap by less than `BOX_GAP`. */
function noOverlap(boxes: readonly RingedBox[]): boolean {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxesTooClose(boxes[i], boxes[j])) return false
    }
  }
  return true
}

/** True while an axis-aligned `box` and a label's own TILTED rectangle (centred at `radius`/`centerAngle`, tangential
 * half-extent `halfChord`, radial half-extent `halfThick`) keep at least `BOX_GAP` apart — the full separating-axis
 * test (SAT) between the two, rather than that tilted rectangle's own (generously larger) axis-aligned bounding box
 * (`arcLabelFootprintBox`): that AABB is exact only when the label sits at the top (where radial/tangential already
 * line up with global y/x, `titleFootprintBox`'s own case) — at any other centre angle a thin tilted rectangle's
 * AABB reaches out toward its own diagonal, which overstated how much a Clean sector's own label (rarely centred at
 * the top) actually crowds nearby elements, growing a ring far more than the real curved text ever needed (a
 * measured 2x blow-up on clean-advanced.hexa, sinking its own fit-% floor). Complete for two rectangles at any
 * relative rotation: the box's own edge normals are the world axes, the label's own are `radial`/`tangential`. */
export function labelOverlapsBox(box: RingedBox, radius: number, centerAngle: number, halfChord: number, halfThick: number): boolean {
  const radial = { x: Math.cos(centerAngle), y: Math.sin(centerAngle) }
  const tangential = { x: -Math.sin(centerAngle), y: Math.cos(centerAngle) }
  const center = { x: radius * radial.x, y: radius * radial.y }
  const d = { x: box.x - center.x, y: box.y - center.y }
  for (const axis of [{ x: 1, y: 0 }, { x: 0, y: 1 }, radial, tangential]) {
    const dist = Math.abs(d.x * axis.x + d.y * axis.y)
    const boxReach = (box.width / 2) * Math.abs(axis.x) + (box.height / 2) * Math.abs(axis.y)
    const labelReach = halfChord * Math.abs(tangential.x * axis.x + tangential.y * axis.y) + halfThick * Math.abs(radial.x * axis.x + radial.y * axis.y)
    if (dist > boxReach + labelReach + BOX_GAP) return false
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

/** An element about to be placed at `angle` on some ring, before that ring's radius is known. `labelIndex` ties it
 * to one of that ring's own `extraLabelsOf` entries (Clean: the slot's own sector, by array position) — a label
 * only ever needs clearance from the slots that are actually ITS OWN (Decision 5's ring-title check stays global,
 * every slot on the ring; a sector's own name only ever crowds its own sector's elements, never a neighbour's on
 * the far side of the same ring). `undefined` (Onion; a ring's own top title) opts a slot out of every extra
 * label's own check entirely. */
export interface RingedSlot {
  angle: number
  width: number
  height: number
  labelIndex?: number
}

/** Radius at which a ring's OWN elements (and, via `titleHalfSpan` above, its own curved title) sit: the middle
 * of its band, between its inner neighbour's own edge (or the origin, for the innermost ring/disc) and this
 * ring's own outer edge — never at the outer edge itself, which is exactly the line the next ring out paints
 * over (the reported straddling "NewElement" box, and before it the clipped "Domain Mod"/"MAIN SERVIC" titles). */
export function ringElementRadius(ring: Pick<LayoutRing, 'apex'>, inner?: Pick<LayoutRing, 'apex'>): number {
  return ((inner?.apex ?? 0) + ring.apex) / 2
}

/** Real visual clearance a box must keep from its own band's PAINTED boundary — more than the ring's own stroke
 * half-width (`.ring { stroke-width: 1.6 }`, styles.css) plus a little breathing room. Zero margin (mathematical
 * touching) used to count as "fits": a box sized that tight always reads as crossing the rendered ring line, since
 * the stroke straddles the exact boundary the box's own corner sits on (the reported "Pricing Service"/"Place
 * Order Service"/"Order Controller" straddling their own ring, onion-basic.hexa — the sizing search and this
 * band-membership test always agreed on paper, they just both allowed a fit with no room for a stroke). */
export const BAND_CLEARANCE = 1

/** True when every corner of an axis-aligned box centred at `(x, y)` lies within `[inner, outer]` distance from
 * the origin, each with `BAND_CLEARANCE` room to spare — the EXACT test, not a same-direction radial projection: a
 * box not centred on an axis has corners that reach further from the origin than its centre-plus-projection alone
 * would suggest (Pythagoras combines the radial and tangential offsets), so only checking the actual farthest and
 * nearest corners is safe. `inner === 0` is the innermost ring's own centre, never a drawn line, so nothing to
 * clear there. */
export function boxWithinBand(box: RingedBox, inner: number, outer: number): boolean {
  const [ax, ay] = [Math.abs(box.x), Math.abs(box.y)]
  const [hw, hh] = [box.width / 2, box.height / 2]
  const farthest = Math.hypot(ax + hw, ay + hh)
  const nearest = Math.hypot(Math.max(0, ax - hw), Math.max(0, ay - hh))
  return farthest <= outer - BAND_CLEARANCE + 1e-9 && nearest >= inner - 1e-9
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
function slotRadii(outerApex: number, innerApex: number, tracks: number, angles: readonly number[], extraRisk: readonly boolean[] = []): number[] {
  const mid = (innerApex + outerApex) / 2
  let riskIndex = 0
  return angles.map((angle, k) => (risksTitle(angle) || extraRisk[k] ? slotRadiusAt(outerApex, innerApex, tracks, riskIndex++) : mid))
}

/** Radius each of `angles` (a ring's own slots, in the SAME order `ringOutlines` sized that ring against) sits at
 * — the placement half of Decision 7's own sizing; a `ringed` kind (Onion/Clean) calls this once per ring with
 * every one of its own slots' angles, then zips the result back onto its elements. `extraRisk[k]` (parallel to
 * `angles`) marks a slot at risk of something OTHER than the ring's own top title — Clean's own lone-sector
 * elements, which always coincide with their own sector's curved name (`labelIndex`, `layout/clean.ts`) — treated
 * by the SAME lane-split Decision 7 already gives a title-crowded slot, rather than growing the whole ring around
 * a coincidence only one slot ever has. */
export function ringSlotRadii(ring: Pick<LayoutRing, 'apex' | 'tracks'>, inner: Pick<LayoutRing, 'apex'> | undefined, angles: readonly number[], extraRisk: readonly boolean[] = []): number[] {
  return slotRadii(ring.apex, inner?.apex ?? 0, ring.tracks ?? 1, angles, extraRisk)
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
/** A ring-specific curved label OTHER than its own top title — Clean's own per-sector name (`render/
 * CleanDiagram.tsx`'s `SectorLabel`), centred at that sector's own wedge mid-angle rather than always the top.
 * `arcLength` is the label's own desired reach (`measure(name, RING_SUBTITLE) + 2 * TITLE_ARC_PAD`, the same
 * quantity `titleArc` is for a ring's own title), turned into a footprint the same way (`titleHalfSpan`) once this
 * ring's own mid-band radius is known. */
export interface RingedExtraLabel {
  angle: number
  arcLength: number
}

export function ringOutlines<Role extends RingRole>(
  rings: readonly { role: Role; name: string }[],
  slotsOf: (role: Role) => readonly RingedSlot[] = () => [],
  extraLabelsOf: (role: Role) => readonly RingedExtraLabel[] = () => [],
): LayoutRing[] {
  const last = rings.length - 1
  const allSlots = rings.map((spec) => slotsOf(spec.role))
  const outlines: Outline[] = []
  const tracksUsed: number[] = []
  const boxesAtTracks = (outerApex: number, innerApex: number, tracks: number, slots: readonly RingedSlot[]): RingedBox[] => {
    const radii = slotRadii(
      outerApex,
      innerApex,
      tracks,
      slots.map((s) => s.angle),
      slots.map((s) => s.labelIndex !== undefined),
    )
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
    const extraLabels = extraLabelsOf(spec.role)
    // Decision 5: an element sharing this ring's own band must never sit under its own curved title, nor (Clean
    // only) under its own SECTOR's curved name (the reported "Shipping" sector name under the "Shipment" box,
    // clean-advanced.hexa) — Decision 7's own track dodge (below, `labelIndex` joins `risksTitle` as an at-risk
    // test) gives a label-adjacent slot another radial lane rather than growing the WHOLE ring around a coincidence
    // only that one slot ever has (an earlier version did exactly that: grow `r` until every slot cleared every
    // label, correct but paying for it on EVERY ring regardless — measured a 2x-plus blow-up on clean-advanced.hexa,
    // sinking its own fit-% floor). `labelsClear` still gates `fits` itself (a lane split that still doesn't clear
    // is rejected, same as `boxWithinBand` below), just never the ONLY way out.
    const fitsWithTracks = (tracks: number) => (r: number) => {
      const own = boxesAtTracks(r, innerApex, tracks, slots)
      const midR = mid(r)
      const title = titleFootprintBox(midR, titleArc)
      const labelsClear = extraLabels.every((l, idx) => {
        const halfSpan = titleHalfSpan(l.arcLength, midR)
        const halfChord = midR * Math.sin(halfSpan)
        return own.every((b, k) => slots[k].labelIndex !== idx || !labelOverlapsBox(b, midR, l.angle, halfChord, TITLE_LINE / 2))
      })
      return labelsClear && noOverlap([title, ...own, ...innerBoxes]) && own.every((b) => boxWithinBand(b, innerApex, r))
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
    const atRisk = slots.filter((s) => risksTitle(s.angle) || s.labelIndex !== undefined).length
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
