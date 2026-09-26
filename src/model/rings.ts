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

/** `count` positions spread evenly around a ring's circumference (REQ-07), instead of stacked in a column. Starts
 * offset half a gap past the top (where the ring's title sits) so no element lands under it. */
export function ringCircumferencePositions(count: number, outline: { halfWidth: number }): { x: number; y: number }[] {
  if (count <= 0) return []
  const gap = (2 * Math.PI) / count
  const start = -Math.PI / 2 + gap / 2
  return Array.from({ length: count }, (_, i) => {
    const angle = start + i * gap
    return { x: outline.halfWidth * Math.cos(angle), y: outline.halfWidth * Math.sin(angle) }
  })
}
