import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Editor } from './Editor'
import { EXAMPLE_DIAGRAM } from '../model/example'
import { toMap } from '../model/hexa'
import { diagramOf } from '../model/map'
import { useMapStore } from '../model/store'
import { useViewStore } from './state/viewStore'
import { twoHexMap } from '../test/fixtures'

const noop = () => {}

beforeEach(() => {
  localStorage.clear()
  useMapStore.getState().replace(toMap(EXAMPLE_DIAGRAM))
  useViewStore.setState({ editorOpen: true })
})
afterEach(cleanup)

const renderEditor = (props: Partial<Parameters<typeof Editor>[0]> = {}) =>
  render(
    <Editor
      onAddHexagon={noop}
      onDeleteHexagon={noop}
      onMoveToContext={noop}
      onAddFromFile={async () => undefined}
      contextLabel="Billing"
      onRenameContext={noop}
      onCreateLink={noop}
      onUpdateLink={noop}
      onDeleteLink={noop}
      {...props}
    />,
  )

const h = twoHexMap().hexagons[0]
/** Billing: Invoices (h1, focused) and Payments (h2); Context 2: Shipping (h3). */
const billingAndShipping = () => {
  useMapStore.getState().replace({
    ...twoHexMap(),
    contexts: [{ id: 'c1', name: 'Billing' }, { id: 'c2' }],
    hexagons: [
      { ...h, title: 'Invoices' },
      { ...h, id: 'h2', cell: { q: 1, r: 0 }, title: 'Payments' },
      { ...h, id: 'h3', cell: { q: 2, r: 0 }, title: 'Shipping', contextId: 'c2' },
    ],
  })
}
/** The tree node's own heading: the panel head can repeat the focused subdomain's title. */
const node = (name: string) => screen.queryAllByRole('heading', { level: 2, name }).find((h) => h.id)
const header = (name: string) => node(name)!.closest('summary') as HTMLElement
const subdomain = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`[data-subdomain="${id}"]`)

describe('subdomain tree', () => {
  it('lists every bounded context, and the subdomains of each context once it is opened', () => {
    billingAndShipping()
    renderEditor()
    expect(node('Billing')).toBeTruthy()
    expect(node('Context 2')).toBeTruthy()
    expect(node('Invoices')).toBeTruthy()
    expect(node('Payments')).toBeTruthy()
    expect(node('Shipping')).toBeUndefined()

    fireEvent.click(header('Context 2'))

    expect(node('Shipping')).toBeTruthy()
    expect(screen.getByLabelText('Name for Context 2')).toBeTruthy()
  })

  it('opens only the focused subdomain; the others render their header and nothing else', () => {
    billingAndShipping()
    const { container } = renderEditor()
    expect(subdomain(container, 'h1')).not.toBeNull()
    expect(subdomain(container, 'h2')).toBeNull()
    expect(screen.getAllByRole('heading', { level: 2, name: 'Ports' })).toHaveLength(1)

    fireEvent.click(header('Payments'))

    expect(subdomain(container, 'h2')).not.toBeNull()
    expect(screen.getAllByRole('heading', { level: 2, name: 'Ports' })).toHaveLength(2)
    fireEvent.click(header('Payments'))
    expect(subdomain(container, 'h2')).toBeNull()
  })

  it('follows the focus: focusing a subdomain in another context opens its whole branch', () => {
    billingAndShipping()
    const { container } = renderEditor()
    expect(subdomain(container, 'h3')).toBeNull()

    act(() => useMapStore.getState().setFocus('h3'))

    expect(subdomain(container, 'h3')).not.toBeNull()
  })

  it('edits the subdomain whose section it is in, not the focused one', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = renderEditor()
    fireEvent.click(header('Second slice'))
    const first = EXAMPLE_DIAGRAM.ports[0]

    const name = within(subdomain(container, 'h2')!).getByDisplayValue(first.name)
    fireEvent.change(name, { target: { value: 'Renamed' } })

    const { map, focus } = useMapStore.getState()
    expect(focus).toBe('h1')
    expect(diagramOf(map, 'h2').ports.find((p) => p.id === first.id)?.name).toBe('Renamed')
    expect(diagramOf(map, 'h1').ports.find((p) => p.id === first.id)?.name).toBe(first.name)
  })

  it('runs add and delete for the subdomain whose button it is', () => {
    useMapStore.getState().replace(twoHexMap())
    const onAddHexagon = vi.fn()
    const onDeleteHexagon = vi.fn()
    const { container } = renderEditor({ onAddHexagon, onDeleteHexagon })
    fireEvent.click(header('Second slice'))
    const second = within(subdomain(container, 'h2')!)

    fireEvent.click(second.getByRole('button', { name: 'Add subdomain' }))
    fireEvent.click(second.getByRole('button', { name: 'Delete subdomain' }))

    expect(onAddHexagon).toHaveBeenCalledWith('h2')
    expect(onDeleteHexagon).toHaveBeenCalledWith('h2')
  })

  it('says subdomain, not hexagon, in the panel', () => {
    const { container } = renderEditor()
    const body = within(subdomain(container, 'h1')!)
    expect(body.getByLabelText('Subdomain title')).toBeTruthy()
    expect(body.getByRole('button', { name: 'Add subdomain' })).toBeTruthy()
    expect(body.getByRole('button', { name: 'Delete subdomain' })).toBeTruthy()
    expect(screen.queryByLabelText('Hexagon title')).toBeNull()
    expect(screen.queryByText('Other bounded contexts')).toBeNull()
  })
})

describe('revealing from the canvas', () => {
  it('opens the context and subdomain branch of a collapsed element and focuses its field', () => {
    billingAndShipping()
    const { container } = renderEditor()
    expect(subdomain(container, 'h3')).toBeNull()
    const port = EXAMPLE_DIAGRAM.ports[0]

    act(() => useViewStore.getState().reveal(port.id, true, 'h3'))

    const field = document.activeElement as HTMLInputElement
    expect(subdomain(container, 'h3')!.contains(field)).toBe(true)
    expect(field.value).toBe(port.name)
  })

  it('finds the element in the subdomain it was double-clicked in when ids repeat across subdomains', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = renderEditor()
    const port = EXAMPLE_DIAGRAM.ports[0]

    act(() => useViewStore.getState().reveal(port.id, true, 'h2'))

    expect(subdomain(container, 'h2')!.contains(document.activeElement)).toBe(true)
  })
})
