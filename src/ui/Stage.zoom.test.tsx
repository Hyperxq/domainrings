import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createRef } from 'react'
import { Stage } from './Stage'
import { layoutMap } from '../layout/map'
import { legendFor } from '../layout/legend'
import { diagramOf } from '../model/map'
import { useMapStore } from '../model/store'
import { useViewStore } from './state/viewStore'
import { manyHexagonMap } from '../test/fixtures'

// MapDiagram draws the legend exactly once per render, so counting legend renders counts diagram renders.
const diagramRenders = vi.hoisted(() => ({ count: 0 }))
vi.mock('../render/SvgLegend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../render/SvgLegend')>()
  const { createElement } = await import('react')
  return {
    ...actual,
    SvgLegend: (props: Parameters<typeof actual.SvgLegend>[0]) => {
      diagramRenders.count++
      return createElement(actual.SvgLegend, props)
    },
  }
})

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
beforeEach(() => {
  useMapStore.getState().replace(manyHexagonMap(4))
  useViewStore.setState({ editorOpen: false })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function Harness() {
  const map = useMapStore((s) => s.map)
  const hexId = useMapStore((s) => s.focus)
  const diagram = diagramOf(map, hexId)
  return (
    <Stage
      model={layoutMap(map, { current: hexId })}
      map={map}
      hexId={hexId}
      diagram={diagram}
      legend={legendFor(diagram)}
      revision={0}
      title="Test"
      svgRef={createRef<SVGSVGElement>()}
      onDelete={() => false}
      onLink={() => {}}
      contextLabel=""
      onGrow={() => {}}
    />
  )
}

describe('Stage zoom performance', () => {
  it('does not re-render the diagram when only the viewport changes', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const { container } = render(<Harness />)
    const main = container.querySelector('main')!
    const before = main.style.backgroundSize
    const rendered = diagramRenders.count
    expect(rendered).toBeGreaterThan(0)
    fireEvent.wheel(main, { deltaY: -300 })
    act(() => frames.splice(0).forEach((cb) => cb(0)))
    expect(main.style.backgroundSize).not.toBe(before)
    expect(diagramRenders.count).toBe(rendered)
  })
})
