import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { EXAMPLES, TWO_SLICES_MAP } from '../model/example'
import type { HexaMap } from '../model/schema'
import { useMapStore } from '../model/store'
import { diagramOf } from '../model/map'
import { threadSlots } from '../model/threads'
import { FlowsPanel } from './FlowsPanel'
import { FlowsSection } from './FlowsSection'
import { usePreferencesStore } from './state/preferencesStore'
import { useViewStore } from './state/viewStore'

const example = () => EXAMPLES.find((e) => e.id === 'hexagonal-advanced')!.map as HexaMap
// The panel lists every hexagon's flows on a map of several, so the single-hexagon cases keep just the first.
const single = (map: HexaMap): HexaMap => ({ ...map, hexagons: map.hexagons.filter((h) => h.id === 'h1'), links: [] })
beforeEach(() => {
  useMapStore.getState().replace(single(example()))
  useViewStore.setState({ focusedFlow: null, hoveredFlows: [] })
})
afterEach(cleanup)

describe('FlowsPanel', () => {
  it('keeps Present in a footer below the scrolling list, so a long list never hides it', () => {
    usePreferencesStore.setState({ viewOnly: true })
    render(<FlowsPanel />)
    const present = screen.getByRole('button', { name: 'Present' })
    expect(present.closest('footer.present-foot')).toBeTruthy()
    expect(present.closest('.editor-body')).toBeNull()
  })

  it('lists the use case with who starts it and where it ends, under an All flows row with the count', () => {
    render(<FlowsPanel />)
    expect(screen.getByRole('heading', { name: 'Flows' })).toBeTruthy()
    expect(screen.getByText('Each flow is one use case, end to end. Pick one to follow it.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^All flows\s*1$/ })).toBeTruthy()
    const row = screen.getByRole('button', { name: /PlaceOrder/ })
    expect(row.textContent).toContain('Web shop → Postgres')
  })

  it('selecting a flow focuses it, marks the row pressed, and All flows clears it', () => {
    render(<FlowsPanel />)
    const row = screen.getByRole('button', { name: /PlaceOrder/ })
    const all = screen.getByRole('button', { name: /^All flows/ })
    expect(all.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(row)
    expect(useViewStore.getState().focusedFlow).toBe('uc-place')
    expect(row.getAttribute('aria-pressed')).toBe('true')
    expect(all.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(all)
    expect(useViewStore.getState().focusedFlow).toBeNull()
  })

  it('selecting the focused flow again returns to all flows', () => {
    render(<FlowsPanel />)
    const row = screen.getByRole('button', { name: /PlaceOrder/ })
    fireEvent.click(row)
    fireEvent.click(row)
    expect(useViewStore.getState().focusedFlow).toBeNull()
  })

  it('is operable from the keyboard: rows are buttons in tab order', () => {
    render(<FlowsPanel />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.tagName)).toEqual(['BUTTON', 'BUTTON'])
    expect(buttons.every((b) => b.tabIndex === 0)).toBe(true)
  })

  it('tags a flow with a gap as incomplete', () => {
    const map = single(example())
    useMapStore.getState().replace({ ...map, hexagons: map.hexagons.map((h) => (h.id === 'h1' ? { ...h, actors: [] } : h)) })
    render(<FlowsPanel />)
    expect(screen.getByRole('button', { name: /PlaceOrder/ }).textContent).toContain('incomplete')
  })

  it('says so when the hexagon has no use case', () => {
    const map = single(example())
    useMapStore.getState().replace({ ...map, hexagons: map.hexagons.map((h) => (h.id === 'h1' ? { ...h, useCases: [], ports: [], adapters: [], actors: [], externals: [] } : h)) })
    render(<FlowsPanel />)
    expect(screen.getByText('No use cases yet. Switch to Edit to add one.')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('the Layers key', () => {
  const key = () => screen.getByRole('region', { name: 'Layers' })
  const names = () => within(key()).getAllByRole('listitem').map((li) => li.textContent)

  it('lists the three layers with their swatch above Present, in the pinned footer', () => {
    usePreferencesStore.setState({ viewOnly: true })
    render(<FlowsPanel />)
    expect(names()).toEqual(['Infrastructure', 'Application', 'Domain'])
    expect(key().querySelector('.swatch-application')).toBeTruthy()
    const footer = key().closest('footer.present-foot')!
    expect(footer.contains(screen.getByRole('button', { name: 'Present' }))).toBe(true)
    expect(key().compareDocumentPosition(screen.getByRole('button', { name: 'Present' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('honours the diagram’s own layer names', () => {
    const map = single(example())
    useMapStore.getState().replace({ ...map, hexagons: map.hexagons.map((h) => ({ ...h, layers: { application: { title: ' Core ' } } })) })
    render(<FlowsPanel />)
    expect(names()).toEqual(['Infrastructure', 'Core', 'Domain'])
  })

  it('stays when the hexagon has no use case', () => {
    const map = single(example())
    useMapStore.getState().replace({ ...map, hexagons: map.hexagons.map((h) => ({ ...h, useCases: [], ports: [], adapters: [], actors: [], externals: [] })) })
    render(<FlowsPanel />)
    expect(names()).toHaveLength(3)
  })
})

describe('previewing a flow from its row', () => {
  const row = () => screen.getByRole('button', { name: /PlaceOrder/ })

  it('previews while the row is hovered or focused, and ends with the pointer or the blur', () => {
    render(<FlowsPanel />)
    fireEvent.pointerEnter(row())
    expect(useViewStore.getState().hoveredFlows).toEqual(['uc-place'])
    fireEvent.pointerLeave(row())
    expect(useViewStore.getState().hoveredFlows).toEqual([])
    fireEvent.focus(row())
    expect(useViewStore.getState().hoveredFlows).toEqual(['uc-place'])
    fireEvent.blur(row())
    expect(useViewStore.getState().hoveredFlows).toEqual([])
  })

  describe('with rows from two hexagons', () => {
    const other = () => screen.getByRole('button', { name: /ReceiveOrder/ })
    beforeEach(() => {
      useMapStore.getState().replace(TWO_SLICES_MAP)
      usePreferencesStore.setState({ viewOnly: true })
    })

    it('falls back to the keyboard-focused row when the pointer leaves another one', () => {
      render(<FlowsPanel />)
      act(() => row().focus())
      fireEvent.pointerEnter(other())
      expect(useViewStore.getState().hoveredFlows).toEqual(['uc-receive'])
      fireEvent.pointerLeave(other())
      expect(useViewStore.getState().hoveredFlows).toEqual(['uc-place'])
    })

    it('clears when the pointer leaves and no row has focus', () => {
      render(<FlowsPanel />)
      fireEvent.pointerEnter(other())
      fireEvent.pointerLeave(other())
      expect(useViewStore.getState().hoveredFlows).toEqual([])
    })

    it('keeps the pointer’s preview of another row when the focused one blurs', () => {
      render(<FlowsPanel />)
      act(() => row().focus())
      fireEvent.pointerEnter(other())
      act(() => row().blur())
      expect(useViewStore.getState().hoveredFlows).toEqual(['uc-receive'])
    })
  })

  it('ends when the hovered row goes away with its use case', () => {
    render(<FlowsPanel />)
    fireEvent.pointerEnter(row())
    const map = useMapStore.getState().map
    act(() => useMapStore.getState().replace({ ...map, hexagons: map.hexagons.map((h) => ({ ...h, useCases: [] })) }))
    expect(useViewStore.getState().hoveredFlows).toEqual([])
  })

  it('leaves another flow’s preview alone when a row goes away', () => {
    const { unmount } = render(<FlowsPanel />)
    act(() => useViewStore.getState().hoverFlows(['uc-other']))
    unmount()
    expect(useViewStore.getState().hoveredFlows).toEqual(['uc-other'])
  })
})

describe('flow bars', () => {
  const withSecondFlow = () => {
    const map = single(example())
    useMapStore.getState().replace({ ...map, hexagons: map.hexagons.map((h) => (h.id === 'h1' ? { ...h, useCases: [...h.useCases, { id: 'uc-two', name: 'RefundOrder' }] } : h)) })
    return threadSlots(diagramOf(useMapStore.getState().map, 'h1'))
  }
  // The row carries the thread, so its bar and its selected highlight both read the same colour.
  const rows = () => [...document.querySelectorAll<HTMLElement>('.flow-row:not(.flow-row-all)')].map((r) => r.style.getPropertyValue('--thread'))

  it.each([
    ['the Flows panel', FlowsPanel],
    ['the editor Flows section', FlowsSection],
  ])('colours each row in %s with its flow thread slot', (_, Component) => {
    const slots = withSecondFlow()
    render(<Component />)
    expect(slots.get('uc-place')).not.toBe(slots.get('uc-two'))
    expect(rows()).toEqual([`var(--thread-${slots.get('uc-place')})`, `var(--thread-${slots.get('uc-two')})`])
  })

  it('highlights the selected row in its own thread colour', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf-8')
    const pressed = css.match(/\.flow-row\[aria-pressed='true'\] \{([^}]*)\}/)?.[1] ?? ''
    expect(pressed).toMatch(/border-color: var\(--thread, var\(--teal\)\)/)
    expect(pressed).toMatch(/background: color-mix\(in srgb, var\(--thread, var\(--teal\)\)/)
  })
})


describe('FlowsPanel on a map of several hexagons', () => {
  beforeEach(() => {
    useMapStore.getState().replace(TWO_SLICES_MAP)
    usePreferencesStore.setState({ viewOnly: true })
  })
  const headings = () => screen.queryAllByRole('heading', { level: 3 }).map((h) => h.textContent)

  it('puts no heading over the flows of a map with one hexagon', () => {
    useMapStore.getState().replace(single(example()))
    render(<FlowsPanel />)
    expect(headings()).toEqual([])
  })

  it('lists every hexagon under its own name in map order, whichever is current, and counts them all', () => {
    useMapStore.getState().setFocus('h2')
    render(<FlowsPanel />)
    expect(headings()).toEqual(['Orders', 'Shipping'])
    expect(screen.getByRole('button', { name: /^All flows\s*2$/ })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /ReceiveOrder|PlaceOrder/ }).map((r) => r.querySelector('.flow-name')!.textContent)).toEqual(['PlaceOrder', 'ReceiveOrder'])
  })

  it('keeps the groups in place when a flow of another hexagon is picked', () => {
    render(<FlowsPanel />)
    fireEvent.click(screen.getByRole('button', { name: /ReceiveOrder/ }))
    expect(headings()).toEqual(['Orders', 'Shipping'])
  })

  it('colours each row from the slots of its own hexagon', () => {
    render(<FlowsPanel />)
    const map = useMapStore.getState().map
    const slot = (hexId: string, uc: string) => `var(--thread-${threadSlots(diagramOf(map, hexId)).get(uc)})`
    const colour = (name: RegExp) => screen.getByRole('button', { name }).style.getPropertyValue('--thread')
    expect(colour(/PlaceOrder/)).toBe(slot('h1', 'uc-place'))
    expect(colour(/ReceiveOrder/)).toBe(slot('h2', 'uc-receive'))
  })

  it("picking another hexagon's flow focuses that hexagon and that flow together", () => {
    render(<FlowsPanel />)
    fireEvent.click(screen.getByRole('button', { name: /ReceiveOrder/ }))
    expect(useMapStore.getState().focus).toBe('h2')
    expect(useViewStore.getState().focusedFlow).toBe('uc-receive')
    expect(screen.getByRole('button', { name: /ReceiveOrder/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /ReceiveOrder/ }))
    expect(useViewStore.getState().focusedFlow).toBeNull()
  })

  it("Present from the footer presents the other hexagon's picked flow", () => {
    render(<FlowsPanel />)
    fireEvent.click(screen.getByRole('button', { name: /ReceiveOrder/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Present' }))
    expect(useViewStore.getState()).toMatchObject({ focusedFlow: 'uc-receive', presentStep: 0 })
    expect(useMapStore.getState().focus).toBe('h2')
  })

  it('leaves the editor Flows section on the current hexagon', () => {
    render(<FlowsSection />)
    expect(screen.getByRole('button', { name: /PlaceOrder/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /ReceiveOrder/ })).toBeNull()
    expect(headings()).toEqual([])
  })
})

describe('planned flows while Planned is off', () => {
  const plan = (...ids: string[]) => {
    const map = useMapStore.getState().map
    useMapStore.getState().replace({
      ...map,
      hexagons: map.hexagons.map((h) => ({ ...h, useCases: h.useCases.map((u) => (ids.includes(u.id) ? { ...u, status: 'planned' as const } : u)) })),
    })
  }
  const names = () => [...document.querySelectorAll('.flow-row:not(.flow-row-all) .flow-name')].map((n) => n.textContent)
  beforeEach(() => {
    useMapStore.getState().replace(TWO_SLICES_MAP)
    usePreferencesStore.setState({ viewOnly: true, showPlanned: false })
  })
  afterEach(() => usePreferencesStore.setState({ showPlanned: true }))

  it('drops a planned flow, its hexagon group and its share of the All flows count', () => {
    plan('uc-receive')
    render(<FlowsPanel />)
    expect(names()).toEqual(['PlaceOrder'])
    expect(screen.queryByRole('heading', { level: 3, name: 'Shipping' })).toBeNull()
    expect(screen.getByRole('button', { name: /^All flows\s*1$/ })).toBeTruthy()
  })

  it('lists planned flows again once Planned is on', () => {
    plan('uc-receive')
    usePreferencesStore.setState({ showPlanned: true })
    render(<FlowsPanel />)
    expect(names()).toEqual(['PlaceOrder', 'ReceiveOrder'])
  })

  it('falls back to the empty help when nothing but planned flows is left', () => {
    plan('uc-place', 'uc-receive')
    render(<FlowsPanel />)
    expect(screen.getByText('No use cases yet. Switch to Edit to add one.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Present' })).toBeNull()
  })

  it('keeps the colours of the flows still listed, and the editor Flows section keeps listing planned ones', () => {
    useMapStore.getState().replace(single(example()))
    const map = useMapStore.getState().map
    useMapStore.getState().replace({ ...map, hexagons: map.hexagons.map((h) => ({ ...h, useCases: [{ id: 'uc-first', name: 'First', status: 'planned' as const }, ...h.useCases] })) })
    const slot = threadSlots(diagramOf(useMapStore.getState().map, 'h1')).get('uc-place')
    const { unmount } = render(<FlowsPanel />)
    expect(names()).toEqual(['PlaceOrder'])
    expect(screen.getByRole('button', { name: /PlaceOrder/ }).style.getPropertyValue('--thread')).toBe(`var(--thread-${slot})`)
    unmount()
    render(<FlowsSection />)
    expect(names()).toEqual(['First', 'PlaceOrder'])
  })

  it('has Present start at the first flow still listed', () => {
    plan('uc-place')
    render(<FlowsPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Present' }))
    expect(useViewStore.getState()).toMatchObject({ focusedFlow: 'uc-receive', presentStep: 0 })
    expect(useMapStore.getState().focus).toBe('h2')
  })
})
