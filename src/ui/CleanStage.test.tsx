import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { layoutClean } from '../layout/clean'
import { newCleanMap } from '../model/hexa'
import { useCleanStore } from '../model/cleanStore'
import type { CleanFile } from '../model/schema'
import { CleanStage } from './CleanStage'
import { usePreferencesStore } from './state/preferencesStore'

const state = () => useCleanStore.getState()

// RingedStage (the shared Onion/Clean viewport chrome) observes its own size, same as Hexagonal's own Stage.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
beforeEach(() => {
  state().replace(newCleanMap('Fresh architecture'))
})
afterEach(cleanup)

/** The stage as the app wires it: laid out fresh from the live store on every render — mirrors OnionStage's own
 * Harness (OnionStage.test.tsx). */
function Harness({ onReject = () => {}, onMutate = () => {} }: { onReject?: (message: string) => void; onMutate?: (message: string, before: CleanFile) => void } = {}) {
  const doc = useCleanStore((s) => s.map)
  const svgRef = createRef<SVGSVGElement>()
  return <CleanStage model={layoutClean(doc)} doc={doc} mode="detailed" svgRef={svgRef} onReject={onReject} onMutate={onMutate} />
}

const renderStage = (props?: { onReject?: (message: string) => void; onMutate?: (message: string, before: CleanFile) => void }) => render(<Harness {...props} />)

/** Reveals a ring's own "+" affordances (mirrors Hexagonal's own Stage.test.tsx `hover` helper, and OnionStage's
 * own) — hovering its band, same as a real pointer resting on the ring. */
const hoverRing = (container: HTMLElement, role: string) => fireEvent.pointerOver(container.querySelector(`[data-band="${role}"]`)!)

describe('CleanStage "+" affordances only show for the hovered/focused ring or element (no clutter, REQ-03/REQ-04)', () => {
  it('offers no "+" at all until a ring is hovered or focused', () => {
    const { container } = renderStage()
    expect(container.querySelectorAll('[data-plus]')).toHaveLength(0)
  })

  it('hovering a ring reveals only its own "+", not another ring\'s', () => {
    const { container } = renderStage()
    hoverRing(container, 'domain')
    expect(screen.getByRole('button', { name: 'Add sector to Entities' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add sector to Frameworks & Drivers' })).toBeNull()
  })

  it('a pointer-driven focus does not reveal "+" buttons, only a real keyboard focus does', () => {
    const { container } = renderStage()
    const band = container.querySelector('[data-band="domain"]')!
    fireEvent.pointerDown(band, { button: 0 })
    fireEvent.focus(band)
    expect(screen.queryByRole('button', { name: 'Add sector to Entities' })).toBeNull()
    fireEvent.pointerUp(band)
    fireEvent.focus(band)
    expect(screen.getByRole('button', { name: 'Add sector to Entities' })).toBeTruthy()
  })

  it('hovering the "+" itself does not hide it, but leaving the canvas entirely does', () => {
    const { container } = renderStage()
    const svg = container.querySelector('svg.canvas')!
    hoverRing(container, 'domain')
    const plus = screen.getByRole('button', { name: 'Add sector to Entities' })
    fireEvent.pointerOver(plus)
    expect(screen.getByRole('button', { name: 'Add sector to Entities' })).toBeTruthy()
    fireEvent.pointerLeave(svg, { relatedTarget: null })
    expect(screen.queryByRole('button', { name: 'Add sector to Entities' })).toBeNull()
  })
})

describe('CleanStage — sector/element "+" affordances (REQ-03/REQ-04)', () => {
  it('a ring\'s "+" adds a sector there (REQ-03)', () => {
    const { container } = renderStage()
    hoverRing(container, 'domain')
    fireEvent.click(screen.getByRole('button', { name: 'Add sector to Entities' }))
    expect(state().map.sectors).toHaveLength(1)
    expect(state().map.sectors[0].ringRole).toBe('domain')
  })

  it('a sector\'s "+" adds a named element there, immediately open for renaming (REQ-04)', () => {
    state().addSector({ name: 'Billing', ringRole: 'domain' })
    const { container } = renderStage()
    hoverRing(container, 'domain')
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
    const { container } = renderStage()
    hoverRing(container, 'domain')
    fireEvent.click(screen.getByRole('button', { name: 'Add element to Billing' }))
    expect(state().map.elements).toHaveLength(1)
    fireEvent.keyDown(screen.getByLabelText('element name'), { key: 'Escape' })
    expect(state().map.elements).toHaveLength(0)
  })

  it('an outer-ring element offers an actor and an external "+" while it is hovered; an inner one offers neither (REQ-07)', () => {
    const innerSector = state().addSector({ name: 'Core', ringRole: 'domain' })
    const outerSector = state().addSector({ name: 'API', ringRole: 'outer' })
    state().addElement({ name: 'Order', sectorId: innerSector })
    state().addElement({ name: 'Controller', sectorId: outerSector })
    renderStage()
    fireEvent.pointerOver(screen.getByRole('button', { name: 'Controller (outer)' }))
    expect(screen.getByRole('button', { name: 'Add an actor for Controller' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add an external system for Controller' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add an actor for Order' })).toBeNull()
  })

  it('an actor "+" creates the endpoint already targeting that outer-ring element', () => {
    const outerSector = state().addSector({ name: 'API', ringRole: 'outer' })
    state().addElement({ name: 'Controller', sectorId: outerSector })
    renderStage()
    fireEvent.pointerOver(screen.getByRole('button', { name: 'Controller (outer)' }))
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

describe('CleanStage — deleting the canvas selection with Delete/Backspace', () => {
  it('Delete removes the selected element and reports it for Undo, same message/mechanism as the editor panel', () => {
    const sectorId = state().addSector({ name: 'Billing', ringRole: 'domain' })
    state().addElement({ name: 'Invoice', sectorId })
    const onMutate = vi.fn()
    renderStage({ onMutate })
    const before = state().map
    fireEvent.click(screen.getByRole('button', { name: 'Invoice (domain)' }))
    fireEvent.keyDown(document.body, { key: 'Delete' })
    expect(state().map.elements).toHaveLength(0)
    expect(onMutate).toHaveBeenCalledWith('Deleted Invoice.', before)
  })

  it('Backspace does the same', () => {
    const sectorId = state().addSector({ name: 'Billing', ringRole: 'domain' })
    state().addElement({ name: 'Invoice', sectorId })
    renderStage()
    fireEvent.click(screen.getByRole('button', { name: 'Invoice (domain)' }))
    fireEvent.keyDown(document.body, { key: 'Backspace' })
    expect(state().map.elements).toHaveLength(0)
  })

  it('deletes a selected actor/external endpoint too', () => {
    const outerSector = state().addSector({ name: 'API', ringRole: 'outer' })
    const targetId = state().addElement({ name: 'Controller', sectorId: outerSector })
    state().addEndpoint('actors', { name: 'Customer', targetId })
    renderStage()
    fireEvent.click(screen.getByRole('button', { name: 'Actor Customer' }))
    fireEvent.keyDown(document.body, { key: 'Delete' })
    expect(state().map.actors).toHaveLength(0)
  })

  it('is ignored while the inline name field has the keyboard', () => {
    state().addSector({ name: 'Billing', ringRole: 'domain' })
    const { container } = renderStage()
    hoverRing(container, 'domain')
    fireEvent.click(screen.getByRole('button', { name: 'Add element to Billing' }))
    expect(state().map.elements).toHaveLength(1)
    fireEvent.keyDown(screen.getByLabelText('element name'), { key: 'Delete' })
    expect(state().map.elements).toHaveLength(1)
  })

  it('is ignored while linking (Depend on… gesture in progress)', () => {
    const outerSector = state().addSector({ name: 'API', ringRole: 'outer' })
    const domainSector = state().addSector({ name: 'Core', ringRole: 'domain' })
    state().addElement({ name: 'Controller', sectorId: outerSector })
    state().addElement({ name: 'Order', sectorId: domainSector })
    renderStage()
    fireEvent.click(screen.getByRole('button', { name: 'Controller (outer)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Depend on… from Controller' }))
    fireEvent.keyDown(document.body, { key: 'Delete' })
    expect(state().map.elements).toHaveLength(2)
  })

  it('Escape clears the selection, so a following Delete does nothing', () => {
    const sectorId = state().addSector({ name: 'Billing', ringRole: 'domain' })
    state().addElement({ name: 'Invoice', sectorId })
    renderStage()
    fireEvent.click(screen.getByRole('button', { name: 'Invoice (domain)' }))
    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.keyDown(document.body, { key: 'Delete' })
    expect(state().map.elements).toHaveLength(1)
  })
})

describe('CleanStage in view-only mode', () => {
  beforeEach(() => usePreferencesStore.setState({ viewOnly: true }))

  it('reveals no "+" on a hovered ring', () => {
    const { container } = renderStage()
    hoverRing(container, 'domain')
    expect(container.querySelectorAll('[data-plus]')).toHaveLength(0)
  })

  it('still selects an element, with no "Depend on…" chip', () => {
    const outerSector = state().addSector({ name: 'API', ringRole: 'outer' })
    const domainSector = state().addSector({ name: 'Core', ringRole: 'domain' })
    state().addElement({ name: 'Controller', sectorId: outerSector })
    state().addElement({ name: 'Order', sectorId: domainSector })
    renderStage()
    const element = screen.getByRole('button', { name: 'Controller (outer)' })
    fireEvent.click(element)
    expect(element.hasAttribute('data-selected')).toBe(true)
    expect(screen.queryByRole('button', { name: /Depend on…/ })).toBeNull()
  })

  it('leaves the document alone on Delete and Backspace', () => {
    const sectorId = state().addSector({ name: 'Billing', ringRole: 'domain' })
    state().addElement({ name: 'Invoice', sectorId })
    const onMutate = vi.fn()
    renderStage({ onMutate })
    fireEvent.click(screen.getByRole('button', { name: 'Invoice (domain)' }))
    fireEvent.keyDown(document.body, { key: 'Delete' })
    fireEvent.keyDown(document.body, { key: 'Backspace' })
    expect(state().map.elements).toHaveLength(1)
    expect(onMutate).not.toHaveBeenCalled()
  })
})
