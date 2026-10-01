import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { layoutMap } from '../layout/map'
import { legendFor } from '../layout/legend'
import { contextName, diagramOf } from '../model/map'
import { useMapStore } from '../model/store'
import { hexGroup, twoHexMap } from '../test/fixtures'
import { Stage } from './Stage'
import { usePreferencesStore } from './state/preferencesStore'
import { useViewStore } from './state/viewStore'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

let styleTag: HTMLStyleElement
beforeEach(() => {
  vi.useFakeTimers()
  const base = twoHexMap()
  useMapStore.getState().replace({ ...base, contexts: [base.contexts[0], { id: 'c2' }], hexagons: [base.hexagons[0], { ...base.hexagons[1], contextId: 'c2' }] })
  useViewStore.setState({ editorOpen: false })
  styleTag = document.createElement('style')
  styleTag.textContent = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf-8')
  document.head.appendChild(styleTag)
})
afterEach(() => {
  cleanup()
  styleTag.remove()
  vi.useRealTimers()
})

function Harness() {
  const mode = usePreferencesStore((s) => s.mode)
  const map = useMapStore((s) => s.map)
  const hexId = useMapStore((s) => s.focus)
  const diagram = diagramOf(map, hexId)
  return (
    <Stage
      model={layoutMap(map, { mode, current: hexId, expanded: new Set() })}
      map={map}
      hexId={hexId}
      diagram={diagram}
      legend={legendFor(diagram)}
      revision={0}
      title="Test"
      svgRef={createRef<SVGSVGElement>()}
      onDelete={() => false}
      onLink={() => {}}
      contextLabel={contextName(map, map.hexagons.find((h) => h.id === hexId)!.contextId)}
      onGrow={() => {}}
    />
  )
}

const REST = 400
const hull = (container: HTMLElement, id: string) => container.querySelector(`[data-hull="${id}"]`)!
const overlays = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[data-context-reveal]')]
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms))

describe('context name reveal', () => {
  it('draws no name on the canvas at rest, while the outlines stay', () => {
    const { container } = render(<Harness />)
    expect(container.querySelectorAll('[data-hull]')).toHaveLength(2)
    expect(overlays(container)).toHaveLength(0)
    for (const chip of container.querySelectorAll('[data-chip]')) expect(getComputedStyle(chip).display).toBe('none')
  })

  it('blurs the region and centres its name once the pointer rests on its empty area', () => {
    const { container } = render(<Harness />)
    fireEvent.pointerMove(hull(container, 'c2'))
    wait(REST - 1)
    expect(overlays(container)).toHaveLength(0)
    wait(1)
    const [overlay] = overlays(container)
    expect(overlays(container)).toHaveLength(1)
    expect(overlay.getAttribute('data-context-reveal')).toBe('c2')
    expect(overlay.textContent).toBe('Context 2')
    expect(overlay.querySelector('.context-blur')).not.toBeNull()
  })

  it('restarts the delay while the pointer keeps moving across the region', () => {
    const { container } = render(<Harness />)
    fireEvent.pointerMove(hull(container, 'c2'))
    wait(REST - 100)
    fireEvent.pointerMove(hull(container, 'c2'))
    wait(REST - 100)
    expect(overlays(container)).toHaveLength(0)
    wait(100)
    expect(overlays(container)).toHaveLength(1)
  })

  it('shows nothing while the pointer is over a hexagon', () => {
    const { container } = render(<Harness />)
    fireEvent.pointerMove(hexGroup(container, 'h2').querySelector('.node')!)
    wait(REST * 2)
    expect(overlays(container)).toHaveLength(0)
  })

  it('cancels a pending reveal when the pointer enters a hexagon, and removes a shown one', () => {
    const { container } = render(<Harness />)
    fireEvent.pointerMove(hull(container, 'c2'))
    wait(REST - 1)
    fireEvent.pointerMove(hexGroup(container, 'h2').querySelector('.node')!)
    wait(REST)
    expect(overlays(container)).toHaveLength(0)

    fireEvent.pointerMove(hull(container, 'c2'))
    wait(REST)
    expect(overlays(container)).toHaveLength(1)
    fireEvent.pointerMove(hexGroup(container, 'h2').querySelector('.node')!)
    expect(overlays(container)).toHaveLength(0)
  })

  it('removes the overlay when the pointer leaves the canvas', () => {
    const { container } = render(<Harness />)
    fireEvent.pointerMove(hull(container, 'c1'))
    wait(REST)
    expect(overlays(container)).toHaveLength(1)
    fireEvent.pointerLeave(container.querySelector('svg.canvas')!)
    expect(overlays(container)).toHaveLength(0)
  })

  it('never takes a click: the overlay and everything in it ignore the pointer', () => {
    const { container } = render(<Harness />)
    fireEvent.pointerMove(hull(container, 'c1'))
    wait(REST)
    const [overlay] = overlays(container)
    for (const el of [overlay, ...overlay.querySelectorAll('*')]) expect(getComputedStyle(el).pointerEvents).toBe('none')
  })

  it('does not reveal while the stage is being panned', () => {
    const { container } = render(<Harness />)
    const main = container.querySelector('main')!
    main.setPointerCapture = () => {}
    fireEvent.pointerMove(hull(container, 'c1'))
    fireEvent.pointerDown(hull(container, 'c1'), { button: 0, buttons: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(main, { buttons: 1, clientX: 140, clientY: 100 })
    fireEvent.pointerMove(hull(container, 'c1'), { buttons: 1, clientX: 150, clientY: 100 })
    wait(REST)
    expect(overlays(container)).toHaveLength(0)
  })

  it('shows every context at once while Alt is held, and hides them on release', () => {
    const { container } = render(<Harness />)
    fireEvent.keyDown(window, { key: 'Alt', altKey: true })
    expect(overlays(container).map((o) => o.getAttribute('data-context-reveal'))).toEqual(['c1', 'c2'])
    expect(container.querySelectorAll('.context-blur')).toHaveLength(2)
    fireEvent.keyUp(window, { key: 'Alt', altKey: false })
    expect(overlays(container)).toHaveLength(0)
  })

  it('hides the Alt overlays when the window loses focus mid-hold', () => {
    const { container } = render(<Harness />)
    fireEvent.keyDown(window, { key: 'Alt', altKey: true })
    fireEvent.blur(window)
    expect(overlays(container)).toHaveLength(0)
  })

  it('names the context of a focused hexagon, without blur, and drops it on blur', () => {
    const { container } = render(<Harness />)
    const other = hexGroup(container, 'h2') as SVGGElement
    fireEvent.focus(other)
    const [overlay] = overlays(container)
    expect(overlays(container)).toHaveLength(1)
    expect(overlay.getAttribute('data-context-reveal')).toBe('c2')
    expect(overlay.textContent).toBe('Context 2')
    expect(overlay.querySelector('.context-blur')).toBeNull()
    fireEvent.blur(other)
    expect(overlays(container)).toHaveLength(0)
  })

  it('caps each label at its region\'s on-screen width, sizes it like the chip, and keeps the full name in the DOM', () => {
    const { container } = render(<Harness />)
    fireEvent.keyDown(window, { key: 'Alt', altKey: true })
    for (const overlay of overlays(container)) {
      const id = overlay.getAttribute('data-context-reveal')!
      const clip = overlay.querySelector<HTMLElement>('.context-blur')!.getAttribute('style')!
      const xs = [...clip.matchAll(/(-?[\d.]+) -?[\d.]+/g)].map((m) => Number(m[1]))
      const screenWidth = Math.max(...xs) - Math.min(...xs)
      const name = overlay.querySelector<HTMLElement>('.context-name')!
      expect(name.style.maxWidth).toBe(`${screenWidth}px`)

      const hullXs = [...hull(container, id).getAttribute('d')!.matchAll(/(-?[\d.]+) -?[\d.]+/g)].map((m) => Number(m[1]))
      const scale = screenWidth / (Math.max(...hullXs) - Math.min(...hullXs))
      const chipSize = Number(container.querySelector(`[data-chip="${id}"]`)!.getAttribute('font-size'))
      expect(parseFloat(name.style.fontSize)).toBeCloseTo(chipSize * scale, 3)
      expect(name.textContent).toBe(contextName(useMapStore.getState().map, id))
    }
  })

  it('shows nothing on a single-context map', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = render(<Harness />)
    fireEvent.focus(hexGroup(container, 'h2'))
    fireEvent.keyDown(window, { key: 'Alt', altKey: true })
    expect(overlays(container)).toHaveLength(0)
  })
})
