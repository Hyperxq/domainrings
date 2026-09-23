import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Editor, revealInEditor } from './Editor'
import { EXAMPLE_DIAGRAM } from '../model/example'
import { useDiagramStore } from '../model/store'

const SECTIONS_KEY = 'domainrings:editor-sections'

beforeEach(() => {
  localStorage.clear()
  useDiagramStore.getState().replace(EXAMPLE_DIAGRAM)
})
afterEach(cleanup)

const renderEditor = () => render(<Editor open onToggle={() => {}} />)
const section = (container: HTMLElement, title: string) =>
  [...container.querySelectorAll('details')].find((d) => d.querySelector(':scope > summary h2')?.textContent === title) as HTMLDetailsElement
const port = EXAMPLE_DIAGRAM.ports[0]

describe('collapsible editor sections', () => {
  it('starts with every section open, each summary showing its title and item count', () => {
    const { container } = renderEditor()
    const titles = ['Diagram', 'Layers', 'Domain', 'Use cases', 'Ports', 'Adapters', 'Actors', 'External systems']
    for (const title of titles) expect(section(container, title).open).toBe(true)
    expect(section(container, 'Ports').querySelector('summary')!.textContent).toBe(`Ports· ${EXAMPLE_DIAGRAM.ports.length}`)
  })

  it('hides a section’s cards when its summary is clicked, and remembers it across mounts', () => {
    const { container, unmount } = renderEditor()
    fireEvent.click(section(container, 'Ports').querySelector('summary')!)
    expect(section(container, 'Ports').open).toBe(false)
    expect(JSON.parse(localStorage.getItem(SECTIONS_KEY)!)).toEqual({ ports: false })

    unmount()
    const again = renderEditor().container
    expect(section(again, 'Ports').open).toBe(false)
    expect(section(again, 'Adapters').open).toBe(true)
  })

  it('adds an item from the "+" without toggling the section', () => {
    const { container } = renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Add a driving port' }))
    expect(section(container, 'Ports').open).toBe(true)
    expect(useDiagramStore.getState().diagram.ports).toHaveLength(EXAMPLE_DIAGRAM.ports.length + 1)
  })

  it('opens a collapsed section before revealing a card in it', () => {
    localStorage.setItem(SECTIONS_KEY, JSON.stringify({ ports: false }))
    const { container } = renderEditor()
    expect(section(container, 'Ports').open).toBe(false)

    revealInEditor(port.id, true)

    expect(section(container, 'Ports').open).toBe(true)
    expect((document.activeElement as HTMLInputElement).value).toBe(port.name)
  })
})

describe('ports: side chosen at creation, cards grouped by side', () => {
  const group = (container: HTMLElement, heading: string) => {
    const h = [...container.querySelectorAll('h3')].find((e) => e.textContent!.startsWith(heading))
    if (!h) throw new Error(`no group ${heading}`)
    return h.closest('.port-group')!
  }
  const namesIn = (el: Element) => [...el.querySelectorAll<HTMLInputElement>('input.name')].map((i) => i.value)
  const portsOf = (side: 'driving' | 'driven') => useDiagramStore.getState().diagram.ports.filter((p) => p.side === side)

  it.each([
    ['Add a driving port', 'driving', 'w'],
    ['Add a driven port', 'driven', 'e'],
  ] as const)('%s creates a %s port on its default wall and puts the caret in its name', (label, side, wall) => {
    const { container } = renderEditor()
    fireEvent.click(screen.getByRole('button', { name: label }))
    const created = useDiagramStore.getState().diagram.ports.at(-1)!
    expect(created).toMatchObject({ side, wall })
    const input = document.activeElement as HTMLInputElement
    expect(container.querySelector(`[data-item-id="${created.id}"]`)!.contains(input)).toBe(true)
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, created.name.length])
  })

  it('shows the side as visible text on the buttons, in the kind’s own words', () => {
    renderEditor()
    expect(screen.getByRole('button', { name: 'Add a driving port' }).textContent).toBe('+ driving')
    expect(screen.getByRole('button', { name: 'Add a driven port' }).textContent).toBe('+ driven')
    cleanup()
    useDiagramStore.getState().replace({ ...EXAMPLE_DIAGRAM, kind: 'clean' })
    const { container } = renderEditor()
    expect(screen.getByRole('button', { name: 'Add an input port' }).textContent).toBe('+ input')
    expect(screen.getByRole('button', { name: 'Add an output port' }).textContent).toBe('+ output')
    expect(group(container, 'Input ports').querySelector('h3')!.textContent).toBe(`Input ports · ${portsOf('driving').length}`)
  })

  it('groups the port cards under their side', () => {
    const { container } = renderEditor()
    expect(namesIn(group(container, 'Driving ports'))).toEqual(portsOf('driving').map((p) => p.name))
    expect(namesIn(group(container, 'Driven ports'))).toEqual(portsOf('driven').map((p) => p.name))
    expect(group(container, 'Driven ports').querySelector('h3')!.textContent).toBe(`Driven ports · ${portsOf('driven').length}`)
  })

  it('moves a card to the other group when its side changes, dropping its wall', () => {
    useDiagramStore.getState().updateItem('ports', port.id, { wall: port.side === 'driving' ? 'nw' : 'ne' })
    const { container } = renderEditor()
    const other = port.side === 'driving' ? 'driven' : 'driving'
    const select = container.querySelector(`[data-item-id="${port.id}"] select`) as HTMLSelectElement
    fireEvent.change(select, { target: { value: other } })
    expect(useDiagramStore.getState().diagram.ports.find((p) => p.id === port.id)).toMatchObject({ side: other, wall: undefined })
    expect(namesIn(group(container, other === 'driving' ? 'Driving ports' : 'Driven ports'))).toContain(port.name)
    expect(namesIn(group(container, other === 'driving' ? 'Driven ports' : 'Driving ports'))).not.toContain(port.name)
  })
})

describe('use case placement', () => {
  const uc = EXAMPLE_DIAGRAM.useCases[0]
  const placementOf = () => useDiagramStore.getState().diagram.useCases.find((u) => u.id === uc.id)!.placement

  it('offers the stack under the title or any wall, in hexagons only', () => {
    const { container } = renderEditor()
    const select = container.querySelector<HTMLSelectElement>(`[data-item-id="${uc.id}"] select[aria-label="Placement"]`)!
    expect([...select.options].map((o) => o.textContent)).toEqual(['Under the title', 'North-west', 'West', 'South-west', 'North-east', 'East', 'South-east'])
    fireEvent.change(select, { target: { value: 'nw' } })
    expect(placementOf()).toBe('nw')
    fireEvent.change(select, { target: { value: 'top' } })
    expect(placementOf()).toBeUndefined()
    cleanup()
    useDiagramStore.getState().replace({ ...EXAMPLE_DIAGRAM, kind: 'clean' })
    expect(renderEditor().container.querySelector(`[data-item-id="${uc.id}"] select[aria-label="Placement"]`)).toBeNull()
  })
})
