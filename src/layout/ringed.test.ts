import { describe, expect, it } from 'vitest'
import { newCleanMap, newOnionMap } from '../model/hexa'
import { ringedBounds, ringOutlines } from './ringed'
import { DOMAIN_TITLE, measure, RING_LABEL } from './text'

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

// A ring's band is a filled disc/annulus; the next ring out is painted afterward (render/band.ts's bandPath), so
// a label wider than THIS ring's own chord at its label height gets its overflow covered by that later fill —
// the reported "Domain Mod", "MAIN SERVIC" clipping on an otherwise-empty Onion file.
describe('ring labels fit inside their own band (no clipping by the next ring out)', () => {
  function assertLabelsFit(rings: ReturnType<typeof ringOutlines>) {
    rings.forEach((ring, i) => {
      const metrics = i === 0 ? DOMAIN_TITLE : RING_LABEL
      const halfWidth = measure(ring.title, metrics) / 2
      const chordHalf = Math.sqrt(Math.max(0, ring.apex ** 2 - ring.labelAt.y ** 2))
      expect(halfWidth).toBeLessThanOrEqual(chordHalf)
    })
  }

  it('an empty Onion file: every ring label fits inside its own band', () => {
    assertLabelsFit(ringOutlines(newOnionMap('Fresh').rings))
  })

  it('an empty Clean file: every ring label fits inside its own band', () => {
    assertLabelsFit(ringOutlines(newCleanMap('Fresh').rings))
  })
})
