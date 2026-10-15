import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Editor } from './Editor'
import { EXAMPLE_DIAGRAM } from '../model/example'
import { toMap } from '../model/hexa'
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

const renderEditor = () =>
  render(
    <Editor onAddHexagon={noop} onDeleteHexagon={noop} onMoveToContext={noop} onAddFromFile={async () => undefined} contextLabel="Context 1" onRenameContext={noop} onCreateLink={noop} onUpdateLink={noop} onDeleteLink={noop} />,
  )
const group = (container: HTMLElement, title: string) =>
  [...container.querySelectorAll('details')].find((d) => d.querySelector(':scope > summary h2')?.textContent === title) as HTMLDetailsElement
const SETTINGS = 'Diagram settings · layers, titles'
const counts: [string, number][] = [
  ['Domain', EXAMPLE_DIAGRAM.domain.length],
  ['Use cases', EXAMPLE_DIAGRAM.useCases.length],
  ['Ports', EXAMPLE_DIAGRAM.ports.length],
  ['Adapters', EXAMPLE_DIAGRAM.adapters.length],
  ['Actors', EXAMPLE_DIAGRAM.actors.length],
  ['External systems', EXAMPLE_DIAGRAM.externals.length],
]

describe('Elements', () => {
  it('lists every collection as a collapsed group with its count', () => {
    const { container } = renderEditor()
    expect(screen.getByRole('heading', { level: 2, name: 'Elements' })).toBeTruthy()
    for (const [title, count] of counts) {
      expect(group(container, title).open).toBe(false)
      expect(group(container, title).querySelector('summary')!.textContent).toBe(`${title}· ${count}`)
    }
  })

  it('shows the existing items of a group once it is expanded', () => {
    const { container } = renderEditor()
    fireEvent.click(group(container, 'Ports').querySelector('summary')!)
    expect(group(container, 'Ports').open).toBe(true)
    expect(within(group(container, 'Ports')).getByDisplayValue(EXAMPLE_DIAGRAM.ports[0].name)).toBeTruthy()
    expect(group(container, 'Adapters').open).toBe(false)
  })

  it('opens the group of an element revealed from the canvas', () => {
    const { container } = renderEditor()
    const port = EXAMPLE_DIAGRAM.ports[0]

    act(() => useViewStore.getState().reveal(port.id, true, 'h1'))

    expect(group(container, 'Ports').open).toBe(true)
    expect(group(container, 'Adapters').open).toBe(false)
    expect((document.activeElement as HTMLInputElement).value).toBe(port.name)
  })

  it('keeps the use case fields (placement, planned, note, remove) reachable', () => {
    const { container } = renderEditor()
    const useCases = within(group(container, 'Use cases'))
    expect(useCases.getAllByLabelText('Placement').length).toBeGreaterThan(0)
    expect(useCases.getAllByRole('button', { name: /^Remove use case/ }).length).toBeGreaterThan(0)
    expect(useCases.getAllByText('Note').length).toBeGreaterThan(0)
  })
})

describe('Links', () => {
  it('is offered only once the map has more than one hexagon', () => {
    const { container, unmount } = renderEditor()
    expect(group(container, 'Links')).toBeUndefined()
    unmount()
    useMapStore.getState().replace(twoHexMap())
    expect(group(renderEditor().container, 'Links').open).toBe(false)
  })
})

describe('Diagram settings', () => {
  it('starts collapsed and holds the map, context, subdomain and layer fields', () => {
    const { container } = renderEditor()
    const settings = group(container, SETTINGS)
    expect(settings.open).toBe(false)
    const inside = within(settings)
    for (const label of ['Map title', 'Name for Context 1', 'Subdomain title', 'Composition root']) expect(inside.getByLabelText(label)).toBeTruthy()
    expect(inside.getByRole('button', { name: 'Add subdomain' })).toBeTruthy()
    expect(inside.getByRole('button', { name: 'Delete subdomain' })).toBeTruthy()
    expect(inside.getByRole('heading', { level: 2, name: 'Layers' })).toBeTruthy()
  })

  it('opens, with its Layers fold, for a layer revealed from the canvas', () => {
    localStorage.setItem('domainrings:editor-sections', JSON.stringify({ 'h1:layers': false }))
    const { container } = renderEditor()

    act(() => useViewStore.getState().reveal('layer:application', true, 'h1'))

    expect(group(container, SETTINGS).open).toBe(true)
    expect(group(container, 'Layers').open).toBe(true)
  })

  it('renames every occupied context from here, with no tree of subdomains', () => {
    useMapStore.getState().replace({ ...twoHexMap(), contexts: [{ id: 'c1' }, { id: 'c2' }], hexagons: twoHexMap().hexagons.map((h, i) => ({ ...h, contextId: `c${i + 1}` })) })
    renderEditor()
    expect(screen.getByLabelText('Name for Context 1')).toBeTruthy()
    expect(screen.getByLabelText('Name for Context 2')).toBeTruthy()
  })

  it('shows only the current subdomain, with no tree to navigate the others', () => {
    useMapStore.getState().replace(twoHexMap())
    renderEditor()
    expect(screen.getAllByLabelText('Subdomain title')).toHaveLength(1)
    expect(screen.queryByRole('heading', { level: 2, name: 'Second slice' })).toBeNull()
  })
})
