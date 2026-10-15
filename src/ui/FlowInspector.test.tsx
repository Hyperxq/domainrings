import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { EXAMPLES } from '../model/example'
import { diagramOf } from '../model/map'
import { threadSlots } from '../model/threads'
import type { HexaMap, Hexagon } from '../model/schema'
import { useMapStore } from '../model/store'
import { FlowInspector } from './FlowInspector'
import { FlowsSection } from './FlowsSection'
import { PresentPanel } from './PresentPanel'
import { useHistoryStore } from './state/historyStore'
import { usePreferencesStore } from './state/preferencesStore'
import { useViewStore } from './state/viewStore'

const advanced = () => EXAMPLES.find((e) => e.id === 'hexagonal-advanced')!.map as HexaMap
const load = (edit: (h: Hexagon) => Hexagon = (h) => h) => {
  const map = advanced()
  useMapStore.getState().replace({ ...map, hexagons: map.hexagons.map((h) => (h.id === 'h1' ? edit(h) : h)) })
  useViewStore.setState({ focusedFlow: 'uc-place' })
}
const d = () => diagramOf(useMapStore.getState().map, 'h1')
const port = (name: string) => d().ports.find((p) => p.name === name)
const useCase = () => d().useCases.find((u) => u.id === 'uc-place')!
const type = (label: string, value: string) => {
  const field = screen.getByLabelText(label)
  fireEvent.focus(field)
  fireEvent.change(field, { target: { value } })
  fireEvent.blur(field)
}
const add = (label: string, value: string) => {
  const field = screen.getByLabelText(label) as HTMLInputElement
  fireEvent.change(field, { target: { value } })
  fireEvent.keyDown(field, { key: 'Enter' })
}
const undo = () => {
  const { map } = useMapStore.getState()
  useHistoryStore.getState().settle(map, 'h1')
  return useHistoryStore.getState().undo(map)
}

beforeEach(() => {
  load()
  usePreferencesStore.setState({ viewOnly: false })
  useViewStore.setState({ focusedFlow: 'uc-place', presentStep: null })
  useHistoryStore.setState({ stack: [], trusted: undefined, pending: null })
})
afterEach(cleanup)

describe('FlowInspector: thread colour', () => {
  it('colours the header dot with the flow thread slot', () => {
    render(<FlowInspector />)
    const slot = threadSlots(d()).get('uc-place')
    expect((document.querySelector('.flow-dot') as HTMLElement).style.getPropertyValue('--thread')).toBe(`var(--thread-${slot})`)
  })
})

describe('FlowInspector: visibility', () => {
  it('shows the focused flow in Edit mode', () => {
    render(<FlowInspector />)
    expect(screen.getByRole('complementary', { name: 'Flow inspector' })).toBeTruthy()
    expect((screen.getByLabelText('Flow name') as HTMLInputElement).value).toBe('PlaceOrder')
  })

  it('is absent in View mode, with no flow focused, and for a flow that is gone', () => {
    const { container, rerender } = render(<FlowInspector />)
    act(() => usePreferencesStore.setState({ viewOnly: true }))
    expect(container.firstChild).toBeNull()
    act(() => usePreferencesStore.setState({ viewOnly: false }))
    act(() => useViewStore.setState({ focusedFlow: 'uc-place' }))
    expect(container.firstChild).not.toBeNull()
    act(() => useViewStore.setState({ focusedFlow: null }))
    expect(container.firstChild).toBeNull()
    act(() => useViewStore.setState({ focusedFlow: 'uc-gone' }))
    rerender(<FlowInspector />)
    expect(container.firstChild).toBeNull()
  })

  it('closes with its close button', () => {
    render(<FlowInspector />)
    fireEvent.click(screen.getByRole('button', { name: 'Close flow' }))
    expect(useViewStore.getState().focusedFlow).toBeNull()
  })
})

describe('FlowInspector: reading the flow', () => {
  it('chains the actor, adapter and driving port of the entry', () => {
    render(<FlowInspector />)
    const entry = screen.getByRole('list', { name: 'Who starts it' })
    expect(entry.textContent).toMatch(/Web shop.*→.*orders\.routes.*→.*ordersApi/)
  })

  it('lists every call with its adapter and destination, local or in another hexagon', () => {
    render(<FlowInspector />)
    const calls = within(screen.getByRole('list', { name: 'What it calls' })).getAllByRole('listitem')
    expect(calls).toHaveLength(4)
    expect(calls[0].textContent).toMatch(/PaymentGateway.*→.*PaymentServiceClient.*→.*Payments.*chargePayment/)
    expect(calls[3].textContent).toMatch(/OrderRepository.*→.*KnexOrderRepository.*→.*Postgres/)
  })

  it('gives the footer note', () => {
    render(<FlowInspector />)
    expect(screen.getByText('2 · WHAT IT DECIDES WITH')).toBeTruthy()
    expect(screen.getByText("Typing a name that doesn't exist yet creates it. Position on the diagram is automatic.")).toBeTruthy()
  })
})

describe('FlowInspector: aggregates', () => {
  const chips = () => within(screen.getByRole('list', { name: 'What it decides with' })).queryAllByRole('listitem').map((li) => li.textContent)
  const aggregates = () => useCase().aggregateIds
  const named = (ids: string[], extra: Hexagon['domain'] = []) => load((h) => ({ ...h, domain: [...h.domain, { id: 'g-customer', name: 'Customer', type: 'aggregate' as const }, ...extra], useCases: h.useCases.map((u) => (u.id === 'uc-place' ? { ...u, aggregateIds: ids } : u)) }))

  it('shows a chip per aggregate the use case names, in order, and nothing for unknown ids', () => {
    named(['g-customer', 'gone', 'd-order'])
    render(<FlowInspector />)
    expect(chips()).toEqual(['◆ Customer', '◆ Order'])
  })

  it('removes an aggregate, dropping the field when it was the last, as one undo step', () => {
    named(['d-order'])
    render(<FlowInspector />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove aggregate Order' }))
    expect(aggregates()).toBeUndefined()
    undo()
    expect(aggregates()).toEqual(['d-order'])
  })

  it('links an existing root aggregate by name, ignoring case, without creating one', () => {
    render(<FlowInspector />)
    const before = d().domain.length
    add('Add aggregate', 'order')
    expect(aggregates()).toEqual(['d-order'])
    expect(d().domain).toHaveLength(before)
  })

  it('offers only root aggregates not yet linked', () => {
    named(['d-order'], [{ id: 'e', name: 'Line', type: 'entity' }, { id: 'n', name: 'Inner', type: 'aggregate', parentId: 'd-order' }])
    render(<FlowInspector />)
    const options = [...document.querySelectorAll(`#${CSS.escape(screen.getByLabelText('Add aggregate').getAttribute('list')!)} option`)].map((o) => (o as HTMLOptionElement).value)
    expect(options).toEqual(['Customer'])
  })

  it('creates a root aggregate for a name that matches none, links it, and undoes both together', () => {
    render(<FlowInspector />)
    add('Add aggregate', 'Basket')
    const basket = d().domain.find((i) => i.name === 'Basket')!
    expect(basket).toMatchObject({ type: 'aggregate' })
    expect(basket.parentId).toBeUndefined()
    expect(aggregates()).toEqual([basket.id])
    undo()
    expect(aggregates()).toBeUndefined()
    expect(d().domain.some((i) => i.name === 'Basket')).toBe(false)
  })

  it('refuses a blank name and an aggregate already linked, keeping the text', () => {
    named(['d-order'])
    render(<FlowInspector />)
    add('Add aggregate', ' ')
    expect(screen.getByText('Type a name first')).toBeTruthy()
    add('Add aggregate', 'Order')
    expect(screen.getByText('Already in this flow')).toBeTruthy()
    expect(aggregates()).toEqual(['d-order'])
  })

  it('writes a step note under the aggregate id when its chip is clicked', () => {
    named(['d-order'])
    render(<FlowInspector />)
    fireEvent.click(screen.getByRole('button', { name: '◆ Order' }))
    type('Note for Order', 'Locks the order.')
    expect(useCase().stepNotes).toEqual({ 'd-order': 'Locks the order.' })
  })
})

describe('FlowInspector: name and description', () => {
  it('renames the use case, as one undo step', () => {
    render(<FlowInspector />)
    type('Flow name', 'CheckOut')
    expect(useCase().name).toBe('CheckOut')
    expect(undo()).toMatchObject({ focus: 'h1' })
    expect(useCase().name).toBe('PlaceOrder')
  })

  it('writes the description, and clears it when emptied', () => {
    render(<FlowInspector />)
    type('What it does', 'Takes an order.')
    expect(useCase().description).toBe('Takes an order.')
    type('What it does', '')
    expect(useCase().description).toBeUndefined()
  })
})

describe('FlowInspector: what it calls', () => {
  it('edits the verb of a call, and clears it when emptied', () => {
    render(<FlowInspector />)
    type('Verb for PaymentGateway', 'charge')
    expect(port('PaymentGateway')!.verb).toBe('charge')
    type('Verb for PaymentGateway', '')
    expect(port('PaymentGateway')!.verb).toBeUndefined()
  })

  it('creates a driven port for a new name, and undoes it', () => {
    render(<FlowInspector />)
    add('Add a call', 'Mailer')
    expect(port('Mailer')).toMatchObject({ side: 'driven', useCaseId: 'uc-place', wall: 'e' })
    expect(d().ports).toHaveLength(6)
    undo()
    expect(port('Mailer')).toBeUndefined()
  })

  it('links an existing unlinked driven port instead of creating one, matching the name regardless of case', () => {
    load((h) => ({ ...h, ports: [...h.ports, { id: 'p-audit', name: 'AuditLog', side: 'driven' }] }))
    render(<FlowInspector />)
    add('Add a call', 'auditlog')
    expect(d().ports).toHaveLength(6)
    expect(d().ports.find((p) => p.id === 'p-audit')!.useCaseId).toBe('uc-place')
  })

  it('does nothing for an empty name or a port already in the flow', () => {
    render(<FlowInspector />)
    add('Add a call', '  ')
    add('Add a call', 'PaymentGateway')
    expect(d().ports).toHaveLength(5)
    expect(useHistoryStore.getState().stack).toHaveLength(0)
  })

  it('unlinks a call without deleting its port, adapter or map link', () => {
    render(<FlowInspector />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove call PaymentGateway' }))
    expect(port('PaymentGateway')).toMatchObject({ id: 'p-payment-out', useCaseId: undefined })
    expect(d().adapters.some((a) => a.id === 'a-payment-client')).toBe(true)
    expect(useMapStore.getState().map.links.some((l) => l.id === 'link-payment')).toBe(true)
    expect(within(screen.getByRole('list', { name: 'What it calls' })).getAllByRole('listitem')).toHaveLength(3)
    undo()
    expect(port('PaymentGateway')!.useCaseId).toBe('uc-place')
  })
})

describe('FlowInspector: who starts it', () => {
  it('creates a driving port for a new name', () => {
    render(<FlowInspector />)
    add('Add a way in', 'adminApi')
    expect(port('adminApi')).toMatchObject({ side: 'driving', useCaseId: 'uc-place', wall: 'w' })
    expect(within(screen.getByRole('list', { name: 'Who starts it' })).getAllByRole('listitem')).toHaveLength(2)
  })

  it('links an existing driving port, and ignores a driven port of that name', () => {
    load((h) => ({ ...h, ports: [...h.ports, { id: 'p-cli', name: 'cliApi', side: 'driving' }] }))
    render(<FlowInspector />)
    add('Add a way in', 'cliApi')
    expect(d().ports).toHaveLength(6)
    expect(port('cliApi')!.useCaseId).toBe('uc-place')
    add('Add a way in', 'PaymentGateway')
    expect(d().ports.filter((p) => p.name === 'PaymentGateway')).toHaveLength(2)
    expect(d().ports.filter((p) => p.name === 'PaymentGateway' && p.side === 'driving')).toHaveLength(1)
  })

  it('creates an adapter on the port, or links an existing one', () => {
    load((h) => ({ ...h, adapters: [...h.adapters, { id: 'a-free', name: 'cli.main' }] }))
    render(<FlowInspector />)
    add('Add adapter to ordersApi', 'graphql.routes')
    expect(d().adapters.find((a) => a.name === 'graphql.routes')!.portId).toBe('p-orders-api')
    add('Add adapter to ordersApi', 'cli.main')
    expect(d().adapters.filter((a) => a.name === 'cli.main')).toHaveLength(1)
    expect(d().adapters.find((a) => a.id === 'a-free')!.portId).toBe('p-orders-api')
  })

  it('creates an actor on the adapter, or links an existing one', () => {
    load((h) => ({ ...h, actors: [...h.actors, { id: 'act-free', name: 'Mobile app' }] }))
    render(<FlowInspector />)
    add('Add actor to orders.routes', 'Partner')
    expect(d().actors.find((a) => a.name === 'Partner')!.adapterId).toBe('a-rest')
    add('Add actor to orders.routes', 'mobile app')
    expect(d().actors).toHaveLength(3)
    expect(d().actors.find((a) => a.id === 'act-free')!.adapterId).toBe('a-rest')
  })
})

describe('FlowInspector: refused names', () => {
  const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement

  it('keeps the typed text and says why when the name is already in the flow, and clears once the text changes', () => {
    render(<FlowInspector />)
    add('Add a call', 'PaymentGateway')
    expect(input('Add a call').value).toBe('PaymentGateway')
    expect(input('Add a call').getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('Already in this flow').id).toBe(input('Add a call').getAttribute('aria-describedby'))
    fireEvent.change(input('Add a call'), { target: { value: 'Mailer' } })
    expect(screen.queryByText('Already in this flow')).toBeNull()
    expect(input('Add a call').getAttribute('aria-invalid')).toBeNull()
  })

  it('keeps an empty name refused with a reason, and clears the text after a name that was added', () => {
    render(<FlowInspector />)
    add('Add a call', '  ')
    expect(screen.getByText('Type a name first')).toBeTruthy()
    add('Add a call', 'Mailer')
    expect(input('Add a call').value).toBe('')
    expect(screen.queryByText('Type a name first')).toBeNull()
  })

  it('creates a new item when the only same-named one cannot be linked there, since names need not be unique', () => {
    render(<FlowInspector />)
    add('Add adapter to ordersApi', 'KnexOrderRepository')
    expect(d().adapters.filter((a) => a.name === 'KnexOrderRepository')).toHaveLength(2)
    expect(input('Add adapter to ordersApi').value).toBe('')
  })

  it('links a same-named item that is free even when another one of that name is already in the flow', () => {
    load((h) => ({ ...h, ports: [...h.ports, { id: 'p-dup', name: 'PaymentGateway', side: 'driven' }] }))
    render(<FlowInspector />)
    add('Add a call', 'PaymentGateway')
    expect(d().ports.find((p) => p.id === 'p-dup')!.useCaseId).toBe('uc-place')
  })
})

describe('FlowInspector: same-named items', () => {
  it('renders every same-named chip and option without a duplicate-key warning', () => {
    load((h) => ({
      ...h,
      adapters: [...h.adapters, { id: 'a-pay-2', name: 'PaymentServiceClient', portId: 'p-payment-out' }],
      externals: [...h.externals, { id: 'x-1', name: 'Stripe', adapterId: 'a-payment-client' }, { id: 'x-2', name: 'Stripe', adapterId: 'a-payment-client' }],
      actors: [...h.actors, { id: 'act-b1', name: 'Bot' }, { id: 'act-b2', name: 'Bot' }],
    }))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = render(<FlowInspector />)
    const payment = within(screen.getByRole('list', { name: 'What it calls' })).getAllByRole('listitem')[0]
    expect(within(payment).getAllByText('Stripe')).toHaveLength(2)
    expect(within(payment).getAllByText('PaymentServiceClient')).toHaveLength(2)
    expect(container.querySelectorAll('datalist option[value="Bot"]')).toHaveLength(2)
    expect(error.mock.calls.filter(([m]) => String(m).includes('same key'))).toEqual([])
    error.mockRestore()
  })
})

describe('FlowInspector: clearing the flow name', () => {
  it('leaves the use case unnamed and lists the flow as Unnamed', () => {
    render(
      <>
        <FlowsSection />
        <FlowInspector />
      </>,
    )
    type('Flow name', '')
    expect(useCase().name).toBe('')
    expect(screen.getByRole('button', { name: /^Unnamed/ })).toBeTruthy()
  })
})

describe('a new flow', () => {
  it('lands the caret in the inspector’s name field', () => {
    render(
      <>
        <FlowsSection />
        <FlowInspector />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: '+ New flow' }))
    const name = screen.getByLabelText('Flow name') as HTMLInputElement
    expect(name.value).toBe('NewUseCase')
    expect(document.activeElement).toBe(name)
  })
})

describe('FlowInspector: more', () => {
  it('deletes the flow, unfocuses it, and undoes', () => {
    render(<FlowInspector />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete flow' }))
    expect(d().useCases.some((u) => u.id === 'uc-place')).toBe(false)
    expect(useViewStore.getState().focusedFlow).toBeNull()
    undo()
    expect(useCase().name).toBe('PlaceOrder')
  })

  it('marks the flow planned and back, as one undo step', () => {
    render(<FlowInspector />)
    fireEvent.click(screen.getByLabelText('Flow planned'))
    expect(useCase().status).toBe('planned')
    undo()
    expect(useCase().status).toBeUndefined()
  })

  it('writes the note, and clears it when emptied', () => {
    render(<FlowInspector />)
    type('Note for flow', 'Owned by checkout.')
    expect(useCase().note).toBe('Owned by checkout.')
    type('Note for flow', '')
    expect(useCase().note).toBeUndefined()
  })

  it('places the flow on a wall, and back under the title', () => {
    render(<FlowInspector />)
    fireEvent.change(screen.getByLabelText('Flow placement'), { target: { value: 'ne' } })
    expect(useCase().placement).toBe('ne')
    fireEvent.change(screen.getByLabelText('Flow placement'), { target: { value: 'top' } })
    expect(useCase().placement).toBeUndefined()
    undo()
    expect(useCase().placement).toBe('ne')
  })
})

describe('FlowInspector: step notes', () => {
  const open = (name: string) => fireEvent.click(within(screen.getByRole('complementary', { name: 'Flow inspector' })).getAllByRole('button', { name })[0])

  it('reveals a note field when a step is clicked, and writes it under that element id', () => {
    render(<FlowInspector />)
    expect(screen.queryByLabelText('Note for orders.routes')).toBeNull()
    open('orders.routes')
    type('Note for orders.routes', 'Parses the JSON.')
    expect(useCase().stepNotes).toEqual({ 'a-rest': 'Parses the JSON.' })
    undo()
    expect(useCase().stepNotes).toBeUndefined()
  })

  it('drops the key, and the map, when the note is emptied', () => {
    render(<FlowInspector />)
    open('orders.routes')
    type('Note for orders.routes', 'x')
    type('Note for orders.routes', '')
    expect(useCase().stepNotes).toBeUndefined()
  })

  it('shows the written note in Present', () => {
    render(<FlowInspector />)
    open('orders.routes')
    type('Note for orders.routes', 'Parses the JSON.')
    cleanup()
    act(() => useViewStore.getState().present(1))
    render(<PresentPanel />)
    expect(screen.getByText('Parses the JSON.')).toBeTruthy()
  })
})
