import { describe, expect, it } from 'vitest'
import { newCleanMap, newOnionMap } from '../model/hexa'
import type { CleanFile, OnionFile } from '../model/schema'
import { layoutClean } from './clean'
import { layoutOnion } from './onion'
import { ringedElementHeight, ringedElementWidth, titleHalfSpan, TITLE_ARC_PAD, TITLE_LINE } from './ringedMetrics'
import { ringElementRadius } from './ringOutlines'
import { measure, RING_LABEL, RING_SUBTITLE } from './text'

// Decision 5 regression: a ring's own title (and, for Clean, a sector's own curved name) must never sit under a
// box sharing its band — regardless of how few elements that band holds. The original Decision 5 test (`ringed.
// test.ts`) only ever exercised a CROWDED ring (8 elements, forcing a big radius) — a small ring with just 2-5
// elements in plain document order (no crossing-minimisation reshuffle to hide behind, now that Decision 3 is an
// explicit "Tidy ring order" action rather than automatic) never got covered.
//
// This oracle deliberately does NOT call `arcLabelFootprintBox`/`titleFootprintBox` — the very functions the
// sizing search (`ringOutlines`) already trusts to decide "does this fit". Asserting against them would only ever
// prove the code agrees with itself. Instead it independently samples the REAL curved arc (both radial edges, the
// full angular span) the `<textPath>` in `render/Diagram.tsx`/`render/CleanDiagram.tsx` actually paints along, and
// asks whether any sampled point lands inside the element's own box — the same question a person looking at the
// rendered SVG would ask.
function arcSamplesOverlapBox(
  radius: number,
  centerAngle: number,
  halfSpan: number,
  halfThick: number,
  box: { x: number; y: number; width: number; height: number },
): boolean {
  const STEPS = 400
  for (let i = 0; i <= STEPS; i++) {
    const angle = centerAngle - halfSpan + (2 * halfSpan * i) / STEPS
    for (const r of [radius - halfThick, radius + halfThick]) {
      const x = r * Math.cos(angle)
      const y = r * Math.sin(angle)
      if (Math.abs(x - box.x) < box.width / 2 && Math.abs(y - box.y) < box.height / 2) return true
    }
  }
  return false
}

// Realistic short names (the exact ones the reported screenshots used) — long enough to force a real title-vs-box
// risk at a small ring's own radius, never so long that wrapping (Decision 8) changes the shape being tested.
const NAMES = ['Order', 'OrderLine', 'Payment', 'Shipment', 'Customer']

describe("a ring's own title never overlaps its own elements, for 2-5 elements in document order (Onion)", () => {
  for (const role of ['domain', 'application'] as const) {
    for (let count = 2; count <= 5; count++) {
      it(`${role === 'domain' ? 'innermost' : 'a middle'} ring with ${count} elements keeps its title clear`, () => {
        const doc: OnionFile = {
          ...newOnionMap('Fresh'),
          elements: NAMES.slice(0, count).map((name, i) => ({ id: `e${i}`, name, ringRole: role })),
        }
        const model = layoutOnion(doc)
        const ringIndex = model.rings.findIndex((r) => r.role === role)
        const ring = model.rings[ringIndex]
        const inner = model.rings[ringIndex - 1]
        const radius = ringElementRadius(ring, inner)
        const titleArc = measure(ring.title, RING_LABEL) + 2 * TITLE_ARC_PAD
        const halfSpan = titleHalfSpan(titleArc, radius)
        for (const e of model.elements.filter((el) => el.ringRole === role)) {
          const box = { x: e.x, y: e.y, width: ringedElementWidth(e.name), height: ringedElementHeight(e.name) }
          expect(arcSamplesOverlapBox(radius, -Math.PI / 2, halfSpan, TITLE_LINE / 2, box), `"${ring.title}" title overlaps "${e.name}"`).toBe(false)
        }
      })
    }
  }
})

describe("a ring's own title, AND its sector's own name, never overlap their elements, for 2-5 elements (Clean)", () => {
  for (const role of ['domain', 'application'] as const) {
    for (let count = 2; count <= 5; count++) {
      it(`${role === 'domain' ? 'innermost' : 'a middle'} ring/sector with ${count} elements keeps both clear`, () => {
        const sectorId = 's1'
        const doc: CleanFile = {
          ...newCleanMap('Fresh'),
          sectors: [{ id: sectorId, name: 'Ordering', ringRole: role }],
          elements: NAMES.slice(0, count).map((name, i) => ({ id: `e${i}`, name, sectorId })),
        }
        const model = layoutClean(doc)
        const ringIndex = model.rings.findIndex((r) => r.role === role)
        const ring = model.rings[ringIndex]
        const inner = model.rings[ringIndex - 1]
        const radius = ringElementRadius(ring, inner)
        const boxes = model.elements
          .filter((el) => el.ringRole === role)
          .map((e) => ({ name: e.name, x: e.x, y: e.y, width: ringedElementWidth(e.name), height: ringedElementHeight(e.name) }))

        const titleArc = measure(ring.title, RING_LABEL) + 2 * TITLE_ARC_PAD
        const titleHalf = titleHalfSpan(titleArc, radius)
        for (const box of boxes) {
          expect(arcSamplesOverlapBox(radius, -Math.PI / 2, titleHalf, TITLE_LINE / 2, box), `"${ring.title}" ring title overlaps "${box.name}"`).toBe(false)
        }

        // Same geometry `render/CleanDiagram.tsx`'s own SectorLabel builds its curved <textPath> from.
        const sector = model.sectors.find((s) => s.ref === sectorId)!
        const centerAngle = (sector.startAngle + sector.endAngle) / 2
        const wedgeHalfSpan = Math.max(0, (sector.endAngle - sector.startAngle) / 2 - TITLE_ARC_PAD / Math.max(radius, 1))
        const labelArc = measure(sector.name, RING_SUBTITLE) + 2 * TITLE_ARC_PAD
        const labelHalf = Math.min(wedgeHalfSpan, titleHalfSpan(labelArc, radius))
        for (const box of boxes) {
          expect(arcSamplesOverlapBox(radius, centerAngle, labelHalf, TITLE_LINE / 2, box), `"${sector.name}" sector label overlaps "${box.name}"`).toBe(false)
        }
      })
    }
  }
})
