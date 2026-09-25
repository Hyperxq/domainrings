import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef, useState } from 'react'
import { Stage } from './Stage'
import { currentHexagon, hexagonBounds, layoutMap } from '../layout/map'
import { legendFor } from '../layout/legend'
import { EXAMPLE_DIAGRAM, STRESS_DIAGRAM } from '../model/example'
import { toMap } from '../model/hexa'
import { contextName, diagramOf, freeSides, neighbour, SIDE_ORDER } from '../model/map'
import { useMapStore } from '../model/store'
import type { HexaMap } from '../model/schema'
import { parseHexa } from '../model/hexa'
import { hexGroup, twoHexMap } from '../test/fixtures'
import { contains, fitMap, fitTo, islandInset, MIN_FIT_SCALE, MIN_SCALE, pinch, visibleRect, zoomAt } from './viewport'
import type { Box, Point } from '../layout/layout'
import v2Honeycomb from '../model/fixtures/v2-honeycomb.hexa?raw'

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
function Harness({
  highlight = true,
  onReveal = () => {},
  onGrow = () => {},
  naming = false,
  onNamed = () => {},
  onNamingCancel = () => {},
  mode = 'detailed',
}: {
  highlight?: boolean
  onReveal?: (ref: string, focus: boolean) => void
  onGrow?: (side: import('../model/schema').Wall, context: 'same' | 'new') => void
  naming?: boolean
  onNamed?: (title: string) => void
  onNamingCancel?: () => void
  mode?: import('../layout/layout').LayoutMode
}) {
  const map = useMapStore((s) => s.map)
  const hexId = useMapStore((s) => s.focus)
  const diagram = diagramOf(map, hexId)
  const svgRef = createRef<SVGSVGElement>()
  const [linking, setLinking] = useState<string | null>(null)
  const currentContextId = map.hexagons.find((h) => h.id === hexId)!.contextId
  return (
    <Stage
      model={layoutMap(map, { mode })}
      hexId={hexId}
      diagram={diagram}
      mode={mode}
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
      contextLabel={contextName(map, currentContextId)}
      onGrow={onGrow}
      naming={naming}
      onNamed={onNamed}
      onNamingCancel={onNamingCancel}
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
  it('does not reveal "+" buttons when focus follows a pointer press, only for a real keyboard focus', () => {
    const { container } = render(<Harness />)
    const band = container.querySelector('[data-band="domain"]')!

    fireEvent.pointerDown(band, { button: 0 })
    fireEvent.focus(band)
    expect(container.querySelector('button.plus')).toBeNull()

    fireEvent.pointerUp(band)
    fireEvent.focus(band)
    expect(container.querySelector('button.plus')).not.toBeNull()
  })

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

describe('Stage side "+" (GROW-01, ADR-02)', () => {
  it('renders exactly freeSides.length triggers on the current hexagon, one per free side', () => {
    const { container } = render(<Harness />)
    // A lone hexagon (the default single-hexagon store state) has all 6 sides free.
    expect(container.querySelectorAll('.side-plus')).toHaveLength(6)
  })

  it('excludes exactly the occupied side, and renders none on the non-current hexagon', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<Harness />)
    // h1 (current) has a neighbour on 'e' only (h2 sits at {1,0}); h2 (non-current) offers none at all.
    expect(container.querySelectorAll('.side-plus')).toHaveLength(5)
  })

  it('renders none when the current hexagon is fully surrounded', () => {
    const base = twoHexMap()
    const centre = base.hexagons[0]
    const ring = SIDE_ORDER.map((s, i) => ({ ...centre, id: `ring${i}`, cell: neighbour(centre.cell, s), contextId: centre.contextId }))
    useMapStore.getState().replace({ ...base, hexagons: [centre, ...ring] })
    const { container } = render(<Harness />)
    expect(freeSides(useMapStore.getState().map, centre.cell)).toEqual([])
    expect(container.querySelectorAll('.side-plus')).toHaveLength(0)
  })

  it('labels each trigger "Add hexagon to the {side} of {title}"', () => {
    const { container } = render(<Harness />)
    expect(screen.getByRole('button', { name: 'Add hexagon to the east of Test' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add hexagon to the north-west of Test' })).toBeTruthy()
    expect(container.querySelectorAll('.side-plus')).toHaveLength(6)
  })

  it('positions each trigger toward its own side of the current hexagon — east strictly right of west', () => {
    render(<Harness />)
    const at = (name: string) => (screen.getByRole('button', { name }).closest('.side-plus') as HTMLElement).style
    // Screen x = (mapX - viewport.x) * scale + pan: a shared viewport.x/scale/pan means the east midpoint
    // (map x = +pitch.x/2) must land strictly right of the west one (map x = -pitch.x/2), whatever the fit resolves to.
    expect(parseFloat(at('Add hexagon to the east of Test').left)).toBeGreaterThan(parseFloat(at('Add hexagon to the west of Test').left))
  })

  it('choosing "Hexagon in {context}" calls onGrow with the side and "same"', () => {
    const onGrow = vi.fn()
    render(<Harness onGrow={onGrow} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add hexagon to the east of Test' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hexagon in Context 1' }))
    expect(onGrow).toHaveBeenCalledWith('e', 'same')
  })

  it('choosing "Hexagon in a new bounded context" calls onGrow with the side and "new"', () => {
    const onGrow = vi.fn()
    render(<Harness onGrow={onGrow} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add hexagon to the east of Test' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hexagon in a new bounded context' }))
    expect(onGrow).toHaveBeenCalledWith('e', 'new')
  })
})

describe('Stage hexagon-naming field (GROW-02, ADR-02)', () => {
  it('renders no field when naming is false', () => {
    render(<Harness />)
    expect(screen.queryByRole('textbox', { name: 'Hexagon title' })).toBeNull()
  })

  it('renders an inline title field for the current hexagon, labelled "Hexagon title", when naming is true', () => {
    render(<Harness naming />)
    const input = screen.getByRole('textbox', { name: 'Hexagon title' }) as HTMLInputElement
    expect(input.value).toBe('Chat feedback slice')
  })

  it('commits the typed title via onNamed on Enter', () => {
    const onNamed = vi.fn()
    render(<Harness naming onNamed={onNamed} />)
    const input = screen.getByRole('textbox', { name: 'Hexagon title' })
    fireEvent.change(input, { target: { value: 'Billing' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onNamed).toHaveBeenCalledWith('Billing')
  })

  it('calls onNamingCancel on Esc', () => {
    const onNamingCancel = vi.fn()
    render(<Harness naming onNamingCancel={onNamingCancel} />)
    const input = screen.getByRole('textbox', { name: 'Hexagon title' })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onNamingCancel).toHaveBeenCalledOnce()
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

// Outer-loop acceptance test for the ONE fit control (FIT-01, FIT-02, ADR-05, F-01/F-02 decision obs 7314): written
// first and kept red through the inner viewport.ts/Stage.tsx RED-GREEN cycles below; green once the single button
// resolves 'auto' to the whole-map fit on a multi-hexagon map.
describe('Stage — the single fit control fits the whole map on 2+ hexagons (FIT-01, ADR-05)', () => {
  /** Reconstructs the live viewport from the same DOM styles toScreen/backgroundPosition derive from (GRID=20,
   * matching Stage.tsx) — the same self-consistent-formula idiom App.test.tsx's own toScreenX helper uses. */
  const viewportOf = (container: HTMLElement) => {
    const style = (container.querySelector('main') as HTMLElement).style
    const scale = parseFloat(style.backgroundSize) / 20
    const [px, py] = style.backgroundPosition.split(' ').map(parseFloat)
    return { x: -px / scale, y: -py / scale, scale }
  }
  const expectViewport = (container: HTMLElement, expected: { x: number; y: number; scale: number }) => {
    const actual = viewportOf(container)
    expect(actual.x).toBeCloseTo(expected.x, 6)
    expect(actual.y).toBeCloseTo(expected.y, 6)
    expect(actual.scale).toBeCloseTo(expected.scale, 6)
  }

  // fitTo's own unit tests (viewport.test.ts) prove minScale: 0 goes below MIN_SCALE for a huge map — this test's
  // job is the WIRING: the single "Fit diagram to screen" button drives that exact formula on a multi-hexagon map,
  // and the result keeps following the map as it grows.
  it('fits the whole map via fitTo(mapBounds, …, minScale: 0), and keeps following the map as it grows', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'Fit diagram to screen' }))

    const inset = islandInset({ width: 0, height: 0 }, false, false)
    const model1 = layoutMap(useMapStore.getState().map)
    const expected1 = fitTo(model1.bounds, model1.bounds.width, model1.bounds.height, inset, 0)
    expectViewport(container, expected1)

    act(() => {
      useMapStore.getState().addHexagon('h1', { context: 'same' })
    })

    const model2 = layoutMap(useMapStore.getState().map)
    const expected2 = fitTo(model2.bounds, model2.bounds.width, model2.bounds.height, inset, 0)
    expectViewport(container, expected2)
  })

  // FIT-01.2: a very large map still fits fully, never falling back to a partial view — the button's job on the
  // 8-hexagon honeycomb fixture, with a real screen size so wholeFit.scale genuinely lands below MIN_FIT_SCALE.
  it('shows every hexagon of the 8-hexagon honeycomb fixture, at a scale below MIN_FIT_SCALE', () => {
    const original = globalThis.ResizeObserver
    class FixedSizeResizeObserver {
      cb: ResizeObserverCallback
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb
      }
      observe() {
        this.cb([{ contentRect: { width: 800, height: 600 } } as ResizeObserverEntry], this as unknown as ResizeObserver)
      }
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = FixedSizeResizeObserver as unknown as typeof ResizeObserver
    try {
      const result = parseHexa(v2Honeycomb)
      if (!result.ok) throw new Error('fixture failed to parse')
      useMapStore.getState().replace(result.map)
      const { container } = render(<Harness />)

      fireEvent.click(screen.getByRole('button', { name: 'Fit diagram to screen' }))

      const inset = islandInset({ width: 800, height: 600 }, false, false)
      const model = layoutMap(useMapStore.getState().map)
      const viewport = viewportOf(container)
      expect(viewport.scale).toBeLessThan(MIN_FIT_SCALE)
      const visible = visibleRect(viewport, { width: 800, height: 600 }, inset)
      for (const hexagon of model.hexagons) expect(contains(visible, hexagonBounds(hexagon))).toBe(true)
    } finally {
      globalThis.ResizeObserver = original
    }
  })

  // Regression: a single-hexagon map is untouched by the multi-hexagon whole-map fit — the button still fits the
  // diagram with the MIN_FIT_SCALE fallback's own MIN_SCALE clamp, exactly as on main. A large single STRESS
  // hexagon on a small stubbed screen forces the natural scale below MIN_SCALE (0.1), the only value at which
  // fitMap's own floor and the whole-map fit's minScale:0 floor genuinely diverge for a one-hexagon map.
  it('still fits a single-hexagon map with the MIN_FIT_SCALE fallback, not the whole-map fit', () => {
    const original = globalThis.ResizeObserver
    class FixedSizeResizeObserver {
      cb: ResizeObserverCallback
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb
      }
      observe() {
        this.cb([{ contentRect: { width: 300, height: 300 } } as ResizeObserverEntry], this as unknown as ResizeObserver)
      }
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = FixedSizeResizeObserver as unknown as typeof ResizeObserver
    try {
      useMapStore.getState().replace(toMap(STRESS_DIAGRAM))
      const { container } = render(<Harness />)

      fireEvent.click(screen.getByRole('button', { name: 'Fit diagram to screen' }))

      const inset = islandInset({ width: 300, height: 300 }, false, false)
      const model = layoutMap(useMapStore.getState().map)
      expect(model.hexagons).toHaveLength(1)
      const singleFit = fitMap(model.bounds, hexagonBounds(currentHexagon(model, useMapStore.getState().focus)), 300, 300, inset)
      const wholeFit = fitTo(model.bounds, 300, 300, inset, 0)
      // The premise: on a real screen this small against STRESS content, the two floors genuinely differ.
      expect(singleFit.scale).not.toBeCloseTo(wholeFit.scale, 3)
      expectViewport(container, singleFit)
    } finally {
      globalThis.ResizeObserver = original
    }
  })
})

describe('Stage — auto-fit after a map-shape change (FIT-02, ADR-05)', () => {
  const inset = islandInset({ width: 0, height: 0 }, false, false)
  // 'auto' resolves by hexagon count (F-02, decision obs 7314): 1 -> the current-diagram fit (MIN_FIT_SCALE
  // fallback, unchanged from main); >=2 -> the whole-map fit, with no fallback, so it never shrinks to one hexagon.
  const autoFitOf = () => {
    const model = layoutMap(useMapStore.getState().map)
    return model.hexagons.length >= 2
      ? fitTo(model.bounds, model.bounds.width, model.bounds.height, inset, 0)
      : fitMap(model.bounds, hexagonBounds(currentHexagon(model, useMapStore.getState().focus)), model.bounds.width, model.bounds.height, inset)
  }
  const viewportOf = (container: HTMLElement) => {
    const style = (container.querySelector('main') as HTMLElement).style
    const scale = parseFloat(style.backgroundSize) / 20
    const [px, py] = style.backgroundPosition.split(' ').map(parseFloat)
    return { x: -px / scale, y: -py / scale, scale }
  }
  /** A pan of `dx`/`dy` screen px, past PAN_SLOP so it actually engages (matches "Stage panning"'s own gesture). */
  const pan = (container: HTMLElement, dx: number, dy: number) => {
    const main = container.querySelector('main') as HTMLElement
    main.setPointerCapture = () => {}
    fireEvent.pointerDown(svg(container), { button: 0, buttons: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(main, { buttons: 1, clientX: dx, clientY: dy })
  }
  // A tight "fit" leaves zero margin by construction, so a genuine "still contains the change" scenario needs a
  // manual viewport with actual slack first: zoom out (positive deltaY) anchored at the visible area's own
  // top-left corner (screen `inset.left`/`inset.top`, not raw (0,0)) — zoomAt keeps whatever diagram point sits
  // under the anchor fixed, so anchoring there keeps the CURRENTLY visible top-left corner fixed while the
  // bottom-right one grows outward with the zoom, matching the direction real growth actually happens in.
  const zoomOut = (container: HTMLElement) => fireEvent.wheel(container.querySelector('main')!, { deltaY: 600, clientX: inset.left, clientY: inset.top })

  const actions: [string, () => void][] = [
    ['grow', () => void useMapStore.getState().addHexagon('h1', { context: 'same' })],
    ['import', () => void useMapStore.getState().importHexagon(toMap(EXAMPLE_DIAGRAM), { context: 'same' })],
    ['delete', () => void useMapStore.getState().removeHexagon('h2')],
  ]

  it.each(actions)('a manual viewport stays exactly where it was when %s keeps the change on screen', (_label, change) => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<Harness />)
    zoomOut(container)
    const before = viewportOf(container)

    act(change)

    const after = viewportOf(container)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
    expect(after.scale).toBeCloseTo(before.scale, 6)
  })

  it.each(actions)('a manual viewport falls back to "auto" when %s moves the change out of view', (_label, change) => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<Harness />)
    pan(container, 100000, 100000) // Far pan: the whole map, and anywhere it could grow, is now off screen.

    act(change)

    const expected = autoFitOf()
    const after = viewportOf(container)
    expect(after.x).toBeCloseTo(expected.x, 6)
    expect(after.y).toBeCloseTo(expected.y, 6)
    expect(after.scale).toBeCloseTo(expected.scale, 6)
  })

  it('undo restores the pre-change hexagon set, which the same visibility rule then re-evaluates', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<Harness />)
    pan(container, 100000, 100000)
    const before = { map: useMapStore.getState().map, focus: useMapStore.getState().focus }

    act(() => useMapStore.getState().addHexagon('h1', { context: 'same' }))
    // The grow already fell out of view above — confirms the premise before undoing it.
    expect(viewportOf(container).scale).toBeCloseTo(autoFitOf().scale, 6)

    act(() => useMapStore.getState().restore(before))

    const expected = autoFitOf()
    const after = viewportOf(container)
    expect(after.x).toBeCloseTo(expected.x, 6)
    expect(after.y).toBeCloseTo(expected.y, 6)
    expect(after.scale).toBeCloseTo(expected.scale, 6)
  })

  it('the whole-map fit is unaffected by any of this on a multi-hexagon map — it keeps recomputing against the live bounds every render (FIT-02.1)', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Fit diagram to screen' }))

    act(() => useMapStore.getState().addHexagon('h1', { context: 'same' }))

    const model = layoutMap(useMapStore.getState().map)
    const expected = fitTo(model.bounds, model.bounds.width, model.bounds.height, inset, 0)
    const after = viewportOf(container)
    expect(after.x).toBeCloseTo(expected.x, 6)
    expect(after.y).toBeCloseTo(expected.y, 6)
    expect(after.scale).toBeCloseTo(expected.scale, 6)
  })

  it('does not disturb link mode when the current hexagon does not change (delete of a non-current hexagon)', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<Harness />)
    const revisionBefore = useMapStore.getState().revision
    const adapter = EXAMPLE_DIAGRAM.adapters.find((a) => EXAMPLE_DIAGRAM.ports.find((p) => p.id === a.portId)?.side === 'driven')!
    fireEvent.click(hexGroup(container, 'h1').querySelector(`[data-ref="${adapter.id}"]`)!)
    fireEvent.keyDown(document.body, { key: 'l' })
    expect(svg(container).hasAttribute('data-link-mode')).toBe(true)

    act(() => useMapStore.getState().removeHexagon('h2'))

    expect(useMapStore.getState().revision).toBe(revisionBefore)
    expect(svg(container).hasAttribute('data-link-mode')).toBe(true)
  })
})

describe('Stage — wheel floor follows the whole-map fit, not a hardcoded MIN_SCALE (FIT-01, ADR-05)', () => {
  const viewportOf = (container: HTMLElement) => {
    const style = (container.querySelector('main') as HTMLElement).style
    const scale = parseFloat(style.backgroundSize) / 20
    const [px, py] = style.backgroundPosition.split(' ').map(parseFloat)
    return { x: -px / scale, y: -py / scale, scale }
  }

  it('wheeling out from a fitted view keeps zooming by min(MIN_SCALE, wholeFit.scale), never snapping the scale back up to the plain MIN_SCALE floor', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Fit diagram to screen' }))
    const fitted = viewportOf(container)
    const inset = islandInset({ width: 0, height: 0 }, false, false)
    const model = layoutMap(useMapStore.getState().map)
    const wholeFit = fitTo(model.bounds, model.bounds.width, model.bounds.height, inset, 0)
    const zoomFloor = Math.min(MIN_SCALE, wholeFit.scale)

    const main = container.querySelector('main')!
    fireEvent.wheel(main, { deltaY: 4000 }) // A hard zoom-out — would hit MIN_SCALE under the old hardcoded floor.
    const zoomedOut = viewportOf(container)
    const expected = zoomAt(fitted, Math.exp(-4000 * 0.0015), { x: 0, y: 0 }, zoomFloor)

    expect(zoomedOut.scale).toBeCloseTo(expected.scale, 6)
    // Never above the fitted whole-map scale itself — a hardcoded MIN_SCALE floor above wholeFit.scale would have
    // clamped the zoom-out short of the view it was already fitted to.
    expect(zoomedOut.scale).toBeLessThanOrEqual(fitted.scale + 1e-9)
  })
})

// Step 0 hardening for S-006 (verify-in-loop-6, obs 7294): closes the three non-blocking findings the pinch
// integration commit left untested — none of them are architectural, spec, or sensitive, all additive coverage.
// F-02 (decision obs 7314) then changed the fallback target itself: 'auto' now resolves to the whole-map fit on
// a multi-hexagon map, so it never falls back to the current hexagon alone, even when it never fits above
// MIN_FIT_SCALE.
describe('Step 0 hardening — pinch, wheel floor, and the whole-map auto fit (obs 7294, F-02)', () => {
  const viewportOf = (container: HTMLElement) => {
    const style = (container.querySelector('main') as HTMLElement).style
    const scale = parseFloat(style.backgroundSize) / 20
    const [px, py] = style.backgroundPosition.split(' ').map(parseFloat)
    return { x: -px / scale, y: -py / scale, scale }
  }
  const pan = (container: HTMLElement, dx: number, dy: number) => {
    const main = container.querySelector('main') as HTMLElement
    main.setPointerCapture = () => {}
    fireEvent.pointerDown(svg(container), { button: 0, buttons: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(main, { buttons: 1, clientX: dx, clientY: dy })
  }
  /** Two hexagons far enough apart (q=0, q=500) that the whole map's bounds dwarf any realistic screen — needed
   * to push wholeFit.scale genuinely below MIN_SCALE/MIN_FIT_SCALE, which jsdom's self-referencing effectiveSize
   * fallback (size stays {0,0}, so effectiveSize mirrors the model's own bounds) can never do on its own. */
  const farHexagonMap = (): HexaMap => {
    const base = twoHexMap()
    return { ...base, hexagons: [base.hexagons[0], { ...base.hexagons[1], cell: { q: 500, r: 0 } }] }
  }
  /** Makes the ResizeObserver fire synchronously with a fixed content rect, giving Stage a REAL bounded screen
   * size instead of the self-referencing jsdom fallback — the gap verify-in-loop-6 finding 2/Mutant 4/5 both
   * name as the reason neither the wheel-floor formula nor the auto/whole fallback target could be RTL-proven. */
  const stubFixedSize = (width: number, height: number) => {
    const original = globalThis.ResizeObserver
    class FixedSizeResizeObserver {
      cb: ResizeObserverCallback
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb
      }
      observe() {
        this.cb([{ contentRect: { width, height } } as ResizeObserverEntry], this as unknown as ResizeObserver)
      }
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = FixedSizeResizeObserver as unknown as typeof ResizeObserver
    return () => {
      globalThis.ResizeObserver = original
    }
  }

  it('two fingers moving apart zoom in around their own midpoint, across two separate synchronous pointermove events, without selecting anything or opening a link chip', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<Harness />)
    const main = container.querySelector('main') as HTMLElement
    main.setPointerCapture = () => {}
    const before = viewportOf(container)

    fireEvent.pointerDown(main, { pointerId: 1, button: 0, buttons: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerDown(main, { pointerId: 2, button: 0, buttons: 1, clientX: 200, clientY: 100 })
    const from1: [Point, Point] = [{ x: 100, y: 100 }, { x: 200, y: 100 }]
    fireEvent.pointerMove(main, { pointerId: 1, buttons: 1, clientX: 50, clientY: 100 })
    const to1: [Point, Point] = [{ x: 50, y: 100 }, { x: 200, y: 100 }]
    const expectedAfter1 = pinch(before, from1, to1, MIN_SCALE)

    fireEvent.pointerMove(main, { pointerId: 2, buttons: 1, clientX: 250, clientY: 100 })
    const to2: [Point, Point] = [{ x: 50, y: 100 }, { x: 250, y: 100 }]
    const expectedAfter2 = pinch(expectedAfter1, to1, to2, MIN_SCALE)

    const after = viewportOf(container)
    expect(after.scale).toBeCloseTo(expectedAfter2.scale, 6)
    expect(after.x).toBeCloseTo(expectedAfter2.x, 6)
    expect(after.y).toBeCloseTo(expectedAfter2.y, 6)
    expect(after.scale).toBeGreaterThan(before.scale)
    expect(container.querySelector('[data-selected]')).toBeNull()
    expect(screen.queryByRole('button', { name: /Link to…/ })).toBeNull()
  })

  it('the wheel floor is min(MIN_SCALE, wholeFit.scale), not a hardcoded MIN_SCALE, once the map genuinely dwarfs the screen', () => {
    const restore = stubFixedSize(800, 600)
    try {
      useMapStore.getState().replace(farHexagonMap())
      const { container } = render(<Harness />)
      fireEvent.click(screen.getByRole('button', { name: 'Fit diagram to screen' }))
      const fitted = viewportOf(container)
      const inset = islandInset({ width: 800, height: 600 }, false, false)
      const model = layoutMap(useMapStore.getState().map)
      const wholeFit = fitTo(model.bounds, 800, 600, inset, 0)
      // The premise this test needs: a hardcoded MIN_SCALE floor and the real zoomFloor now genuinely differ.
      expect(wholeFit.scale).toBeLessThan(MIN_SCALE)
      const zoomFloor = Math.min(MIN_SCALE, wholeFit.scale)

      const main = container.querySelector('main')!
      fireEvent.wheel(main, { deltaY: 4000 })
      const zoomedOut = viewportOf(container)
      const expected = zoomAt(fitted, Math.exp(-4000 * 0.0015), { x: 0, y: 0 }, zoomFloor)

      expect(zoomedOut.scale).toBeCloseTo(expected.scale, 6)
      // A hardcoded MIN_SCALE mutant would have clamped here instead of following the map's own, lower floor.
      expect(zoomedOut.scale).toBeLessThan(MIN_SCALE)
    } finally {
      restore()
    }
  })

  it('falls back to the whole-map fit, not the old current-hexagon fallback, when a change moves an existing manual view out of sight on a map where the two targets genuinely diverge (F-02)', () => {
    const restore = stubFixedSize(800, 600)
    try {
      useMapStore.getState().replace(farHexagonMap())
      const { container } = render(<Harness />)
      const inset = islandInset({ width: 800, height: 600 }, false, false)
      const modelBefore = layoutMap(useMapStore.getState().map)
      // The premise: the OLD current-hexagon fallback threshold (MIN_FIT_SCALE) would have fired for this map —
      // F-02 says 'auto' follows the whole map anyway on 2+ hexagons, never falling back to it.
      expect(fitTo(modelBefore.bounds, 800, 600, inset, 0).scale).toBeLessThan(0.4)

      pan(container, 100000, 100000) // a manual viewport now looks far away from every hexagon

      act(() => {
        // Grows near h1 (adjacent, in view once the fallback lands); the far h2 stays on the map, so the whole-map
        // fit and the old current-hexagon fallback still diverge dramatically AFTER the change too.
        useMapStore.getState().addHexagon('h1', { context: 'same' })
      })

      const modelAfter = layoutMap(useMapStore.getState().map)
      const wholeAfter = fitTo(modelAfter.bounds, 800, 600, inset, 0)
      const oldCurrentHexagonFallback = fitMap(modelAfter.bounds, hexagonBounds(currentHexagon(modelAfter, useMapStore.getState().focus)), 800, 600, inset)
      expect(oldCurrentHexagonFallback.scale).not.toBeCloseTo(wholeAfter.scale, 3)

      const after = viewportOf(container)
      expect(after.scale).toBeCloseTo(wholeAfter.scale, 6)
      expect(after.x).toBeCloseTo(wholeAfter.x, 6)
      expect(after.y).toBeCloseTo(wholeAfter.y, 6)
    } finally {
      restore()
    }
  })

  it('with no fit button ever pressed, "auto" keeps every hexagon inside the visible rect after growing a multi-hexagon map whose whole-map fit is below MIN_FIT_SCALE (F-02)', () => {
    const restore = stubFixedSize(800, 600)
    try {
      useMapStore.getState().replace(farHexagonMap())
      const { container } = render(<Harness />)
      const inset = islandInset({ width: 800, height: 600 }, false, false)
      const modelBefore = layoutMap(useMapStore.getState().map)
      // Same premise as above, but this time the view is NEVER touched — the default 'auto' state must already
      // resolve to the whole-map fit on its own, with no button click and no prior manual viewport involved.
      expect(fitTo(modelBefore.bounds, 800, 600, inset, 0).scale).toBeLessThan(MIN_FIT_SCALE)

      act(() => {
        useMapStore.getState().addHexagon('h1', { context: 'same' })
      })

      const modelAfter = layoutMap(useMapStore.getState().map)
      const after = viewportOf(container)
      const visible = visibleRect(after, { width: 800, height: 600 }, inset)
      for (const hexagon of modelAfter.hexagons) expect(contains(visible, hexagonBounds(hexagon))).toBe(true)
    } finally {
      restore()
    }
  })
})

// S-006.2: the committed honeycomb fixture (8 hexagons, one STRESS-content, a split context, an unnamed context,
// a 6-ring around a foreign hexagon), rendered with each hexagon current in turn, in both layout modes.
describe('Stage — the honeycomb fixture stays disjoint with every hexagon current in turn, in both modes (S-006.2)', () => {
  const separation = (a: Box, b: Box): number => {
    const dx = Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width)
    const dy = Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height)
    return Math.max(dx, dy)
  }
  const honeycombMap = (): HexaMap => {
    const result = parseHexa(v2Honeycomb)
    if (!result.ok) throw new Error('fixture failed to parse')
    return result.map
  }

  for (const mode of ['detailed', 'overview'] as const) {
    it(`every pair of hexagon boxes stays separated by MAP_GAP with each hexagon current in turn (${mode})`, () => {
      const map = honeycombMap()
      useMapStore.getState().replace(map)
      const { container } = render(<Harness mode={mode} />)

      for (const hexagon of map.hexagons) {
        act(() => useMapStore.getState().setFocus(hexagon.id))

        const model = layoutMap(useMapStore.getState().map, { mode })
        for (let i = 0; i < model.hexagons.length; i++) {
          for (let j = i + 1; j < model.hexagons.length; j++) {
            expect(separation(hexagonBounds(model.hexagons[i]), hexagonBounds(model.hexagons[j]))).toBeGreaterThanOrEqual(60 - 1e-6)
          }
        }
        // Bridges the pure-layout guarantee above to the actual DOM: jsdom's getBoundingClientRect is a zero-box
        // stub (App.test.tsx's own EX-01 note), so the real proof a rendered group sits where the model says it
        // does is that its `transform` matches the model's `centre` exactly, for every hexagon, every time focus moves.
        for (const h of model.hexagons) {
          expect(hexGroup(container, h.id).getAttribute('transform')).toBe(`translate(${h.centre.x} ${h.centre.y})`)
        }
      }
    })
  }
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

  it('mounts the live region before any switch, so the first announcement is spoken, not missed by a region appearing with it already set', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<Harness />)
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('')

    fireEvent.keyDown(hexGroup(container, 'h2'), { key: 'Enter' })

    expect(screen.getByRole('status')).toBe(status)
    expect(status.textContent).toBe('Second slice is now the current hexagon')
  })

  it('switches to a hexagon whose id contains a double quote without breaking the DOM selector', () => {
    const base = twoHexMap()
    useMapStore.getState().replace({ ...base, hexagons: [base.hexagons[0], { ...base.hexagons[1], id: 'h"2' }] })
    const { container } = render(<Harness />)
    const group = hexGroup(container, 'h"2')
    expect(group.getAttribute('tabindex')).toBe('0')

    fireEvent.keyDown(group, { key: 'Enter' })

    expect(useMapStore.getState().focus).toBe('h"2')
    expect(hexGroup(container, 'h"2').contains(document.activeElement)).toBe(true)
  })

  it.each([{ key: 'Enter' }, { key: ' ' }])('makes a non-current hexagon current on %o, moves keyboard focus to its first item, and announces it', ({ key }) => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<Harness />)
    const group = hexGroup(container, 'h2')
    expect(group.getAttribute('tabindex')).toBe('0')

    fireEvent.keyDown(group, { key })

    expect(useMapStore.getState().focus).toBe('h2')
    // REQ-05.1: focus moves to the switched hexagon's first ITEM — not whatever tabbable element happens to
    // come first in DOM order, which is the outer ring (rendered before any node).
    const firstItem = hexGroup(container, 'h2').querySelector('.node[tabindex]')
    expect(firstItem).not.toBeNull()
    expect(document.activeElement).toBe(firstItem)
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

  it('a real double-click gesture on a non-current hexagon still reveals the hexagon card, not the item the pointer lands on (FOCUS-03.1)', () => {
    useMapStore.getState().replace(twoHexMap())
    const onReveal = vi.fn()
    const { container } = render(<Harness onReveal={onReveal} />)
    // A real gesture: click, click, dblclick — the first click already switches the current hexagon via
    // flushSync, so by the time dblclick fires, clickedHexId === hexId unless the code remembers which
    // hexagon was current when the gesture began.
    const target = hexGroup(container, 'h2').querySelector('.node')!

    fireEvent.click(target, { detail: 1 })
    fireEvent.click(target, { detail: 2 })
    fireEvent.doubleClick(target)

    expect(useMapStore.getState().focus).toBe('h2')
    expect(onReveal).toHaveBeenCalledWith('hexagon', true)
    expect(onReveal).not.toHaveBeenCalledWith(target.getAttribute('data-ref'), true)
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

describe('Stage — hull and chip are inert (CB-05, ADR-05 extended to context overlays)', () => {
  it('never respond to hover, click, or double-click', () => {
    const hexId = useMapStore.getState().focus
    useMapStore.getState().addHexagon(hexId, { side: 'e', context: 'new' })
    const { container } = render(<Harness />)
    expect(useMapStore.getState().map.contexts.length).toBeGreaterThanOrEqual(2)
    const hull = container.querySelector('[data-hull]')!
    const chip = container.querySelector('[data-chip]')!

    fireEvent.pointerOver(hull)
    expect(container.querySelector('[data-hex][aria-current="true"]')!.hasAttribute('data-hover')).toBe(false)

    const beforeMap = useMapStore.getState().map
    fireEvent.click(hull)
    fireEvent.doubleClick(hull)
    fireEvent.click(chip)
    fireEvent.doubleClick(chip)

    expect(useMapStore.getState().map).toBe(beforeMap)
  })

  it('does not change an existing selection when a hull is clicked', () => {
    const base = twoHexMap()
    useMapStore.getState().replace({ ...base, contexts: [base.contexts[0], { id: 'c2' }], hexagons: [base.hexagons[0], { ...base.hexagons[1], contextId: 'c2' }] })
    const { container } = render(<Harness />)
    const node = hexGroup(container, 'h1').querySelector<HTMLElement>('.node[data-ref]')!
    fireEvent.click(node)
    expect(node.hasAttribute('data-selected')).toBe(true)

    fireEvent.click(container.querySelector('[data-hull]')!)

    expect(node.hasAttribute('data-selected')).toBe(true)
  })
})
