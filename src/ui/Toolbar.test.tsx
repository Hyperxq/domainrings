import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ROOMY_TOOLBAR, Toolbar } from './Toolbar'
import { EXAMPLES } from '../model/example'
import { usePreferencesStore } from './state/preferencesStore'
import { useViewStore } from './state/viewStore'

type Listener = () => void
const minWidth = (query: string) => Number(/min-width: (\d+)px/.exec(query)![1])
const WIDE = 1600
const ROOMY = minWidth(ROOMY_TOOLBAR)
let viewport = WIDE
let systemDark = false
const listeners = new Set<Listener>()

beforeEach(() => {
  viewport = WIDE
  systemDark = false
  listeners.clear()
  window.matchMedia = ((media: string) => ({
    get matches() {
      return media === '(prefers-color-scheme: dark)' ? systemDark : viewport >= minWidth(media)
    },
    media,
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  })) as unknown as typeof matchMedia
})
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
    exportScope?: 'map' | 'hexagon'
    themeChoice?: 'light' | 'dark' | 'system'
    palette?: 'default' | 'ink' | 'moss'
  } = {},
) {
  const { mode = 'detailed', guides = true, highlight = true, dependents = false, themeChoice = 'system', palette = 'default', exportScope = 'map', showScope = false } = overrides
  usePreferencesStore.setState({ mode, guides, highlight, dependents, theme: themeChoice, palette })
  useViewStore.setState({ exportScope })
  const props = { onNew: vi.fn(), onExample: vi.fn(), onOpen: vi.fn(), onCopyLink: vi.fn(), onExport: vi.fn() }
  render(<Toolbar {...props} showScope={showScope} />)
  return props
}

describe('Toolbar at wide width', () => {
  it('has a Dependents switch that shows its state, explains itself and flips on click', () => {
    renderToolbar({ dependents: false })
    const toggle = screen.getByRole('switch', { name: 'Dependents' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(toggle.getAttribute('title')).toMatch(/what depends on the selection/i)

    fireEvent.click(toggle)

    expect(usePreferencesStore.getState().dependents).toBe(true)
    cleanup()
    renderToolbar({ dependents: true })
    expect(screen.getByRole('switch', { name: 'Dependents' }).getAttribute('aria-checked')).toBe('true')
  })

  it('draws every switch as a track with a knob, activated by Space and Enter because it is a native button', () => {
    renderToolbar()
    for (const name of ['Guides', 'Highlight', 'Dependents']) {
      const toggle = screen.getByRole('switch', { name })
      expect(toggle.tagName).toBe('BUTTON')
      expect(toggle.querySelector('.switch-track > .switch-knob')).not.toBeNull()
    }
    expect(screen.queryByRole('button', { name: 'Guides' })).toBeNull()
  })

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
    expect(document.activeElement).toBe(screen.getByRole('radio', { checked: true }))
  })

  it('separates the detail level, the switches and the actions with dividers', () => {
    renderToolbar()
    const dividers = [...document.querySelectorAll('.toolbar .divider')]
    const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    const between = (a: Element, b: Element) => dividers.some((d) => before(a, d) && before(d, b))
    const mode = screen.getByRole('radiogroup', { name: 'Detail level' })
    const guides = screen.getByRole('switch', { name: 'Guides' })
    const dependents = screen.getByRole('switch', { name: 'Dependents' })
    const file = screen.getByRole('button', { name: 'File' })
    expect(between(mode, guides)).toBe(true)
    expect(between(dependents, file)).toBe(true)
    expect(between(guides, dependents)).toBe(false)
  })

  it('offers File and Share as menus with no kind switcher or export buttons (REQ-01)', () => {
    renderToolbar()
    expect(screen.queryByRole('radio', { name: /Hexagonal|Clean|Onion/ })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Architecture style' })).toBeNull()
    for (const name of ['File', 'Share']) expect(screen.getByRole('button', { name }).getAttribute('aria-haspopup')).toBe('menu')
    for (const name of ['Save as .hexa file', 'Export as SVG', 'Export as PNG', 'Export', 'New diagram', 'Copy link']) expect(screen.queryByRole('button', { name })).toBeNull()
  })
})


describe('Toolbar between the two breakpoints', () => {
  beforeEach(() => {
    viewport = ROOMY
  })

  it('keeps the detail level and toggles in the bar, with File and Share as menus', () => {
    renderToolbar()
    for (const name of ['File', 'Share']) expect(screen.getByRole('button', { name })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Overview' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Guides' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'View' })).toBeNull()
  })
})


describe('Toolbar below the compact breakpoint', () => {
  beforeEach(() => {
    viewport = ROOMY - 1
  })

  const openView = () => fireEvent.click(screen.getByRole('button', { name: 'View' }))

  it('moves the detail level and the toggles into a View menu that shows their state', () => {
    renderToolbar({ mode: 'overview', guides: false, highlight: true })
    expect(screen.queryByRole('radio', { name: 'Overview' })).toBeNull()
    expect(screen.queryByRole('switch', { name: 'Guides' })).toBeNull()
    expect(screen.queryByRole('switch', { name: 'Highlight' })).toBeNull()
    expect(screen.queryByRole('switch', { name: 'Dependents' })).toBeNull()

    openView()

    const state = [...screen.getAllByRole('menuitemradio'), ...screen.getAllByRole('menuitemcheckbox')].map((item) => [item.textContent, item.getAttribute('aria-checked')])
    expect(state).toEqual([
      ['Overview', 'true'],
      ['Detailed', 'false'],
      ['Guides', 'false'],
      ['Highlight', 'true'],
      ['Dependents', 'false'],
    ])
  })

  it.each([
    ['Overview', 'mode', 'overview'],
    ['Detailed', 'mode', 'detailed'],
    ['Guides', 'guides', true],
    ['Highlight', 'highlight', false],
    ['Dependents', 'dependents', true],
  ] as const)('choosing %s in the View menu sets %s to %s and nothing else', (name, field, value) => {
    renderToolbar({ mode: 'detailed', guides: false, highlight: true })
    const before = usePreferencesStore.getState()
    openView()
    fireEvent.click(screen.getByRole(field === 'mode' ? 'menuitemradio' : 'menuitemcheckbox', { name }))
    expect(usePreferencesStore.getState()).toEqual({ ...before, [field]: value })
  })

  it('shows two kinds of control in the View menu: a segmented mode and switches, set apart', () => {
    renderToolbar()
    openView()
    const menu = screen.getByRole('menu')
    const pill = within(menu).getAllByRole('menuitemradio')[0].parentElement!
    expect(pill.classList.contains('segmented')).toBe(true)
    expect(within(pill).getAllByRole('menuitemradio')).toHaveLength(2)
    for (const item of within(menu).getAllByRole('menuitemcheckbox')) expect(item.querySelector('.switch-track > .switch-knob')).not.toBeNull()
    expect(within(menu).queryByRole('menuitem')).toBeNull()
    expect(within(menu).getAllByRole('separator')).toHaveLength(1)
  })

})

describe.each([
  ['wide', WIDE],
  ['compact', ROOMY - 1],
  ['phone', 390],
])('Toolbar File and Share menus at %s width', (_, width) => {
  beforeEach(() => {
    viewport = width
  })

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

  it('Share lists Copy link first, then an Export image group with SVG and PNG', () => {
    renderToolbar()
    open('Share')
    const menu = screen.getByRole('menu', { name: 'Share' })
    expect([...menu.querySelectorAll('[role^="menuitem"]')].map((i) => i.textContent)).toEqual(['Copy link', 'SVG', 'PNG'])
    const group = screen.getByRole('group', { name: 'Export image' })
    expect([...group.querySelectorAll('[role^="menuitem"]')].map((i) => i.textContent)).toEqual(['SVG', 'PNG'])
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
    expect([...group.querySelectorAll('[role^="menuitem"]')].map((i) => i.textContent)).toEqual(['Only the current hexagon', 'SVG', 'PNG'])
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


// At a literal phone width (below styles.css's toolbar wrap point, TOOLBAR-PHONE-01) the markup is the same
// icon-only tier as above — styles.css wraps it into two rows instead of scrolling sideways — so this pins the
// requirement that drove the wrap: nothing is dropped for it to hide, every control stays reachable as one of
// the three menus or a labelled icon/link.
describe('Toolbar at phone width', () => {
  beforeEach(() => {
    viewport = 390
  })

  it('keeps every control reachable: the four menus and the GitHub link', () => {
    renderToolbar({ showScope: true })
    for (const name of ['View', 'File', 'Share', 'Appearance']) expect(screen.getByRole('button', { name })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View the source on GitHub' })).toBeTruthy()
  })
})

describe('Toolbar appearance menu', () => {
  const openAppearance = () => fireEvent.click(screen.getByRole('button', { name: 'Appearance' }))
  const iconPath = () => screen.getByRole('button', { name: 'Appearance' }).querySelector('path')!.getAttribute('d')!
  const MOON = /^M21 12\.8/
  const SUN = /^M12 8a4/

  it.each([WIDE, ROOMY, ROOMY - 1])('is one icon-sized trigger at a %ipx viewport', (width) => {
    viewport = width
    renderToolbar()
    const trigger = screen.getByRole('button', { name: 'Appearance' })
    expect(trigger.classList.contains('icon-trigger')).toBe(true)
    expect(trigger.textContent).toBe('')
  })

  it('lists the theme choices and then the palettes, checking the stored theme and the active palette', () => {
    renderToolbar({ themeChoice: 'dark', palette: 'ink' })
    openAppearance()
    const state = screen.getAllByRole('menuitemcheckbox').map((item) => [item.firstChild!.textContent, item.getAttribute('aria-checked')])
    expect(state).toEqual([
      ['Light', 'false'],
      ['Dark', 'true'],
      ['System', 'false'],
      ['Default', 'false'],
      ['Ink', 'true'],
      ['Moss', 'false'],
    ])
  })

  it('checks System and Default when nothing is chosen', () => {
    renderToolbar()
    openAppearance()
    expect(screen.getByRole('menuitemcheckbox', { name: 'System' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('menuitemcheckbox', { name: /^Default/ }).getAttribute('aria-checked')).toBe('true')
  })

  it.each([
    ['Light', 'theme', 'light'],
    ['Dark', 'theme', 'dark'],
    ['System', 'theme', 'system'],
    ['Default', 'palette', 'default'],
    ['Moss', 'palette', 'moss'],
  ] as const)('choosing %s sets %s to %s and nothing else', (name, field, value) => {
    renderToolbar({ themeChoice: 'light', palette: 'ink' })
    const before = usePreferencesStore.getState()
    openAppearance()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: new RegExp(`^${name}`) }))
    expect(usePreferencesStore.getState()).toEqual({ ...before, [field]: value })
  })

  it('shows the moon on a light page and the sun on a dark one, resolving System from the OS', () => {
    renderToolbar({ themeChoice: 'light' })
    expect(iconPath()).toMatch(MOON)
    cleanup()
    renderToolbar({ themeChoice: 'dark' })
    expect(iconPath()).toMatch(SUN)
    cleanup()
    systemDark = true
    renderToolbar({ themeChoice: 'system' })
    expect(iconPath()).toMatch(SUN)
  })
})
