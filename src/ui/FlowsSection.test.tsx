import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EXAMPLES } from '../model/example'
import { diagramOf } from '../model/map'
import type { HexaMap } from '../model/schema'
import { useMapStore } from '../model/store'
import { FlowsSection } from './FlowsSection'
import { useHistoryStore } from './state/historyStore'
import { useViewStore } from './state/viewStore'

beforeEach(() => {
  useMapStore.getState().replace(EXAMPLES.find((e) => e.id === 'hexagonal-advanced')!.map as HexaMap)
  useViewStore.getState().focusFlow(null)
  useHistoryStore.setState({ stack: [] })
})
afterEach(cleanup)

const useCases = () => diagramOf(useMapStore.getState().map, useMapStore.getState().focus).useCases

describe('FlowsSection', () => {
  it('lists the flows under a Flows heading, as the View mode panel does', () => {
    render(<FlowsSection />)
    expect(screen.getByRole('heading', { name: 'Flows' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /PlaceOrder/ }).textContent).toContain('Web shop → Payments, Shipping, Catalog, Postgres')
  })

  it('selecting a flow focuses it', () => {
    render(<FlowsSection />)
    fireEvent.click(screen.getByRole('button', { name: /PlaceOrder/ }))
    expect(useViewStore.getState().focusedFlow).toBe('uc-place')
  })

  it('"+ New flow" adds a use case with the usual defaults, focuses it and records an undo step', () => {
    render(<FlowsSection />)
    fireEvent.click(screen.getByRole('button', { name: '+ New flow' }))
    const added = useCases().at(-1)!
    expect(useCases()).toHaveLength(2)
    expect(added.name).toBe('NewUseCase')
    expect(useViewStore.getState().focusedFlow).toBe(added.id)
    expect(useHistoryStore.getState().stack).toHaveLength(1)
    expect(screen.getByRole('button', { name: /NewUseCase/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('lists no rows for a hexagon without use cases but still offers "+ New flow"', () => {
    const map = EXAMPLES.find((e) => e.id === 'hexagonal-advanced')!.map as HexaMap
    useMapStore.getState().replace({ ...map, hexagons: map.hexagons.map((h) => (h.id === 'h1' ? { ...h, useCases: [], ports: [], adapters: [], actors: [], externals: [] } : h)) })
    render(<FlowsSection />)
    expect(screen.getByRole('button', { name: '+ New flow' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /PlaceOrder/ })).toBeNull()
  })
})
