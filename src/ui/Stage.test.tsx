import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { Stage } from './Stage'
import { hexagonBounds } from '../layout/lattice'
import { currentHexagon, layoutMap } from '../layout/map'
import { legendFor } from '../layout/legend'
import { EXAMPLE_DIAGRAM, STRESS_DIAGRAM } from '../model/example'
import { flowFrame } from './flowFrame'
import { flowOf } from '../model/flow'
import { toMap } from '../model/hexa'
import { contextName, diagramOf, freeSides, neighbour, SIDE_ORDER } from '../model/map'
import { withoutPlanned } from '../model/planned'
import { useMapStore } from '../model/store'
import { usePreferencesStore } from './state/preferencesStore'
import { useViewStore } from './state/viewStore'
import type { HexaMap } from '../model/schema'
import { parseHexa } from '../model/hexa'
import { hexGroup, linkedTwoHexMap, manyHexagonMap, twoHexMap } from '../test/fixtures'
import { canvasBounds, contains, ELEMENT_FOCUS_SCALE, fitMap, fitTo, islandInset, MIN_FIT_SCALE, MIN_SCALE, pinch, visibleRect, zoomAt } from './viewport'
import type { Box, Point } from '../layout/geometry'
import { readFileSync } from 'node:fs'
import { translatedNodeBox } from '../layout/linkEnds'
import { boxObstacles } from '../layout/boxLabels'
import { centreZones, touches } from './stage/labelCulling'
import { boxLabelsOverlaid, zoomLevel } from './stage/overlays'
import { labelTextWidth } from './stage/labelWidth'
import v2Honeycomb from '../model/fixtures/v2-honeycomb.hexa?raw'
import twoHexagonSample from '../model/fixtures/two-hexagon-sample.hexa?raw'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
let queuedFrames: FrameRequestCallback[] = []
/** Wheel, pinch and pan commit once per animation frame: runs the frame (the fake clock's when it is faked). */
const flushFrame = () => act(() => (vi.isFakeTimers() ? void vi.advanceTimersByTime(16) : void queuedFrames.splice(0).forEach((cb) => cb(performance.now()))))
beforeEach(() => {
  queuedFrames = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => queuedFrames.push(cb))
  vi.stubGlobal('cancelAnimationFrame', () => {})
  useMapStore.getState().replace(toMap(EXAMPLE_DIAGRAM))
  useViewStore.setState({ editorOpen: false })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** The stage as the app wires it: laid out from the live stores; view state and preferences are seeded through them. */
function Harness({
  onGrow = () => {},
  onLink = () => {},
  onDelete = () => false,
}: {
  onDelete?: (ref: string) => boolean
  onGrow?: (side: import('../model/schema').Wall, context: 'same' | 'new') => void
  onLink?: (source: string, choice: import('../model/links').LinkChoice) => void
}) {
  const mode = usePreferencesStore((s) => s.mode)
  const expanded = useViewStore((s) => s.expanded)
  const showPlanned = usePreferencesStore((s) => s.showPlanned)
  const whole = useMapStore((s) => s.map)
  const revision = useMapStore((s) => s.revision)
  const hexId = useMapStore((s) => s.focus)
  const map = showPlanned ? whole : withoutPlanned(whole, hexId)
  const diagram = diagramOf(map, hexId)
  const svgRef = createRef<SVGSVGElement>()
  const currentContextId = map.hexagons.find((h) => h.id === hexId)!.contextId
  return (
    <Stage
      model={layoutMap(map, { mode, current: hexId, expanded })}
      map={map}
      hexId={hexId}
      diagram={diagram}
      legend={legendFor(diagram)}
      revision={revision}
      title="Test"
      svgRef={svgRef}
      onDelete={onDelete}
      onLink={onLink}
      contextLabel={contextName(map, currentContextId)}
      onGrow={onGrow}
    />
  )
}

/** Opens the current hexagon's inline title field, as growing the map does. */
const startNaming = () => {
  const { map, focus } = useMapStore.getState()
  useViewStore.setState({ growing: { hexId: focus, before: { map, focus } } })
}

const svg = (container: HTMLElement) => container.querySelector('svg.canvas')!
const hover = (container: HTMLElement, layer: string) => fireEvent.pointerOver(container.querySelector(`[data-band="${layer}"]`)!)

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
/** Makes the ResizeObserver fire synchronously with a fixed content rect, giving Stage a REAL bounded screen size
 * instead of jsdom's self-referencing fallback (size stays {0,0}, so effectiveSize mirrors the model's own bounds). */
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
    usePreferencesStore.setState({ highlight: false })
 const { container } = render(<Harness />)
    hover(container, 'application')
    expect(svg(container).hasAttribute('data-hover')).toBe(false)
    expect(screen.getByRole('button', { name: 'Add a use case on the south-west wall' })).toBeTruthy()
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
    expect(screen.queryByRole('button', { name: 'Add a use case on the south-west wall' })).toBeNull()
    hover(container, 'domain')
    expect(screen.getByRole('button', { name: 'Add a domain item' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add a use case on the south-west wall' })).toBeNull()
  })

  it('creates a use case, edits its name inline, and commits it on Enter', () => {
    const { container } = render(<Harness />)
    hover(container, 'application')
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Add a use case on the south-west wall' })))
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
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Add a use case on the south-west wall' })))
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
    startNaming()
    render(<Harness />)
    const input = screen.getByRole('textbox', { name: 'Hexagon title' }) as HTMLInputElement
    expect(input.value).toBe('Chat feedback slice')
  })

  it('commits the typed title as the hexagon title and closes the field on Enter', () => {
    startNaming()
    render(<Harness />)
    const input = screen.getByRole('textbox', { name: 'Hexagon title' })
    fireEvent.change(input, { target: { value: 'Billing' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useMapStore.getState().map.hexagons.find((h) => h.id === useMapStore.getState().focus)!.title).toBe('Billing')
    expect(useViewStore.getState().growing).toBeNull()
  })

  it('closes the field on Esc', () => {
    startNaming()
    render(<Harness />)
    const input = screen.getByRole('textbox', { name: 'Hexagon title' })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(useViewStore.getState().growing).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Hexagon title' })).toBeNull()
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
    flushFrame()
    expect(origin(container)).not.toBe(start)
    expect(main.classList.contains('is-dragging')).toBe(true)
  })
})

// Outer-loop acceptance test for the ONE fit control (FIT-01, FIT-02, ADR-05): written
// first and kept red through the inner viewport.ts/Stage.tsx RED-GREEN cycles below; green once the single button
// resolves 'auto' to the whole-map fit on a multi-hexagon map.
describe('Stage — the single fit control fits the whole map on 2+ hexagons (FIT-01, ADR-05)', () => {
  // fitTo's own unit tests (viewport.test.ts) prove minScale: 0 goes below MIN_SCALE for a huge map — this test's
  // job is the WIRING: the single "Fit diagram to screen" button drives that exact formula on a multi-hexagon map,
  // and the result keeps following the map as it grows.
  it('fits the whole map via fitTo(mapBounds, …, minScale: 0), and keeps following the map as it grows', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'Fit diagram to screen' }))

    const inset = islandInset({ width: 0, height: 0 }, false, false)
    const model1 = layoutMap(useMapStore.getState().map)
    const expected1 = fitTo(canvasBounds(model1), model1.bounds.width, model1.bounds.height, inset, 0)
    expectViewport(container, expected1)

    act(() => {
      useMapStore.getState().addHexagon('h1', { context: 'same' })
    })

    const model2 = layoutMap(useMapStore.getState().map)
    const expected2 = fitTo(canvasBounds(model2), model2.bounds.width, model2.bounds.height, inset, 0)
    expectViewport(container, expected2)
  })

  // FIT-01.2: a very large map still fits fully, never falling back to a partial view — the button's job on the
  // 8-hexagon honeycomb fixture, with a real screen size so wholeFit.scale genuinely lands below MIN_FIT_SCALE.
  it('shows every hexagon of the 8-hexagon honeycomb fixture, at a scale below MIN_FIT_SCALE', () => {
    const restore = stubFixedSize(800, 600)
    try {
      const result = parseHexa(v2Honeycomb)
      if (!result.ok || result.map.kind !== 'hexagonal') throw new Error('fixture failed to parse')
      useMapStore.getState().replace(result.map)
      const { container } = render(<Harness />)

      fireEvent.click(screen.getByRole('button', { name: 'Fit diagram to screen' }))

      const inset = islandInset({ width: 800, height: 600 }, false, false)
      const model = layoutMap(useMapStore.getState().map, { current: useMapStore.getState().focus })
      const viewport = viewportOf(container)
      expect(viewport.scale).toBeLessThan(MIN_FIT_SCALE)
      const visible = visibleRect(viewport, { width: 800, height: 600 }, inset)
      for (const hexagon of model.hexagons) expect(contains(visible, hexagonBounds(hexagon))).toBe(true)
    } finally {
      restore()
    }
  })

  // Regression: a single-hexagon map is untouched by the multi-hexagon whole-map fit — the button still fits the
  // diagram with the MIN_FIT_SCALE fallback's own MIN_SCALE clamp, exactly as on main. A large single STRESS
  // hexagon on a small stubbed screen forces the natural scale below MIN_SCALE (0.1), the only value at which
  // fitMap's own floor and the whole-map fit's minScale:0 floor genuinely diverge for a one-hexagon map.
  it('still fits a single-hexagon map with the MIN_FIT_SCALE fallback, not the whole-map fit', () => {
    const restore = stubFixedSize(300, 300)
    try {
      useMapStore.getState().replace(toMap(STRESS_DIAGRAM))
      const { container } = render(<Harness />)

      fireEvent.click(screen.getByRole('button', { name: 'Fit diagram to screen' }))

      const inset = islandInset({ width: 300, height: 300 }, false, false)
      const model = layoutMap(useMapStore.getState().map)
      expect(model.hexagons).toHaveLength(1)
      const singleFit = fitMap(model.bounds, hexagonBounds(currentHexagon(model, useMapStore.getState().focus)), 300, 300, inset)
      const wholeFit = fitTo(canvasBounds(model), 300, 300, inset, 0)
      // The premise: on a real screen this small against STRESS content, the two floors genuinely differ.
      expect(singleFit.scale).not.toBeCloseTo(wholeFit.scale, 3)
      expectViewport(container, singleFit)
    } finally {
      restore()
    }
  })
})

describe('Stage — auto-fit after a map-shape change (FIT-02, ADR-05)', () => {
  const inset = islandInset({ width: 0, height: 0 }, false, false)
  // 'auto' resolves by hexagon count: 1 -> the current-diagram fit (MIN_FIT_SCALE
  // fallback, unchanged from main); >=2 -> the whole-map fit, with no fallback, so it never shrinks to one hexagon.
  const autoFitOf = () => {
    const model = layoutMap(useMapStore.getState().map)
    return model.hexagons.length >= 2
      ? fitTo(canvasBounds(model), model.bounds.width, model.bounds.height, inset, 0)
      : fitMap(model.bounds, hexagonBounds(currentHexagon(model, useMapStore.getState().focus)), model.bounds.width, model.bounds.height, inset)
  }
  /** A pan of `dx`/`dy` screen px, past PAN_SLOP so it actually engages (matches "Stage panning"'s own gesture). */
  const pan = (container: HTMLElement, dx: number, dy: number) => {
    const main = container.querySelector('main') as HTMLElement
    main.setPointerCapture = () => {}
    fireEvent.pointerDown(svg(container), { button: 0, buttons: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(main, { buttons: 1, clientX: dx, clientY: dy })
    flushFrame()
  }
  // A tight "fit" leaves zero margin by construction, so a genuine "still contains the change" scenario needs a
  // manual viewport with actual slack first: zoom out (positive deltaY) anchored at the visible area's own
  // top-left corner (screen `inset.left`/`inset.top`, not raw (0,0)) — zoomAt keeps whatever diagram point sits
  // under the anchor fixed, so anchoring there keeps the CURRENTLY visible top-left corner fixed while the
  // bottom-right one grows outward with the zoom, matching the direction real growth actually happens in.
  const zoomOut = (container: HTMLElement) => {
    fireEvent.wheel(container.querySelector('main')!, { deltaY: 600, clientX: inset.left, clientY: inset.top })
    flushFrame()
  }

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

  // Importing (or deleting) a large hexagon beside a lower-row one moves that one, so the visibility rule must look at
  // the survivors that shifted, not only at the added/removed one.
  describe('when the change moves an existing hexagon', () => {
    const SCREEN = { width: 1200, height: 1900 }
    /** h2 sits one row below h1, so the large hexagon imported east of h1 pushes it down. */
    const stacked = (): HexaMap => {
      const base = twoHexMap()
      return { ...base, hexagons: [base.hexagons[0], { ...base.hexagons[1], cell: { q: 0, r: 1 } }] }
    }
    const withLarge = () => {
      useMapStore.getState().replace(stacked())
      useMapStore.getState().importHexagon(toMap(STRESS_DIAGRAM), { context: 'same' })
      return useMapStore.getState().map
    }
    const largeId = (map: HexaMap) => map.hexagons[map.hexagons.length - 1].id
    const largeBox = () => {
      const map = withLarge()
      return hexagonBounds(layoutMap(map).hexagons.find((h) => h.id === largeId(map))!)
    }
    const visibleOf = (vp: { x: number; y: number; scale: number }) => visibleRect(vp, SCREEN, islandInset(SCREEN, false, false))
    /** Zooms out until the visible area is larger than `target`, then pans so that area starts just before it. */
    const frame = (container: HTMLElement, target: Box) => {
      const box = { x: target.x - 50, y: target.y - 50, width: target.width + 100, height: target.height + 100 }
      for (let step = 0; step < 60 && (visibleOf(viewportOf(container)).width < box.width || visibleOf(viewportOf(container)).height < box.height); step++) {
        fireEvent.wheel(container.querySelector('main')!, { deltaY: 50, clientX: inset.left, clientY: inset.top })
        flushFrame()
      }
      const vp = viewportOf(container)
      const visible = visibleOf(vp)
      pan(container, (visible.x - box.x) * vp.scale, (visible.y - box.y) * vp.scale)
    }
    /** Zooms out by `zoomDelta` wheel units, then pans so the visible area's top-left sits at `topLeft` in map space. */
    const frameAt = (container: HTMLElement, topLeft: Point, zoomDelta: number) => {
      fireEvent.wheel(container.querySelector('main')!, { deltaY: zoomDelta, clientX: inset.left, clientY: inset.top })
      flushFrame()
      const vp = viewportOf(container)
      const visible = visibleOf(vp)
      pan(container, (visible.x - topLeft.x) * vp.scale, (visible.y - topLeft.y) * vp.scale)
    }
    const expectRefit = (container: HTMLElement) => {
      const model = layoutMap(useMapStore.getState().map)
      expectViewport(container, fitTo(canvasBounds(model), SCREEN.width, SCREEN.height, islandInset(SCREEN, false, false), 0))
    }

    it('importing a larger hexagon re-fits when it pushes an existing hexagon out of a manual view', () => {
      const restore = stubFixedSize(SCREEN.width, SCREEN.height)
      try {
        const large = largeBox()
        useMapStore.getState().replace(stacked())
        const { container } = render(<Harness />)
        frame(container, large)
        const before = viewportOf(container)

        act(() => void useMapStore.getState().importHexagon(toMap(STRESS_DIAGRAM), { context: 'same' }))

        const model = layoutMap(useMapStore.getState().map)
        const visible = visibleOf(before)
        const moved = model.hexagons.find((h) => h.id === 'h2')!
        expect(contains(visible, hexagonBounds(model.hexagons.find((h) => h.id === largeId(useMapStore.getState().map))!))).toBe(true) // the added hexagon alone would keep the view
        expect(contains(visible, hexagonBounds(moved))).toBe(false) // but h2 was pushed off it
        expectRefit(container)
      } finally {
        restore()
      }
    })

    it('deleting the large hexagon re-fits when it pulls an existing hexagon out of a manual view', () => {
      const restore = stubFixedSize(SCREEN.width, SCREEN.height)
      try {
        const map = withLarge()
        const { container } = render(<Harness />)
        const model = layoutMap(map)
        frame(container, hexagonBounds(model.hexagons.find((h) => h.id === largeId(map))!))
        const visible = visibleOf(viewportOf(container))
        expect(contains(visible, hexagonBounds(model.hexagons.find((h) => h.id === largeId(map))!))).toBe(true)

        act(() => void useMapStore.getState().removeHexagon(largeId(map)))

        const moved = layoutMap(useMapStore.getState().map).hexagons.find((h) => h.id === 'h2')!
        expect(contains(visible, hexagonBounds(moved))).toBe(false)
        expectRefit(container)
      } finally {
        restore()
      }
    })

    it('leaves a manual view alone when every shifted hexagon still fits in it', () => {
      const restore = stubFixedSize(SCREEN.width, SCREEN.height)
      try {
        useMapStore.getState().replace(twoHexMap())
        const { container } = render(<Harness />)
        frameAt(container, { x: -1300, y: -1300 }, 400)
        const before = viewportOf(container)

        act(() => void useMapStore.getState().importHexagon(toMap(STRESS_DIAGRAM), { context: 'same' }))

        const visible = visibleOf(before)
        expect(layoutMap(useMapStore.getState().map).hexagons.every((h) => contains(visible, hexagonBounds(h)))).toBe(true)
        expectViewport(container, before)
      } finally {
        restore()
      }
    })
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
    const expected = fitTo(canvasBounds(model), model.bounds.width, model.bounds.height, inset, 0)
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

describe('Stage — the whole-map auto view survives a canvas focus switch (FIT-02.1)', () => {
  const threeHexMap = (): HexaMap => {
    const base = twoHexMap()
    return { ...base, hexagons: [base.hexagons[0], base.hexagons[1], { ...base.hexagons[0], id: 'h3', cell: { q: 0, r: 1 } }] }
  }

  it('keeps following the whole map after switching the current hexagon, so a later delete still re-fits to the smaller map', () => {
    const restore = stubFixedSize(1200, 800)
    try {
      useMapStore.getState().replace(threeHexMap())
      const { container } = render(<Harness />)

      fireEvent.click(hexGroup(container, 'h2'))
      act(() => useMapStore.getState().removeHexagon('h3'))

      const inset = islandInset({ width: 1200, height: 800 }, false, false)
      const model = layoutMap(useMapStore.getState().map)
      expect(model.hexagons).toHaveLength(2)
      const expected = fitTo(canvasBounds(model), 1200, 800, inset, 0)
      expectViewport(container, expected)
    } finally {
      restore()
    }
  })

  it('a switch on a two-hexagon map does not freeze the view — opening the side panel leaves it where it is while the current hexagon stays visible', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<Harness />)
    fireEvent.click(hexGroup(container, 'h2'))
    const before = viewportOf(container)

    act(() => useViewStore.setState({ editorOpen: true }))

    expectViewport(container, before)
  })

  it('a switch on a two-hexagon map keeps the zoom and pans the current hexagon into the area the side panel leaves', () => {
    const restore = stubFixedSize(700, 940)
    try {
      useMapStore.getState().replace(twoHexMap())
      const { container } = render(<Harness />)
      fireEvent.click(hexGroup(container, 'h2'))
      const size = { width: 700, height: 940 }
      const before = viewportOf(container)
      const model = layoutMap(useMapStore.getState().map)
      const h2 = hexagonBounds(model.hexagons.find((h) => h.id === 'h2')!)
      expect(contains(visibleRect(before, size, islandInset(size, true, false)), h2)).toBe(false)

      act(() => useViewStore.setState({ editorOpen: true }))

      const after = viewportOf(container)
      expect(after.scale).toBeCloseTo(before.scale, 9)
      expect(contains(visibleRect(after, size, islandInset(size, true, false)), { ...h2, x: h2.x + 0.001, y: h2.y + 0.001, width: h2.width - 0.002, height: h2.height - 0.002 })).toBe(true)
    } finally {
      restore()
    }
  })

  it('the initial auto view on exactly two widely-spaced hexagons is the whole-map fit, not the current-hexagon fallback', () => {
    const restore = stubFixedSize(800, 600)
    try {
      const base = twoHexMap()
      const spread: HexaMap = { ...base, hexagons: [base.hexagons[0], { ...base.hexagons[1], cell: { q: 500, r: 0 } }] }
      useMapStore.getState().replace(spread)
      const { container } = render(<Harness />)

      const inset = islandInset({ width: 800, height: 600 }, false, false)
      const model = layoutMap(useMapStore.getState().map)
      expect(model.hexagons).toHaveLength(2)
      const wholeFit = fitTo(canvasBounds(model), 800, 600, inset, 0)
      const singleFit = fitMap(model.bounds, hexagonBounds(currentHexagon(model, useMapStore.getState().focus)), 800, 600, inset)
      // The premise: the whole map is genuinely too small to read, so fitMap's own current-hexagon fallback would
      // otherwise kick in — the only regime where 'auto' resolving to wholeFit vs. singleFit is distinguishable.
      expect(wholeFit.scale).toBeLessThan(MIN_FIT_SCALE)
      expect(singleFit.scale).not.toBeCloseTo(wholeFit.scale, 3)
      expectViewport(container, wholeFit)
    } finally {
      restore()
    }
  })
})

describe('Stage — wheel floor follows the whole-map fit, not a hardcoded MIN_SCALE (FIT-01, ADR-05)', () => {
  it('wheeling out from a fitted view keeps zooming by min(MIN_SCALE, wholeFit.scale), never snapping the scale back up to the plain MIN_SCALE floor', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Fit diagram to screen' }))
    const fitted = viewportOf(container)
    const inset = islandInset({ width: 0, height: 0 }, false, false)
    const model = layoutMap(useMapStore.getState().map)
    const wholeFit = fitTo(canvasBounds(model), model.bounds.width, model.bounds.height, inset, 0)
    const zoomFloor = Math.min(MIN_SCALE, wholeFit.scale)

    const main = container.querySelector('main')!
    fireEvent.wheel(main, { deltaY: 4000 }) // A hard zoom-out — would hit MIN_SCALE under the old hardcoded floor.
    flushFrame()
    const zoomedOut = viewportOf(container)
    const expected = zoomAt(fitted, Math.exp(-4000 * 0.0015), { x: 0, y: 0 }, zoomFloor)

    expect(zoomedOut.scale).toBeCloseTo(expected.scale, 6)
    // Never above the fitted whole-map scale itself — a hardcoded MIN_SCALE floor above wholeFit.scale would have
    // clamped the zoom-out short of the view it was already fitted to.
    expect(zoomedOut.scale).toBeLessThanOrEqual(fitted.scale + 1e-9)
  })
})

// Pinch, wheel floor, and the whole-map auto fit: 'auto' resolves to the whole-map fit on a multi-hexagon map, so
// it never falls back to the current hexagon alone, even when it never fits above MIN_FIT_SCALE.
describe('Stage — pinch, wheel floor, and the whole-map auto fit', () => {
  const pan = (container: HTMLElement, dx: number, dy: number) => {
    const main = container.querySelector('main') as HTMLElement
    main.setPointerCapture = () => {}
    fireEvent.pointerDown(svg(container), { button: 0, buttons: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(main, { buttons: 1, clientX: dx, clientY: dy })
    flushFrame()
  }
  /** Two hexagons far enough apart (q=0, q=500) that the whole map's bounds dwarf any realistic screen — needed
   * to push wholeFit.scale genuinely below MIN_SCALE/MIN_FIT_SCALE, which jsdom's self-referencing effectiveSize
   * fallback (size stays {0,0}, so effectiveSize mirrors the model's own bounds) can never do on its own. */
  const farHexagonMap = (): HexaMap => {
    const base = twoHexMap()
    return { ...base, hexagons: [base.hexagons[0], { ...base.hexagons[1], cell: { q: 500, r: 0 } }] }
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
    flushFrame()
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
      const wholeFit = fitTo(canvasBounds(model), 800, 600, inset, 0)
      // The premise this test needs: a hardcoded MIN_SCALE floor and the real zoomFloor now genuinely differ.
      expect(wholeFit.scale).toBeLessThan(MIN_SCALE)
      const zoomFloor = Math.min(MIN_SCALE, wholeFit.scale)

      const main = container.querySelector('main')!
      fireEvent.wheel(main, { deltaY: 4000 })
      flushFrame()
      const zoomedOut = viewportOf(container)
      const expected = zoomAt(fitted, Math.exp(-4000 * 0.0015), { x: 0, y: 0 }, zoomFloor)

      expect(zoomedOut.scale).toBeCloseTo(expected.scale, 6)
      // A hardcoded MIN_SCALE mutant would have clamped here instead of following the map's own, lower floor.
      expect(zoomedOut.scale).toBeLessThan(MIN_SCALE)
    } finally {
      restore()
    }
  })

  it('falls back to the whole-map fit, not the old current-hexagon fallback, when a change moves an existing manual view out of sight on a map where the two targets genuinely diverge', () => {
    const restore = stubFixedSize(800, 600)
    try {
      useMapStore.getState().replace(farHexagonMap())
      const { container } = render(<Harness />)
      const inset = islandInset({ width: 800, height: 600 }, false, false)
      const modelBefore = layoutMap(useMapStore.getState().map)
      // The premise: the OLD current-hexagon fallback threshold (MIN_FIT_SCALE) would have fired for this map —
      // 'auto' follows the whole map anyway on 2+ hexagons, never falling back to it.
      expect(fitTo(canvasBounds(modelBefore), 800, 600, inset, 0).scale).toBeLessThan(0.4)

      pan(container, 100000, 100000) // a manual viewport now looks far away from every hexagon

      act(() => {
        // Grows near h1 (adjacent, in view once the fallback lands); the far h2 stays on the map, so the whole-map
        // fit and the old current-hexagon fallback still diverge dramatically AFTER the change too.
        useMapStore.getState().addHexagon('h1', { context: 'same' })
      })

      const modelAfter = layoutMap(useMapStore.getState().map)
      const wholeAfter = fitTo(canvasBounds(modelAfter), 800, 600, inset, 0)
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

  it('with no fit button ever pressed, "auto" keeps every hexagon inside the visible rect after growing a multi-hexagon map whose whole-map fit is below MIN_FIT_SCALE', () => {
    const restore = stubFixedSize(800, 600)
    try {
      useMapStore.getState().replace(farHexagonMap())
      const { container } = render(<Harness />)
      const inset = islandInset({ width: 800, height: 600 }, false, false)
      const modelBefore = layoutMap(useMapStore.getState().map)
      // Same premise as above, but this time the view is NEVER touched — the default 'auto' state must already
      // resolve to the whole-map fit on its own, with no button click and no prior manual viewport involved.
      expect(fitTo(canvasBounds(modelBefore), 800, 600, inset, 0).scale).toBeLessThan(MIN_FIT_SCALE)

      act(() => {
        useMapStore.getState().addHexagon('h1', { context: 'same' })
      })

      const modelAfter = layoutMap(useMapStore.getState().map)
      const after = viewportOf(container)
      const visible = visibleRect(after, { width: 800, height: 600 }, inset)
      // A cell 500 pitches out puts the fit's edge ~1e6 units away, where float rounding alone shifts it ~1e-11.
      const EPS = 1e-6
      const tolerant = { x: visible.x - EPS, y: visible.y - EPS, width: visible.width + 2 * EPS, height: visible.height + 2 * EPS }
      for (const hexagon of modelAfter.hexagons) expect(contains(tolerant, hexagonBounds(hexagon))).toBe(true)
    } finally {
      restore()
    }
  })
})

// The committed honeycomb fixture (8 hexagons, one STRESS-content, a split context, an unnamed context, a 6-ring
// around a foreign hexagon), rendered with each hexagon current in turn, in both layout modes.
describe('Stage — the honeycomb fixture stays disjoint with every hexagon current in turn, in both modes', () => {
  const separation = (a: Box, b: Box): number => {
    const dx = Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width)
    const dy = Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height)
    return Math.max(dx, dy)
  }
  const honeycombMap = (): HexaMap => {
    const result = parseHexa(v2Honeycomb)
    if (!result.ok || result.map.kind !== 'hexagonal') throw new Error('fixture failed to parse')
    return result.map
  }

  for (const mode of ['detailed', 'overview'] as const) {
    it(`every pair of hexagon boxes stays separated by MAP_GAP with each hexagon current in turn (${mode})`, () => {
      const map = honeycombMap()
      useMapStore.getState().replace(map)
      usePreferencesStore.setState({ mode })
      const { container } = render(<Harness />)

      for (const hexagon of map.hexagons) {
        act(() => useMapStore.getState().setFocus(hexagon.id))

        const model = layoutMap(useMapStore.getState().map, { mode, current: hexagon.id })
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
    const onReveal = vi.spyOn(useViewStore.getState(), 'reveal')
    const { container } = render(<Harness />)

    fireEvent.doubleClick(hexGroup(container, 'h2'))

    expect(useMapStore.getState().focus).toBe('h2')
    expect(onReveal).toHaveBeenCalledWith('hexagon', true, 'h2')
  })

  it('double-clicking an element or a hexagon title reveals its field in that hexagon’s own subdomain', () => {
    useMapStore.getState().replace(twoHexMap())
    const onReveal = vi.spyOn(useViewStore.getState(), 'reveal')
    const { container } = render(<Harness />)
    const element = hexGroup(container, 'h1').querySelector('.node')!

    fireEvent.doubleClick(element)
    expect(onReveal).toHaveBeenLastCalledWith(element.getAttribute('data-ref'), true, 'h1')

    fireEvent.doubleClick(hexGroup(container, 'h1').querySelector('[data-hexagon-title]')!)
    expect(onReveal).toHaveBeenLastCalledWith('hexagon', true, 'h1')
  })

  it('a real double-click gesture on a non-current hexagon still reveals the hexagon card, not the item the pointer lands on (FOCUS-03.1)', () => {
    useMapStore.getState().replace(twoHexMap())
    const onReveal = vi.spyOn(useViewStore.getState(), 'reveal')
    const { container } = render(<Harness />)
    // A real gesture: click, click, dblclick — the first click already switches the current hexagon via
    // flushSync, so by the time dblclick fires, clickedHexId === hexId unless the code remembers which
    // hexagon was current when the gesture began.
    const target = hexGroup(container, 'h2').querySelector('.node')!

    fireEvent.click(target, { detail: 1 })
    fireEvent.click(target, { detail: 2 })
    fireEvent.doubleClick(target)

    expect(useMapStore.getState().focus).toBe('h2')
    expect(onReveal).toHaveBeenCalledWith('hexagon', true, 'h2')
    expect(onReveal).not.toHaveBeenCalledWith(target.getAttribute('data-ref'), true)
  })

  it('switching the current hexagon clears the selection and ends link mode, without moving the view (FOCUS-04.1)', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<Harness />)
    const main = container.querySelector('main') as HTMLElement
    const adapter = EXAMPLE_DIAGRAM.adapters.find((a) => EXAMPLE_DIAGRAM.ports.find((p) => p.id === a.portId)?.side === 'driven')!
    const node = hexGroup(container, 'h1').querySelector(`[data-ref="${adapter.id}"]`)!

    fireEvent.click(node)
    expect(node.hasAttribute('data-selected')).toBe(true)
    const positionBefore = main.style.backgroundPosition
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
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Add a use case on the south-west wall' })))
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

  const twoContextMap = () => {
    const base = twoHexMap()
    useMapStore.getState().replace({ ...base, contexts: [base.contexts[0], { id: 'c2' }], hexagons: [base.hexagons[0], { ...base.hexagons[1], contextId: 'c2' }] })
  }

  it('clears the selection when a hull is clicked', () => {
    twoContextMap()
    const { container } = render(<Harness />)
    const node = hexGroup(container, 'h1').querySelector<HTMLElement>('.node[data-ref]')!
    fireEvent.click(node)
    expect(node.hasAttribute('data-selected')).toBe(true)

    fireEvent.click(container.querySelector('[data-hull]')!)

    expect(node.hasAttribute('data-selected')).toBe(false)
  })

  it('cancels link mode when a hull is clicked', () => {
    twoContextMap()
    const { container } = render(<Harness />)
    fireEvent.click(hexGroup(container, 'h1').querySelector('[data-ref="p-repo"]')!)
    fireEvent.keyDown(document.body, { key: 'l' })
    expect(svg(container).hasAttribute('data-link-mode')).toBe(true)

    fireEvent.click(container.querySelector('[data-hull]')!)

    expect(svg(container).hasAttribute('data-link-mode')).toBe(false)
  })
})

// twoHexMap's two hexagons each carry the EXAMPLE_DIAGRAM shape (one use case), so every port's same-hexagon
// linkTargets (use cases) is already exhausted — [] — isolating the cross-hexagon gate/target from the
// pre-existing same-hexagon one (REQ-LNK-01.1, 01.1b, ADR-02).
describe('Stage — cross-hexagon link creation (REQ-LNK-01.1, 01.1b, ADR-02)', () => {
  const startWithL = (container: HTMLElement, hexId: string, ref: string) => {
    fireEvent.click(hexGroup(container, hexId).querySelector(`[data-ref="${ref}"]`)!)
    fireEvent.keyDown(document.body, { key: 'l' })
  }

  it('offers the "Link to…" chip for a port with no same-hexagon targets but a cross-hexagon one', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<Harness />)
    fireEvent.click(hexGroup(container, 'h1').querySelector('[data-ref="p-repo"]')!)
    expect(screen.getByRole('button', { name: /Link .* to…/ })).toBeTruthy()
  })

  it('starting from a driven port and clicking a driving port on another hexagon calls onLink with a link-kind choice (REQ-LNK-01.1)', () => {
    useMapStore.getState().replace(twoHexMap())
    const onLink = vi.fn()
    const { container } = render(<Harness onLink={onLink} />)
    startWithL(container, 'h1', 'p-repo')

    fireEvent.click(hexGroup(container, 'h2').querySelector('[data-ref="p-submit"]')!)

    expect(onLink).toHaveBeenCalledWith('p-repo', { kind: 'link', hexagonId: 'h2', portId: 'p-submit' })
  })

  it('starting from a driving port and clicking a driven port on another hexagon calls onLink with a link-kind choice (REQ-LNK-01.1b)', () => {
    useMapStore.getState().replace(twoHexMap())
    const onLink = vi.fn()
    const { container } = render(<Harness onLink={onLink} />)
    startWithL(container, 'h1', 'p-submit')

    fireEvent.click(hexGroup(container, 'h2').querySelector('[data-ref="p-repo"]')!)

    expect(onLink).toHaveBeenCalledWith('p-submit', { kind: 'link', hexagonId: 'h2', portId: 'p-repo' })
  })

  it('switches focus instead of linking when clicking a non-target node on another hexagon while linking', () => {
    useMapStore.getState().replace(twoHexMap())
    const onLink = vi.fn()
    const { container } = render(<Harness onLink={onLink} />)
    startWithL(container, 'h1', 'p-repo')

    fireEvent.click(hexGroup(container, 'h2').querySelector('[data-ref="p-notify"]')!)

    expect(onLink).not.toHaveBeenCalled()
    expect(useMapStore.getState().focus).toBe('h2')
  })

  // A cross-hexagon target is identified by (hexagonId, portId) together, never portId alone — port ids are only
  // unique WITHIN one hexagon (twoHexMap's own h1/h2 already collide by id). h3 here carries a port with the same
  // id as h2's valid target, but on the wrong side, so it must never be treated as a match.
  it('does not link to a decoy port that shares an id with the valid target on a different hexagon', () => {
    const base = twoHexMap()
    const decoy = { ...base.hexagons[0], id: 'h3', cell: { q: 2, r: 0 }, ports: [{ id: 'p-submit', name: 'decoy', side: 'driven' as const, wall: 'e' as const }] }
    useMapStore.getState().replace({ ...base, hexagons: [...base.hexagons, decoy] })
    const onLink = vi.fn()
    const { container } = render(<Harness onLink={onLink} />)
    startWithL(container, 'h1', 'p-repo')

    fireEvent.click(hexGroup(container, 'h3').querySelector('[data-ref="p-submit"]')!)

    expect(onLink).not.toHaveBeenCalled()
    expect(useMapStore.getState().focus).toBe('h3')
  })

  // Decision 7387: a valid cross-hexagon target must carry the same dashed data-link-target marking a
  // same-hexagon target gets, and clicking that marked node must still create the link (not just any node).
  it('marks the cross-hexagon target with data-link-target, and clicking that marked node creates the link', () => {
    useMapStore.getState().replace(twoHexMap())
    const onLink = vi.fn()
    const { container } = render(<Harness onLink={onLink} />)
    startWithL(container, 'h1', 'p-repo')

    const target = hexGroup(container, 'h2').querySelector('[data-ref="p-submit"]')!
    expect(target.hasAttribute('data-link-target')).toBe(true)

    fireEvent.click(target)

    expect(onLink).toHaveBeenCalledWith('p-repo', { kind: 'link', hexagonId: 'h2', portId: 'p-submit' })
  })
})

describe('Stage — compact neighbours on a large map', () => {
  it('expands a clicked compact hexagon and compacts the previous current one', () => {
    useMapStore.getState().replace(manyHexagonMap(6))
    const { container } = render(<Harness />)
    expect(hexGroup(container, 'h3').querySelector('.compact-title')).not.toBeNull()

    fireEvent.click(hexGroup(container, 'h3').querySelector('.compact-title')!)

    expect(useMapStore.getState().focus).toBe('h3')
    expect(hexGroup(container, 'h3').querySelector('.compact-title')).toBeNull()
    expect(hexGroup(container, 'h3').querySelectorAll('.node').length).toBeGreaterThan(0)
    expect(hexGroup(container, 'h1').querySelector('.compact-title')).not.toBeNull()
  })

  it.each([{ key: 'Enter' }, { key: ' ' }])('expands a compact hexagon on %o, focusing its first item', ({ key }) => {
    useMapStore.getState().replace(manyHexagonMap(6))
    const { container } = render(<Harness />)

    fireEvent.keyDown(screen.getByRole('button', { name: 'Make Slice 4 the current hexagon' }), { key })

    expect(useMapStore.getState().focus).toBe('h4')
    expect(document.activeElement).toBe(hexGroup(container, 'h4').querySelector('.node[tabindex]'))
  })

  it('offers the side "+" buttons for the current hexagon only', () => {
    const map = manyHexagonMap(6)
    useMapStore.getState().replace(map)
    render(<Harness />)
    const current = map.hexagons.find((h) => h.id === useMapStore.getState().focus)!
    expect(screen.getAllByRole('button', { name: /^Add hexagon to the / })).toHaveLength(freeSides(map, current.cell).length)
  })

  describe('the Expand / Collapse toggle of each hexagon', () => {
    it('offers Expand on every compact hexagon, and on none of a map below the compact threshold', () => {
      useMapStore.getState().replace(manyHexagonMap(6))
      const { unmount } = render(<Harness />)
      expect(screen.getAllByRole('button', { name: /^Expand Slice / })).toHaveLength(5)
      unmount()

      useMapStore.getState().replace(manyHexagonMap(3))
      render(<Harness />)
      expect(screen.queryAllByRole('button', { name: /^(Expand|Collapse) Slice / })).toHaveLength(0)
    })

    it('offers Collapse on an expanded hexagon and a disabled Collapse on the current one', () => {
      useMapStore.getState().replace(manyHexagonMap(6))
      useViewStore.setState({ expanded: new Set(['h3']) })
      render(<Harness />)
      expect(screen.getByRole('button', { name: 'Collapse Slice 3' })).toHaveProperty('disabled', false)
      expect(screen.getByRole('button', { name: 'Collapse Slice 1' })).toHaveProperty('disabled', true)
      expect(screen.queryByRole('button', { name: 'Expand Slice 3' })).toBeNull()
    })

    it('toggles the hexagon pressed, and leaves the current hexagon and the selection alone', () => {
      useMapStore.getState().replace(manyHexagonMap(6))
      render(<Harness />)

      fireEvent.click(screen.getByRole('button', { name: 'Expand Slice 4' }))

      expect([...useViewStore.getState().expanded]).toEqual(['h4'])
      expect(useMapStore.getState().focus).toBe('h1')
    })

    it('never toggles the current hexagon', () => {
      useMapStore.getState().replace(manyHexagonMap(6))
      render(<Harness />)
      fireEvent.click(screen.getByRole('button', { name: 'Collapse Slice 1' }))
      expect(useViewStore.getState().expanded.size).toBe(0)
    })

    it('sits at the top-right corner of its hexagon', () => {
      useMapStore.getState().replace(manyHexagonMap(6))
      const restore = stubFixedSize(1200, 900)
      try {
        const { container } = render(<Harness />)
        const { x, y, scale } = viewportOf(container)
        const model = layoutMap(useMapStore.getState().map, { current: 'h1' })
        const box = hexagonBounds(model.hexagons.find((h) => h.id === 'h4')!)
        const button = screen.getByRole('button', { name: 'Expand Slice 4' })
        expect(parseFloat(button.style.left) + 12).toBeCloseTo((box.x + box.width - x) * scale, 6)
        expect(parseFloat(button.style.top) + 12).toBeCloseTo((box.y - y) * scale, 6)
      } finally {
        restore()
      }
    })

    it('drops a manual view for the whole-map fit when expanding a hexagon grows it in place', () => {
      useMapStore.getState().replace(manyHexagonMap(6))
      const restore = stubFixedSize(1200, 900)
      try {
        const { container } = render(<Harness />)
        const main = container.querySelector('main') as HTMLElement
        main.setPointerCapture = () => {}
        fireEvent.pointerDown(svg(container), { button: 0, buttons: 1, clientX: 0, clientY: 0 })
        fireEvent.pointerMove(main, { buttons: 1, clientX: 100000, clientY: 100000 })
        flushFrame()
        fireEvent.pointerUp(main)

        act(() => useViewStore.setState({ expanded: new Set(['h6']) }))

        const model = layoutMap(useMapStore.getState().map, { current: 'h1', expanded: new Set(['h6']) })
        expectViewport(container, fitTo(canvasBounds(model), 1200, 900, islandInset({ width: 1200, height: 900 }, false, false), 0))
      } finally {
        restore()
      }
    })
  })

  describe('linking onto a compact hexagon\'s port marker', () => {
    const marker = (container: HTMLElement, hexId: string, ref: string) => hexGroup(container, hexId).querySelector<SVGGElement>(`.node-port[data-ref="${ref}"]`)!
    const startLinking = (container: HTMLElement) => {
      fireEvent.click(hexGroup(container, 'h1').querySelector('[data-ref="p-repo"]')!)
      fireEvent.keyDown(document.body, { key: 'l' })
    }

    it('completes the link when the marker is clicked in link mode', () => {
      useMapStore.getState().replace(manyHexagonMap(6))
      const onLink = vi.fn()
      const { container } = render(<Harness onLink={onLink} />)
      startLinking(container)

      fireEvent.click(marker(container, 'h2', 'p-submit'))

      expect(onLink).toHaveBeenCalledWith('p-repo', { kind: 'link', hexagonId: 'h2', portId: 'p-submit' })
      expect(useMapStore.getState().focus).toBe('h1')
    })

    it.each([{ key: 'Enter' }, { key: ' ' }])('completes the link when the focused marker is activated with %o', ({ key }) => {
      useMapStore.getState().replace(manyHexagonMap(6))
      const onLink = vi.fn()
      const { container } = render(<Harness onLink={onLink} />)
      startLinking(container)

      fireEvent.keyDown(screen.getByRole('button', { name: 'submitChatFeedback on Slice 3' }), { key })

      expect(onLink).toHaveBeenCalledWith('p-repo', { kind: 'link', hexagonId: 'h3', portId: 'p-submit' })
      expect(useMapStore.getState().focus).toBe('h1')
    })

    it('makes the hexagon current when the marker is clicked outside link mode', () => {
      useMapStore.getState().replace(manyHexagonMap(6))
      const onLink = vi.fn()
      const { container } = render(<Harness onLink={onLink} />)

      fireEvent.click(marker(container, 'h2', 'p-submit'))

      expect(onLink).not.toHaveBeenCalled()
      expect(useMapStore.getState().focus).toBe('h2')
    })

    it('makes the hexagon current when a marker that is not a link target is clicked in link mode', () => {
      useMapStore.getState().replace(manyHexagonMap(6))
      const onLink = vi.fn()
      const { container } = render(<Harness onLink={onLink} />)
      startLinking(container)

      fireEvent.click(marker(container, 'h2', 'p-repo'))

      expect(onLink).not.toHaveBeenCalled()
      expect(useMapStore.getState().focus).toBe('h2')
    })
  })

  it('drops a manual view for the new whole-map fit when a new current hexagon moves the lattice', () => {
    const restore = stubFixedSize(1200, 900)
    try {
      useMapStore.getState().replace(manyHexagonMap(6))
      const { container } = render(<Harness />)
      const main = container.querySelector('main') as HTMLElement
      main.setPointerCapture = () => {}
      fireEvent.pointerDown(svg(container), { button: 0, buttons: 1, clientX: 0, clientY: 0 })
      fireEvent.pointerMove(main, { buttons: 1, clientX: 100000, clientY: 100000 })
      flushFrame()
      fireEvent.pointerUp(main)

      act(() => useMapStore.getState().setFocus('h4'))

      const model = layoutMap(useMapStore.getState().map, { current: 'h4' })
      expectViewport(container, fitTo(canvasBounds(model), 1200, 900, islandInset({ width: 1200, height: 900 }, false, false), 0))
    } finally {
      restore()
    }
  })

  it('re-fits the whole map when the current hexagon changes on a large map', () => {
    const restore = stubFixedSize(800, 600)
    try {
      useMapStore.getState().replace(manyHexagonMap(12))
      const { container } = render(<Harness />)
      const inset = islandInset({ width: 800, height: 600 }, false, false)
      const scaleFor = (current: string) => fitTo(canvasBounds(layoutMap(useMapStore.getState().map, { current })), 800, 600, inset, 0).scale

      fireEvent.click(hexGroup(container, 'h9').querySelector('.compact-title')!)

      expect(viewportOf(container).scale).toBeCloseTo(scaleFor('h9'), 6)
    } finally {
      restore()
    }
  })
})

describe('Stage — dependency chain emphasis', () => {
  // A port or an aggregate is drawn twice under one ref, so refs are deduplicated.
  const chained = (container: HTMLElement, hexId = 'h1') => [...new Set([...hexGroup(container, hexId).querySelectorAll('[data-chain][data-ref]')].map((n) => n.getAttribute('data-ref')))].sort()
  const select = (container: HTMLElement, ref: string, hexId = 'h1') => fireEvent.click(hexGroup(container, hexId).querySelector(`.node[data-ref="${ref}"]`)!)

  it('emphasizes the chain of a selected adapter and marks the canvas as emphasizing', () => {
    const { container } = render(<Harness />)
    expect(svg(container).hasAttribute('data-emphasis')).toBe(false)

    select(container, 'a-http')

    expect(svg(container).hasAttribute('data-emphasis')).toBe(true)
    expect(chained(container)).toEqual(['a-http', 'd-email', 'd-feedback', 'd-rating', 'p-submit', 'uc-submit'])
    expect(hexGroup(container, 'h1').hasAttribute('data-chain')).toBe(true)
    expect(container.querySelectorAll('.edge[data-chain]').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.edge:not([data-chain])').length).toBeGreaterThan(0)
  })

  it('clears on Escape and on a click on empty canvas', () => {
    const { container } = render(<Harness />)
    select(container, 'a-http')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(svg(container).hasAttribute('data-emphasis')).toBe(false)
    expect(container.querySelector('[data-chain]')).toBeNull()

    select(container, 'a-http')
    fireEvent.click(container.querySelector('[data-band="application"]')!)
    expect(svg(container).hasAttribute('data-emphasis')).toBe(false)
  })

  it('is off with Highlight off, and while linking', () => {
    usePreferencesStore.setState({ highlight: false })
    const off = render(<Harness />)
    select(off.container, 'a-http')
    expect(svg(off.container).hasAttribute('data-emphasis')).toBe(false)
    expect(off.container.querySelector('[data-chain]')).toBeNull()
    cleanup()
    usePreferencesStore.setState({ highlight: true })

    const { container } = render(<Harness />)
    select(container, 'a-knex')
    fireEvent.keyDown(document.body, { key: 'l' })
    expect(svg(container).hasAttribute('data-link-mode')).toBe(true)
    expect(svg(container).hasAttribute('data-emphasis')).toBe(false)
  })

  it('follows a link into a compact hexagon and stops at its port', () => {
    useMapStore.getState().replace(manyHexagonMap(6))
    const { container } = render(<Harness />)

    select(container, 'a-knex')

    expect(container.querySelector('.map-link')!.hasAttribute('data-chain')).toBe(true)
    expect(hexGroup(container, 'h2').hasAttribute('data-chain')).toBe(true)
    expect(chained(container, 'h2')).toEqual(['p-submit'])
    expect(hexGroup(container, 'h3').hasAttribute('data-chain')).toBe(false)
  })

  it('carries on inward to the domain when the linked hexagon is fully drawn', () => {
    useMapStore.getState().replace(linkedTwoHexMap())
    const { container } = render(<Harness />)

    select(container, 'a-knex')

    expect(chained(container, 'h2')).toEqual(['d-email', 'd-feedback', 'd-rating', 'p-submit', 'uc-submit'])
    expect(container.querySelector('.map-link')!.hasAttribute('data-chain')).toBe(true)
  })

  describe('as dependents', () => {
    it('emphasizes what depends on the selection, and marks the canvas as showing dependents', () => {
      usePreferencesStore.setState({ dependents: true })
      const { container } = render(<Harness />)

      select(container, 'd-rating')

      expect(svg(container).getAttribute('data-emphasis')).toBe('dependents')
      expect(chained(container)).toEqual(['a-email', 'a-http', 'a-knex', 'a-legacy', 'act-frontend', 'd-rating', 'ext-legacy', 'ext-mailgun', 'ext-pg', 'p-notify', 'p-repo', 'p-submit', 'p-users', 'uc-submit'])
    })

    it('leaves the dependencies marking untouched when off', () => {
      const { container } = render(<Harness />)
      select(container, 'd-rating')
      expect(svg(container).getAttribute('data-emphasis')).toBe('')
      expect(chained(container)).toEqual(['d-feedback', 'd-rating'])
    })

    it('follows a link backwards into the caller hexagon', () => {
      useMapStore.getState().replace(linkedTwoHexMap())
      act(() => useMapStore.getState().setFocus('h2'))
      usePreferencesStore.setState({ dependents: true })
      const { container } = render(<Harness />)

      select(container, 'p-submit', 'h2')

      expect(chained(container, 'h2')).toEqual(['a-http', 'act-frontend', 'p-submit'])
      expect(chained(container, 'h1')).toEqual(['a-knex', 'ext-pg', 'p-repo'])
      expect(container.querySelector('.map-link')!.hasAttribute('data-chain')).toBe(true)
    })

    it('stops at the port of a compact caller', () => {
      useMapStore.getState().replace(manyHexagonMap(6))
      act(() => useMapStore.getState().setFocus('h2'))
      usePreferencesStore.setState({ dependents: true })
      const { container } = render(<Harness />)

      select(container, 'p-submit', 'h2')

      expect(chained(container, 'h1')).toEqual(['p-repo'])
    })

    it('is off with Highlight off', () => {
      usePreferencesStore.setState({ dependents: true, highlight: false })
      const { container } = render(<Harness />)
      select(container, 'd-rating')
      expect(svg(container).hasAttribute('data-emphasis')).toBe(false)
      expect(container.querySelector('[data-chain]')).toBeNull()
    })
  })
})

describe('Stage in view-only mode', () => {
  const drivenAdapter = () => EXAMPLE_DIAGRAM.adapters.find((a) => EXAMPLE_DIAGRAM.ports.find((p) => p.id === a.portId)?.side === 'driven')!
  beforeEach(() => usePreferencesStore.setState({ viewOnly: true }))

  it('offers no "+" on a hovered layer and no side "+" to grow from', () => {
    const { container } = render(<Harness />)
    hover(container, 'application')
    expect(container.querySelectorAll('.plus')).toHaveLength(0)
    expect(container.querySelectorAll('.side-plus')).toHaveLength(0)
  })

  it('still selects an element and emphasizes its dependency chain, without a "Link to…" chip', () => {
    const { container } = render(<Harness />)
    const node = container.querySelector(`svg.canvas [data-ref="${drivenAdapter().id}"]`)!
    fireEvent.click(node)
    expect(node.hasAttribute('data-selected')).toBe(true)
    expect(svg(container).hasAttribute('data-emphasis')).toBe(true)
    expect(screen.queryByRole('button', { name: /Link .* to…/ })).toBeNull()
  })

  it('ignores L and Delete on a selection, but Esc still clears it', () => {
    const onDelete = vi.fn(() => true)
    const { container } = render(<Harness onDelete={onDelete} />)
    const node = container.querySelector(`svg.canvas [data-ref="${drivenAdapter().id}"]`)!
    fireEvent.click(node)
    fireEvent.keyDown(document.body, { key: 'l' })
    fireEvent.keyDown(document.body, { key: 'Delete' })
    fireEvent.keyDown(document.body, { key: 'Backspace' })
    expect(svg(container).hasAttribute('data-link-mode')).toBe(false)
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(container.querySelectorAll('[data-selected]')).toHaveLength(0)
  })

  it('does not open the editor on a double-click, but still switches the current hexagon', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<Harness />)
    fireEvent.doubleClick(hexGroup(container, 'h2'))
    expect(useMapStore.getState().focus).toBe('h2')
    expect(useViewStore.getState().editorOpen).toBe(false)
  })

  it('ends a link mode that was already on', () => {
    useMapStore.getState().replace(twoHexMap())
    usePreferencesStore.setState({ viewOnly: false })
    const { container } = render(<Harness />)
    fireEvent.click(hexGroup(container, 'h1').querySelector(`[data-ref="${drivenAdapter().id}"]`)!)
    fireEvent.keyDown(document.body, { key: 'l' })
    expect(svg(container).hasAttribute('data-link-mode')).toBe(true)
    act(() => usePreferencesStore.setState({ viewOnly: true }))
    expect(svg(container).hasAttribute('data-link-mode')).toBe(false)
  })

  it('keeps the expand and collapse toggles', () => {
    useMapStore.getState().replace(manyHexagonMap(6))
    render(<Harness />)
    expect(screen.getAllByRole('button', { name: /^Expand Slice / })).toHaveLength(5)
  })

  it('keeps the zoom controls working', () => {
    const { container } = render(<Harness />)
    const before = viewportOf(container).scale
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(viewportOf(container).scale).toBeGreaterThan(before)
  })
})

describe('Stage — smooth fit changes (animated refit, panel open/close)', () => {
  const SCREEN = { width: 2000, height: 800 }
  let restoreSize: () => void
  const originalMatchMedia = window.matchMedia
  const viewBoxOf = (container: HTMLElement) => svg(container).getAttribute('viewBox')
  const frames = (ms: number) => act(() => void vi.advanceTimersByTime(ms))
  const allowMotion = () => {
    window.matchMedia = ((media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia
  }
  beforeEach(() => {
    vi.useFakeTimers()
    restoreSize = stubFixedSize(SCREEN.width, SCREEN.height)
    useViewStore.setState({ editorOpen: false })
  })
  afterEach(() => {
    restoreSize()
    window.matchMedia = originalMatchMedia
    vi.useRealTimers()
  })

  it('eases to the new fit after a grow instead of snapping, and reaches it after the duration', () => {
    allowMotion()
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<Harness />)
    const before = viewBoxOf(container)

    act(() => void useMapStore.getState().addHexagon('h1', { context: 'same' }))
    expect(viewBoxOf(container)).toBe(before)
    frames(48)
    const mid = viewBoxOf(container)
    expect(mid).not.toBe(before)

    frames(400)
    const settled = viewBoxOf(container)
    expect(settled).not.toBe(mid)
    const model = layoutMap(useMapStore.getState().map)
    const expected = fitTo(canvasBounds(model), SCREEN.width, SCREEN.height, islandInset(SCREEN, false, false), 0)
    expectViewport(container, expected)
  })

  it('snaps to the fit of a swapped-in document instead of easing from the previous one', () => {
    allowMotion()
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<Harness />)

    act(() => void useMapStore.getState().replace(manyHexagonMap(6)))
    const fitted = viewBoxOf(container)
    frames(400)
    expect(viewBoxOf(container)).toBe(fitted)
  })

  it('changes instantly under prefers-reduced-motion', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<Harness />)
    const before = viewBoxOf(container)
    act(() => void useMapStore.getState().addHexagon('h1', { context: 'same' }))
    expect(viewBoxOf(container)).not.toBe(before)
    const model = layoutMap(useMapStore.getState().map)
    expectViewport(container, fitTo(canvasBounds(model), SCREEN.width, SCREEN.height, islandInset(SCREEN, false, false), 0))
  })

  it('a wheel zoom is immediate and cancels a running ease', () => {
    allowMotion()
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<Harness />)
    act(() => void useMapStore.getState().addHexagon('h1', { context: 'same' }))
    frames(48)
    fireEvent.wheel(container.querySelector('main')!, { deltaY: -300, clientX: 500, clientY: 400 })
    flushFrame()
    const zoomed = viewBoxOf(container)
    frames(400)
    expect(viewBoxOf(container)).toBe(zoomed)
  })

  it('keeps the canvas where it is when the editor panel opens and closes while the hexagon stays visible', () => {
    allowMotion()
    const { container } = render(<Harness />)
    const before = viewBoxOf(container)

    act(() => useViewStore.setState({ editorOpen: true }))
    frames(400)
    expect(viewBoxOf(container)).toBe(before)

    act(() => useViewStore.setState({ editorOpen: false }))
    frames(400)
    expect(viewBoxOf(container)).toBe(before)
  })

  it('refits, easing, when the panel would cover the hexagon', () => {
    allowMotion()
    restoreSize()
    restoreSize = stubFixedSize(700, 900)
    const { container } = render(<Harness />)
    const before = viewBoxOf(container)
    act(() => useViewStore.setState({ editorOpen: true }))
    expect(viewBoxOf(container)).toBe(before)
    frames(400)
    expect(viewBoxOf(container)).not.toBe(before)
  })

  describe('on a multi-hexagon map', () => {
    const openPanel = () => act(() => useViewStore.setState({ editorOpen: true }))
    const closePanel = () => act(() => useViewStore.setState({ editorOpen: false }))
    const wholeMapFit = (panelOpen: boolean) => {
      const model = layoutMap(useMapStore.getState().map)
      return fitTo(canvasBounds(model), SCREEN.width, SCREEN.height, islandInset(SCREEN, panelOpen, false), 0)
    }
    beforeEach(() => {
      allowMotion()
      useMapStore.getState().replace(twoHexMap())
    })

    it('opening the panel leaves the view where it is while the current hexagon stays visible', () => {
      const { container } = render(<Harness />)
      const before = viewBoxOf(container)
      openPanel()
      frames(400)
      expect(viewBoxOf(container)).toBe(before)
    })

    it('closing the panel leaves the whole-map fit in place', () => {
      const { container } = render(<Harness />)
      const before = viewBoxOf(container)
      openPanel()
      closePanel()
      expect(viewBoxOf(container)).toBe(before)
      frames(400)
      expectViewport(container, wholeMapFit(false))
    })

    it('opening the panel mid-ease freezes the fit being eased to, not a partial frame', () => {
      const { container } = render(<Harness />)
      act(() => void useMapStore.getState().addHexagon('h1', { context: 'same' }))
      frames(100)
      openPanel()
      frames(400)
      expectViewport(container, wholeMapFit(false))
    })

    it('a manual zoom made while the panel is open survives closing it', () => {
      const { container } = render(<Harness />)
      openPanel()
      fireEvent.wheel(container.querySelector('main')!, { deltaY: 300, clientX: 500, clientY: 400 })
      flushFrame()
      const zoomed = viewBoxOf(container)
      closePanel()
      frames(400)
      expect(viewBoxOf(container)).toBe(zoomed)
    })

    describe('when the panel would cover the current hexagon', () => {
      const SIZE = { width: 1200, height: 1000 }
      const current = () => {
        const { x, y, width, height } = hexagonBounds(layoutMap(useMapStore.getState().map).hexagons.find((h) => h.id === 'h1')!)
        return { x: x + 0.001, y: y + 0.001, width: width - 0.002, height: height - 0.002 } // slack for the viewport read back from CSS
      }
      const freeAreaShows = (container: HTMLElement, size: { width: number; height: number }) =>
        contains(visibleRect(viewportOf(container), size, islandInset(size, true, false)), current())
      beforeEach(() => {
        restoreSize()
        restoreSize = stubFixedSize(SIZE.width, SIZE.height)
      })

      it('keeps the zoom and pans the hexagon into the free area when it fits there', () => {
        const { container } = render(<Harness />)
        const before = viewportOf(container)
        expect(freeAreaShows(container, SIZE)).toBe(false)
        openPanel()
        frames(400)
        const after = viewportOf(container)
        expect(after.scale).toBeCloseTo(before.scale, 9)
        expect(after.x).not.toBeCloseTo(before.x, 3)
        expect(freeAreaShows(container, SIZE)).toBe(true)
      })

      it('pans the current hexagon clear of the panel when a double-click reveals it from a fitted view', () => {
        restoreSize()
        const size = { width: 1414, height: 696 }
        restoreSize = stubFixedSize(size.width, size.height)
        const result = parseHexa(twoHexagonSample)
        if (!result.ok || result.map.kind !== 'hexagonal') throw new Error('fixture failed to parse')
        useMapStore.getState().replace(result.map)
        const { container } = render(<Harness />)
        fireEvent.click(screen.getByRole('button', { name: 'Fit diagram to screen' }))
        const before = viewportOf(container)
        const hex = hexagonBounds(layoutMap(useMapStore.getState().map, { current: useMapStore.getState().focus }).hexagons.find((h) => h.id === 'h1')!)
        expect(contains(visibleRect(before, size, islandInset(size, true, false)), hex)).toBe(false)

        fireEvent.doubleClick(container.querySelector('[data-hex="h1"] .node[data-ref]')!)
        frames(400)

        expect(useViewStore.getState().editorOpen).toBe(true)
        const after = viewportOf(container)
        expect(after.scale).toBeCloseTo(before.scale, 9)
        expect(after.x).not.toBeCloseTo(before.x, 3)
        expect(contains(visibleRect(after, size, islandInset(size, true, false)), { x: hex.x + 0.001, y: hex.y + 0.001, width: hex.width - 0.002, height: hex.height - 0.002 })).toBe(true)
      })

      it('still pans the hexagon clear of the panel after a resize that followed an earlier panel freeze', () => {
        let resize: (width: number, height: number) => void = () => {}
        const original = globalThis.ResizeObserver
        globalThis.ResizeObserver = class {
          constructor(cb: ResizeObserverCallback) {
            resize = (width, height) => cb([{ contentRect: { width, height } } as ResizeObserverEntry], this as unknown as ResizeObserver)
          }
          observe() {
            resize(784, 696)
          }
          unobserve() {}
          disconnect() {}
        } as unknown as typeof ResizeObserver
        try {
          const result = parseHexa(twoHexagonSample)
          if (!result.ok || result.map.kind !== 'hexagonal') throw new Error('fixture failed to parse')
          useMapStore.getState().replace(result.map)
          const { container } = render(<Harness />)
          const fit = () => fireEvent.click(screen.getByRole('button', { name: 'Fit diagram to screen' }))
          fit()
          const reveal = (hexId: string) => {
            const node = container.querySelector(`[data-hex="${hexId}"] .node[data-ref]`)!
            fireEvent.click(node, { detail: 1 })
            fireEvent.click(node, { detail: 2 })
            fireEvent.doubleClick(node)
          }
          reveal('h2')
          frames(400)
          expect(useViewStore.getState().editorOpen).toBe(true)

          const size = { width: 1414, height: 696 }
          act(() => resize(size.width, size.height))
          frames(400)
          act(() => useViewStore.setState({ editorOpen: false }))
          fit()
          frames(400)
          const before = viewportOf(container)
          const hex = hexagonBounds(layoutMap(useMapStore.getState().map, { current: useMapStore.getState().focus }).hexagons.find((h) => h.id === 'h1')!)
          expect(contains(visibleRect(before, size, islandInset(size, true, false)), hex)).toBe(false)

          reveal('h1')
          frames(400)

          const after = viewportOf(container)
          expect(after.x).not.toBeCloseTo(before.x, 3)
          expect(contains(visibleRect(after, size, islandInset(size, true, false)), { x: hex.x + 0.001, y: hex.y + 0.001, width: hex.width - 0.002, height: hex.height - 0.002 })).toBe(true)
        } finally {
          globalThis.ResizeObserver = original
        }
      })

      it('refits the whole map after the stage is resized while the panel holds the view', () => {
        // Wide enough that opening the panel freezes the view as it is.
        let resize: (width: number, height: number) => void = () => {}
        const original = globalThis.ResizeObserver
        globalThis.ResizeObserver = class {
          constructor(cb: ResizeObserverCallback) {
            resize = (width, height) => cb([{ contentRect: { width, height } } as ResizeObserverEntry], this as unknown as ResizeObserver)
          }
          observe() {
            resize(SCREEN.width, SCREEN.height)
          }
          unobserve() {}
          disconnect() {}
        } as unknown as typeof ResizeObserver
        try {
          const { container } = render(<Harness />)
          openPanel()
          frames(400)
          const wide = { width: 2600, height: SCREEN.height }
          act(() => resize(wide.width, wide.height))
          frames(400)
          const model = layoutMap(useMapStore.getState().map)
          expectViewport(container, fitTo(canvasBounds(model), wide.width, wide.height, islandInset(wide, true, false)))
        } finally {
          globalThis.ResizeObserver = original
        }
      })
    })

    it('a grow made while the panel is open that would leave a hexagon off screen falls back to the whole-map fit', () => {
      const { container } = render(<Harness />)
      openPanel()
      act(() => void useMapStore.getState().addHexagon('h1', { context: 'same' }))
      frames(400)
      expectViewport(container, wholeMapFit(true))
    })
  })
})

describe('Stage — hexagon titles stay readable when zoomed out', () => {
  const titleOverlays = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[data-hexagon-title-overlay]')]
  const withSize = (width: number, height: number, run: () => void) => {
    const restore = stubFixedSize(width, height)
    try {
      useMapStore.getState().replace(twoHexMap())
      run()
    } finally {
      restore()
    }
  }

  it('draws a 12px label per hexagon once the title would render smaller on screen', () => {
    withSize(700, 360, () => {
      const { container } = render(<Harness />)
      expect(viewportOf(container).scale * 24).toBeLessThan(12)
      const labels = titleOverlays(container)
      expect(labels.length).toBeGreaterThan(0)
      for (const label of labels) expect(label.style.fontSize).toBe('12px')
      expect(svg(container).classList.contains('titles-overlaid')).toBe(true)
    })
  })

  it('draws no label, and keeps the SVG titles, while they already render at 12px or more', () => {
    withSize(9000, 6000, () => {
      const { container } = render(<Harness />)
      expect(viewportOf(container).scale * 24).toBeGreaterThanOrEqual(12)
      expect(titleOverlays(container)).toHaveLength(0)
      expect(svg(container).classList.contains('titles-overlaid')).toBe(false)
    })
  })

  it('never lets a label run wider than its hexagon on screen', () => {
    withSize(700, 360, () => {
      const { container } = render(<Harness />)
      for (const label of titleOverlays(container)) expect(parseFloat(label.style.maxWidth)).toBeGreaterThan(0)
    })
  })

  it('draws the map title at 12px over the canvas, and hides the SVG one, once it would render smaller', () => {
    withSize(700, 360, () => {
      const { container } = render(<Harness />)
      const title = container.querySelector<SVGTextElement>('[data-map-title]')!
      expect(viewportOf(container).scale * Number(title.getAttribute('font-size'))).toBeLessThan(12)
      const overlay = container.querySelector<HTMLElement>('[data-map-title-overlay]')!
      expect(overlay.style.fontSize).toBe('12px')
      expect(overlay.textContent).toBe(title.textContent)
      expect(svg(container).classList.contains('map-title-overlaid')).toBe(true)
    })
  })

  it('keeps the SVG map title, and draws no overlay, while it already renders at 12px or more', () => {
    withSize(9000, 6000, () => {
      const { container } = render(<Harness />)
      expect(container.querySelector('[data-map-title-overlay]')).toBeNull()
      expect(svg(container).classList.contains('map-title-overlaid')).toBe(false)
    })
  })

  describe('on a large map', () => {
    const font = 12
    type Rect = { x: number; y: number; width: number; height: number }
    // The overlays are positioned by their left/top and a transform: left-anchored with the box above the point, or centred on it.
    const rectOf = (el: HTMLElement): Rect => {
      const width = Math.min(labelTextWidth(el.textContent!, font), parseFloat(el.style.maxWidth || 'Infinity'))
      const x = parseFloat(el.style.left)
      return { x: el.style.transform.startsWith('translate(0') ? x : x - width / 2, y: parseFloat(el.style.top) - font * 1.3, width, height: font * 1.3 }
    }
    const overlap = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    const largeMap = (title: string, hexTitle?: string) => {
      const map = manyHexagonMap(5)
      map.title = title
      if (hexTitle) map.hexagons[3] = { ...map.hexagons[3], title: hexTitle }
      useMapStore.getState().replace(map)
    }

    it('keeps the map title and every hexagon title apart', () => {
      withSize(1400, 800, () => {
        largeMap('Propylaea · Growth')
        const { container } = render(<Harness />)
        const all = [...titleOverlays(container), ...container.querySelectorAll<HTMLElement>('[data-map-title-overlay]')]
        expect(all.length).toBeGreaterThan(1)
        for (const [i, a] of all.entries()) for (const b of all.slice(i + 1)) expect(overlap(rectOf(a), rectOf(b))).toBe(false)
      })
    })

    it.each([[1000, 600], [800, 500]])('leaves a gap between the map title and every hexagon title when far out (%i x %i)', (w, h) => {
      withSize(w, h, () => {
        largeMap('Propylaea · Growth')
        const { container } = render(<Harness />)
        expect(zoomLevel(viewportOf(container).scale)).toBe('far')
        const mapTitle = rectOf(container.querySelector<HTMLElement>('[data-map-title-overlay]')!)
        const padded = { x: mapTitle.x - 3, y: mapTitle.y - 3, width: mapTitle.width + 6, height: mapTitle.height + 6 }
        for (const t of titleOverlays(container)) expect(overlap(padded, rectOf(t))).toBe(false)
      })
    })

    it('keeps a compact hexagon\'s name, cut with an ellipsis from the full one to fit its width', () => {
      withSize(1400, 800, () => {
        largeMap('Map', 'Analytics events and everything around them')
        const { container } = render(<Harness />)
        expect(zoomLevel(viewportOf(container).scale)).toBe('mid')
        const label = container.querySelector<HTMLElement>('[data-hexagon-title-overlay="h4"]')!
        expect(label.textContent!.endsWith('…')).toBe(true)
        expect('Analytics events and everything around them'.startsWith(label.textContent!.slice(0, -1))).toBe(true)
        expect(rectOf(label).width).toBeLessThanOrEqual(parseFloat(label.style.maxWidth))
      })
    })

    it('shows a compact hexagon\'s whole name once it fits', () => {
      withSize(1800, 1100, () => {
        largeMap('Map', 'Analytics')
        const { container } = render(<Harness />)
        expect(container.querySelector('[data-hexagon-title-overlay="h4"]')?.textContent).toBe('Analytics')
      })
    })
  })

  it('hides the SVG map title only on the canvas, never in an export', () => {
    expect(readFileSync('src/styles.css', 'utf8')).toMatch(/\.canvas\.map-title-overlaid:not\(\.exporting\) \[data-map-title\]\s*\{\s*display:\s*none/)
  })

  it('hides the SVG titles only on the canvas, never in an export', () => {
    expect(readFileSync('src/styles.css', 'utf8')).toMatch(/\.canvas\.titles-overlaid:not\(\.exporting\) \[data-hexagon-title\]\s*\{\s*display:\s*none/)
  })
})

describe('Stage — box names stay readable when zoomed out', () => {
  const labels = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[data-box-label]')]
  const withSize = (width: number, height: number, run: () => void) => {
    const restore = stubFixedSize(width, height)
    try {
      useMapStore.getState().replace(twoHexMap())
      run()
    } finally {
      restore()
    }
  }
  const nodeOf = (container: HTMLElement, label: HTMLElement) => {
    const [hexId, kind, ref = kind] = label.dataset.boxLabel!.split(':')
    return [...container.querySelectorAll<SVGGElement>(`[data-hex="${hexId}"] .node-${kind}[data-ref="${ref}"]`)]
  }

  it('names the boxes once a 14px name would render at under half size', () => {
    withSize(1400, 900, () => {
      const { container } = render(<Harness />)
      expect(viewportOf(container).scale).toBeLessThan(0.5)
      const shown = labels(container)
      expect(shown.length).toBeGreaterThan(0)
      for (const label of shown) {
        expect(label.style.fontSize).toBe('11px')
        expect(label.getAttribute('aria-hidden')).toBe('true')
      }
    })
  })

  it('draws no label, and keeps every SVG text, from half size up', () => {
    withSize(9000, 6000, () => {
      const { container } = render(<Harness />)
      expect(viewportOf(container).scale).toBeGreaterThanOrEqual(0.5)
      expect(labels(container)).toHaveLength(0)
      expect(container.querySelector('style')).toBeNull()
    })
  })

  it('switches at exactly half size', () => {
    expect(boxLabelsOverlaid(0.49)).toBe(true)
    expect(boxLabelsOverlaid(0.5)).toBe(false)
    expect(boxLabelsOverlaid(0.51)).toBe(false)
  })

  it('shows no two labels on top of each other', () => {
    withSize(1400, 900, () => {
      const { container } = render(<Harness />)
      const rects = labels(container).map((l) => {
        const [x, y] = [parseFloat(l.style.left), parseFloat(l.style.top)]
        const w = labelTextWidth(l.textContent!, 11)
        return { x: x - w / 2, y: y - 7, w, h: 14 }
      })
      expect(rects.length).toBeGreaterThan(1)
      for (const [i, a] of rects.entries())
        for (const b of rects.slice(i + 1)) expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false)
    })
  })

  it("shows no label over another box's centre", () => {
    withSize(1400, 900, () => {
      const { container } = render(<Harness />)
      const model = layoutMap(twoHexMap(), { mode: usePreferencesStore.getState().mode, current: 'h1' })
      const { scale, x, y } = viewportOf(container)
      const zones = centreZones(
        boxObstacles(model, twoHexMap()).map((o) => ({ owner: o.owner, rect: { x: o.rect.x * scale + x, y: o.rect.y * scale + y, width: o.rect.width * scale, height: o.rect.height * scale } })),
        6,
      )
      const shown = labels(container)
      expect(shown.length).toBeGreaterThan(0)
      for (const l of shown) {
        const w = labelTextWidth(l.textContent!, 11)
        const [cx, cy] = [parseFloat(l.style.left), parseFloat(l.style.top)]
        // A label sits on its own box's centre; every other box's centre zone stays clear.
        const others = zones.filter(({ rect: r }) => !(cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height))
        for (const { rect: r } of others) expect(cx - w / 2 < r.x + r.width && r.x < cx + w / 2 && cy - 7 < r.y + r.height && r.y < cy + 7).toBe(false)
      }
    })
  })

  it('always shows the label of the hovered box, even where another label wins the spot', () => {
    withSize(1400, 900, () => {
      const { container } = render(<Harness />)
      const shown = new Set(labels(container).map((l) => l.textContent))
      const hidden = [...container.querySelectorAll<SVGGElement>('[data-hex="h1"] .node-domainItem')].find((n) => !shown.has(n.textContent!.trim()))
      expect(hidden).toBeDefined()
      fireEvent.pointerOver(hidden!)
      expect(labels(container).map((l) => l.textContent)).toContain(hidden!.textContent!.trim())
    })
  })

  it('hides the SVG text of exactly the boxes whose label is shown, so none goes blank', () => {
    withSize(1400, 900, () => {
      const { container } = render(<Harness />)
      const css = readFileSync('src/styles.css', 'utf8')
      const style = document.createElement('style')
      style.textContent = css
      document.head.appendChild(style)
      try {
        const shown = labels(container)
        expect(shown.length).toBeGreaterThan(0)
        const labelled = new Set(shown.flatMap((l) => nodeOf(container, l)))
        const display = (n: Element) => getComputedStyle(n.querySelector('text')!).display
        for (const n of labelled) expect(display(n)).toBe('none')
        const bare = [...container.querySelectorAll('.node')].filter((n) => !labelled.has(n as SVGGElement) && n.querySelector('text'))
        expect(bare.length).toBeGreaterThan(0)
        for (const n of bare) expect(display(n)).not.toBe('none')
      } finally {
        style.remove()
      }
    })
  })

  it('does not hide any text on the canvas by a global rule, and keeps it in an export', () => {
    const css = readFileSync('src/styles.css', 'utf8')
    expect(css).not.toMatch(/box-labels-overlaid/)
    expect(css).toMatch(/\.canvas:not\(\.exporting\) \.note-marker\s*\{\s*r:\s*max\(2\.5px,\s*calc\(3px \/ var\(--zoom\)\)\)/)
  })

  // Larger stages label so many boxes that the one hide rule passes jsdom's 2048-character selector limit and is silently ignored.
  it('keeps the aggregate named in the overview, by its label or else its own SVG text', () => {
    const restore = stubFixedSize(1400, 800)
    try {
      useMapStore.getState().replace(twoHexMap())
      usePreferencesStore.setState({ mode: 'overview' })
      const { container } = render(<Harness />)
      const style = document.createElement('style')
      style.textContent = readFileSync('src/styles.css', 'utf8')
      document.head.appendChild(style)
      try {
        expect(zoomLevel(viewportOf(container).scale)).toBe('mid')
        const labelled = labels(container).some((l) => l.dataset.boxLabel === 'h1:domainItem:d-feedback')
        const text = container.querySelector('[data-hex="h1"] .node-domainItem[data-ref="d-feedback"] text')!
        expect(labelled || getComputedStyle(text).display !== 'none').toBe(true)
        expect(labelled && getComputedStyle(text).display !== 'none').toBe(false)
      } finally {
        style.remove()
      }
    } finally {
      restore()
    }
  })

  it('hands the zoom to CSS on the canvas', () => {
    withSize(1400, 900, () => {
      const { container } = render(<Harness />)
      expect(Number((svg(container) as SVGElement).style.getPropertyValue('--zoom'))).toBeCloseTo(viewportOf(container).scale, 3)
    })
  })

  it('leaves compact hexagons to their own title', () => {
    const restore = stubFixedSize(1400, 900)
    try {
      useMapStore.getState().replace(manyHexagonMap(5))
      const { container } = render(<Harness />)
      expect(labels(container).length).toBeGreaterThan(0)
      expect(container.querySelector('[data-hex="h4"] .compact-title')).not.toBeNull()
      expect(labels(container).every((l) => l.dataset.boxLabel!.startsWith('h1:'))).toBe(true)
    } finally {
      restore()
    }
  })
})

describe('Stage note popover', () => {
  const node = (container: HTMLElement, ref: string) => container.querySelector(`[data-hex] .node[data-ref="${ref}"]`)!
  const popover = () => screen.queryByRole('tooltip')

  it('shows the full note, line breaks kept, when a noted element is hovered, and drops it on leave', () => {
    const { container } = render(<Harness />)
    expect(popover()).toBeNull()
    fireEvent.pointerOver(node(container, 'uc-submit'))
    expect(popover()!.textContent).toBe('execute(cmd): Promise<void>\nvalidate, save, notify support')
    fireEvent.pointerLeave(svg(container))
    expect(popover()).toBeNull()
  })

  it('shows the note of the selected element and describes the node by it', () => {
    const { container } = render(<Harness />)
    fireEvent.click(node(container, 'uc-submit'))
    expect(popover()!.textContent).toContain('validate, save, notify support')
    expect(node(container, 'uc-submit').getAttribute('aria-describedby')).toBe(popover()!.id)
    fireEvent.click(svg(container))
    expect(popover()).toBeNull()
  })

  it('shows nothing for an element without a note', () => {
    const { container } = render(<Harness />)
    fireEvent.pointerOver(node(container, 'a-knex'))
    expect(popover()).toBeNull()
    fireEvent.click(node(container, 'a-knex'))
    expect(popover()).toBeNull()
  })

  it('keeps the selected note while another noted element is hovered', () => {
    const { container } = render(<Harness />)
    fireEvent.click(node(container, 'uc-submit'))
    fireEvent.pointerOver(node(container, 'ext-pg'))
    expect(popover()!.textContent).toContain('validate, save')
  })

  it('shows the hovered note when the selection has none', () => {
    const { container } = render(<Harness />)
    fireEvent.click(node(container, 'a-knex'))
    fireEvent.pointerOver(node(container, 'ext-pg'))
    expect(popover()!.textContent).toBe('chat_feedback')
  })

  it('is out of the way of the pointer', () => {
    const { container } = render(<Harness />)
    fireEvent.pointerOver(node(container, 'ext-pg'))
    expect(readFileSync('src/styles.css', 'utf8')).toMatch(/\.note-popover\s*\{[^}]*pointer-events:\s*none/)
    expect(popover()!.className).toBe('note-popover')
  })

  it('hides while the canvas is being panned', () => {
    const { container } = render(<Harness />)
    const main = container.querySelector('main')!
    main.setPointerCapture = () => {}
    fireEvent.click(node(container, 'uc-submit'))
    expect(popover()).not.toBeNull()
    fireEvent.pointerDown(svg(container), { button: 0, buttons: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(main, { buttons: 1, clientX: 140, clientY: 100 })
    flushFrame()
    expect(main.classList.contains('is-dragging')).toBe(true)
    expect(popover()).toBeNull()
  })

  it.each(['detailed', 'overview'] as const)('marks only the noted boxes in %s', (mode) => {
    usePreferencesStore.setState({ mode })
    const { container } = render(<Harness />)
    expect(node(container, 'uc-submit').querySelector('[data-note-marker]')).not.toBeNull()
    expect(node(container, 'ext-pg').querySelector('[data-note-marker]')).not.toBeNull()
    expect(node(container, 'a-knex').querySelector('[data-note-marker]')).toBeNull()
    expect(node(container, 'd-feedback').querySelector('[data-note-marker]')).toBeNull()
    expect(container.querySelector('[data-note-marker]')!.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('Stage — layout and map out of step', () => {
  it('renders when the layout holds a hexagon the map does not, with no popover', () => {
    const full = twoHexMap()
    const map = { ...full, hexagons: [full.hexagons[0]] }
    const diagram = diagramOf(map, 'h1')
    const { container } = render(
      <Stage model={layoutMap(full, { current: 'h1' })} map={map} hexId="h1" diagram={diagram} legend={legendFor(diagram)} revision={0} title="Test" svgRef={createRef()} onDelete={() => false} onLink={() => {}} contextLabel="Context 1" onGrow={() => {}} />,
    )
    expect(container.querySelectorAll('[data-hex]')).toHaveLength(2)
    fireEvent.pointerOver(container.querySelector('[data-hex="h2"] .node[data-ref="uc-submit"]')!)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})

describe('Stage — an element that gets hidden while selected or hovered', () => {
  const planUseCase = () => {
    const map = toMap(EXAMPLE_DIAGRAM)
    const [h] = map.hexagons
    useMapStore.getState().replace({ ...map, hexagons: [{ ...h, useCases: h.useCases.map((u) => ({ ...u, status: 'planned' as const })) }] })
  }
  const useCase = (container: HTMLElement) => container.querySelector('[data-hex] .node[data-ref="uc-submit"]')!

  it('drops its note popover instead of showing it at the corner', () => {
    planUseCase()
    const { container } = render(<Harness />)
    fireEvent.click(useCase(container))
    expect(screen.queryByRole('tooltip')).not.toBeNull()
    act(() => usePreferencesStore.setState({ showPlanned: false }))
    expect(container.querySelector('[data-ref="uc-submit"]')).toBeNull()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('is no longer selected, so a key press cannot act on what is out of sight', () => {
    planUseCase()
    const onDelete = vi.fn(() => true)
    const { container } = render(<Harness onDelete={onDelete} />)
    fireEvent.click(useCase(container))
    act(() => usePreferencesStore.setState({ showPlanned: false }))
    fireEvent.keyDown(svg(container), { key: 'Delete' })
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('is forgotten as hovered', () => {
    planUseCase()
    const { container } = render(<Harness />)
    fireEvent.pointerOver(useCase(container))
    expect(screen.queryByRole('tooltip')).not.toBeNull()
    act(() => usePreferencesStore.setState({ showPlanned: false }))
    act(() => usePreferencesStore.setState({ showPlanned: true }))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})

describe('Stage — detail follows the zoom level', () => {
  const css = readFileSync('src/styles.css', 'utf8')
  const boxLabels = (container: HTMLElement) => container.querySelectorAll('[data-box-label]')
  const titles = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[data-hexagon-title-overlay]')]
  const at = (width: number, height: number, level: 'far' | 'mid' | 'near', map: HexaMap = twoHexMap()) => {
    const restore = stubFixedSize(width, height)
    useMapStore.getState().replace(map)
    const rendered = render(<Harness />)
    expect(zoomLevel(viewportOf(rendered.container).scale)).toBe(level)
    return { ...rendered, restore }
  }
  const withStyles = (run: () => void) => {
    const style = document.createElement('style')
    style.textContent = css
    document.head.appendChild(style)
    try {
      run()
    } finally {
      style.remove()
    }
  }

  it('cuts the levels at a quarter and a half', () => {
    expect([0.24, 0.25, 0.49, 0.5].map(zoomLevel)).toEqual(['far', 'mid', 'mid', 'near'])
  })

  it('far: no box labels, and the canvas is marked far', () => {
    const { container, restore } = at(300, 160, 'far')
    try {
      expect(boxLabels(container)).toHaveLength(0)
      expect(svg(container).classList.contains('zoom-far')).toBe(true)
    } finally {
      restore()
    }
  })

  it('far: hexagon names are not cut to the hexagon width, and none overlap', () => {
    const map = manyHexagonMap(5)
    map.hexagons[3] = { ...map.hexagons[3], title: 'Analytics events' }
    const { container, restore } = at(1000, 600, 'far', map)
    try {
      expect(container.querySelector('[data-hexagon-title-overlay="h4"]')?.textContent).toBe('Analytics events')
      const rects = titles(container).map((el) => {
        const width = labelTextWidth(el.textContent!, 12)
        const x = parseFloat(el.style.left)
        return { x: el.style.transform.startsWith('translate(0') ? x : x - width / 2, y: parseFloat(el.style.top) - 15.6, width, height: 15.6 }
      })
      expect(rects.length).toBeGreaterThan(1)
      for (const [i, a] of rects.entries()) for (const b of rects.slice(i + 1)) expect(touches(a, b)).toBe(false)
    } finally {
      restore()
    }
  })

  it('far: the context name shows on the canvas; mid keeps it hidden', () => {
    const far = at(600, 300, 'far', manyHexagonMap(5))
    try {
      withStyles(() => expect(getComputedStyle(far.container.querySelector('.chip')!).display).not.toBe('none'))
    } finally {
      far.restore()
      cleanup()
    }
    const mid = at(1400, 800, 'mid', manyHexagonMap(5))
    try {
      withStyles(() => expect(getComputedStyle(mid.container.querySelector('.chip')!).display).toBe('none'))
    } finally {
      mid.restore()
    }
  })

  it('far: the editing buttons and the compact element counts are left out; mid has them', () => {
    const far = at(1000, 600, 'far', manyHexagonMap(5))
    try {
      expect(far.container.querySelector('.side-plus, .expand-toggle')).toBeNull()
      withStyles(() => expect(getComputedStyle(far.container.querySelector('.compact-count')!).display).toBe('none'))
    } finally {
      far.restore()
      cleanup()
    }
    const mid = at(1400, 800, 'mid', manyHexagonMap(5))
    try {
      expect(mid.container.querySelector('.side-plus')).not.toBeNull()
      expect(mid.container.querySelector('.expand-toggle')).not.toBeNull()
      withStyles(() => expect(getComputedStyle(mid.container.querySelector('.compact-count')!).display).not.toBe('none'))
    } finally {
      mid.restore()
    }
  })

  it('mid: box labels are drawn, and none sits on a hexagon title', () => {
    const { container, restore } = at(1400, 900, 'mid')
    try {
      expect(boxLabels(container).length).toBeGreaterThan(0)
      expect(svg(container).classList.contains('zoom-mid')).toBe(true)
      const rect = (el: HTMLElement, font: number, centred: boolean) => {
        const width = labelTextWidth(el.textContent!, font)
        const [x, y] = [parseFloat(el.style.left), parseFloat(el.style.top)]
        return { x: centred ? x - width / 2 : x, y: centred ? y - font * 0.65 : y - font * 1.3, width, height: font * 1.3 }
      }
      for (const title of titles(container))
        for (const label of container.querySelectorAll<HTMLElement>('[data-box-label]')) expect(touches(rect(title, 12, title.style.transform === ''), rect(label, 11, true))).toBe(false)
    } finally {
      restore()
    }
  })

  it('near: the canvas is marked near, and only the live canvas fades the context outline and name', () => {
    const { container, restore } = at(9000, 6000, 'near', linkedTwoHexMap())
    try {
      expect(svg(container).classList.contains('zoom-near')).toBe(true)
      expect(css).toMatch(/\.canvas\.zoom-near:not\(\.exporting\)[^{]*\.hull[^{]*\{[^}]*opacity/)
      expect(css).toMatch(/\.canvas\.zoom-near:not\(\.exporting\)[^{]*\.chip[^{]*\{[^}]*opacity/)
    } finally {
      restore()
    }
  })
})

describe('Stage — flying to a picked flow', () => {
  const SCREEN = { width: 2000, height: 800 }
  const originalMatchMedia = window.matchMedia
  let restoreSize: () => void
  const frames = (ms: number) => act(() => void vi.advanceTimersByTime(ms))
  const frameBounds = () => {
    const map = useMapStore.getState().map
    return flowFrame(map, 'h1', 'uc-submit', layoutMap(map, { current: 'h1' }))!.bounds
  }
  beforeEach(() => {
    vi.useFakeTimers()
    window.matchMedia = ((media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia
    restoreSize = stubFixedSize(SCREEN.width, SCREEN.height)
    useMapStore.getState().replace(manyHexagonMap(6))
  })
  afterEach(() => {
    restoreSize()
    window.matchMedia = originalMatchMedia
    vi.useRealTimers()
  })

  it('eases until the whole flow, across its hexagons, fits clear of the flow inspector', () => {
    const { container } = render(<Harness />)
    const before = viewportOf(container)
    act(() => useViewStore.getState().focusFlow('uc-submit'))
    frames(48)
    expect(viewportOf(container)).not.toEqual(before)
    frames(400)
    const fit = fitTo(frameBounds(), SCREEN.width, SCREEN.height, islandInset(SCREEN, false, false, null, true), 0)
    expect(fit.scale).toBeGreaterThan(before.scale)
    expectViewport(container, fit)
  })

  it('frames what a flow export frames, whether or not the corridor guides are shown', () => {
    usePreferencesStore.setState({ guides: true })
    const { container } = render(<Harness />)
    act(() => useViewStore.getState().focusFlow('uc-submit'))
    frames(400)
    expectViewport(container, fitTo(frameBounds(), SCREEN.width, SCREEN.height, islandInset(SCREEN, false, false, null, true), 0))
  })

  it('does not move the camera when the flow is unpicked', () => {
    const { container } = render(<Harness />)
    act(() => useViewStore.getState().focusFlow('uc-submit'))
    frames(400)
    const picked = viewportOf(container)
    act(() => useViewStore.getState().focusFlow(null))
    frames(400)
    expectViewport(container, picked)
  })
})

describe('Stage — presenting a flow up close', () => {
  const SCREEN = { width: 2000, height: 800 }
  const originalMatchMedia = window.matchMedia
  let restoreSize: () => void
  const frames = (ms: number) => act(() => void vi.advanceTimersByTime(ms))
  const { focusFlow, present } = useViewStore.getState()
  const layout = () => layoutMap(useMapStore.getState().map, { current: 'h1' })
  const stepBox = (index: number) => {
    const step = flowOf(useMapStore.getState().map, 'h1', 'uc-submit').steps[index]
    const at = layout().hexagons.find((h) => h.id === step.hexId)!
    const kind = { actor: 'actor', aggregate: 'domainItem', useCase: 'useCase' }[step.role as string]!
    return translatedNodeBox(at.model.nodes.find((n) => n.ref === step.id && n.kind === kind)!, at.centre)
  }
  const free = (container: HTMLElement) => visibleRect(viewportOf(container), SCREEN, islandInset(SCREEN, true, false, null, false))
  const expectCentredOn = (container: HTMLElement, box: Box) => {
    expect(free(container).x + free(container).width / 2).toBeCloseTo(box.x + box.width / 2, 6)
    expect(free(container).y + free(container).height / 2).toBeCloseTo(box.y + box.height / 2, 6)
  }
  const USE_CASE_STEP = 3
  const COMPACT_STEP = 8
  beforeEach(() => {
    vi.useFakeTimers()
    window.matchMedia = ((media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia
    restoreSize = stubFixedSize(SCREEN.width, SCREEN.height)
    useMapStore.getState().replace(manyHexagonMap(6))
    usePreferencesStore.setState({ viewOnly: true })
    useViewStore.setState({ editorOpen: true })
  })
  afterEach(() => {
    restoreSize()
    window.matchMedia = originalMatchMedia
    vi.useRealTimers()
  })

  it('eases in on the first step and centres it, instead of flying to the whole flow', () => {
    const { container } = render(<Harness />)
    const before = viewportOf(container)
    act(() => {
      focusFlow('uc-submit')
      present(0)
    })
    frames(48)
    const early = viewportOf(container)
    frames(800)
    const { scale } = viewportOf(container)
    expect(early.scale).toBeGreaterThan(before.scale)
    expect(early.scale).toBeLessThan(scale)
    expect(scale).toBeLessThanOrEqual(ELEMENT_FOCUS_SCALE)
    expectCentredOn(container, stepBox(0))
  })

  it('moves on to the next step with the same close view', () => {
    const { container } = render(<Harness />)
    act(() => {
      focusFlow('uc-submit')
      present(0)
    })
    frames(800)
    const first = viewportOf(container)
    act(() => present(USE_CASE_STEP))
    frames(800)
    expect(viewportOf(container).x).not.toBeCloseTo(first.x, 3)
    expectCentredOn(container, stepBox(USE_CASE_STEP))
  })

  it('frames the whole hexagon of a step that is drawn compact', () => {
    const { container } = render(<Harness />)
    act(() => {
      focusFlow('uc-submit')
      present(COMPACT_STEP)
    })
    frames(800)
    const h2 = layout().hexagons.find((h) => h.id === 'h2')!
    expect(h2.compact).toBeTruthy()
    expectViewport(container, fitTo(hexagonBounds(h2), SCREEN.width, SCREEN.height, islandInset(SCREEN, true, false, null, false), 0))
  })

  it('flies back to the flow frame when presenting stops and the flow stays picked', () => {
    const { container } = render(<Harness />)
    act(() => focusFlow('uc-submit'))
    frames(800)
    const flowView = viewportOf(container)
    act(() => present(USE_CASE_STEP))
    frames(800)
    expect(viewportOf(container).scale).toBeGreaterThan(flowView.scale)
    act(() => present(null))
    frames(800)
    expectViewport(container, flowView)
  })

  it('does not move the camera when the flow is cleared while presenting', () => {
    const { container } = render(<Harness />)
    act(() => {
      focusFlow('uc-submit')
      present(USE_CASE_STEP)
    })
    frames(800)
    const close = viewportOf(container)
    act(() => focusFlow(null))
    frames(800)
    expectViewport(container, close)
  })
})

describe('Stage — zooming to a clicked element', () => {
  const SCREEN = { width: 2000, height: 800 }
  let restoreSize: () => void
  const adapterId = () => diagramOf(useMapStore.getState().map, 'h1').adapters[0].id
  const adapter = (container: HTMLElement) => hexGroup(container, 'h1').querySelector(`[data-ref="${adapterId()}"]`)!
  const adapterBox = () => {
    const h1 = currentHexagon(layoutMap(useMapStore.getState().map, { current: 'h1' }), 'h1')
    return translatedNodeBox(h1.model.nodes.find((n) => n.ref === adapterId() && n.kind === 'adapter')!, h1.centre)
  }
  const free = (container: HTMLElement) => visibleRect(viewportOf(container), SCREEN, islandInset(SCREEN, false, false))
  beforeEach(() => {
    restoreSize = stubFixedSize(SCREEN.width, SCREEN.height)
    useMapStore.getState().replace(manyHexagonMap(4))
  })
  afterEach(() => restoreSize())

  it('zooms in and centres the element in the free area, without letting it fill more than a third of the shorter side', () => {
    const { container } = render(<Harness />)
    const before = viewportOf(container).scale
    fireEvent.click(adapter(container))
    const box = adapterBox()
    const { scale } = viewportOf(container)
    expect(scale).toBeGreaterThan(before)
    expect(scale).toBeLessThanOrEqual(ELEMENT_FOCUS_SCALE)
    expect(Math.max(box.width, box.height) * scale).toBeLessThanOrEqual(Math.min(free(container).width, free(container).height) * scale / 3 + 1e-6)
    expect(free(container).x + free(container).width / 2).toBeCloseTo(box.x + box.width / 2, 6)
    expect(free(container).y + free(container).height / 2).toBeCloseTo(box.y + box.height / 2, 6)
  })

  it('never zooms out: a closer view keeps its scale and only re-centres', () => {
    const { container } = render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom to 100%' }))
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    const close = viewportOf(container).scale
    expect(close).toBeGreaterThan(ELEMENT_FOCUS_SCALE)
    fireEvent.click(adapter(container))
    expect(viewportOf(container).scale).toBeCloseTo(close, 9)
    expect(free(container).x + free(container).width / 2).toBeCloseTo(adapterBox().x + adapterBox().width / 2, 6)
  })

  it('leaves the camera alone for another hexagon, a context hull and empty canvas', () => {
    const { container } = render(<Harness />)
    fireEvent.click(hexGroup(container, 'h2'))
    const autoFit = fitTo(canvasBounds(layoutMap(useMapStore.getState().map, { current: 'h2' })), SCREEN.width, SCREEN.height, islandInset(SCREEN, false, false), 0)
    expectViewport(container, autoFit)
    const before = viewportOf(container)
    fireEvent.click(container.querySelector('[data-hull]')!)
    expectViewport(container, before)
    fireEvent.click(svg(container))
    expectViewport(container, before)
  })

  it('moves once for a double-click: its repeat click does not fly again', () => {
    const { container } = render(<Harness />)
    fireEvent.click(adapter(container), { detail: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    const zoomedOut = viewportOf(container)
    fireEvent.click(adapter(container), { detail: 2 })
    expectViewport(container, zoomedOut)
  })

  it('leaves the camera alone while linking', () => {
    const { container } = render(<Harness />)
    fireEvent.click(hexGroup(container, 'h1').querySelector('[data-ref="p-repo"]')!)
    const selected = viewportOf(container)
    fireEvent.keyDown(document.body, { key: 'l' })
    fireEvent.click(adapter(container))
    expectViewport(container, selected)
  })

  it('leaves the camera where a pan-drag put it when the press ends over an element', () => {
    const { container } = render(<Harness />)
    const main = container.querySelector('main')!
    main.setPointerCapture = () => {}
    fireEvent.pointerDown(adapter(container), { button: 0, buttons: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(main, { buttons: 1, clientX: 160, clientY: 100 })
    flushFrame()
    const panned = viewportOf(container)
    fireEvent.pointerUp(main, { clientX: 160, clientY: 100 })
    fireEvent.click(adapter(container))
    expectViewport(container, panned)
  })
})
