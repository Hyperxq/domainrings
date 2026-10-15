import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Toolbar } from './Toolbar'
import { EXAMPLES } from '../model/example'
import { usePreferencesStore } from './state/preferencesStore'
import { useViewStore } from './state/viewStore'
import { useMapStore } from '../model/store'
import { manyHexagonMap } from '../test/fixtures'

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.documentElement.style.removeProperty('--toolbar-bottom')
  useViewStore.setState({ toolbarBottom: null })
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
    showPlanned?: boolean
    viewOnly?: boolean
    exportScope?: 'map' | 'hexagon'
    themeChoice?: 'light' | 'dark' | 'system'
    palette?: 'default' | 'purple' | 'terracotta' | 'cool'
    canAddDiagram?: boolean
  } = {},
) {
  const { mode = 'detailed', guides = true, highlight = true, dependents = false, themeChoice = 'system', palette = 'default', exportScope = 'map', showScope = false, hasPlanned = true, showPlanned = true, viewOnly = false, canAddDiagram = true } = overrides
  usePreferencesStore.setState({ mode, guides, highlight, dependents, showPlanned, theme: themeChoice, palette, viewOnly })
  useViewStore.setState({ exportScope })
  const props = { onNew: vi.fn(), onExample: vi.fn(), onOpen: vi.fn(), onCopyLink: vi.fn(), onExport: vi.fn(), onNewDiagram: vi.fn() }
  render(<Toolbar {...props} showScope={showScope} hasPlanned={hasPlanned} canAddDiagram={canAddDiagram} />)
  return props
}

describe('Toolbar Copy image hint', () => {
  const open = (name: 'Share') => fireEvent.click(screen.getByRole('button', { name }))

  it('names the Mac shortcut on a Mac, outside the accessible name', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')
    renderToolbar()
    open('Share')
    expect(screen.getByRole('menuitem', { name: 'Copy image' }).textContent).toBe('Copy image⌘C')
  })

  it('hands the copy choice to onExport', () => {
    const { onExport } = renderToolbar()
    open('Share')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy image' }))
    expect(onExport).toHaveBeenCalledWith('png-copy')
  })
})

describe('Toolbar View options', () => {
  const openOptions = () => fireEvent.click(screen.getByRole('button', { name: 'View options' }))
  // Some switches carry a hover hint as their description, so the accessible name is the label plus the hint.
  const option = (name: string) => screen.getByRole('menuitemcheckbox', { name: new RegExp(`^${name}`) })

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
    renderToolbar({ guides: false, highlight: true, dependents: true, showPlanned: true, themeChoice: 'dark', palette: 'terracotta' })
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

  it('keeps the hover hints of Dependents and Planned as descriptions', () => {
    renderToolbar()
    openOptions()
    expect(option('Dependents').querySelector('.choice-description')?.textContent).toBe('Emphasize what depends on the selection, not what it depends on')
    expect(option('Planned').querySelector('.choice-description')?.textContent).toBe('Show what is not built yet; off hides it from the canvas and image exports')
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
    expect(screen.queryByRole('menuitemcheckbox', { name: /^Planned/ })).toBeNull()
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

  const FILE_ITEMS = ['New', 'Open .hexa…Ctrl+O', 'Save .hexaCtrl+S', 'Start from an example']

  it('File lists New, Open .hexa… and Save .hexa with their shortcuts, a separator, then the examples submenu', () => {
    renderToolbar()
    open('File')
    const menu = screen.getByRole('menu', { name: 'File' })
    expect([...menu.querySelectorAll('[role^="menuitem"]')].map((i) => i.textContent)).toEqual(FILE_ITEMS)
    expect(menu.children[3]?.getAttribute('role')).toBe('separator')
    expect(menu.children[4]?.textContent).toBe('Start from an example')
    for (const name of ['New', 'Open .hexa…', 'Save .hexa']) expect(within(menu).getByRole('menuitem', { name }).querySelector('svg')).not.toBeNull()
    expect(within(menu).getByRole('menuitem', { name: 'New' }).querySelector('.choice-shortcut')).toBeNull()
  })

  it('names the Mac shortcuts on a Mac', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')
    renderToolbar()
    open('File')
    expect([...screen.getByRole('menu', { name: 'File' }).querySelectorAll('[role^="menuitem"]')].map((i) => i.textContent)).toEqual(['New', 'Open .hexa…⌘O', 'Save .hexa⌘S', 'Start from an example'])
  })

  it('Start from an example opens a submenu of the examples grouped by architecture', () => {
    renderToolbar()
    open('File')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Start from an example' }))
    const sub = screen.getByRole('menu', { name: 'Start from an example' })
    const names = (root: Element) => [...root.querySelectorAll('[role^="menuitem"]')].map((i) => i.textContent)
    expect(names(sub)).toEqual(EXAMPLES.map((x) => x.label))
    for (const architecture of ['Hexagonal', 'Onion', 'Clean']) {
      expect(names(within(sub).getByRole('group', { name: architecture }))).toEqual(EXAMPLES.filter((x) => x.architecture === architecture).map((x) => x.label))
    }
  })

  it('File > New and File > an example call their handlers', () => {
    const { onNew, onExample } = renderToolbar()
    open('File')
    fireEvent.click(screen.getByRole('menuitem', { name: 'New' }))
    expect(onNew).toHaveBeenCalledTimes(1)
    open('File')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Start from an example' }))
    fireEvent.click(screen.getByRole('menuitem', { name: EXAMPLES[4].label }))
    expect(onExample).toHaveBeenCalledTimes(1)
    expect(onExample).toHaveBeenCalledWith(EXAMPLES[4].id)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('File > Save .hexa exports a .hexa file and nothing else', () => {
    const { onExport } = renderToolbar()
    open('File')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save .hexa' }))
    expect(onExport).toHaveBeenCalledTimes(1)
    expect(onExport).toHaveBeenCalledWith('hexa')
  })

  it('File > Open .hexa… opens the file picker, and the picked file goes to onOpen', () => {
    const { onOpen } = renderToolbar()
    const input = screen.getByLabelText('Open a .hexa file, replacing the map') as HTMLInputElement
    const pick = vi.spyOn(input, 'click')
    open('File')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open .hexa…' }))
    expect(pick).toHaveBeenCalledTimes(1)
    const file = new File(['{}'], 'map.hexa')
    fireEvent.change(input, { target: { files: [file] } })
    expect(onOpen).toHaveBeenCalledWith(file)
  })

  it('Share lists Copy link first, then an Export image group with Download PNG, Download SVG and Copy image', () => {
    renderToolbar()
    open('Share')
    const menu = screen.getByRole('menu', { name: 'Share' })
    expect([...menu.querySelectorAll('[role^="menuitem"]')].map((i) => i.textContent)).toEqual(['Copy link', 'Download PNG', 'Download SVG', 'Copy imageCtrl+C'])
    const group = screen.getByRole('group', { name: 'Export image' })
    expect([...group.querySelectorAll('[role^="menuitem"]')].map((i) => i.textContent)).toEqual(['Download PNG', 'Download SVG', 'Copy imageCtrl+C'])
    expect(within(menu).getByRole('menuitem', { name: 'Copy link' }).querySelector('svg')).not.toBeNull()
  })

  it.each([
    ['Copy link', undefined],
    ['Download PNG', 'png'],
    ['Download SVG', 'svg'],
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
    expect([...group.querySelectorAll('[role^="menuitem"]')].map((i) => i.textContent)).toEqual(['Only the current hexagon', 'Download PNG', 'Download SVG', 'Copy imageCtrl+C'])
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

describe('Toolbar height measurement', () => {
  /** Stands in for ResizeObserver so a test decides when the bar's height changed. */
  function observeToolbar() {
    const disconnect = vi.fn()
    let notify = () => {}
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          notify = cb
        }
        observe() {}
        disconnect = disconnect
      },
    )
    return {
      disconnect,
      resizeTo(bottom: number) {
        screen.getByRole('banner').getBoundingClientRect = () => ({ bottom }) as DOMRect
        act(() => notify())
      },
    }
  }

  it('publishes the bar’s bottom edge and follows it as the bar wraps', () => {
    const bar = observeToolbar()
    renderToolbar()
    bar.resizeTo(86)
    expect(document.documentElement.style.getPropertyValue('--toolbar-bottom')).toBe('86px')
    expect(useViewStore.getState().toolbarBottom).toBe(86)
    bar.resizeTo(122)
    expect(document.documentElement.style.getPropertyValue('--toolbar-bottom')).toBe('122px')
    expect(useViewStore.getState().toolbarBottom).toBe(122)
  })

  it('stops observing and forgets the measurement when the bar unmounts', () => {
    const bar = observeToolbar()
    renderToolbar()
    bar.resizeTo(86)
    cleanup()
    expect(bar.disconnect).toHaveBeenCalled()
    expect(document.documentElement.style.getPropertyValue('--toolbar-bottom')).toBe('')
    expect(useViewStore.getState().toolbarBottom).toBeNull()
  })
})

describe('Toolbar file shortcuts', () => {
  const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true, ...init }))
  const picker = () => vi.spyOn(screen.getByLabelText('Open a .hexa file, replacing the map') as HTMLInputElement, 'click')

  it.each([
    ['Ctrl+S', 's', { ctrlKey: true }],
    ['Cmd+S', 's', { ctrlKey: false, metaKey: true }],
  ])('%s saves the .hexa and keeps the browser’s own save dialog away', (_name, key, init) => {
    const { onExport } = renderToolbar()
    expect(press(key, init)).toBe(false)
    expect(onExport).toHaveBeenCalledTimes(1)
    expect(onExport).toHaveBeenCalledWith('hexa')
  })

  it.each([
    ['Ctrl+O', { ctrlKey: true }],
    ['Cmd+O', { ctrlKey: false, metaKey: true }],
  ])('%s opens the file picker', (_name, init) => {
    renderToolbar()
    const pick = picker()
    expect(press('o', init)).toBe(false)
    expect(pick).toHaveBeenCalledTimes(1)
  })

  it('does nothing in View mode, leaving the keys to the browser', () => {
    const { onExport } = renderToolbar({ viewOnly: true })
    expect(press('s')).toBe(true)
    expect(press('o')).toBe(true)
    expect(onExport).not.toHaveBeenCalled()
  })

  it('stops listening once the toolbar goes away', () => {
    const { onExport } = renderToolbar()
    cleanup()
    press('s')
    expect(onExport).not.toHaveBeenCalled()
  })

  it('leaves the keys alone while typing in a field', () => {
    const { onExport } = renderToolbar()
    const pick = picker()
    const field = document.body.appendChild(document.createElement('input'))
    try {
      expect(press('s', {}, field)).toBe(true)
      expect(press('o', {}, field)).toBe(true)
      expect(onExport).not.toHaveBeenCalled()
      expect(pick).not.toHaveBeenCalled()
    } finally {
      field.remove()
    }
  })

  it('leaves the keys alone while a menu or a dialog is open', () => {
    const { onExport } = renderToolbar()
    fireEvent.click(screen.getByRole('button', { name: 'File' }))
    expect(press('s')).toBe(true)
    expect(onExport).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    const dialog = document.body.appendChild(document.createElement('dialog'))
    dialog.setAttribute('open', '')
    try {
      expect(press('s')).toBe(true)
      expect(onExport).not.toHaveBeenCalled()
    } finally {
      dialog.remove()
    }
  })

  it.each([
    ['without a modifier', 's', { ctrlKey: false }],
    ['with Shift', 's', { shiftKey: true }],
    ['with Alt', 'o', { altKey: true }],
  ])('ignores the key %s', (_name, key, init) => {
    const { onExport } = renderToolbar()
    const pick = picker()
    expect(press(key, init)).toBe(true)
    expect(onExport).not.toHaveBeenCalled()
    expect(pick).not.toHaveBeenCalled()
  })
})

describe('Toolbar diagram switcher', () => {
  const seed = () => {
    useMapStore.getState().replace({ ...manyHexagonMap(4), contexts: [{ id: 'c1', name: 'Orders' }, { id: 'c2', name: 'Billing' }, { id: 'c3', name: 'Shipping' }] })
    useViewStore.setState({ expanded: new Set(['h1', 'h2']) })
  }
  const trigger = () => screen.getByRole('button', { name: 'Diagram' })
  const open = () => fireEvent.click(trigger())

  it('is labelled with the current subdomain and sits right after the wordmark', () => {
    seed()
    renderToolbar({ showScope: true })
    expect(trigger().textContent).toBe('Slice 1')
    expect(screen.getByRole('heading', { name: 'domainrings' }).nextElementSibling?.contains(trigger())).toBe(true)
    act(() => useMapStore.getState().setFocus('h2'))
    expect(trigger().textContent).toBe('Slice 2')
  })

  it('lists the subdomains under their bounded context, marking the current one', () => {
    seed()
    renderToolbar({ showScope: true })
    open()
    const menu = screen.getByRole('menu', { name: 'Diagram' })
    for (const [context, titles] of [['Orders', ['Slice 1', 'Slice 4']], ['Billing', ['Slice 2']], ['Shipping', ['Slice 3']]] as const) {
      const group = within(menu).getByRole('group', { name: context })
      expect(within(group).getAllByRole('menuitemcheckbox').map((i) => i.textContent)).toEqual(titles)
    }
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Slice 1' }).getAttribute('aria-checked')).toBe('true')
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Slice 2' }).getAttribute('aria-checked')).toBe('false')
  })

  it('choosing a subdomain makes it the current hexagon', () => {
    seed()
    renderToolbar({ showScope: true })
    open()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Slice 3' }))
    expect(useMapStore.getState().focus).toBe('h3')
    expect(trigger().textContent).toBe('Slice 3')
  })

  it('Map of all contexts compacts every hexagon but the current one', () => {
    seed()
    renderToolbar({ showScope: true })
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Map of all contexts' }))
    expect(useViewStore.getState().expanded.size).toBe(0)
  })

  it('Map of all contexts also asks the view to fit', () => {
    seed()
    renderToolbar({ showScope: true })
    open()
    const before = useViewStore.getState().fitRequest
    fireEvent.click(screen.getByRole('menuitem', { name: 'Map of all contexts' }))
    expect(useViewStore.getState().fitRequest).toBe(before + 1)
  })

  it('disables + New diagram with a reason when the current hexagon has no free side', () => {
    seed()
    const { onNewDiagram } = renderToolbar({ showScope: true, canAddDiagram: false })
    open()
    const item = screen.getByRole('menuitem', { name: /\+ New diagram/ })
    expect(item.getAttribute('aria-disabled')).toBe('true')
    expect(item.textContent).toContain('No free side around this subdomain')
    fireEvent.click(item)
    expect(onNewDiagram).not.toHaveBeenCalled()
  })

  it('keeps + New diagram enabled while a side is free', () => {
    seed()
    renderToolbar({ showScope: true })
    open()
    expect(screen.getByRole('menuitem', { name: '+ New diagram' }).getAttribute('aria-disabled')).toBeNull()
  })

  it('offers + New diagram in Edit mode only, handing it to onNewDiagram', () => {
    seed()
    const { onNewDiagram } = renderToolbar({ showScope: true })
    open()
    fireEvent.click(screen.getByRole('menuitem', { name: '+ New diagram' }))
    expect(onNewDiagram).toHaveBeenCalledOnce()
    cleanup()
    renderToolbar({ showScope: true, viewOnly: true })
    open()
    expect(screen.getByRole('menuitem', { name: 'Map of all contexts' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: '+ New diagram' })).toBeNull()
  })

  it('is absent unless the map is a multi-hexagon hexagonal one', () => {
    seed()
    renderToolbar({ showScope: false })
    expect(screen.queryByRole('button', { name: 'Diagram' })).toBeNull()
  })
})
