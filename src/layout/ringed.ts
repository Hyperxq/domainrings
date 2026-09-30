import { polarPoint } from '../model/rings'
import type { LayoutRing } from './layout'
import { circle, type Outline } from './outline'
import { measure, RING_LABEL } from './text'
import { arcLabelFootprintBox, RING_TITLE_PAD, titleFootprintBox, titleHalfSpan, TITLE_ARC_PAD, TITLE_LINE, TITLE_MAX_SPAN, type RingedBox } from './ringedMetrics'

// Stable path for src/render, which imports the metrics from here.
export { endpointLabelHeight, endpointLines, KIND_LINE_STEP, KIND_METRICS, RINGED_ELEMENT_METRICS, RINGED_ENDPOINT_DIAMETER, ringedElementHeight, ringedElementLines, ringedElementWidth, ringedKindHeight, ringedKindLines, TITLE_ARC_PAD, titleHalfSpan } from './ringedMetrics'

/** The least radial thickness any ring may have — enough to hold its own title's rendered line height with
 * `RING_TITLE_PAD` clearance on both sides. An empty ring (no elements, `ringOutlines`' own early-exit branch
 * below) is sized at EXACTLY this, so this floor is also what an empty Onion/Clean's own world size is built
 * from — too thin here, and a title spills past its own band into the next one (the reported "INTERFACE
 * ADAPTERS" spilling outward, "APPLICATION SERVICES" touching "DOMAIN SERVICES"). */
const MIN_BAND = TITLE_LINE + 2 * RING_TITLE_PAD
const SUBTITLE_GAP = 4
/** Minimum clearance kept between two adjacent boxes, on top of their own widths/heights. */
const BOX_GAP = 3
/** True while two boxes keep at least `BOX_GAP` between them. */
function boxesTooClose(a: RingedBox, b: RingedBox): boolean {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2 + BOX_GAP && Math.abs(a.y - b.y) < (a.height + b.height) / 2 + BOX_GAP
}

/** True while no two boxes overlap by less than `BOX_GAP`. */
export function noOverlap(boxes: readonly RingedBox[]): boolean {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxesTooClose(boxes[i], boxes[j])) return false
    }
  }
  return true
}

/** True while an axis-aligned `box` and a curved label's own true footprint (`arcLabelFootprintBox` — an annular
 * sector at `radius ± halfThick`, spanning `centerAngle ± asin(halfChord / radius)`, `halfChord` being how this
 * function's own callers already had the label's half-width in hand) keep at least `BOX_GAP` apart. Used to be its
 * own separating-axis test (SAT) against a FLAT rectangle merely tangent to the label's own curve at its centre
 * angle — deliberately chosen over that flat rectangle's (then-buggy) axis-aligned bounding box, which reached out
 * toward its own diagonal for an off-axis label and over-grew a ring for clearance no one needed (a measured 2x
 * blow-up on clean-advanced.hexa). Now that `arcLabelFootprintBox` computes the curve's own TRUE bounding box
 * (never an approximation of it, whatever its span), a plain box-vs-box check is both simpler and exact — the
 * SAT it replaces was solving the wrong shape, not a shape this one still needs solving differently. */
export function labelOverlapsBox(box: RingedBox, radius: number, centerAngle: number, halfChord: number, halfThick: number): boolean {
  const halfSpan = Math.asin(Math.min(1, halfChord / radius))
  return boxesTooClose(box, arcLabelFootprintBox(radius, centerAngle, halfSpan, halfThick))
}

/** Smallest `t` (whatever radius `fits` treats it as) satisfying `fits` — the same "grow it until its contents
 * fit" idiom as `fitRing` (layout.ts), but by binary search rather than a closed-form Need list: unlike a
 * hexagon's straight sides, boxes spread around an arc (evenly or not, one ring or mixed with another) have no
 * such formula. Only ever grows `t`, never shrinks it below `minT`, so a ring already large enough for its title
 * and its own elements pays nothing extra. `fits` need not be strictly monotonic in `t` — every `hi` this ever
 * returns is one `fits` already confirmed true, so the result is always safe, if not always the smallest. */
export function growUntilFits(minT: number, fits: (t: number) => boolean): number {
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

/** True while `angle` sits within 90° of `labelCenterAngle` — the same "which half can a centred label actually
 * reach" heuristic as `risksTitle` (its own `labelCenterAngle` is always `-π/2`, the top), generalised to any
 * label's own centre: Clean's own per-sector name, centred at that sector's own wedge mid-angle rather than
 * always the top (`clean.ts`'s own `risksLabelByRole`, and this file's own `slotRisksLabel`). */
export const risksLabelAt = (angle: number, labelCenterAngle: number): boolean => Math.cos(angle - labelCenterAngle) > 0

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
  /** Ceiling on how far this label's own `titleHalfSpan` may reach — a ring's own top title has none (nothing
   * else on its ring bounds it), but a Clean sector's own name is confined to its own wedge (`render/
   * CleanDiagram.tsx`'s own `wedgeHalfSpan`) and never reads past it however long the name is. Without this, the
   * sizing search here judged a many-sector ring's own label reach the same generous way it judges a ring's own
   * top title (unbounded up to `TITLE_MAX_SPAN`/2) — far wider than that label is ever actually drawn, forcing
   * needless extra radial tracks (and so growth) a ring with several narrow sectors never needed. */
  maxHalfSpan?: number
}

export function ringOutlines<Role extends string>(
  rings: readonly { role: Role; name: string }[],
  slotsOf: (role: Role) => readonly RingedSlot[] = () => [],
  extraLabelsOf: (role: Role) => readonly RingedExtraLabel[] = () => [],
): LayoutRing[] {
  const last = rings.length - 1
  const allSlots = rings.map((spec) => slotsOf(spec.role))
  const allExtraLabels = rings.map((spec) => extraLabelsOf(spec.role))
  const outlines: Outline[] = []
  const tracksUsed: number[] = []
  // A slot merely HAVING a `labelIndex` (belonging to some sector, Clean's own case) never told this apart from
  // one that could actually be near enough that sector's own label to need dodging — every element in a sector
  // has one, by construction, whatever its own angle. The real test mirrors `risksTitle`'s own "which half can it
  // reach" heuristic, generalised from always-the-top to that label's own centre angle.
  const slotRisksLabel = (slot: RingedSlot, extraLabels: readonly RingedExtraLabel[]): boolean =>
    slot.labelIndex !== undefined && risksLabelAt(slot.angle, extraLabels[slot.labelIndex].angle)
  const boxesAtTracks = (outerApex: number, innerApex: number, tracks: number, slots: readonly RingedSlot[], extraLabels: readonly RingedExtraLabel[]): RingedBox[] => {
    const radii = slotRadii(
      outerApex,
      innerApex,
      tracks,
      slots.map((s) => s.angle),
      slots.map((s) => slotRisksLabel(s, extraLabels)),
    )
    return slots.map((s, k) => ({ ...polarPoint(radii[k], s.angle), width: s.width, height: s.height }))
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
    // MIN_BAND applies uniformly, including the innermost ring (`innerApex` is already 0 there) — it used to be
    // skipped for i===0, leaving a short innermost title (e.g. a one-word domain name) free to shrink the ring
    // well below its own title's radial reach.
    const floor = Math.max(innerApex + MIN_BAND, titleFloor)
    // The inner ring's own elements, already fixed at its own resolved band (whatever lane count it settled on)
    // — MIN_BAND alone only keeps two ADJACENT rings' circumferences apart, it says nothing about a wide box
    // aligned radially, e.g. two elements both near angle 0, whose combined half-widths can exceed the band.
    const innerTracks = i > 0 ? tracksUsed[i - 1] : 1
    const innerInnerApex = i > 1 ? outlines[i - 2].apex : 0
    const innerBoxes = inner ? boxesAtTracks(inner.apex, innerInnerApex, innerTracks, allSlots[i - 1], allExtraLabels[i - 1]) : []
    const extraLabels = allExtraLabels[i]
    // Decision 5: an element sharing this ring's own band must never sit under its own curved title, nor (Clean
    // only) under its own SECTOR's curved name (the reported "Shipping" sector name under the "Shipment" box,
    // clean-advanced.hexa) — Decision 7's own track dodge (below, `labelIndex` joins `risksTitle` as an at-risk
    // test) gives a label-adjacent slot another radial lane rather than growing the WHOLE ring around a coincidence
    // only that one slot ever has (an earlier version did exactly that: grow `r` until every slot cleared every
    // label, correct but paying for it on EVERY ring regardless — measured a 2x-plus blow-up on clean-advanced.hexa,
    // sinking its own fit-% floor). `labelsClear` still gates `fits` itself (a lane split that still doesn't clear
    // is rejected, same as `boxWithinBand` below), just never the ONLY way out.
    const fitsWithTracks = (tracks: number) => (r: number) => {
      const own = boxesAtTracks(r, innerApex, tracks, slots, extraLabels)
      const midR = mid(r)
      const title = titleFootprintBox(midR, titleArc)
      const labelsClear = extraLabels.every((l, idx) => {
        const halfSpan = Math.min(titleHalfSpan(l.arcLength, midR), l.maxHalfSpan ?? Infinity)
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
    const atRisk = slots.filter((s) => risksTitle(s.angle) || slotRisksLabel(s, extraLabels)).length
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
