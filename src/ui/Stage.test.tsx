import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { Stage } from './Stage'
import { layoutDiagram } from '../layout/layout'
import { legendFor } from '../layout/legend'
import { EXAMPLE_DIAGRAM } from '../model/example'
import { useDiagramStore } from '../model/store'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
beforeEach(() => useDiagramStore.getState().replace(EXAMPLE_DIAGRAM))
afterEach(cleanup)

/** The stage as the app wires it: laid out from the live store. */
function Harness({ highlight = true }: { highlight?: boolean }) {
  const diagram = useDiagramStore((s) => s.diagram)
  const svgRef = createRef<SVGSVGElement>()
  return (
    <Stage
      model={layoutDiagram(diagram)}
      diagram={diagram}
      mode="detailed"
      legend={legendFor(diagram)}
      revision={0}
      title="Test"
      svgRef={svgRef}
      panelOpen={false}
      showGuides
      highlight={highlight}
    />
  )
}

const svg = (container: HTMLElement) => container.querySelector('svg.canvas')!
const hover = (container: HTMLElement, layer: string) => fireEvent.pointerOver(container.querySelector(`[data-band="${layer}"]`)!)

describe('Stage layer hover', () => {
  it('highlights the application layer while its band is hovered, and Esc clears it', () => {
    const { container } = render(<Harness />)
    expect(container.querySelector('[data-band="application"]')!.getAttribute('fill-rule')).toBe('evenodd')
    hover(container, 'application')
    expect(svg(container).getAttribute('data-hover')).toBe('application')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(svg(container).hasAttribute('data-hover')).toBe(false)
  })

  it('highlights a layer from one of its elements, and clears when the pointer leaves the canvas', () => {
    const { container } = render(<Harness />)
    fireEvent.pointerOver(container.querySelector('[data-layer="application"].node')!)
    expect(svg(container).getAttribute('data-hover')).toBe('application')
    fireEvent.pointerLeave(svg(container))
    expect(svg(container).hasAttribute('data-hover')).toBe(false)
  })

  it('makes every band keyboard-focusable with the layer title as its name', () => {
    const { container } = render(<Harness />)
    const band = container.querySelector('[data-band="domain"]')!
    expect(band.getAttribute('tabindex')).toBe('0')
    expect(band.getAttribute('role')).toBe('group')
    expect(band.getAttribute('aria-label')).toBe('Domain')
    fireEvent.focus(band)
    expect(svg(container).getAttribute('data-hover')).toBe('domain')
  })

  it('with highlighting off, styles nothing but still offers the layer "+" buttons', () => {
    const { container } = render(<Harness highlight={false} />)
    hover(container, 'application')
    expect(svg(container).hasAttribute('data-hover')).toBe(false)
    expect(screen.getByRole('button', { name: 'Add a use case' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add a driven port on the north-east wall' })).toBeTruthy()
  })
})

describe('Stage "+" affordances', () => {
  it('shows only the "+" buttons of the hovered layer', () => {
    const { container } = render(<Harness />)
    expect(screen.queryByRole('button', { name: 'Add a use case' })).toBeNull()
    hover(container, 'domain')
    expect(screen.getByRole('button', { name: 'Add a domain item' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add a use case' })).toBeNull()
  })

  it('creates a use case, edits its name inline, and commits it on Enter', () => {
    const { container } = render(<Harness />)
    hover(container, 'application')
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Add a use case' })))
    const input = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement
    expect(input.value).toBe('NewUseCase')
    fireEvent.change(input, { target: { value: 'ShipOrder' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useDiagramStore.getState().diagram.useCases.map((u) => u.name)).toEqual(['SubmitChatFeedback', 'ShipOrder'])
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
  })

  it('removes the new element again on Esc', () => {
    const { container } = render(<Harness />)
    hover(container, 'application')
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Add a driven port on the south-east wall' })))
    expect(useDiagramStore.getState().diagram.ports.at(-1)).toMatchObject({ name: 'NewPort', side: 'driven', wall: 'se' })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Escape' })
    expect(useDiagramStore.getState().diagram.ports).toEqual(EXAMPLE_DIAGRAM.ports)
  })

  it('asks which domain type to add, then links a child to its aggregate', () => {
    const { container } = render(<Harness />)
    hover(container, 'domain')
    fireEvent.click(screen.getByRole('button', { name: 'Add an item inside Feedback' }))
    act(() => fireEvent.click(screen.getByRole('menuitem', { name: '○ value object' })))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Enter' })
    expect(useDiagramStore.getState().diagram.domain.at(-1)).toMatchObject({ name: 'NewValueObject', type: 'valueObject', parentId: 'd-feedback' })
  })

  it('removes an element whose name was cleared when the input loses focus', () => {
    const { container } = render(<Harness />)
    hover(container, 'application')
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Add a use case' })))
    const input = screen.getByRole('textbox', { name: 'Name' })
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)
    expect(useDiagramStore.getState().diagram.useCases).toEqual(EXAMPLE_DIAGRAM.useCases)
  })
})
