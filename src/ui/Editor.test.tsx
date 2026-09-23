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
    fireEvent.click(screen.getByRole('button', { name: 'Add port' }))
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
