import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Toolbar } from './Toolbar'
import { EXAMPLES } from '../model/example'
import { usePreferencesStore } from './state/preferencesStore'
import { useViewStore } from './state/viewStore'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** Seeds the stores the toolbar reads, then renders it; its choices land in those stores. */
function renderToolbar(
  overrides: {
    mode?: 'overview' | 'detailed'
    guides?: boolean
    highlight?: boolean
    dependents?: boolean
    showScope?: boolean
    hasPlanned?: boolean
    viewOnly?: boolean
    exportScope?: 'map' | 'hexagon'
    themeChoice?: 'light' | 'dark' | 'system'
    palette?: 'default' | 'purple' | 'terracotta' | 'cool'
  } = {},
) {
  const { mode = 'detailed', guides = true, highlight = true, dependents = false, themeChoice = 'system', palette = 'default', exportScope = 'map', showScope = false, hasPlanned = true, viewOnly = false } = overrides
  usePreferencesStore.setState({ mode, guides, highlight, dependents, theme: themeChoice, palette, viewOnly })
  useViewStore.setState({ exportScope })
  const props = { onNew: vi.fn(), onExample: vi.fn(), onOpen: vi.fn(), onCopyLink: vi.fn(), onExport: vi.fn() }
  render(<Toolbar {...props} showScope={showScope} hasPlanned={hasPlanned} />)
  return props
}

describe('Toolbar copy PNG hint', () => {
  const open = (name: 'Share') => fireEvent.click(screen.getByRole('button', { name }))

  it('names the Mac shortcut on a Mac', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')
    renderToolbar()
    open('Share')
    expect(screen.getByRole('menuitem', { name: /Copy PNG/ }).textContent).toBe('Copy PNGOr press ⌘C')
  })

  it('hands the copy choice to onExport', () => {
    const { onExport } = renderToolbar()
    open('Share')
    fireEvent.click(screen.getByRole('menuitem', { name: /Copy PNG/ }))
    expect(onExport).toHaveBeenCalledWith('png-copy')
  })
})

describe('Toolbar View options', () => {
  const openOptions = () => fireEvent.click(screen.getByRole('button', { name: 'View options' }))
  const option = (name: string | RegExp) => screen.getByRole('menuitemcheckbox', { name })

  it('is one icon-only menu trigger, aligned to the end', () => {
    renderToolbar()
    const trigger = screen.getByRole('button', { name: 'View options' })
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.classList.contains('icon-trigger')).toBe(true)
    expect(trigger.textContent).toBe('')
  })

  it('replaces the loose switches and the Appearance menu', () => {
    renderToolbar()
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Appearance' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'View' })).toBeNull()
  })

  it('lists the switches, then the Theme group, then the Palette group, each showing its state', () => {
    renderToolbar({ guides: false, highlight: true, dependents: true, themeChoice: 'dark', palette: 'terracotta' })
    openOptions()
    const menu = screen.getByRole('menu', { name: 'View options' })
    const state = (root: Element) => [...root.querySelectorAll('[role^="menuitem"]')].map((i) => [i.firstChild!.textContent, i.getAttribute('aria-checked')])
    expect(state(menu)).toEqual([
      ['Corridor guides', 'false'],
      ['Dim other flows on hover', 'true'],
      ['Dependents', 'true'],
      ['Planned', 'true'],
      ['Light', 'false'],
      ['Dark', 'true'],
      ['System', 'false'],
      ['Default', 'false'],
      ['Purple', 'false'],
      ['Terracotta', 'true'],
      ['Cool', 'false'],
    ])
    expect(state(within(menu).getByRole('group', { name: 'Theme' })).map(([n]) => n)).toEqual(['Light', 'Dark', 'System'])
    expect(state(within(menu).getByRole('group', { name: 'Palette' })).map(([n]) => n)).toEqual(['Default', 'Purple', 'Terracotta', 'Cool'])
  })

  it('draws the switches as a track with a knob and the themes as one segmented pill', () => {
    renderToolbar()
    openOptions()
    for (const name of ['Corridor guides', 'Dim other flows on hover', 'Dependents', 'Planned']) expect(option(name).querySelector('.switch-track > .switch-knob')).not.toBeNull()
    const theme = screen.getAllByRole('menuitemradio', { name: 'Light' })[0].parentElement!
    expect(theme.classList.contains('segmented')).toBe(true)
  })

  it('leaves Planned out when the map has nothing planned', () => {
    renderToolbar({ hasPlanned: false })
    openOptions()
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Planned' })).toBeNull()
  })

  it.each([
    ['Corridor guides', 'guides', false],
    ['Dim other flows on hover', 'highlight', false],
    ['Dependents', 'dependents', true],
    ['Planned', 'showPlanned', false],
  ] as const)('toggling %s sets %s to %s and nothing else', (name, field, value) => {
    renderToolbar({ guides: true, highlight: true, dependents: false })
    const before = usePreferencesStore.getState()
    openOptions()
    fireEvent.click(option(name))
    expect(usePreferencesStore.getState()).toEqual({ ...before, [field]: value })
  })

  it.each([
    ['Light', 'theme', 'light'],
    ['Dark', 'theme', 'dark'],
    ['System', 'theme', 'system'],
    ['Default', 'palette', 'default'],
    ['Cool', 'palette', 'cool'],
  ] as const)('choosing %s sets %s to %s and nothing else', (name, field, value) => {
    renderToolbar({ themeChoice: 'light', palette: 'terracotta' })
    const before = usePreferencesStore.getState()
    openOptions()
    fireEvent.click(screen.getByRole(field === 'theme' ? 'menuitemradio' : 'menuitemcheckbox', { name: new RegExp(`^${name}`) }))
    expect(usePreferencesStore.getState()).toEqual({ ...before, [field]: value })
  })

  it('stays open after a switch or a radio is toggled, and shows the new state', () => {
    renderToolbar({ dependents: false, themeChoice: 'light' })
    openOptions()
    fireEvent.click(option('Dependents'))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Dark' }))
    expect(screen.getByRole('menu', { name: 'View options' })).toBeTruthy()
    expect(option('Dependents').getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('menuitemradio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('Toolbar at wide width', () => {
  it('offers the detail level as one radio group whose selected half is checked', () => {
    renderToolbar({ mode: 'overview' })
    const group = screen.getByRole('radiogroup', { name: 'Detail level' })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map((r) => [r.textContent, r.getAttribute('aria-checked'), r.getAttribute('tabindex')])).toEqual([
      ['Overview', 'true', '0'],
      ['Detailed', 'false', '-1'],
    ])
  })

  it.each([
    ['Overview', 'ArrowRight', 'detailed'],
    ['Overview', 'ArrowDown', 'detailed'],
    ['Overview', 'ArrowLeft', 'detailed'],
    ['Detailed', 'ArrowLeft', 'overview'],
    ['Detailed', 'ArrowUp', 'overview'],
    ['Detailed', 'ArrowRight', 'overview'],
  ] as const)('moves the choice and the focus from %s on %s', (from, key, mode) => {
    renderToolbar({ mode: from === 'Overview' ? 'overview' : 'detailed' })
    const radio = screen.getByRole('radio', { name: from })
    radio.focus()
    fireEvent.keyDown(radio, { key })
    expect(usePreferencesStore.getState().mode).toBe(mode)
    expect(document.activeElement).toBe(within(screen.getByRole('radiogroup', { name: 'Detail level' })).getByRole('radio', { checked: true }))
  })

  it('separates the detail level from the editing mode and the actions with dividers', () => {
    renderToolbar()
    const dividers = [...document.querySelectorAll('.toolbar .divider')]
    const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    const between = (a: Element, b: Element) => dividers.some((d) => before(a, d) && before(d, b))
    expect(between(screen.getByRole('radiogroup', { name: 'Detail level' }), screen.getByRole('radiogroup', { name: 'Editing mode' }))).toBe(true)
    expect(between(screen.getByRole('button', { name: 'Share' }), screen.getByRole('link', { name: 'View the source on GitHub' }))).toBe(true)
  })

  it('offers File and Share as menus with no kind switcher or export buttons (REQ-01)', () => {
    renderToolbar()
    expect(screen.queryByRole('radio', { name: /Hexagonal|Clean|Onion/ })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Architecture style' })).toBeNull()
    for (const name of ['File', 'Share']) expect(screen.getByRole('button', { name }).getAttribute('aria-haspopup')).toBe('menu')
    for (const name of ['Save as .hexa file', 'Export as SVG', 'Export as PNG', 'Export', 'New diagram', 'Copy link']) expect(screen.queryByRole('button', { name })).toBeNull()
  })
})


describe('Toolbar View and Edit switch', () => {
  const modeGroup = () => screen.getByRole('radiogroup', { name: 'Editing mode' })

  it('offers View and Edit as one radio group that reflects the preference', () => {
    renderToolbar({ viewOnly: false })
    expect(within(modeGroup()).getAllByRole('radio').map((r) => [r.textContent, r.getAttribute('aria-checked'), r.getAttribute('tabindex')])).toEqual([
      ['View', 'false', '-1'],
      ['Edit', 'true', '0'],
    ])
    cleanup()
    renderToolbar({ viewOnly: true })
    expect(within(modeGroup()).getByRole('radio', { checked: true }).textContent).toBe('View')
  })

  it('writes viewOnly when a half is chosen', () => {
    renderToolbar({ viewOnly: false })
    fireEvent.click(within(modeGroup()).getByRole('radio', { name: 'View' }))
    expect(usePreferencesStore.getState().viewOnly).toBe(true)
    fireEvent.click(within(modeGroup()).getByRole('radio', { name: 'Edit' }))
    expect(usePreferencesStore.getState().viewOnly).toBe(false)
  })

  it('moves the choice and the focus with the arrow keys', () => {
    renderToolbar({ viewOnly: false })
    const edit = within(modeGroup()).getByRole('radio', { name: 'Edit' })
    edit.focus()
    fireEvent.keyDown(edit, { key: 'ArrowLeft' })
    expect(usePreferencesStore.getState().viewOnly).toBe(true)
    expect(document.activeElement).toBe(within(modeGroup()).getByRole('radio', { name: 'View' }))
  })

  it('sits between the detail level and View options, then File, Share and the GitHub link', () => {
    renderToolbar()
    const after = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    const order = [
      screen.getByRole('radiogroup', { name: 'Detail level' }),
      modeGroup(),
      screen.getByRole('button', { name: 'View options' }),
      screen.getByRole('button', { name: 'File' }),
      screen.getByRole('button', { name: 'Share' }),
      screen.getByRole('link', { name: 'View the source on GitHub' }),
    ]
    order.slice(1).forEach((el, i) => expect(after(order[i], el)).toBe(true))
  })

  it('shows File only while editing', () => {
    renderToolbar({ viewOnly: true })
    expect(screen.queryByRole('button', { name: 'File' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy()
    cleanup()
    renderToolbar({ viewOnly: false })
    expect(screen.getByRole('button', { name: 'File' })).toBeTruthy()
  })
})

describe('Toolbar File and Share menus', () => {
  const open = (name: 'File' | 'Share') => fireEvent.click(screen.getByRole('button', { name }))

  it('File lists New, Open… and Save (.hexa) together, then the examples to load under their architecture', () => {
    renderToolbar()
    open('File')
    const menu = screen.getByRole('menu', { name: 'File' })
    const names = (root: Element) => [...root.querySelectorAll('[role^="menuitem"]')].map((i) => i.textContent)
    expect(names(menu)).toEqual(['New', 'Open…', 'Save (.hexa)', ...EXAMPLES.map((x) => x.label)])
    for (const architecture of ['Hexagonal', 'Onion', 'Clean']) {
      expect(names(within(menu).getByRole('group', { name: `Load example · ${architecture}` }))).toEqual(EXAMPLES.filter((x) => x.architecture === architecture).map((x) => x.label))
    }
    for (const name of ['New', 'Open…', 'Save (.hexa)']) expect(within(menu).getByRole('menuitem', { name }).querySelector('svg')).not.toBeNull()
  })

  it('File > New and File > an example call their handlers', () => {
    const { onNew, onExample } = renderToolbar()
    open('File')
    fireEvent.click(screen.getByRole('menuitem', { name: 'New' }))
    expect(onNew).toHaveBeenCalledTimes(1)
    open('File')
    fireEvent.click(screen.getByRole('menuitem', { name: EXAMPLES[4].label }))
    expect(onExample).toHaveBeenCalledTimes(1)
    expect(onExample).toHaveBeenCalledWith(EXAMPLES[4].id)
  })

  it('File > Save (.hexa) exports a .hexa file and nothing else', () => {
    const { onExport } = renderToolbar()
    open('File')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save (.hexa)' }))
    expect(onExport).toHaveBeenCalledTimes(1)
    expect(onExport).toHaveBeenCalledWith('hexa')
  })

  it('File > Open… opens the file picker, and the picked file goes to onOpen', () => {
    const { onOpen } = renderToolbar()
    const input = screen.getByLabelText('Open a .hexa file, replacing the map') as HTMLInputElement
    const pick = vi.spyOn(input, 'click')
    open('File')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open…' }))
    expect(pick).toHaveBeenCalledTimes(1)
    const file = new File(['{}'], 'map.hexa')
    fireEvent.change(input, { target: { files: [file] } })
    expect(onOpen).toHaveBeenCalledWith(file)
  })

  it('Share lists Copy link first, then an Export image group with SVG, PNG and Copy PNG', () => {
    renderToolbar()
    open('Share')
    const menu = screen.getByRole('menu', { name: 'Share' })
    expect([...menu.querySelectorAll('[role^="menuitem"]')].map((i) => i.textContent)).toEqual(['Copy link', 'SVG', 'PNG', 'Copy PNGOr press Ctrl+C'])
    const group = screen.getByRole('group', { name: 'Export image' })
    expect([...group.querySelectorAll('[role^="menuitem"]')].map((i) => i.textContent)).toEqual(['SVG', 'PNG', 'Copy PNGOr press Ctrl+C'])
    expect(within(menu).getByRole('menuitem', { name: 'Copy link' }).querySelector('svg')).not.toBeNull()
  })

  it.each([
    ['Copy link', undefined],
    ['SVG', 'svg'],
    ['PNG', 'png'],
  ] as const)('Share > %s calls its handler', (name, format) => {
    const { onCopyLink, onExport } = renderToolbar()
    open('Share')
    fireEvent.click(screen.getByRole('menuitem', { name }))
    if (format) {
      expect(onExport).toHaveBeenCalledTimes(1)
      expect(onExport).toHaveBeenCalledWith(format)
      expect(onCopyLink).not.toHaveBeenCalled()
    } else {
      expect(onCopyLink).toHaveBeenCalledTimes(1)
      expect(onExport).not.toHaveBeenCalled()
    }
  })

  it('shows the scope switch inside Export image only when the scope applies, checked by the current scope', () => {
    renderToolbar({ showScope: true, exportScope: 'map' })
    open('Share')
    const group = screen.getByRole('group', { name: 'Export image' })
    const scope = within(group).getByRole('menuitemcheckbox', { name: 'Only the current hexagon' })
    expect(scope.getAttribute('aria-checked')).toBe('false')
    expect(scope.querySelector('.switch-track > .switch-knob')).not.toBeNull()
    expect([...group.querySelectorAll('[role^="menuitem"]')].map((i) => i.textContent)).toEqual(['Only the current hexagon', 'SVG', 'PNG', 'Copy PNGOr press Ctrl+C'])
    cleanup()

    renderToolbar({ showScope: false })
    open('Share')
    expect(screen.queryByRole('menuitemcheckbox')).toBeNull()
  })

  it.each([
    ['map', 'hexagon'],
    ['hexagon', 'map'],
  ] as const)('flipping the scope switch from %s writes %s and exports nothing', (from, to) => {
    const { onExport } = renderToolbar({ showScope: true, exportScope: from })
    open('Share')
    expect(screen.getByRole('menuitemcheckbox', { name: 'Only the current hexagon' }).getAttribute('aria-checked')).toBe(String(from === 'hexagon'))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Only the current hexagon' }))
    expect(useViewStore.getState().exportScope).toBe(to)
    expect(onExport).not.toHaveBeenCalled()
  })

  it('opens from ArrowDown with the first item focused', () => {
    renderToolbar()
    const trigger = screen.getByRole('button', { name: 'File' })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'New' }))
  })
})


// styles.css wraps the bar into two rows below the phone breakpoint instead of scrolling it sideways, so nothing
// is dropped for it to hide: every control must stay reachable as one of the menus or a labelled link.
describe('Toolbar at phone width', () => {
  it('keeps every control reachable: the three menus and the GitHub link', () => {
    renderToolbar({ showScope: true })
    for (const name of ['View options', 'File', 'Share']) expect(screen.getByRole('button', { name }).getAttribute('aria-haspopup')).toBe('menu')
    expect(screen.getByRole('radiogroup', { name: 'Detail level' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View the source on GitHub' })).toBeTruthy()
  })
})
