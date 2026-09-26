import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { layoutClean } from '../layout/clean'
import { newCleanMap } from '../model/hexa'
import { useCleanStore } from '../model/cleanStore'
import { CleanStage } from './CleanStage'

const state = () => useCleanStore.getState()

beforeEach(() => {
  state().replace(newCleanMap('Fresh architecture'))
})
afterEach(cleanup)

/** The stage as the app wires it: laid out fresh from the live store on every render — mirrors OnionStage's own
 * Harness (OnionStage.test.tsx). */
function Harness({ onReject = () => {} }: { onReject?: (message: string) => void } = {}) {
  const doc = useCleanStore((s) => s.map)
  const svgRef = createRef<SVGSVGElement>()
  return <CleanStage model={layoutClean(doc)} doc={doc} svgRef={svgRef} onReject={onReject} />
}

const renderStage = (props?: { onReject?: (message: string) => void }) => render(<Harness {...props} />)

describe('CleanStage — sector/element "+" affordances (REQ-03/REQ-04)', () => {
  it('offers a "+" for every ring on a fresh map, to add a sector', () => {
    renderStage()
    for (const label of ['Add sector to Entities', 'Add sector to Use Cases', 'Add sector to Interface Adapters', 'Add sector to Frameworks & Drivers']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
  })

  it('a ring\'s "+" adds a sector there (REQ-03)', () => {
    renderStage()
    fireEvent.click(screen.getByRole('button', { name: 'Add sector to Entities' }))
    expect(state().map.sectors).toHaveLength(1)
    expect(state().map.sectors[0].ringRole).toBe('domain')
  })

  it('a sector\'s "+" adds a named element there, immediately open for renaming (REQ-04)', () => {
    state().addSector({ name: 'Billing', ringRole: 'domain' })
    renderStage()
    fireEvent.click(screen.getByRole('button', { name: 'Add element to Billing' }))
    expect(state().map.elements).toHaveLength(1)
    expect(state().map.elements[0].sectorId).toBe(state().map.sectors[0].id)
    const field = screen.getByLabelText('element name') as HTMLInputElement
    fireEvent.change(field, { target: { value: 'Invoice' } })
    fireEvent.blur(field)
    expect(state().map.elements[0].name).toBe('Invoice')
  })

  it('cancelling a new element\'s name (Esc) removes it', () => {
    state().addSector({ name: 'Billing', ringRole: 'domain' })
    renderStage()
    fireEvent.click(screen.getByRole('button', { name: 'Add element to Billing' }))
    expect(state().map.elements).toHaveLength(1)
    fireEvent.keyDown(screen.getByLabelText('element name'), { key: 'Escape' })
    expect(state().map.elements).toHaveLength(0)
  })

  it('an outer-ring element offers an actor and an external "+"; an inner one offers neither (REQ-07)', () => {
    const innerSector = state().addSector({ name: 'Core', ringRole: 'domain' })
    const outerSector = state().addSector({ name: 'API', ringRole: 'outer' })
    state().addElement({ name: 'Order', sectorId: innerSector })
    state().addElement({ name: 'Controller', sectorId: outerSector })
    renderStage()
    expect(screen.getByRole('button', { name: 'Add an actor for Controller' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add an external system for Controller' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add an actor for Order' })).toBeNull()
  })

  it('an actor "+" creates the endpoint already targeting that outer-ring element', () => {
    const outerSector = state().addSector({ name: 'API', ringRole: 'outer' })
    state().addElement({ name: 'Controller', sectorId: outerSector })
    renderStage()
    fireEvent.click(screen.getByRole('button', { name: 'Add an actor for Controller' }))
    expect(state().map.actors).toHaveLength(1)
    expect(state().map.actors[0].targetId).toBe(state().map.elements[0].id)
  })
})

describe('CleanStage — the Depend-on gesture, inherited from RingedCanvas.tsx (REQ-06)', () => {
  it('selecting an element with a valid target offers "Depend on…"; choosing that target creates the dependency', () => {
    const outerSector = state().addSector({ name: 'API', ringRole: 'outer' })
    const domainSector = state().addSector({ name: 'Core', ringRole: 'domain' })
    const outerId = state().addElement({ name: 'Controller', sectorId: outerSector })
    const domainId = state().addElement({ name: 'Order', sectorId: domainSector })
    renderStage()
    fireEvent.click(screen.getByRole('button', { name: 'Controller (outer)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Depend on… from Controller' }))
    fireEvent.click(screen.getByRole('button', { name: 'Order (domain)' }))
    expect(state().map.dependencies).toHaveLength(1)
    expect(state().map.dependencies[0]).toMatchObject({ fromId: outerId, toId: domainId })
  })

  it('marks only the valid targets with data-link-target while linking, not the source or an outward element', () => {
    const outerSector = state().addSector({ name: 'API', ringRole: 'outer' })
    const appSector = state().addSector({ name: 'Core', ringRole: 'application' })
    const domainSector = state().addSector({ name: 'Domain', ringRole: 'domain' })
    const outerId = state().addElement({ name: 'Controller', sectorId: outerSector })
    const appId = state().addElement({ name: 'OrderService', sectorId: appSector })
    const domainId = state().addElement({ name: 'Order', sectorId: domainSector })
    const { container } = renderStage()
    const markedRef = (ref: string) => container.querySelector(`[data-ref="${ref}"]`)!.hasAttribute('data-link-target')

    fireEvent.click(screen.getByRole('button', { name: 'Controller (outer)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Depend on… from Controller' }))

    expect(markedRef(appId)).toBe(true)
    expect(markedRef(domainId)).toBe(true)
    expect(markedRef(outerId)).toBe(false)
  })

  it('choosing an invalid (outward) target while linking calls onReject, leaving the document unchanged (REQ-06)', () => {
    const domainSector = state().addSector({ name: 'Domain', ringRole: 'domain' })
    const appSector = state().addSector({ name: 'Core', ringRole: 'application' })
    const outerSector = state().addSector({ name: 'API', ringRole: 'outer' })
    state().addElement({ name: 'Order', sectorId: domainSector })
    state().addElement({ name: 'OrderService', sectorId: appSector })
    state().addElement({ name: 'Controller', sectorId: outerSector })
    const onReject = vi.fn()
    renderStage({ onReject })
    const before = state().map
    fireEvent.click(screen.getByRole('button', { name: 'OrderService (application)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Depend on… from OrderService' }))
    fireEvent.click(screen.getByRole('button', { name: 'Controller (outer)' })) // outward — invalid target

    expect(state().map).toBe(before)
    expect(state().map.dependencies).toEqual([])
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject.mock.calls[0][0]).toMatch(/same ring or a more inward one/)
  })
})
