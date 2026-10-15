import { describe, expect, it } from 'vitest'
import type { Diagram, DomainItem } from '../../model/schema'
import { WALLS } from './walls'
import { boxFrames } from './boxFrames'
import { layCentre } from './centreBlock'
import type { UseCaseSeating } from './useCaseSeating'

const diagramOf = (domain: DomainItem[]) => ({ version: 1, kind: 'hexagonal', title: '', domain, useCases: [], ports: [], adapters: [], actors: [], externals: [] }) as Diagram
const centre = (domain: DomainItem[]) => layCentre({ d: diagramOf(domain), overview: false, domainFrame: boxFrames(false).domainFrame, seating: { walls: [] } as unknown as UseCaseSeating })
const box = (c: { x: number; y: number }, w: number, h: number) => ({ x0: c.x - w / 2, x1: c.x + w / 2, y0: c.y - h / 2, y1: c.y + h / 2 })

describe('layCentre', () => {
  it('degrades to the largest region instead of throwing when no region holds a block', () => {
    const result = centre([{ id: 'wide', name: 'W'.repeat(30000), type: 'entity' }])
    expect(Number.isFinite(result.region.apex)).toBe(true)
    expect(result.region.apex).toBe(1e5)
  })

  it('gives every root a wall of the region', () => {
    const domain: DomainItem[] = [
      { id: 'a0', name: 'Order', type: 'aggregate' },
      { id: 'a1', name: 'Customer', type: 'aggregate' },
      ...['One', 'Two', 'Three'].map((name, i): DomainItem => ({ id: `e${i}`, name, type: 'entity' })),
    ]
    const { faces } = centre(domain)
    expect([...faces.keys()].sort()).toEqual(domain.map((i) => i.id).sort())
    for (const face of faces.values()) expect(WALLS).toContain(face)
  })

  // Two small blocks stacked on a slanted face were set a block apart along the face, which on a diagonal is still
  // overlapping boxes at any region size, so no region ever held them.
  it('holds blocks sharing a slanted face at a size well under the cap, apart from each other', () => {
    const domain: DomainItem[] = [
      { id: 'a0', name: 'AAAAAAAAAAAAAA', type: 'aggregate' },
      ...[24, 21, 12, 12].map((n, i): DomainItem => ({ id: `a0k${i}`, name: 'K'.repeat(n), type: 'entity', parentId: 'a0' })),
      { id: 'a1', name: 'AAA', type: 'aggregate' },
      { id: 'a2', name: 'AAAA', type: 'aggregate' },
      { id: 'e0', name: 'E'.repeat(23), type: 'entity' },
    ]
    const result = centre(domain)
    expect(result.region.apex).toBeLessThan(1e4)
    const roots = result.boxes.filter((b) => b.kind === 'aggregate' || domain.find((i) => i.id === b.ref)?.parentId === undefined)
    const [a, b] = [roots.find((r) => r.ref === 'a1')!, roots.find((r) => r.ref === 'a2')!]
    const [p, q] = [box(a, a.frame.width, a.frame.height), box(b, b.frame.width, b.frame.height)]
    expect(p.x1 <= q.x0 || q.x1 <= p.x0 || p.y1 <= q.y0 || q.y1 <= p.y0).toBe(true)
  })
})
