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

/** `count` positions spread evenly across the arc from `startAngle` to `endAngle` (radians) — generalizes
 * `ringCircumferencePositions`'s full-circle placement to a sector's own angular sub-range (REQ-08), so Clean's
 * wedge placement and Onion's whole-ring placement share the same spacing rule instead of each re-deriving it.
 * Offset half a gap past `startAngle` so the first (and last) position never lands on the arc's own boundary. */
export function arcPositions(count: number, outline: { halfWidth: number }, startAngle: number, endAngle: number): { x: number; y: number }[] {
  if (count <= 0) return []
  const gap = (endAngle - startAngle) / count
  const start = startAngle + gap / 2
  return Array.from({ length: count }, (_, i) => {
    const angle = start + i * gap
    return { x: outline.halfWidth * Math.cos(angle), y: outline.halfWidth * Math.sin(angle) }
  })
}

/** `count` positions spread evenly around a ring's whole circumference (REQ-07), instead of stacked in a column —
 * the full-circle special case of `arcPositions`, starting at the top (where the ring's title sits). */
export function ringCircumferencePositions(count: number, outline: { halfWidth: number }): { x: number; y: number }[] {
  return arcPositions(count, outline, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI)
}
