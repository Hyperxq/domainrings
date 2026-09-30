import { RINGED_KIND_LABEL, type RingedKind } from '../model/ringedKinds'
import { LINE_METRICS, measure, RING_LABEL, wrapLabel } from './text'

/** A ring title's own rendered line height — the one thing every ring band must be thick enough to hold. */
export const TITLE_LINE = RING_LABEL.size + 4
/** Clearance kept between a title's own radial reach and its band's inner/outer edge, on each side. Covers the
 * halo's own stroke-width (styles.css, 2px) and real font ascent/descent beyond the `TITLE_LINE` estimate, but is
 * deliberately more generous than that alone needs: Hexagonal's own empty ring bands read at a comparable overall
 * SIZE across all its own sizing terms (MIN_BAND, title depth, domain padding) — a Ringed band this thin only
 * accounted for the title's own bare line height, leaving an empty Onion/Clean roughly half Hexagonal's own scale
 * and so fit-to-screen zoomed to nearly 2× (the reported "the text only looks twice as big"). This pad is what
 * closes that gap back to a comparable on-screen size (`examples.test.ts`'s own fit-scale-parity suite). */
export const RING_TITLE_PAD = 31
/** Padding kept between a curved title's own ends and the rest of its ring's own arc. */
export const TITLE_ARC_PAD = 4
/** The most a ring title's curved arc may span, centred at the top — leaves the lower part of the ring free of
 * title text; a ring only ever grows past MIN_BAND for a title that wouldn't fit even at this generous a span. */
export const TITLE_MAX_SPAN = Math.PI
/** Half the angle a title of arc-length `arcLength` needs at `radius`, capped at `TITLE_MAX_SPAN / 2` — shared by
 * the ring-sizing floor below and `render/Diagram.tsx`'s curved `<textPath>`, so the two never disagree about how
 * wide a title reads. */
export const titleHalfSpan = (arcLength: number, radius: number): number => (radius > 0 ? Math.min(TITLE_MAX_SPAN / 2, arcLength / 2 / radius) : 0)

/** Every axis-aligned angle (`0`, `±π/2`, `π`, …) that an arc sweeping from `from` to `to` actually passes
 * through, plus the arc's own two ends — `cos`/`sin` are each monotonic between any two of these, so a curved
 * shape's true `x`/`y` extremes can only ever land on one of them, never strictly between (the closed-form basis
 * `arcLabelFootprintBox` below needs instead of sampling the curve point by point). */
function arcExtremeAngles(from: number, to: number): number[] {
  const angles = [from, to]
  const step = Math.PI / 2
  for (let k = Math.ceil(from / step); k * step <= to + 1e-9; k++) angles.push(k * step)
  return angles
}

/** A curved label's own rendered footprint at `radius`, centred at ANY `centerAngle` — not just the ring's own
 * top title (the special case `titleFootprintBox` below reduces to). The label rides a true circular arc (an
 * annular sector: radius `± halfThick`, angle `centerAngle ± halfSpan`), never a flat rectangle merely TANGENT to
 * that arc at its own centre angle — a fair stand-in only for a narrow span, but for a small ring's proportionally
 * wide title (`titleHalfSpan` growing toward its own `TITLE_MAX_SPAN`/2 cap as the radius shrinks under a fixed
 * title length) the real curve sweeps much farther round, and at a markedly different radius-projected reach,
 * than a flat rectangle tangent at the centre ever captured (the reported "Domain Model"/"Entities" title, and
 * Clean's own sector name, both read under boxes at a small ring's own few-element band — `ringOutlines`'s own
 * growth search trusted this exact function to say "clear" and never grew the ring the extra bit real clearance
 * needed). `arcExtremeAngles` gives the exact set of angles the shape's own x/y extremes can occur at; evaluating
 * both radii at each gives the shape's true axis-aligned bounding box, not an approximation of it. Shared by
 * `ringOutlines` (Decision 5, and Clean's own per-sector labels) and the real render (`ringedArcPath`), so sizing
 * and the curved `<textPath>` it rides never disagree about where a label actually sits. */
export function arcLabelFootprintBox(radius: number, centerAngle: number, halfSpan: number, halfThick: number = TITLE_LINE / 2): RingedBox {
  const angles = arcExtremeAngles(centerAngle - halfSpan, centerAngle + halfSpan)
  const radii = [radius - halfThick, radius + halfThick]
  const xs = angles.flatMap((a) => radii.map((r) => r * Math.cos(a)))
  const ys = angles.flatMap((a) => radii.map((r) => r * Math.sin(a)))
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

/** An element's kind tag sits on its own small rows above the name, so a box only grows by them when a kind is set. */
export const KIND_METRICS = LINE_METRICS.tag
const KIND_MAX_CHARS = 12
export const KIND_LINE_STEP = 13
export const ringedKindLines = (kind?: RingedKind): string[] => (kind ? wrapLabel(RINGED_KIND_LABEL[kind], KIND_MAX_CHARS) : [])
export const ringedKindHeight = (kind?: RingedKind): number => ringedKindLines(kind).length * KIND_LINE_STEP

export const ringedElementWidth = (name: string, kind?: RingedKind): number =>
  Math.max(...ringedElementLines(name).map((l) => measure(l, RINGED_ELEMENT_METRICS)), ...ringedKindLines(kind).map((l) => measure(l, KIND_METRICS))) + 2 * ELEMENT_PAD_X

/** A single-line name keeps the exact height every existing box always had; only a wrapped name (over
 * `ELEMENT_MAX_CHARS`) grows past it, by `ELEMENT_LINE_STEP` a line — and a kind tag adds its own rows on top. */
export const ringedElementHeight = (name: string, kind?: RingedKind): number => {
  const lines = ringedElementLines(name).length
  return (lines <= 1 ? RINGED_ELEMENT_HEIGHT : lines * ELEMENT_LINE_STEP + 2 * ELEMENT_PAD_Y) + ringedKindHeight(kind)
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
