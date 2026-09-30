import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import type { CleanFile } from '../model/schema'
import { newCleanMap } from '../model/hexa'
import { layoutClean } from '../layout/clean'
import { legendForClean } from '../layout/legend'
import { CleanDiagram } from './CleanDiagram'

const renderDiagram = (doc: CleanFile, opts: { selected?: string | null; mode?: 'overview' | 'detailed'; hoverRef?: string | null } = {}) => {
  const model = layoutClean(doc)
  return render(
    <svg>
      <CleanDiagram
        model={model}
        selected={opts.selected ?? null}
        interactive
        validTargets={new Set()}
        legend={legendForClean(doc)}
        mode={opts.mode ?? 'detailed'}
        hoverRef={opts.hoverRef ?? null}
      />
    </svg>,
  )
}

describe('CleanDiagram — sector wedges (REQ-08)', () => {
  it('draws exactly one divider per sector on a ring', () => {
    const doc: CleanFile = {
      ...newCleanMap('Fresh'),
      sectors: [
        { id: 's1', name: 'Billing', ringRole: 'domain' },
        { id: 's2', name: 'Catalog', ringRole: 'domain' },
        { id: 's3', name: 'Shipping', ringRole: 'domain' },
      ],
    }
    const { container } = renderDiagram(doc)
    const divider = container.querySelector('[data-sector-divider="domain"]')!
    expect(divider.getAttribute('d')?.match(/M/g)?.length).toBe(3)
  })

  it('draws no dividers for a ring with no sectors', () => {
    const { container } = renderDiagram(newCleanMap('Fresh'))
    expect(container.querySelectorAll('[data-sector-divider]')).toHaveLength(0)
  })
})

// Decision 4: a sector's own name is drawn on the canvas, curved along its own wedge, so the wedges read as
// named divisions — not just unlabelled radial lines.
describe('CleanDiagram — sector names drawn on canvas (Decision 4)', () => {
  it('draws one curved label per sector, named after it', () => {
    const doc: CleanFile = {
      ...newCleanMap('Fresh'),
      sectors: [
        { id: 's1', name: 'Billing', ringRole: 'domain' },
        { id: 's2', name: 'Catalog', ringRole: 'domain' },
      ],
    }
    const { container } = renderDiagram(doc)
    const labels = container.querySelectorAll('[data-sector-label]')
    expect(labels).toHaveLength(2)
    const names = [...labels].map((l) => l.textContent)
    expect(names).toEqual(expect.arrayContaining(['Billing', 'Catalog']))
  })

  it('a sector\'s label rides its own curved arc, not a straight line', () => {
    const doc: CleanFile = { ...newCleanMap('Fresh'), sectors: [{ id: 's1', name: 'Billing', ringRole: 'domain' }] }
    const { container } = renderDiagram(doc)
    const textPath = container.querySelector('[data-sector-label="s1"] textPath')!
    const arcId = textPath.getAttribute('href')!.replace('#', '')
    const arc = container.querySelector(`#${CSS.escape(arcId)}`)!
    expect(arc.getAttribute('d')).toContain('A')
  })

  it('draws no sector labels for a ring with no sectors', () => {
    const { container } = renderDiagram(newCleanMap('Fresh'))
    expect(container.querySelectorAll('[data-sector-label]')).toHaveLength(0)
  })

  // A sector's own name shares its ring's own `data-layer` (styles.css targets the halo per-band by this
  // attribute, same convention `Ring`'s own title already carries) — without it, CSS has no way to match a
  // sector label's halo to the ring it actually sits on.
  it('carries its own ring\'s data-layer, for the halo-per-band CSS rule to match', () => {
    const doc: CleanFile = { ...newCleanMap('Fresh'), sectors: [{ id: 's1', name: 'Billing', ringRole: 'application' }] }
    const { container } = renderDiagram(doc)
    expect(container.querySelector('[data-sector-label="s1"]')!.getAttribute('data-layer')).toBe('application')
  })
})

describe('CleanDiagram — elements, endpoints and edges', () => {
  it('renders an element node for each element, positioned inside its own sector wedge', () => {
    const doc: CleanFile = {
      ...newCleanMap('Fresh'),
      sectors: [{ id: 's1', name: 'Billing', ringRole: 'domain' }],
      elements: [{ id: 'e1', name: 'Invoice', sectorId: 's1' }],
    }
    const { container } = renderDiagram(doc)
    const node = container.querySelector('[data-ref="e1"]')!
    expect(node).toBeTruthy()
    expect(node.textContent).toContain('Invoice')
  })

  it('renders an actor/external node and an edge for a targeted endpoint', () => {
    const doc: CleanFile = {
      ...newCleanMap('Fresh'),
      sectors: [{ id: 's1', name: 'API', ringRole: 'outer' }],
      elements: [{ id: 'e1', name: 'Controller', sectorId: 's1' }],
      actors: [{ id: 'a1', name: 'Customer', targetId: 'e1' }],
    }
    const { container } = renderDiagram(doc)
    expect(container.querySelector('[data-ref="a1"]')).toBeTruthy()
    expect(container.querySelectorAll('.edge')).toHaveLength(1)
  })

  it('marks a valid dependency target with data-link-target', () => {
    const doc: CleanFile = {
      ...newCleanMap('Fresh'),
      sectors: [{ id: 's1', name: 'Billing', ringRole: 'domain' }],
      elements: [{ id: 'e1', name: 'Invoice', sectorId: 's1' }],
    }
    const model = layoutClean(doc)
    const { container } = render(
      <svg>
        <CleanDiagram model={model} selected={null} interactive validTargets={new Set(['e1'])} legend={legendForClean(doc)} mode="detailed" hoverRef={null} />
      </svg>,
    )
    expect(container.querySelector('[data-ref="e1"]')!.hasAttribute('data-link-target')).toBe(true)
  })
})

// Decision 1: the Overview/Detailed toolbar switch controls which dependency arrows are drawn — Overview shows
// only the hovered/selected element's own edges, Detailed shows every edge.
describe('CleanDiagram — arrow visibility follows Overview/Detailed (Decision 1)', () => {
  const docWithDependency = (): CleanFile => ({
    ...newCleanMap('Fresh'),
    sectors: [
      { id: 's1', name: 'API', ringRole: 'outer' },
      { id: 's2', name: 'Core', ringRole: 'domain' },
    ],
    elements: [
      { id: 'e1', name: 'Controller', sectorId: 's1' },
      { id: 'e2', name: 'Order', sectorId: 's2' },
    ],
    dependencies: [{ id: 'd1', fromId: 'e1', toId: 'e2' }],
  })

  it('Overview, nothing hovered/selected: draws zero edges', () => {
    const { container } = renderDiagram(docWithDependency(), { mode: 'overview' })
    expect(container.querySelectorAll('.edge')).toHaveLength(0)
  })

  it('Overview, the edge\'s own element hovered: draws that edge', () => {
    const { container } = renderDiagram(docWithDependency(), { mode: 'overview', hoverRef: 'e1' })
    expect(container.querySelectorAll('.edge')).toHaveLength(1)
  })

  it('Overview, an unrelated element hovered: still draws zero edges', () => {
    const doc: CleanFile = { ...docWithDependency(), elements: [...docWithDependency().elements, { id: 'e3', name: 'Unrelated', sectorId: 's2' }] }
    const { container } = renderDiagram(doc, { mode: 'overview', hoverRef: 'e3' })
    expect(container.querySelectorAll('.edge')).toHaveLength(0)
  })

  it('Overview, the edge\'s own element selected (not hovered): draws that edge', () => {
    const { container } = renderDiagram(docWithDependency(), { mode: 'overview', selected: 'e2' })
    expect(container.querySelectorAll('.edge')).toHaveLength(1)
  })

  it('Detailed: draws every edge, as a curve rather than a straight chord', () => {
    const { container } = renderDiagram(docWithDependency(), { mode: 'detailed' })
    const edges = container.querySelectorAll('.edge')
    expect(edges).toHaveLength(1)
    expect(edges[0].getAttribute('d')).toContain('Q')
  })
})
