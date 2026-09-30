/** Shared, kind-agnostic ring primitives (ADR-03): the inward-only dependency rule and circumference placement,
 * generic over an ordered role list — reused by Onion's own integrity check/layout and, later, native-clean's. */

/** True when a dependency from `fromRole` to `toRole` stays within the same ring or points to a more inward one
 * (REQ-04) — `rings` is innermost-first, so "inward or same" means `toRole`'s index is no greater than `fromRole`'s. */
export function isInwardOrSame(rings: readonly { role: string }[], fromRole: string, toRole: string): boolean {
  const fromIndex = rings.findIndex((r) => r.role === fromRole)
  const toIndex = rings.findIndex((r) => r.role === toRole)
  return toIndex <= fromIndex
}

/** The outermost ring's role (REQ-05: only its elements may receive an actor/external's direct arrow) — `rings`
 * is innermost-first, so it is always the last entry regardless of how many rings there are. Generic over the
 * role type (rather than widening to `string`) so a caller's literal role union survives the round trip. */
export function outerRoleOf<Role extends string>(rings: readonly { role: Role }[]): Role {
  return rings[rings.length - 1].role
}

/** `count` angles spread evenly across the arc from `startAngle` to `endAngle` (radians), offset half a gap past
 * `startAngle` so the first (and last) angle never lands on the arc's own boundary — the angle half of
 * `arcPositions`, split out so a ring's radius can be sized (`ringOutlines`, layout/ringOutlines.ts) against each
 * element's real angle before that radius is known, using the exact same spacing rule its final placement uses. */
export function arcAngles(count: number, startAngle: number, endAngle: number): number[] {
  if (count <= 0) return []
  const gap = (endAngle - startAngle) / count
  const start = startAngle + gap / 2
  return Array.from({ length: count }, (_, i) => start + i * gap)
}

/** A solitary slot's own arc always lands dead-centre of its span (`arcAngles`' one-count case: `startAngle + gap
 * / 2` with `gap` the whole span) — exactly where a CENTRED label also always sits, whether that's a ring's own
 * top title on a full-circle span (Onion's shape) or a Clean sector's own name on its narrower wedge. Two costs
 * this one nudge fixes together: a document made mostly of single-element rings (Onion's most common small shape)
 * stacks every one of them into one straight vertical column (the reported "Order"/"Pricing Service"/"Place Order
 * Service"/"Order Controller" column, onion-basic.hexa); and a sector with exactly one element sits right under
 * that sector's own curved name (the reported "Shipping" sector name under the "Shipment" box, clean-advanced.hexa)
 * — both are the same "dead-centre coincides with a centred label" shape. `fraction` keeps the offset well inside
 * the span (never near either boundary, where a narrow sector's neighbour starts) while still varying enough by
 * ring index that a chain of full-circle spans (Onion) never repeats the same angle twice. */
const LONE_SLOT_FRACTIONS = [0.42, 0.49]

function loneSlotOffset(ringIndex: number, halfSpan: number): number {
  const side = ringIndex % 2 === 0 ? -1 : 1
  const fraction = LONE_SLOT_FRACTIONS[Math.floor(ringIndex / 2) % LONE_SLOT_FRACTIONS.length]
  return side * fraction * halfSpan
}

/** `arcAngles`, nudging a SOLITARY slot off dead-centre by its own ring's index (`loneSlotOffset`) rather than
 * always the exact midpoint a centred label (ring title or Clean sector name) also always sits at. Two or more
 * slots keep `arcAngles`' own even spacing untouched — only a lone slot ever coincides with a centred label in the
 * first place. */
export function ringedArcAngles(count: number, startAngle: number, endAngle: number, ringIndex: number): number[] {
  if (count !== 1) return arcAngles(count, startAngle, endAngle)
  const halfSpan = (endAngle - startAngle) / 2
  const center = startAngle + halfSpan
  return [center + loneSlotOffset(ringIndex, halfSpan)]
}

/** The one polar→cartesian conversion every "ringed" placement site shares (Onion/Clean elements, insertion "+"s,
 * label footprints, endpoint layout) rather than each hand-rolling `{ x: r·cos(a), y: r·sin(a) }`. */
export function polarPoint(radius: number, angle: number): { x: number; y: number } {
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) }
}

/** `count` positions spread evenly across the arc from `startAngle` to `endAngle` (radians) — generalizes
 * `ringCircumferencePositions`'s full-circle placement to a sector's own angular sub-range (REQ-08), so Clean's
 * wedge placement and Onion's whole-ring placement share the same spacing rule instead of each re-deriving it. */
export function arcPositions(count: number, outline: { halfWidth: number }, startAngle: number, endAngle: number): { x: number; y: number }[] {
  return arcAngles(count, startAngle, endAngle).map((angle) => polarPoint(outline.halfWidth, angle))
}

/** `count` positions spread evenly around a ring's whole circumference (REQ-07), instead of stacked in a column —
 * the full-circle special case of `arcPositions`, starting at the top (where the ring's title sits). */
export function ringCircumferencePositions(count: number, outline: { halfWidth: number }): { x: number; y: number }[] {
  return arcPositions(count, outline, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI)
}
