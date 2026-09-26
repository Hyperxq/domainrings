import { describe, expect, it } from 'vitest'
import { newCleanMap, newOnionMap } from '../model/hexa'
import { arcAngles } from '../model/rings'
import {
  endpointLabelHeight,
  endpointLabelWidth,
  endpointLayout,
  RINGED_ELEMENT_HEIGHT,
  RINGED_ENDPOINT_DIAMETER,
  ringedBounds,
  ringElementRadius,
  ringOutlines,
  ringSlotRadii,
  titleFootprintBox,
  TITLE_ARC_PAD,
  TITLE_MAX_SPAN,
} from './ringed'
import { measure, RING_LABEL } from './text'

// Direct unit coverage for the shared ring-outline/bounds sizing (ADR-01) — previously exercised only
// indirectly through layout/onion.test.ts and the Clean creation test (verify-in-loop-1, WARNING b).

describe('ringOutlines', () => {
  it('grows each ring outward from its inner neighbour, sentence-case for the innermost, uppercase for the rest', () => {
    const rings = ringOutlines([
      { role: 'domain', name: 'Entities' },
      { role: 'application', name: 'Use Cases' },
    ])
    expect(rings).toHaveLength(2)
    expect(rings[0].role).toBe('domain')
    expect(rings[0].title).toBe('Entities')
    expect(rings[1].title).toBe('USE CASES')
    // Each outer ring must enclose its inner neighbour.
    expect(rings[1].apex).toBeGreaterThan(rings[0].apex)
  })

  it('a wider ring title grows that ring past the minimum band', () => {
    const short = ringOutlines([{ role: 'domain', name: 'X' }])
    const long = ringOutlines([{ role: 'domain', name: 'A Very Long Domain Ring Title Indeed' }])
    expect(long[0].apex).toBeGreaterThan(short[0].apex)
  })
})

describe('ringedBounds', () => {
  it('encloses the outer ring plus margin, square and centered on the origin', () => {
    const [ring] = ringOutlines([{ role: 'domain', name: 'Entities' }])
    const bounds = ringedBounds(ring)
    expect(bounds.width).toBe(bounds.height)
    expect(bounds.x).toBe(-bounds.width / 2)
    expect(bounds.y).toBe(-bounds.height / 2)
  })

  it('reaches further out when given an extra reach (e.g. Onion endpoints)', () => {
    const [ring] = ringOutlines([{ role: 'domain', name: 'Entities' }])
    const plain = ringedBounds(ring)
    const extended = ringedBounds(ring, 56)
    expect(extended.width).toBeGreaterThan(plain.width)
  })
})

// A ring's title now reads along a curved arc at its own band's MID radius (render/Diagram.tsx's `<textPath>`),
// not as straight text near the pole — so the only thing that must fit is the label's own arc length against the
// USABLE arc length its mid-band radius offers within TITLE_MAX_SPAN, never a straight chord (that was af5734e's
// approach, reverted: it inflated an empty ring's radius from its title alone).
describe('ring titles fit the usable arc length at their own band (no clipping by the next ring out)', () => {
  function assertLabelsFit(rings: ReturnType<typeof ringOutlines>) {
    rings.forEach((ring, i) => {
      const labelArcLength = measure(ring.title, RING_LABEL) + 2 * TITLE_ARC_PAD
      const usableArcLength = TITLE_MAX_SPAN * ringElementRadius(ring, rings[i - 1])
      expect(labelArcLength).toBeLessThanOrEqual(usableArcLength + 1e-6)
    })
  }

  it('an empty Onion file: every ring title fits the usable arc length at its own band', () => {
    assertLabelsFit(ringOutlines(newOnionMap('Fresh').rings))
  })

  it('an empty Clean file: every ring title fits the usable arc length at its own band', () => {
    assertLabelsFit(ringOutlines(newCleanMap('Fresh').rings))
  })
})

// af5734e's pole-chord growth inflated an empty Onion file's outer ring from ~198px (measured against the
// pre-af5734e formula: half title width + a flat pad, growing only by MIN_BAND per ring) to ~783px. The curved
// title fix above removes that growth; this pins the outer ring back to a comparable, compact size.
// Decision 5: the innermost ring's own elements crowded right where its curved title reads, hiding it — nothing
// in the old sizing ever checked title-vs-element, only element-vs-element and element-vs-band.
describe("a ring's own title never overlaps its own elements (Decision 5)", () => {
  const boxesOverlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
    Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(a.y - b.y) < (a.height + b.height) / 2

  it('8 elements densely packed around the innermost ring all clear a long title', () => {
    const name = 'Entities Of The Domain Model'
    const count = 8
    const angles = arcAngles(count, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI)
    const slotsOf = () => angles.map((angle) => ({ angle, width: 90, height: RINGED_ELEMENT_HEIGHT }))
    const [ring] = ringOutlines([{ role: 'domain', name }], slotsOf)
    // Decision 7: a crowded band may stagger its own elements onto more than one radial track rather than growing
    // the whole ring around the title — so a slot's own radius is no longer always the ring's one true mid.
    const radii = ringSlotRadii(ring, undefined, angles)
    const titleArc = measure(ring.title, RING_LABEL) + 2 * TITLE_ARC_PAD
    const titleBox = titleFootprintBox(ringElementRadius(ring), titleArc)
    const elementBoxes = angles.map((angle, k) => ({
      x: radii[k] * Math.cos(angle),
      y: radii[k] * Math.sin(angle),
      width: 90,
      height: RINGED_ELEMENT_HEIGHT,
    }))
    for (const box of elementBoxes) expect(boxesOverlap(box, titleBox)).toBe(false)
  })
})

describe('an empty ringed file stays compact (no title-driven blow-up)', () => {
  const PRE_AF5734E_ONION_OUTER_APEX = 198
  const COMPACT_BOUND = PRE_AF5734E_ONION_OUTER_APEX * 1.5

  it("an empty Onion file's outer ring stays compact, comparable to its pre-af5734e size", () => {
    const rings = ringOutlines(newOnionMap('Fresh').rings)
    expect(rings[rings.length - 1].apex).toBeLessThan(COMPACT_BOUND)
  })

  it("an empty Clean file's outer ring stays compact, comparable to its pre-af5734e size", () => {
    const rings = ringOutlines(newCleanMap('Fresh').rings)
    expect(rings[rings.length - 1].apex).toBeLessThan(COMPACT_BOUND)
  })
})

// Decision 6: `ringedBounds`/`endpointLayout` only ever counted the 8px endpoint DOT, never its name label —
// a long name (e.g. "ShippingAdapter") could sit mostly outside the bounds and show clipped ("ingAdapter").
describe('endpointLayout — labels count toward the bounds, never just the dot (Decision 6)', () => {
  it("a long actor/external name's rendered label stays fully inside ringedBounds", () => {
    const [ring] = ringOutlines([{ role: 'outer', name: 'Infrastructure' }])
    const actors = [
      { id: 'a1', name: 'ShippingAdapter' },
      { id: 'a2', name: 'PaymentGatewayAdapterForCheckout' },
      { id: 'a3', name: 'Ops' },
      { id: 'a4', name: 'NotificationDispatchService' },
    ]
    const { endpoints, extraReach } = endpointLayout(actors, [], ring)
    const bounds = ringedBounds(ring, extraReach)
    for (const endpoint of endpoints) {
      const labelSide = endpoint.x >= 0 ? 1 : -1
      const textStart = endpoint.x + labelSide * (RINGED_ENDPOINT_DIAMETER / 2 + 4)
      // Decision 8: a long name wraps onto more than one line, so its own reach is its WIDEST line, not the whole
      // unbroken name.
      const textEnd = textStart + labelSide * endpointLabelWidth(endpoint.name)
      const halfTextHeight = endpointLabelHeight(endpoint.name) / 2
      for (const x of [textStart, textEnd]) expect(x).toBeGreaterThanOrEqual(bounds.x)
      for (const x of [textStart, textEnd]) expect(x).toBeLessThanOrEqual(bounds.x + bounds.width)
      expect(endpoint.y - halfTextHeight).toBeGreaterThanOrEqual(bounds.y)
      expect(endpoint.y + halfTextHeight).toBeLessThanOrEqual(bounds.y + bounds.height)
    }
  })
})
