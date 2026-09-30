import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { RingedEdge, type RingedEdgeLayout } from './RingedNodes'

/** Parses `M{x} {y}Q{cx} {cy} {ex} {ey}` back into its own two endpoints and control point. */
function parseQuadratic(d: string): { control: { x: number; y: number } } {
  const m = d.match(/^M(-?[\d.]+) (-?[\d.]+)Q(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)$/)
  if (!m) throw new Error(`not a quadratic path: ${d}`)
  return { control: { x: Number(m[3]), y: Number(m[4]) } }
}

const renderEdge = (edge: RingedEdgeLayout) => {
  const { container } = render(
    <svg>
      <RingedEdge edge={edge} markerId="arrow" />
    </svg>,
  )
  return container.querySelector('path')!.getAttribute('d')!
}

// Decision 1's curved Detailed-mode edges are meant to bow away from the diagram's own centre so simultaneous
// chords spread into distinguishable arcs — but a chord whose own midpoint sits ON (or very near) the centre has
// no well-defined "away from the origin" direction distinct from the chord itself; bowing along the chord's own
// line leaves it rendered perfectly straight (the reported edge running dead straight through the whole diagram,
// e.g. an outer-ring element on one side, through an inner element near the centre, to another outer-ring element
// on the opposite side).
describe('RingedEdge — a curved chord collinear with the centre still bows (never renders straight)', () => {
  it('a chord whose midpoint sits exactly at the origin still curves', () => {
    const edge: RingedEdgeLayout = { key: 'e', kind: 'dependency', from: { x: -100, y: 0 }, to: { x: 100, y: 0 } }
    const d = renderEdge(edge)
    const { control } = parseQuadratic(d)
    // A straight (unbowed) chord's own control point sits exactly on the chord's own midpoint (0, 0) — any real
    // curve must move the control point off that line.
    expect(Math.abs(control.y)).toBeGreaterThan(1)
  })

  it('a chord through the outer ring, near an inner element close to the centre, still bows', () => {
    // Mirrors the reported case: two outer-ring elements roughly opposite each other, one inner element between
    // them close to the centre — the whole configuration nearly collinear.
    const edge: RingedEdgeLayout = { key: 'e', kind: 'dependency', from: { x: -300, y: -2 }, to: { x: 300, y: 2 } }
    const d = renderEdge(edge)
    const { control } = parseQuadratic(d)
    const mid = { x: 0, y: 0 }
    const chord = { x: 600, y: 4 }
    // The control point's own offset from the chord's midpoint must have a real component PERPENDICULAR to the
    // chord (not just along it) — otherwise the curve is visually straight regardless of the offset's magnitude.
    const offset = { x: control.x - mid.x, y: control.y - mid.y }
    const chordLength = Math.hypot(chord.x, chord.y)
    const along = (offset.x * chord.x + offset.y * chord.y) / chordLength
    const perpComponent = Math.hypot(offset.x - (along * chord.x) / chordLength, offset.y - (along * chord.y) / chordLength)
    expect(perpComponent).toBeGreaterThan(1)
  })

  it('an ordinary, well-off-centre chord keeps bowing outward (unchanged behaviour)', () => {
    const edge: RingedEdgeLayout = { key: 'e', kind: 'dependency', from: { x: 100, y: 0 }, to: { x: 0, y: 100 } }
    const d = renderEdge(edge)
    const { control } = parseQuadratic(d)
    const mid = { x: 50, y: 50 }
    const centreDist = Math.hypot(mid.x, mid.y)
    // Bowing "outward" means the control point sits FARTHER from the origin than the chord's own midpoint.
    expect(Math.hypot(control.x, control.y)).toBeGreaterThan(centreDist)
  })
})
