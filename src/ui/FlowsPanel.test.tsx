import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EXAMPLES } from '../model/example'
import type { HexaMap } from '../model/schema'
import { useMapStore } from '../model/store'
import { diagramOf } from '../model/map'
import { threadSlots } from '../model/threads'
import { FlowsPanel } from './FlowsPanel'
import { FlowsSection } from './FlowsSection'
import { usePreferencesStore } from './state/preferencesStore'
import { useViewStore } from './state/viewStore'

const load = (id: string) => useMapStore.getState().replace(EXAMPLES.find((e) => e.id === id)!.map as HexaMap)
beforeEach(() => {
  load('hexagonal-advanced')
  useViewStore.getState().focusFlow(null)
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
    expect(row.textContent).toContain('Web shop → Payments, Shipping, Catalog, Postgres')
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
    const map = EXAMPLES.find((e) => e.id === 'hexagonal-advanced')!.map as HexaMap
    useMapStore.getState().replace({ ...map, hexagons: map.hexagons.map((h) => (h.id === 'h1' ? { ...h, actors: [] } : h)) })
    render(<FlowsPanel />)
    expect(screen.getByRole('button', { name: /PlaceOrder/ }).textContent).toContain('incomplete')
  })

  it('says so when the hexagon has no use case', () => {
    const map = EXAMPLES.find((e) => e.id === 'hexagonal-advanced')!.map as HexaMap
    useMapStore.getState().replace({ ...map, hexagons: map.hexagons.map((h) => (h.id === 'h1' ? { ...h, useCases: [], ports: [], adapters: [], actors: [], externals: [] } : h)) })
    render(<FlowsPanel />)
    expect(screen.getByText('No use cases yet. Switch to Edit to add one.')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('flow bars', () => {
  const withSecondFlow = () => {
    const map = EXAMPLES.find((e) => e.id === 'hexagonal-advanced')!.map as HexaMap
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

