import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import type { OnionFile } from '../model/schema'
import { newOnionMap } from '../model/hexa'
import { layoutOnion } from '../layout/onion'
import { legendForOnion } from '../layout/legend'
import { OnionDiagram } from './OnionDiagram'

const renderDiagram = (doc: OnionFile, opts: { selected?: string | null; mode?: 'overview' | 'detailed'; hoverRef?: string | null } = {}) => {
  const model = layoutOnion(doc)
  return render(
    <svg>
      <OnionDiagram
        model={model}
        selected={opts.selected ?? null}
        interactive
        validTargets={new Set()}
        legend={legendForOnion(doc)}
        mode={opts.mode ?? 'detailed'}
        hoverRef={opts.hoverRef ?? null}
      />
    </svg>,
  )
}

// Decision 1: the Overview/Detailed toolbar switch controls which dependency arrows are drawn — Overview shows
// only the hovered/selected element's own edges (as straight chords), Detailed shows every edge, curved.
describe('OnionDiagram — arrow visibility follows Overview/Detailed (Decision 1)', () => {
  const docWithDependency = (): OnionFile => ({
    ...newOnionMap('Fresh'),
    elements: [
      { id: 'e1', name: 'Controller', ringRole: 'outer' },
      { id: 'e2', name: 'Order', ringRole: 'domain' },
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
    const doc: OnionFile = { ...docWithDependency(), elements: [...docWithDependency().elements, { id: 'e3', name: 'Unrelated', ringRole: 'domain' }] }
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
