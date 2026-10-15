import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { App } from './App'
import { EXAMPLES } from './model/example'
import type { HexaMap } from './model/schema'
import { useMapStore } from './model/store'
import { usePreferencesStore } from './ui/state/preferencesStore'
import { useViewStore } from './ui/state/viewStore'
import { installDialogPolyfill } from './test/fixtures'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  window.matchMedia = ((media: string) => ({ matches: true, media, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia
  Element.prototype.scrollIntoView = vi.fn()
  installDialogPolyfill()
})
beforeEach(() => {
  useMapStore.getState().replace(EXAMPLES.find((e) => e.id === 'hexagonal-advanced')!.map as HexaMap)
  useViewStore.setState({ editorOpen: true, focusedFlow: null, hoveredFlows: [], presentStep: null })
  usePreferencesStore.setState({ viewOnly: true, highlight: true })
})
afterEach(cleanup)

/** The stress example with every use case working on one aggregate, so that card is touched by three threads. */
const sharedAggregate = () => {
  const map = EXAMPLES.find((e) => e.id === 'hexagonal-stress')!.map as HexaMap
  const [hexagon] = map.hexagons
  const aggregate = hexagon.domain.find((i) => i.type === 'aggregate')!
  return { aggregate: aggregate.id, map: { ...map, hexagons: [{ ...hexagon, useCases: hexagon.useCases.map((u) => ({ ...u, aggregateIds: [aggregate.id] })) }, ...map.hexagons.slice(1)] } }
}
const canvas = (container: HTMLElement) => container.querySelector('svg.canvas')!
const chained = (container: HTMLElement) => [...new Set([...container.querySelectorAll('[data-hex] .node[data-chain]')].map((n) => n.getAttribute('data-ref')))]
const edgeOf = (container: HTMLElement, useCaseId: string) => container.querySelector(`path.edge[data-thread="${useCaseId}"]`)!

describe('hovering a thread', () => {
  it('previews the flow of an edge that belongs to one thread, and ends with the pointer', () => {
    const { container } = render(<App />)
    expect(canvas(container).hasAttribute('data-emphasis')).toBe(false)
    fireEvent.pointerOver(edgeOf(container, 'uc-place'))
    expect(canvas(container).hasAttribute('data-emphasis')).toBe(true)
    expect(chained(container)).toContain('uc-place')
    fireEvent.pointerLeave(canvas(container))
    expect(canvas(container).hasAttribute('data-emphasis')).toBe(false)
  })

  it('previews the flow of a box that serves one thread', () => {
    const { container } = render(<App />)
    fireEvent.pointerOver(container.querySelector('[data-hex="h1"] .node-useCase[data-ref="uc-place"]')!)
    expect(useViewStore.getState().hoveredFlows).toEqual(['uc-place'])
    expect(chained(container)).toContain('uc-place')
  })

  it('previews the union of the threads of a box several threads touch', () => {
    const { aggregate, map } = sharedAggregate()
    useMapStore.getState().replace(map)
    const { container } = render(<App />)
    const card = container.querySelector(`[data-hex] .node[data-ref="${aggregate}"][data-threads]`)!
    const useCases = map.hexagons[0].useCases.map((u) => u.id)
    expect(card.getAttribute('data-threads')!.split(' ')).toHaveLength(useCases.length)
    fireEvent.pointerOver(card)
    expect(useViewStore.getState().hoveredFlows).toEqual(useCases)
    expect(canvas(container).hasAttribute('data-emphasis')).toBe(true)
    expect(chained(container)).toEqual(expect.arrayContaining(useCases))
  })

  it('previews the one thread of a dot', () => {
    const { aggregate, map } = sharedAggregate()
    useMapStore.getState().replace(map)
    const { container } = render(<App />)
    const dot = container.querySelector(`.node[data-ref="${aggregate}"] circle.thread-dot[data-thread="uc-cancel"]`)!
    fireEvent.pointerOver(dot)
    expect(useViewStore.getState().hoveredFlows).toEqual(['uc-cancel'])
  })

  it('does nothing when highlighting is off', () => {
    usePreferencesStore.setState({ highlight: false })
    const { container } = render(<App />)
    fireEvent.pointerOver(edgeOf(container, 'uc-place'))
    expect(canvas(container).hasAttribute('data-emphasis')).toBe(false)
  })

  it('previews in Edit mode too, while nothing is selected', () => {
    usePreferencesStore.setState({ viewOnly: false })
    const { container } = render(<App />)
    fireEvent.pointerOver(edgeOf(container, 'uc-place'))
    expect(canvas(container).hasAttribute('data-emphasis')).toBe(true)
    expect(chained(container)).toContain('uc-place')
  })

  it('leaves a selection its own dependency chain in Edit mode', () => {
    usePreferencesStore.setState({ viewOnly: false })
    const { container } = render(<App />)
    fireEvent.click(container.querySelector('[data-hex="h1"] .node-port[data-ref="p-orders-api"]')!)
    const before = chained(container)
    fireEvent.pointerOver(edgeOf(container, 'uc-place'))
    expect(chained(container)).toEqual(before)
  })

  it('yields to a focused flow', () => {
    useMapStore.getState().replace(EXAMPLES.find((e) => e.id === 'hexagonal-stress')!.map as HexaMap)
    const { container } = render(<App />)
    act(() => useViewStore.getState().focusFlow('uc-cancel'))
    const before = chained(container)
    fireEvent.pointerOver(edgeOf(container, 'uc-place'))
    expect(chained(container)).toEqual(before)
    expect(chained(container)).not.toContain('uc-place')
  })

  it('still previews in Edit mode when a flow was left focused there, where nothing is isolated', () => {
    usePreferencesStore.setState({ viewOnly: false })
    useMapStore.getState().replace(EXAMPLES.find((e) => e.id === 'hexagonal-stress')!.map as HexaMap)
    const { container } = render(<App />)
    act(() => useViewStore.getState().focusFlow('uc-cancel'))
    fireEvent.pointerOver(edgeOf(container, 'uc-place'))
    expect(chained(container)).toContain('uc-place')
  })

  it('ends a preview when a pan starts, and ignores hovers until it ends', () => {
    const { container } = render(<App />)
    const main = container.querySelector('main')!
    main.setPointerCapture = () => {}
    fireEvent.pointerOver(edgeOf(container, 'uc-place'))
    expect(useViewStore.getState().hoveredFlows).toEqual(['uc-place'])
    fireEvent.pointerDown(canvas(container), { button: 0, buttons: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(main, { buttons: 1, clientX: 160, clientY: 100 })
    expect(useViewStore.getState().hoveredFlows).toEqual([])
    fireEvent.pointerOver(edgeOf(container, 'uc-place'))
    expect(useViewStore.getState().hoveredFlows).toEqual([])
  })

  it('ends when the hovered flow is deleted', () => {
    const { container } = render(<App />)
    act(() => useViewStore.getState().hoverFlows(['gone']))
    expect(canvas(container).hasAttribute('data-emphasis')).toBe(false)
  })
})

describe('the Flows rows', () => {
  const rows = () => [...document.querySelectorAll<HTMLButtonElement>('.flow-row:not(.flow-row-all)')]

  it('preview a flow on the canvas while hovered, and end with the pointer', () => {
    const { container } = render(<App />)
    fireEvent.pointerEnter(rows()[0])
    expect(canvas(container).hasAttribute('data-emphasis')).toBe(true)
    fireEvent.pointerLeave(rows()[0])
    expect(canvas(container).hasAttribute('data-emphasis')).toBe(false)
  })

  it('preview in Edit mode too, while nothing is selected', () => {
    usePreferencesStore.setState({ viewOnly: false })
    const { container } = render(<App />)
    fireEvent.pointerEnter(rows()[0])
    expect(canvas(container).hasAttribute('data-emphasis')).toBe(true)
  })

  it('yield to a focused flow', () => {
    useMapStore.getState().replace(EXAMPLES.find((e) => e.id === 'hexagonal-stress')!.map as HexaMap)
    const { container } = render(<App />)
    act(() => useViewStore.getState().focusFlow('uc-cancel'))
    const before = chained(container)
    fireEvent.pointerEnter(rows()[0])
    expect(chained(container)).toEqual(before)
  })

  it('stop previewing when the hovered flow is deleted', () => {
    const { container } = render(<App />)
    const map = useMapStore.getState().map
    const [first] = map.hexagons[0].useCases
    fireEvent.pointerEnter(rows()[0])
    expect(useViewStore.getState().hoveredFlows).toEqual([first.id])
    act(() => useMapStore.getState().replace({ ...map, hexagons: map.hexagons.map((h, i) => (i ? h : { ...h, useCases: h.useCases.filter((u) => u.id !== first.id) })) }))
    expect(useViewStore.getState().hoveredFlows).toEqual([])
    expect(canvas(container).hasAttribute('data-emphasis')).toBe(false)
  })
})
