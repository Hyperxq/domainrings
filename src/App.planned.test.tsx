import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { App } from './App'
import { EXAMPLE_DIAGRAM } from './model/example'
import { toMap } from './model/hexa'
import { useMapStore } from './model/store'
import type { HexaMap } from './model/schema'
import { usePreferencesStore } from './ui/state/preferencesStore'
import { useViewStore } from './ui/state/viewStore'
import { card, installDialogPolyfill } from './test/fixtures'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  window.matchMedia = ((media: string) => ({ matches: true, media, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia
  Element.prototype.scrollIntoView = vi.fn()
  URL.createObjectURL ??= vi.fn(() => 'blob:mock')
  URL.revokeObjectURL ??= vi.fn()
  installDialogPolyfill()
})

/** h1: its use case is planned, and the ports point at it. h2: a planned hexagon, linked from h1. */
function roadmap(): HexaMap {
  const base = toMap(EXAMPLE_DIAGRAM)
  const [h] = base.hexagons
  return {
    ...base,
    contexts: [{ id: 'c1' }, { id: 'c2' }],
    hexagons: [
      { ...h, useCases: h.useCases.map((u) => ({ ...u, status: 'planned' as const })) },
      { ...h, id: 'h2', contextId: 'c2', cell: { q: 1, r: 0 }, title: 'Second', status: 'planned' as const },
    ],
    links: [{ id: 'l1', from: { hexagonId: 'h1', portId: 'p-repo' }, to: { hexagonId: 'h2', portId: 'p-submit' } }],
  }
}

beforeEach(() => {
  useMapStore.getState().replace(roadmap())
  usePreferencesStore.setState({ showPlanned: true, legendOpen: true, legendInExport: true })
  useViewStore.setState({ editorOpen: false, exportScope: 'hexagon' })
})
afterEach(cleanup)

const canvas = (container: HTMLElement) => container.querySelector('svg.canvas')!
const hidePlanned = () => {
  // The View options menu stays open while toggling, so it is opened only when it is not already.
  if (!screen.queryByRole('menu')) fireEvent.click(screen.getByRole('button', { name: 'View options' }))
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /^Planned/ }))
}
const LEGEND_ENTRY = 'Planned: not built yet'

describe('planned items on the canvas', () => {
  it('draws them marked, and explains the marking in the legend', () => {
    const { container } = render(<App />)
    expect(canvas(container).querySelector('[data-hex="h1"] .node[data-ref="uc-submit"]')!.classList.contains('planned')).toBe(true)
    expect(canvas(container).querySelector('[data-hex="h2"]')!.classList.contains('planned')).toBe(true)
    expect(screen.queryAllByText(LEGEND_ENTRY)).not.toHaveLength(0)
  })

  it('leaves them out when the Planned switch is off, along with their legend entry, keeping the built ones', () => {
    const { container } = render(<App />)
    hidePlanned()
    expect(canvas(container).querySelector('.node[data-ref="uc-submit"]')).toBeNull()
    expect(canvas(container).querySelector('[data-hex="h1"] .node[data-ref="p-submit"]')).not.toBeNull()
    expect(canvas(container).querySelector('[data-hex="h2"]')).toBeNull()
    expect(canvas(container).querySelectorAll('[data-map-link]')).toHaveLength(0)
    expect(screen.queryAllByText(LEGEND_ENTRY)).toHaveLength(0)
    hidePlanned()
    expect(canvas(container).querySelector('.node[data-ref="uc-submit"]')).not.toBeNull()
  })

  it('never hides the hexagon being worked on, even when it is planned', () => {
    const { container } = render(<App />)
    act(() => useMapStore.getState().setFocus('h2'))
    hidePlanned()
    expect(canvas(container).querySelector('[data-hex="h2"]')).not.toBeNull()
    expect(canvas(container).querySelector('[data-hex="h1"]')).not.toBeNull()
    expect(screen.queryAllByText(LEGEND_ENTRY)).not.toHaveLength(0)
  })

  it('keeps showing every item in the editor', () => {
    useViewStore.setState({ editorOpen: true })
    const { container } = render(<App />)
    hidePlanned()
    expect(card(container, 'p-submit')).not.toBeNull()
    expect(within(screen.getByRole('region', { name: 'Flows' })).getByText('SubmitChatFeedback')).toBeTruthy()
  })

  it('leaves the stored map untouched', () => {
    render(<App />)
    const before = useMapStore.getState().map
    hidePlanned()
    expect(useMapStore.getState().map).toBe(before)
  })
})

describe('exports while planned items are hidden', () => {
  const exportAs = async (menu: 'File' | 'Share', item: string) => {
    let captured: Blob | undefined
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      captured = blob as Blob
      return 'blob:mock'
    })
    fireEvent.click(screen.getByRole('button', { name: menu }))
    fireEvent.click(screen.getByRole('menuitem', { name: item }))
    await vi.waitFor(() => expect(captured).toBeDefined())
    return captured!.text()
  }

  it('leaves them out of an SVG export', async () => {
    render(<App />)
    expect(await exportAs('Share', 'Download SVG')).toContain('SubmitChatFeedback')
    vi.restoreAllMocks()
    hidePlanned()
    expect(await exportAs('Share', 'Download SVG')).not.toContain('SubmitChatFeedback')
  })

  it('still saves them in the .hexa file', async () => {
    render(<App />)
    hidePlanned()
    const file = JSON.parse(await exportAs('File', 'Save .hexa'))
    expect(file.hexagons[0].useCases[0].status).toBe('planned')
    expect(file.hexagons).toHaveLength(2)
  })
})

describe('editor Planned controls', () => {
  const built = (): HexaMap => {
    const base = roadmap()
    return { ...base, hexagons: base.hexagons.map(({ status: _status, useCases, ...rest }) => ({ ...rest, useCases: useCases.map(({ status: _s, ...u }) => u) })) }
  }
  const undoKey = () => fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
  const store = () => useMapStore.getState().map
  const flowBox = () => screen.getByRole('checkbox', { name: 'Flow planned' }) as HTMLInputElement

  beforeEach(() => {
    useMapStore.getState().replace(built())
    useViewStore.setState({ editorOpen: true, focusedFlow: 'uc-submit' })
  })

  it('marks a flow planned and back from the inspector, removing the key, each step undoable', () => {
    render(<App />)
    expect(flowBox().checked).toBe(false)
    fireEvent.click(flowBox())
    expect(store().hexagons[0].useCases[0].status).toBe('planned')
    expect(flowBox().checked).toBe(true)
    fireEvent.click(flowBox())
    expect('status' in store().hexagons[0].useCases[0]).toBe(false)
    undoKey()
    expect(store().hexagons[0].useCases[0].status).toBe('planned')
    undoKey()
    expect('status' in store().hexagons[0].useCases[0]).toBe(false)
  })

  it('offers it on every kind of element in the lists', () => {
    const { container } = render(<App />)
    for (const id of ['d-feedback', 'p-submit', 'a-knex', 'ext-pg']) expect(within(card(container, id)).queryByRole('checkbox', { name: 'Planned' }), id).not.toBeNull()
  })

  it('marks the subdomain planned and back, and undoes it', () => {
    render(<App />)
    const box = () => screen.getByRole('checkbox', { name: 'Planned subdomain' }) as HTMLInputElement
    fireEvent.click(box())
    expect(store().hexagons[0].status).toBe('planned')
    fireEvent.click(box())
    expect('status' in store().hexagons[0]).toBe(false)
    undoKey()
    expect(store().hexagons[0].status).toBe('planned')
  })

  it('marks a link planned and back, and undoes it', () => {
    const { container } = render(<App />)
    const box = () => within(card(container, 'l1')).getByRole('checkbox', { name: 'Planned' }) as HTMLInputElement
    fireEvent.click(box())
    expect(store().links[0].status).toBe('planned')
    fireEvent.click(box())
    expect('status' in store().links[0]).toBe(false)
    undoKey()
    expect(store().links[0].status).toBe('planned')
  })
})
