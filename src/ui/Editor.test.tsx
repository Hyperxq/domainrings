import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Editor, revealInEditor } from './Editor'
import { EXAMPLE_DIAGRAM } from '../model/example'
import { toMap } from '../model/hexa'
import { neighbour, SIDE_ORDER } from '../model/map'
import { useMapStore } from '../model/store'
import type { HexaMap } from '../model/schema'
import { card, currentDiagram, linkedTwoHexMap, twoHexMap } from '../test/fixtures'
import type { LinkEnd } from '../model/schema'

const SECTIONS_KEY = 'domainrings:editor-sections'

beforeEach(() => {
  localStorage.clear()
  useMapStore.getState().replace(toMap(EXAMPLE_DIAGRAM))
})
afterEach(cleanup)

const renderEditor = (
  onAddHexagon: () => void = () => {},
  onDeleteHexagon: () => void = () => {},
  onAddFromFile: (file: File, context: 'same' | 'new', opener: HTMLElement | null) => void = () => {},
  contextLabel = 'Context 1',
  onRenameContext: (before: HexaMap, contextId: string) => void = () => {},
  onCreateLink: (from: LinkEnd, to: LinkEnd) => void = () => {},
  onUpdateLink: (id: string, patch: import('../model/map').LinkPatch) => void = () => {},
  onDeleteLink: (id: string) => void = () => {},
) =>
  render(
    <Editor
      open
      onToggle={() => {}}
      onPrune={() => {}}
      onAddHexagon={onAddHexagon}
      onDeleteHexagon={onDeleteHexagon}
      onAddFromFile={onAddFromFile}
      contextLabel={contextLabel}
      onRenameContext={onRenameContext}
      onCreateLink={onCreateLink}
      onUpdateLink={onUpdateLink}
      onDeleteLink={onDeleteLink}
    />,
  )
const section = (container: HTMLElement, title: string) =>
  [...container.querySelectorAll('details')].find((d) => d.querySelector(':scope > summary h2')?.textContent === title) as HTMLDetailsElement
const port = EXAMPLE_DIAGRAM.ports[0]

describe('collapsible editor sections', () => {
  it('starts with every section open, each summary showing its title and item count', () => {
    const { container } = renderEditor()
    const titles = ['Map', 'Hexagon', 'Layers', 'Domain', 'Use cases', 'Ports', 'Adapters', 'Actors', 'External systems']
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
    expect(currentDiagram().ports).toHaveLength(EXAMPLE_DIAGRAM.ports.length + 1)
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

describe('map and hexagon titles (TITLE-01, TITLE-02)', () => {
  it('shows distinct, clearly labelled Map and Hexagon title fields, and no field labelled plain "Title" (TITLE-02.1)', () => {
    const { container } = renderEditor()
    const mapSection = within(section(container, 'Map'))
    const hexagonSection = within(section(container, 'Hexagon'))
    expect(mapSection.getByLabelText('Map title')).toBeInstanceOf(HTMLInputElement)
    expect(hexagonSection.getByLabelText('Hexagon title')).toBeInstanceOf(HTMLInputElement)
    expect(hexagonSection.getByLabelText('Subtitle')).toBeInstanceOf(HTMLInputElement)
    expect(mapSection.queryByText('Title', { selector: 'label > span' })).toBeNull()
    expect(hexagonSection.queryByText('Title', { selector: 'label > span' })).toBeNull()
    expect(screen.queryByText('Title', { selector: 'label > span', exact: true })).toBeNull()
  })

  it('names the current hexagon in the panel header, falling back to "Untitled hexagon" (TITLE-02.1)', () => {
    renderEditor()
    expect(screen.getByRole('heading', { level: 2, name: EXAMPLE_DIAGRAM.title })).toBeInstanceOf(HTMLHeadingElement)

    cleanup()
    useMapStore.getState().replace(toMap({ ...EXAMPLE_DIAGRAM, title: '' }))
    renderEditor()
    expect(screen.getByRole('heading', { level: 2, name: 'Untitled hexagon' })).toBeInstanceOf(HTMLHeadingElement)
  })

  it('editing the map title updates only the map, leaving every hexagon untouched (TITLE-01.1)', () => {
    const base = toMap(EXAMPLE_DIAGRAM)
    const otherHexagon = { ...base.hexagons[0], id: 'h2', cell: { q: 1, r: 0 }, title: 'Second slice' }
    useMapStore.getState().replace({ ...base, hexagons: [base.hexagons[0], otherHexagon] })
    const { container } = renderEditor()
    const mapTitleInput = within(section(container, 'Map')).getByLabelText('Map title')

    fireEvent.change(mapTitleInput, { target: { value: 'Renamed map' } })

    expect(useMapStore.getState().map.title).toBe('Renamed map')
    expect(currentDiagram()).toMatchObject({ title: EXAMPLE_DIAGRAM.title, subtitle: EXAMPLE_DIAGRAM.subtitle })
    expect(useMapStore.getState().map.hexagons[1]).toBe(otherHexagon)
    expect((card(container, 'hexagon').querySelector('input') as HTMLInputElement).value).toBe(EXAMPLE_DIAGRAM.title)
  })
})

describe('"Add hexagon" button in the Hexagon section (GROW-04)', () => {
  it('is enabled and calls onAddHexagon when the current hexagon has a free side', () => {
    const onAddHexagon = vi.fn()
    const { container } = renderEditor(onAddHexagon)
    const button = within(section(container, 'Hexagon')).getByRole('button', { name: 'Add hexagon' })
    expect(button.hasAttribute('aria-disabled')).toBe(false)

    fireEvent.click(button)

    expect(onAddHexagon).toHaveBeenCalledOnce()
  })

  it('is aria-disabled, keyboard-reachable, and hinted when the current hexagon is surrounded (GROW-04.1)', () => {
    const base = toMap(EXAMPLE_DIAGRAM)
    const centre = base.hexagons[0]
    const ring = SIDE_ORDER.map((s, i) => ({ ...centre, id: `ring${i}`, cell: neighbour(centre.cell, s) }))
    useMapStore.getState().replace({ ...base, hexagons: [centre, ...ring] })
    const onAddHexagon = vi.fn()
    const { container } = renderEditor(onAddHexagon)
    const button = within(section(container, 'Hexagon')).getByRole('button', { name: 'Add hexagon' })

    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.hasAttribute('disabled')).toBe(false)
    const hint = document.getElementById(button.getAttribute('aria-describedby')!)
    expect(hint?.textContent).toBe('No free side around this hexagon.')

    fireEvent.click(button)
    expect(onAddHexagon).not.toHaveBeenCalled()
  })
})

describe('"Delete hexagon" button in the Hexagon section (DEL-01)', () => {
  it('is enabled and calls onDeleteHexagon when the map has more than one hexagon', () => {
    useMapStore.getState().replace(twoHexMap())
    const onDeleteHexagon = vi.fn()
    const { container } = renderEditor(() => {}, onDeleteHexagon)
    const button = within(section(container, 'Hexagon')).getByRole('button', { name: 'Delete hexagon' })
    expect(button.hasAttribute('aria-disabled')).toBe(false)

    fireEvent.click(button)

    expect(onDeleteHexagon).toHaveBeenCalledOnce()
  })

  it('is aria-disabled, keyboard-reachable, and hinted on the map’s last hexagon (DEL-01.2)', () => {
    const onDeleteHexagon = vi.fn()
    const { container } = renderEditor(() => {}, onDeleteHexagon)
    const button = within(section(container, 'Hexagon')).getByRole('button', { name: 'Delete hexagon' })

    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.hasAttribute('disabled')).toBe(false)
    const hint = document.getElementById(button.getAttribute('aria-describedby')!)
    expect(hint?.textContent).toBe('A map needs at least one hexagon.')
    expect(hint?.className).toBe('hint')

    fireEvent.click(button)
    expect(onDeleteHexagon).not.toHaveBeenCalled()
  })
})

describe('Bounded contexts (NAME-01..03, CB-05.2)', () => {
  it('shows one input per context, labelled by its stable ordinal, with the name (or none) as its value', () => {
    const { container } = renderEditor()
    const input = within(section(container, 'Bounded contexts')).getByLabelText('Name for Context 1') as HTMLInputElement
    expect(input.value).toBe('')
  })

  it('typing a name updates the store immediately, so the chip can follow live (NAME-02.1)', () => {
    const contextId = useMapStore.getState().map.contexts[0].id
    const { container } = renderEditor()
    const input = within(section(container, 'Bounded contexts')).getByLabelText('Name for Context 1')

    fireEvent.change(input, { target: { value: 'Billing' } })

    expect(useMapStore.getState().map.contexts.find((c) => c.id === contextId)?.name).toBe('Billing')
  })

  it('reports the pre-edit map on blur when the name actually changed (NAME-03.1)', () => {
    const onRenameContext = vi.fn()
    const contextId = useMapStore.getState().map.contexts[0].id
    const beforeMap = useMapStore.getState().map
    const { container } = renderEditor(() => {}, () => {}, () => {}, 'Context 1', onRenameContext)
    const input = within(section(container, 'Bounded contexts')).getByLabelText('Name for Context 1')

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Billing' } })
    expect(onRenameContext).not.toHaveBeenCalled()

    fireEvent.blur(input)

    expect(onRenameContext).toHaveBeenCalledOnce()
    expect(onRenameContext).toHaveBeenCalledWith(beforeMap, contextId)
  })

  it('keeps a trailing space live while typing, trimming only when the rename commits on blur (NAME-02.3)', () => {
    const contextId = useMapStore.getState().map.contexts[0].id
    const { container } = renderEditor()
    const input = within(section(container, 'Bounded contexts')).getByLabelText('Name for Context 1') as HTMLInputElement

    fireEvent.change(input, { target: { value: 'Order ' } })
    expect(input.value).toBe('Order ')
    expect(useMapStore.getState().map.contexts.find((c) => c.id === contextId)?.name).toBe('Order ')

    fireEvent.blur(input)

    expect(useMapStore.getState().map.contexts.find((c) => c.id === contextId)?.name).toBe('Order')
  })

  it('a whitespace-only name clears to the placeholder once the rename commits on blur (NAME-02.3)', () => {
    const contextId = useMapStore.getState().map.contexts[0].id
    const { container } = renderEditor()
    const input = within(section(container, 'Bounded contexts')).getByLabelText('Name for Context 1') as HTMLInputElement

    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)

    expect(useMapStore.getState().map.contexts.find((c) => c.id === contextId)).toEqual({ id: contextId })
    expect(input.value).toBe('')
    expect(input.placeholder).toBe('Context 1')
  })

  it('reports the rename with the trimmed name, not the untrimmed keystroke value (NAME-03.1, NAME-02.3)', () => {
    const onRenameContext = vi.fn()
    const contextId = useMapStore.getState().map.contexts[0].id
    const { container } = renderEditor(() => {}, () => {}, () => {}, 'Context 1', onRenameContext)
    const input = within(section(container, 'Bounded contexts')).getByLabelText('Name for Context 1')

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '  Billing ' } })
    fireEvent.blur(input)

    expect(onRenameContext).toHaveBeenCalledOnce()
    const [, renamedId] = onRenameContext.mock.calls[0]
    expect(renamedId).toBe(contextId)
    expect(useMapStore.getState().map.contexts.find((c) => c.id === contextId)?.name).toBe('Billing')
  })

  it('does not report a blur that never changed the name', () => {
    const onRenameContext = vi.fn()
    const { container } = renderEditor(() => {}, () => {}, () => {}, 'Context 1', onRenameContext)
    const input = within(section(container, 'Bounded contexts')).getByLabelText('Name for Context 1')

    fireEvent.focus(input)
    fireEvent.blur(input)

    expect(onRenameContext).not.toHaveBeenCalled()
  })

  it('the Hexagon section shows the current hexagon’s bounded context as read-only text, with no rename input', () => {
    const { container } = renderEditor(() => {}, () => {}, () => {}, 'Billing')
    const hexagonSection = section(container, 'Hexagon')
    expect(within(hexagonSection).getByText('Billing')).toBeTruthy()
    expect(within(hexagonSection).queryByLabelText('Name for Context 1')).toBeNull()
  })
})

describe('"Add hexagon from file…" in the Map section (IMP-01, IMP-01.4)', () => {
  const openMenu = (container: HTMLElement) =>
    fireEvent.click(within(section(container, 'Map')).getByRole('button', { name: 'Add hexagon from file…' }))

  it('offers "Import into {context}" and "Import into a new bounded context"', () => {
    const { container } = renderEditor(() => {}, () => {}, () => {}, 'Billing')
    openMenu(container)
    expect(within(section(container, 'Map')).getByRole('menuitem', { name: 'Import into Billing' })).toBeTruthy()
    expect(within(section(container, 'Map')).getByRole('menuitem', { name: 'Import into a new bounded context' })).toBeTruthy()
  })

  it('choosing "Import into {context}" opens the hidden file input before onAddFromFile fires, then reports the picked file with "same"', () => {
    const onAddFromFile = vi.fn()
    const { container } = renderEditor(() => {}, () => {}, onAddFromFile, 'Billing')
    const trigger = within(section(container, 'Map')).getByRole('button', { name: 'Add hexagon from file…' })
    openMenu(container)

    fireEvent.click(screen.getByRole('menuitem', { name: 'Import into Billing' }))
    expect(onAddFromFile).not.toHaveBeenCalled()
    const file = new File(['{}'], 'billing.hexa', { type: 'application/json' })
    const input = screen.getByLabelText('Add hexagon from a .hexa file') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    expect(onAddFromFile).toHaveBeenCalledOnce()
    expect(onAddFromFile).toHaveBeenCalledWith(file, 'same', trigger)
    expect(input.value).toBe('')
  })

  it('choosing "Import into a new bounded context" reports the picked file with "new"', () => {
    const onAddFromFile = vi.fn()
    const { container } = renderEditor(() => {}, () => {}, onAddFromFile)
    openMenu(container)

    fireEvent.click(screen.getByRole('menuitem', { name: 'Import into a new bounded context' }))
    const file = new File(['{}'], 'billing.hexa', { type: 'application/json' })
    fireEvent.change(screen.getByLabelText('Add hexagon from a .hexa file'), { target: { files: [file] } })

    expect(onAddFromFile).toHaveBeenCalledWith(file, 'new', expect.anything())
  })

  it('does not call onAddFromFile when the file picker is cancelled (no file chosen)', () => {
    const onAddFromFile = vi.fn()
    const { container } = renderEditor(() => {}, () => {}, onAddFromFile)
    openMenu(container)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import into a new bounded context' }))

    fireEvent.change(screen.getByLabelText('Add hexagon from a .hexa file'), { target: { files: [] } })

    expect(onAddFromFile).not.toHaveBeenCalled()
  })
})

describe('ports: side chosen at creation, cards grouped by side', () => {
  const group = (container: HTMLElement, heading: string) => {
    const h = [...container.querySelectorAll('h3')].find((e) => e.textContent!.startsWith(heading))
    if (!h) throw new Error(`no group ${heading}`)
    return h.closest('.port-group')!
  }
  const namesIn = (el: Element) => [...el.querySelectorAll<HTMLInputElement>('input.name')].map((i) => i.value)
  const portsOf = (side: 'driving' | 'driven') => currentDiagram().ports.filter((p) => p.side === side)

  it.each([
    ['Add a driving port', 'driving', 'w'],
    ['Add a driven port', 'driven', 'e'],
  ] as const)('%s creates a %s port on its default wall and puts the caret in its name', (label, side, wall) => {
    const { container } = renderEditor()
    fireEvent.click(screen.getByRole('button', { name: label }))
    const created = currentDiagram().ports.at(-1)!
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
    useMapStore.getState().replace(toMap({ ...EXAMPLE_DIAGRAM, kind: 'clean' }))
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
    useMapStore.getState().updateItem(useMapStore.getState().focus, 'ports', port.id, { wall: port.side === 'driving' ? 'nw' : 'ne' })
    const { container } = renderEditor()
    const other = port.side === 'driving' ? 'driven' : 'driving'
    const select = container.querySelector(`[data-item-id="${port.id}"] select`) as HTMLSelectElement
    fireEvent.change(select, { target: { value: other } })
    expect(currentDiagram().ports.find((p) => p.id === port.id)).toMatchObject({ side: other, wall: undefined })
    expect(namesIn(group(container, other === 'driving' ? 'Driving ports' : 'Driven ports'))).toContain(port.name)
    expect(namesIn(group(container, other === 'driving' ? 'Driven ports' : 'Driving ports'))).not.toContain(port.name)
  })
})

describe('Links section (REQ-LNK-01, REQ-LNK-07)', () => {
  it('shows the section with a count of every link in the map', () => {
    useMapStore.getState().replace(linkedTwoHexMap())
    const { container } = renderEditor()
    expect(section(container, 'Links').querySelector('summary')!.textContent).toBe('Links· 1')
  })

  it('lists each existing link by its two ends’ hexagon and port names', () => {
    useMapStore.getState().replace(linkedTwoHexMap())
    const { container } = renderEditor()
    const row = within(section(container, 'Links')).getByRole('listitem')
    expect(row.querySelector('.link-row-label')!.textContent).toBe('Chat feedback slice · FeedbackRepository → Second slice · submitChatFeedback')
  })

  it('offers every driven port and every driving port across the map for the create form', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = renderEditor()
    const linksSection = within(section(container, 'Links'))
    // 3 driven ports per hexagon × 2 hexagons, plus the placeholder; 1 driving port per hexagon × 2, plus the placeholder.
    expect((linksSection.getByLabelText('Driven port') as HTMLSelectElement).options).toHaveLength(7)
    expect((linksSection.getByLabelText('Driving port') as HTMLSelectElement).options).toHaveLength(3)
  })

  it('disables Create link until both a driven and a driving port are chosen', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = renderEditor()
    const linksSection = within(section(container, 'Links'))
    const button = linksSection.getByRole('button', { name: 'Create link' })
    expect(button.hasAttribute('disabled')).toBe(true)

    fireEvent.change(linksSection.getByLabelText('Driven port'), { target: { value: '0' } })
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('creating a link calls onCreateLink with the chosen ends and resets the form (REQ-LNK-01.2)', () => {
    useMapStore.getState().replace(twoHexMap())
    const onCreateLink = vi.fn()
    const { container } = renderEditor(() => {}, () => {}, () => {}, 'Context 1', () => {}, onCreateLink)
    const linksSection = within(section(container, 'Links'))
    // Driven index 0 = h1's first driven port (p-repo); driving index 1 = h2's p-submit.
    fireEvent.change(linksSection.getByLabelText('Driven port'), { target: { value: '0' } })
    fireEvent.change(linksSection.getByLabelText('Driving port'), { target: { value: '1' } })
    const button = linksSection.getByRole('button', { name: 'Create link' })
    expect(button.hasAttribute('disabled')).toBe(false)

    fireEvent.click(button)

    expect(onCreateLink).toHaveBeenCalledWith({ hexagonId: 'h1', portId: 'p-repo', adapterId: undefined }, { hexagonId: 'h2', portId: 'p-submit', adapterId: undefined })
    expect((linksSection.getByLabelText('Driven port') as HTMLSelectElement).value).toBe('')
    expect((linksSection.getByLabelText('Driving port') as HTMLSelectElement).value).toBe('')
  })

  it('shows an adapter select for an end once its port is chosen', () => {
    useMapStore.getState().replace(twoHexMap())
    const { container } = renderEditor()
    const linksSection = within(section(container, 'Links'))
    expect(linksSection.queryByLabelText('Driven port adapter')).toBeNull()

    fireEvent.change(linksSection.getByLabelText('Driven port'), { target: { value: '0' } })

    expect(linksSection.getByLabelText('Driven port adapter')).toBeTruthy()
  })

  it('passes the chosen adapter through to onCreateLink', () => {
    useMapStore.getState().replace(twoHexMap())
    const onCreateLink = vi.fn()
    const { container } = renderEditor(() => {}, () => {}, () => {}, 'Context 1', () => {}, onCreateLink)
    const linksSection = within(section(container, 'Links'))
    fireEvent.change(linksSection.getByLabelText('Driven port'), { target: { value: '0' } })
    fireEvent.change(linksSection.getByLabelText('Driven port adapter'), { target: { value: 'a-knex' } })
    fireEvent.change(linksSection.getByLabelText('Driving port'), { target: { value: '1' } })

    fireEvent.click(linksSection.getByRole('button', { name: 'Create link' }))

    expect(onCreateLink).toHaveBeenCalledWith({ hexagonId: 'h1', portId: 'p-repo', adapterId: 'a-knex' }, { hexagonId: 'h2', portId: 'p-submit', adapterId: undefined })
  })

  /** linkedTwoHexMap with its two hexagons split across contexts — the minimum shape that makes the pattern
   * control eligible (REQ-LNK-06.2). */
  function crossContextLinkedMap(): HexaMap {
    const base = linkedTwoHexMap()
    return { ...base, contexts: [...base.contexts, { id: 'c2' }], hexagons: base.hexagons.map((h, i) => (i === 1 ? { ...h, contextId: 'c2' } : h)) }
  }

  it('shows a delete button for each link, calling onDeleteLink with its id (REQ-LNK-04.1)', () => {
    useMapStore.getState().replace(linkedTwoHexMap())
    const onDeleteLink = vi.fn()
    const { container } = renderEditor(() => {}, () => {}, () => {}, 'Context 1', () => {}, () => {}, () => {}, onDeleteLink)
    const row = within(section(container, 'Links')).getByRole('listitem')

    fireEvent.click(within(row).getByRole('button', { name: /Delete link/ }))

    expect(onDeleteLink).toHaveBeenCalledWith('link-1')
  })

  it('offers an adapter edit for each end, calling onUpdateLink — a chosen value sets it, the placeholder clears it with null (REQ-LNK-02.1)', () => {
    useMapStore.getState().replace(linkedTwoHexMap())
    const onUpdateLink = vi.fn()
    const { container } = renderEditor(() => {}, () => {}, () => {}, 'Context 1', () => {}, () => {}, onUpdateLink)
    const row = within(section(container, 'Links')).getByRole('listitem')

    fireEvent.change(within(row).getByLabelText('Driven port adapter'), { target: { value: 'a-knex' } })
    expect(onUpdateLink).toHaveBeenCalledWith('link-1', { from: { adapterId: 'a-knex' } })

    fireEvent.change(within(row).getByLabelText('Driven port adapter'), { target: { value: '' } })
    expect(onUpdateLink).toHaveBeenCalledWith('link-1', { from: { adapterId: null } })
  })

  it('shows the pattern control only when the link’s two hexagons are in different contexts (REQ-LNK-06.2)', () => {
    useMapStore.getState().replace(linkedTwoHexMap())
    const { container: sameContext } = renderEditor()
    expect(within(section(sameContext, 'Links')).queryByLabelText('Pattern')).toBeNull()
    cleanup()

    useMapStore.getState().replace(crossContextLinkedMap())
    const { container: crossContext } = renderEditor()
    expect(within(section(crossContext, 'Links')).getByLabelText('Pattern')).toBeTruthy()
  })

  it('calls onUpdateLink with the chosen pattern, or null when cleared back to the placeholder (REQ-LNK-02.2)', () => {
    useMapStore.getState().replace(crossContextLinkedMap())
    const onUpdateLink = vi.fn()
    const { container } = renderEditor(() => {}, () => {}, () => {}, 'Context 1', () => {}, () => {}, onUpdateLink)
    const row = within(section(container, 'Links')).getByRole('listitem')

    fireEvent.change(within(row).getByLabelText('Pattern'), { target: { value: 'acl' } })
    expect(onUpdateLink).toHaveBeenCalledWith('link-1', { pattern: 'acl' })

    fireEvent.change(within(row).getByLabelText('Pattern'), { target: { value: '' } })
    expect(onUpdateLink).toHaveBeenCalledWith('link-1', { pattern: null })
  })

  it('offers no control anywhere that moves an endpoint (REQ-LNK-03.1)', () => {
    useMapStore.getState().replace(crossContextLinkedMap())
    const { container } = renderEditor()
    const row = within(section(container, 'Links')).getByRole('listitem')

    expect(within(row).queryByLabelText('Driven port')).toBeNull()
    expect(within(row).queryByLabelText('Driving port')).toBeNull()
  })
})

describe('use case placement', () => {
  const uc = EXAMPLE_DIAGRAM.useCases[0]
  const placementOf = () => currentDiagram().useCases.find((u) => u.id === uc.id)!.placement

  it('offers the stack under the title or any wall, in hexagons only', () => {
    const { container } = renderEditor()
    const select = container.querySelector<HTMLSelectElement>(`[data-item-id="${uc.id}"] select[aria-label="Placement"]`)!
    expect([...select.options].map((o) => o.textContent)).toEqual(['Under the title', 'North-west', 'West', 'South-west', 'North-east', 'East', 'South-east'])
    fireEvent.change(select, { target: { value: 'nw' } })
    expect(placementOf()).toBe('nw')
    fireEvent.change(select, { target: { value: 'top' } })
    expect(placementOf()).toBeUndefined()
    cleanup()
    useMapStore.getState().replace(toMap({ ...EXAMPLE_DIAGRAM, kind: 'clean' }))
    expect(renderEditor().container.querySelector(`[data-item-id="${uc.id}"] select[aria-label="Placement"]`)).toBeNull()
  })
})
