import type { CleanFile } from '../model/schema'
import type { Box, LayoutRing } from './layout'
import { ringedBounds, ringOutlines } from './ringed'

export interface CleanLayoutModel {
  rings: LayoutRing[]
  bounds: Box
}

/** Ring outlines only (ADR-01: shares `ringOutlines` with Onion) — a fresh Clean document has no sectors or
 * elements yet, so there is nothing to place inside a ring beyond its outline. */
export function layoutClean(doc: CleanFile): CleanLayoutModel {
  const rings = ringOutlines(doc.rings)
  return { rings, bounds: ringedBounds(rings[rings.length - 1]) }
}
