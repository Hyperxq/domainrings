import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef, useState } from 'react'
import { Stage } from './Stage'
import { layoutMap } from '../layout/map'
import { legendFor } from '../layout/legend'
import { EXAMPLE_DIAGRAM } from '../model/example'
import { toMap } from '../model/hexa'
import { diagramOf } from '../model/map'
import { useMapStore } from '../model/store'
import { hexGroup, twoHexMap } from '../test/fixtures'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
beforeEach(() => useMapStore.getState().replace(toMap(EXAMPLE_DIAGRAM)))
afterEach(cleanup)

/** The stage as the app wires it: laid out from the live store. */
function Harness({ highlight = true, onReveal = () => {} }: { highlight?: boolean; onReveal?: (ref: string, focus: boolean) => void }) {
  const map = useMapStore((s) => s.map)
  const hexId = useMapStore((s) => s.focus)
  const diagram = diagramOf(map, hexId)
  const svgRef = createRef<SVGSVGElement>()
  const [linking, setLinking] = useState<string | null>(null)
  return (
    <Stage
      model={layoutMap(map)}
      hexId={hexId}
      diagram={diagram}
      mode="detailed"
      legend={legendFor(diagram)}
      revision={0}
      title="Test"
      svgRef={svgRef}
      panelOpen={false}
      legendOpen={false}
      onReveal={onReveal}
      onDelete={() => false}
      linking={linking}
      onLinking={setLinking}
      onLink={() => {}}
      showGuides
      highlight={highlight}
    />
  )
}

const svg = (container: HTMLElement) => container.querySelector('svg.canvas')!
const hover = (container: HTMLElement, layer: string) => fireEvent.pointerOver(container.querySelector(`[data-band="${layer}"]`)!)

describe('Stage layer hover', () => {
  // Single-hexagon Harness: its one group is always current, so data-hover (scoped to the current group, CANVAS-03) lands on it.
  const group = (container: HTMLElement) => container.querySelector('[data-hex]')!

  it('highlights the application layer while its band is hovered, and Esc clears it', () => {
    const { container } = render(<Harness />)
    expect(container.querySelector('[data-band="application"]')!.getAttribute('fill-rule')).toBe('evenodd')
    hover(container, 'application')
    expect(group(container).getAttribute('data-hover')).toBe('application')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(group(container).hasAttribute('data-hover')).toBe(false)
  })

  it('highlights a layer from one of its elements, and clears when the pointer leaves the canvas', () => {
    const { container } = render(<Harness />)
    fireEvent.pointerOver(container.querySelector('[data-layer="application"].node')!)
    expect(group(container).getAttribute('data-hover')).toBe('application')
    fireEvent.pointerLeave(svg(container))
    expect(group(container).hasAttribute('data-hover')).toBe(false)
  })

  it('makes every band keyboard-focusable with the layer title as its name', () => {
    const { container } = render(<Harness />)
    const band = container.querySelector('[data-band="domain"]')!
    expect(band.getAttribute('tabindex')).toBe('0')
    expect(band.getAttribute('role')).toBe('group')
    expect(band.getAttribute('aria-label')).toBe('Domain')
    fireEvent.focus(band)
    expect(group(container).getAttribute('data-hover')).toBe('domain')
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
    expect(diagramOf(useMapStore.getState().map, useMapStore.getState().focus).useCases.map((u) => u.name)).toEqual(['SubmitChatFeedback', 'ShipOrder'])
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
  })

  it('removes the new element again on Esc', () => {
    const { container } = render(<Harness />)
    hover(container, 'application')
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Add a driven port on the south-east wall' })))
    expect(diagramOf(useMapStore.getState().map, useMapStore.getState().focus).ports.at(-1)).toMatchObject({ name: 'NewPort', side: 'driven', wall: 'se' })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Escape' })
    expect(diagramOf(useMapStore.getState().map, useMapStore.getState().focus).ports).toEqual(EXAMPLE_DIAGRAM.ports)
  })

  it('asks which domain type to add, then links a child to its aggregate', () => {
    const { container } = render(<Harness />)
    hover(container, 'domain')
    fireEvent.click(screen.getByRole('button', { name: 'Add an item inside Feedback' }))
    act(() => fireEvent.click(screen.getByRole('menuitem', { name: '○ value object' })))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Name' }), { key: 'Enter' })
    expect(diagramOf(useMapStore.getState().map, useMapStore.getState().focus).domain.at(-1)).toMatchObject({ name: 'NewValueObject', type: 'valueObject', parentId: 'd-feedback' })
  })

  it('removes an element whose name was cleared when the input loses focus', () => {
    const { container } = render(<Harness />)
    hover(container, 'application')
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Add a use case' })))
    const input = screen.getByRole('textbox', { name: 'Name' })
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)
    expect(diagramOf(useMapStore.getState().map, useMapStore.getState().focus).useCases).toEqual(EXAMPLE_DIAGRAM.useCases)
  })
})

describe('Stage panning', () => {
  const origin = (container: HTMLElement) => (container.querySelector('main') as HTMLElement).style.backgroundPosition

  it('keeps a press that barely moves as a click, and pans once the pointer really moves', () => {
    const { container } = render(<Harness />)
    const main = container.querySelector('main')!
    main.setPointerCapture = () => {}
    const start = origin(container)

    fireEvent.pointerDown(svg(container), { button: 0, buttons: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(main, { buttons: 1, clientX: 102, clientY: 101 })
    expect(origin(container)).toBe(start)
    expect(main.classList.contains('is-dragging')).toBe(false)

    fireEvent.pointerMove(main, { buttons: 1, clientX: 140, clientY: 100 })
    expect(origin(container)).not.toBe(start)
    expect(main.classList.contains('is-dragging')).toBe(true)
  })
})

describe('Stage current-hexagon focus (FOCUS-01, 03, 04, 05, CANVAS-03)', () => {
  it('click on a non-current hexagon makes it current and does nothing else', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<Harness />)
    expect(useMapStore.getState().focus).toBe('h1')

    fireEvent.click(hexGroup(container, 'h2'))

    expect(useMapStore.getState().focus).toBe('h2')
    expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(1)
    expect(hexGroup(container, 'h2').getAttribute('aria-current')).toBe('true')
    expect(container.querySelectorAll('[data-selected]')).toHaveLength(0)
    expect(container.querySelector('.inline-name')).toBeNull()
  })

  it('clicking the map title leaves the current hexagon unchanged (FOCUS-01.3)', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<Harness />)

    fireEvent.click(container.querySelector('[data-map-title]')!)

    expect(useMapStore.getState().focus).toBe('h1')
  })

  it('scopes hover to the current hexagon only (CANVAS-03)', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<Harness />)

    const bandInNonCurrent = hexGroup(container, 'h2').querySelector('[data-band]')!
    fireEvent.pointerOver(bandInNonCurrent)
    expect(hexGroup(container, 'h1').hasAttribute('data-hover')).toBe(false)
    expect(hexGroup(container, 'h2').hasAttribute('data-hover')).toBe(false)

    const bandInCurrent = hexGroup(container, 'h1').querySelector('[data-band]')!
    const layer = bandInCurrent.getAttribute('data-band')
    fireEvent.pointerOver(bandInCurrent)
    expect(hexGroup(container, 'h1').getAttribute('data-hover')).toBe(layer)
    expect(hexGroup(container, 'h2').hasAttribute('data-hover')).toBe(false)
  })

  it.each([{ key: 'Enter' }, { key: ' ' }])('makes a non-current hexagon current on %o, moves keyboard focus to its first item, and announces it', ({ key }) => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<Harness />)
    const group = hexGroup(container, 'h2')
    expect(group.getAttribute('tabindex')).toBe('0')

    fireEvent.keyDown(group, { key })

    expect(useMapStore.getState().focus).toBe('h2')
    const firstTabbable = hexGroup(container, 'h2').querySelector('[tabindex="0"]')
    expect(firstTabbable).not.toBeNull()
    expect(document.activeElement).toBe(firstTabbable)
    expect(screen.getByRole('status').textContent).toBe('Second slice is now the current hexagon')
  })

  it('double-clicking a non-current hexagon makes it current and opens its editor card (FOCUS-03.1)', () => {
    useMapStore.getState().replace(twoHexMap())
    const onReveal = vi.fn()
    const { container } = render(<Harness onReveal={onReveal} />)

    fireEvent.doubleClick(hexGroup(container, 'h2'))

    expect(useMapStore.getState().focus).toBe('h2')
    expect(onReveal).toHaveBeenCalledWith('hexagon', true)
  })

  it('switching the current hexagon clears the selection and ends link mode, without moving the view (FOCUS-04.1)', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<Harness />)
    const main = container.querySelector('main') as HTMLElement
    const positionBefore = main.style.backgroundPosition
    const adapter = EXAMPLE_DIAGRAM.adapters.find((a) => EXAMPLE_DIAGRAM.ports.find((p) => p.id === a.portId)?.side === 'driven')!
    const node = hexGroup(container, 'h1').querySelector(`[data-ref="${adapter.id}"]`)!

    fireEvent.click(node)
    expect(node.hasAttribute('data-selected')).toBe(true)
    fireEvent.keyDown(document.body, { key: 'l' })
    expect(svg(container).hasAttribute('data-link-mode')).toBe(true)

    fireEvent.click(hexGroup(container, 'h2'))

    expect(useMapStore.getState().focus).toBe('h2')
    expect(container.querySelectorAll('[data-selected]')).toHaveLength(0)
    expect(svg(container).hasAttribute('data-link-mode')).toBe(false)
    expect(main.style.backgroundPosition).toBe(positionBefore)
  })

  it('switching the current hexagon commits an inline name in progress on the hexagon it started on (FOCUS-04.1)', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<Harness />)
    hover(container, 'application')
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Add a use case' })))
    const input = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'CommittedOnSwitch' } })

    fireEvent.click(hexGroup(container, 'h2'))

    expect(useMapStore.getState().focus).toBe('h2')
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
    const h1UseCases = diagramOf(useMapStore.getState().map, 'h1').useCases.map((u) => u.name)
    const h2UseCases = diagramOf(useMapStore.getState().map, 'h2').useCases.map((u) => u.name)
    expect(h1UseCases).toContain('CommittedOnSwitch')
    expect(h2UseCases).not.toContain('CommittedOnSwitch')
  })
})
