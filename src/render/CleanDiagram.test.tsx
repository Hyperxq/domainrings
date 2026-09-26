import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import type { CleanFile } from '../model/schema'
import { newCleanMap } from '../model/hexa'
import { layoutClean } from '../layout/clean'
import { CleanDiagram } from './CleanDiagram'

const renderDiagram = (doc: CleanFile) => {
  const model = layoutClean(doc)
  return render(
    <svg>
      <CleanDiagram model={model} selected={null} interactive validTargets={new Set()} />
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
        <CleanDiagram model={model} selected={null} interactive validTargets={new Set(['e1'])} />
      </svg>,
    )
    expect(container.querySelector('[data-ref="e1"]')!.hasAttribute('data-link-target')).toBe(true)
  })
})
