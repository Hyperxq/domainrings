import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { newCleanMap } from '../model/hexa'
import { useCleanStore } from '../model/cleanStore'
import { CleanEditor } from './CleanEditor'

const state = () => useCleanStore.getState()

beforeEach(() => {
  state().replace(newCleanMap('Fresh architecture'))
})
afterEach(cleanup)

const renderEditor = () => render(<CleanEditor open onToggle={() => {}} />)
const section = (container: HTMLElement, title: string) => within(container).getByText(title).closest('details')!

describe('CleanEditor', () => {
  it('renders one fold per ring, innermost-first, each starting with 0 sectors', () => {
    const { container } = renderEditor()
    for (const title of ['Entities', 'Use Cases', 'Interface Adapters', 'Frameworks & Drivers']) {
      expect(section(container, title).querySelector('summary')!.textContent).toBe(`${title}· 0`)
    }
  })

  it('adds a sector to the ring whose "+" was clicked, immediately focused for renaming (REQ-03)', () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Add sector to Entities' }))

    expect(state().map.sectors).toHaveLength(1)
    expect(state().map.sectors[0].ringRole).toBe('domain')
    expect((document.activeElement as HTMLElement).classList.contains('name')).toBe(true)

    fireEvent.change(document.activeElement!, { target: { value: 'Order Management' } })
    expect(state().map.sectors[0].name).toBe('Order Management')
  })

  it('an empty sector is a valid, displayable state (REQ-03/REQ-04)', () => {
    state().addSector({ name: 'Billing', ringRole: 'domain' })
    const { container } = renderEditor()
    const domainFold = section(container, 'Entities')
    expect(within(domainFold).getByDisplayValue('Billing')).toBeTruthy()
    expect(within(domainFold).getByText('No elements yet.')).toBeTruthy()
  })

  it('adding an element via a sector\'s "+" attaches it to that sector, immediately focused for renaming (REQ-04)', () => {
    state().addSector({ name: 'Billing', ringRole: 'domain' })
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Add element to Billing' }))

    expect(state().map.elements).toHaveLength(1)
    expect(state().map.elements[0].sectorId).toBe(state().map.sectors[0].id)
    expect((document.activeElement as HTMLElement).classList.contains('name')).toBe(true)

    fireEvent.change(document.activeElement!, { target: { value: 'Invoice' } })
    expect(state().map.elements[0].name).toBe('Invoice')
  })

  it('removing a sector removes it and cascade-prunes its own elements', () => {
    const sectorId = state().addSector({ name: 'Billing', ringRole: 'domain' })
    const elementId = state().addElement({ name: 'Invoice', sectorId })
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Remove sector Billing' }))

    expect(state().map.sectors.find((s) => s.id === sectorId)).toBeUndefined()
    expect(state().map.elements.find((e) => e.id === elementId)).toBeUndefined()
  })

  it('removing an element removes it from its sector', () => {
    const sectorId = state().addSector({ name: 'Billing', ringRole: 'domain' })
    const elementId = state().addElement({ name: 'Invoice', sectorId })
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Remove element Invoice' }))

    expect(state().map.elements.find((e) => e.id === elementId)).toBeUndefined()
  })
})
