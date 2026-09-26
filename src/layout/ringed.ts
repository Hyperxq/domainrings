import type { RingRole } from '../model/kinds'
import { circle, type LayoutRing, type Outline } from './layout'
import { DOMAIN_TITLE, measure, RING_LABEL } from './text'

/** Same floor as the Hexagonal rings' MIN_BAND — keeps ring bands visually consistent across kinds. */
const MIN_BAND = 36
const LABEL_PAD_X = 8
const TITLE_LINE = RING_LABEL.size + 4
const SUBTITLE_GAP = 4

/** Ring outline sizing shared by every "ringed" document kind (Onion, Clean — ADR-01): each ring grows from its
 * own title width or its inner neighbour's edge plus a minimum band, whichever is larger; the innermost ring's
 * title renders sentence-case, every other ring's uppercase. Extracted from Onion's original `layoutOnion` —
 * behaviour-preserving, no element/endpoint placement here (each kind still owns that, since Onion places one
 * element per ring-slot and Clean places them per sector-wedge). */
export function ringOutlines<Role extends RingRole>(rings: readonly { role: Role; name: string }[]): LayoutRing[] {
  const last = rings.length - 1
  const outlines: Outline[] = []
  for (let i = 0; i <= last; i++) {
    const spec = rings[i]
    const innermost = i === 0
    const metrics = innermost ? DOMAIN_TITLE : RING_LABEL
    const titleRadius = measure(spec.name, metrics) / 2 + LABEL_PAD_X
    const inner = outlines[i - 1]
    outlines[i] = circle(Math.max(inner ? inner.apex + MIN_BAND : 0, titleRadius))
  }
  return rings.map((spec, i) => {
    const innermost = i === 0
    const title = innermost ? spec.name : spec.name.toUpperCase()
    const titleWidth = measure(title, innermost ? DOMAIN_TITLE : RING_LABEL)
    const titleHeight = innermost ? DOMAIN_TITLE.size + 4 : TITLE_LINE
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
