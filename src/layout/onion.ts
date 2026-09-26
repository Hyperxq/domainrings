import type { OnionFile } from '../model/schema'
import { circle, type Box, type LayoutRing, type Outline } from './layout'
import { DOMAIN_TITLE, measure, RING_LABEL } from './text'

export interface OnionLayoutModel {
  rings: LayoutRing[]
  bounds: Box
}

/** Same floor as the Hexagonal/Clean rings' MIN_BAND — keeps ring bands visually consistent across kinds. */
const MIN_BAND = 36
const LABEL_PAD_X = 8
const MARGIN = 16
const TITLE_LINE = RING_LABEL.size + 4
const SUBTITLE_GAP = 4

/** Innermost-first (REQ-02) — `doc.rings[0]` is the domain, the one big sentence-case title; every outer ring
 * (built from it outward) grows from its own inner neighbour, mirroring layoutDiagram's domain-outward solve. */
export function layoutOnion(doc: OnionFile): OnionLayoutModel {
  const last = doc.rings.length - 1
  const outlines: Outline[] = []
  for (let i = 0; i <= last; i++) {
    const spec = doc.rings[i]
    const innermost = i === 0
    const metrics = innermost ? DOMAIN_TITLE : RING_LABEL
    const titleRadius = measure(spec.name, metrics) / 2 + LABEL_PAD_X
    const inner = outlines[i - 1]
    outlines[i] = circle(Math.max(inner ? inner.apex + MIN_BAND : 0, titleRadius))
  }

  const rings: LayoutRing[] = doc.rings.map((spec, i) => {
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

  const outer = outlines[last]
  return {
    rings,
    bounds: { x: -outer.halfWidth - MARGIN, y: -outer.apex - MARGIN, width: 2 * (outer.halfWidth + MARGIN), height: 2 * (outer.apex + MARGIN) },
  }
}
