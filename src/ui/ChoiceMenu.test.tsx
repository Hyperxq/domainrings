import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ChoiceMenu } from './ChoiceMenu'

afterEach(cleanup)

const CHOICES = [
  { id: 'same', label: 'Import into Billing' },
  { id: 'new', label: 'Import into a new context', description: 'Starts its own context' },
] as const

function renderMenu() {
  const onChoose = vi.fn()
  render(
    <>
      <ChoiceMenu label="Add subdomain from file…" choices={CHOICES} onChoose={onChoose} />
      <button type="button">Elsewhere</button>
    </>,
  )
  return { onChoose, trigger: screen.getByRole('button', { name: 'Add subdomain from file…' }) }
}

const items = () => screen.getAllByRole('menuitem')

describe('ChoiceMenu', () => {
  it('is a closed menu button until pressed, then lists every choice and focuses the first', () => {
    const { trigger } = renderMenu()
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.click(trigger)

    const menu = screen.getByRole('menu', { name: 'Add subdomain from file…' })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(trigger.getAttribute('aria-controls')).toBe(menu.id)
    expect(items().map((i) => i.textContent)).toEqual(['Import into Billing', 'Import into a new contextStarts its own context'])
    expect(document.activeElement).toBe(items()[0])
  })

  it('opens from ArrowDown on the trigger', () => {
    const { trigger } = renderMenu()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(document.activeElement).toBe(items()[0])
  })

  it('moves focus with the arrow keys, wrapping at both ends', () => {
    const { trigger } = renderMenu()
    fireEvent.click(trigger)
    const [first, second] = items()
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(second)
    fireEvent.keyDown(second, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(second)
  })

  it('closes on Escape, returns focus to the trigger, and keeps the key from document listeners', () => {
    const { trigger } = renderMenu()
    const onDocumentKey = vi.fn()
    document.addEventListener('keydown', onDocumentKey)
    try {
      fireEvent.click(trigger)
      fireEvent.keyDown(items()[0], { key: 'Escape' })
      expect(screen.queryByRole('menu')).toBeNull()
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
      expect(document.activeElement).toBe(trigger)
      expect(onDocumentKey).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', onDocumentKey)
    }
  })

  it('calls onChoose with the chosen id once, closes, and returns focus to the trigger', () => {
    const { trigger, onChoose } = renderMenu()
    fireEvent.click(trigger)
    fireEvent.click(items()[1])
    expect(onChoose).toHaveBeenCalledTimes(1)
    expect(onChoose).toHaveBeenCalledWith('new')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('closes on a press outside, but not on a press inside the menu', () => {
    const { trigger, onChoose } = renderMenu()
    fireEvent.click(trigger)
    fireEvent.pointerDown(items()[0])
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(onChoose).not.toHaveBeenCalled()
  })

  it('closes on Tab, handing focus back to the trigger so the browser tabs on from there', () => {
    const { trigger } = renderMenu()
    fireEvent.click(trigger)
    fireEvent.keyDown(items()[0], { key: 'Tab' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('renders a choice with `checked` as a menuitemcheckbox carrying its state, and leaves the others plain', () => {
    render(
      <ChoiceMenu
        label="View"
        choices={[
          { id: 'guides', label: 'Guides', checked: true },
          { id: 'highlight', label: 'Highlight', checked: false },
          { id: 'reset', label: 'Reset' },
        ]}
        onChoose={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'View' }))
    expect(screen.getByRole('menuitemcheckbox', { name: 'Guides' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('menuitemcheckbox', { name: 'Highlight' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('menuitem', { name: 'Reset' }).hasAttribute('aria-checked')).toBe(false)
  })

  it('moves focus across checkbox and plain items alike, starting on the first', () => {
    render(
      <ChoiceMenu
        label="View"
        choices={[
          { id: 'guides', label: 'Guides', checked: true },
          { id: 'reset', label: 'Reset' },
        ]}
        onChoose={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'View' }))
    const guides = screen.getByRole('menuitemcheckbox', { name: 'Guides' })
    expect(document.activeElement).toBe(guides)
    fireEvent.keyDown(guides, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Reset' }))
  })

  it('toggles closed when the trigger is pressed again', () => {
    const { trigger } = renderMenu()
    fireEvent.click(trigger)
    fireEvent.click(trigger)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens under the trigger’s left edge by default', () => {
    const { trigger } = renderMenu()
    trigger.getBoundingClientRect = () => ({ left: 100, right: 132, bottom: 40 }) as DOMRect
    fireEvent.click(trigger)
    const menu = screen.getByRole('menu')
    expect([menu.style.top, menu.style.left, menu.style.right]).toEqual(['44px', '100px', ''])
  })

  it('with align="end", pins the menu’s right edge to the trigger’s so a trigger near the viewport edge keeps it on screen', () => {
    render(<ChoiceMenu label="Appearance" align="end" className="icon-trigger" choices={CHOICES} onChoose={() => {}} />)
    const trigger = screen.getByRole('button', { name: 'Appearance' })
    expect(trigger.classList.contains('icon-trigger')).toBe(true)
    trigger.getBoundingClientRect = () => ({ left: 900, right: 932, bottom: 40 }) as DOMRect
    fireEvent.click(trigger)
    const menu = screen.getByRole('menu')
    expect([menu.style.top, menu.style.left, menu.style.right]).toEqual(['44px', '', `${innerWidth - 932}px`])
  })

  describe('keeping the menu on screen', () => {
    const MENU = { width: 200, height: 80 }
    const rectOf = (left: number, top: number, width: number, height: number) =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }) as DOMRect

    function openAt(trigger: DOMRect, obstacle?: DOMRect) {
      vi.stubGlobal('innerWidth', 1000)
      vi.stubGlobal('innerHeight', 700)
      const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        if (this.getAttribute('role') === 'menu') return rectOf(0, 0, MENU.width, MENU.height)
        if (this.hasAttribute('data-menu-avoid')) return obstacle!
        return trigger
      })
      const legend = document.createElement('section')
      legend.setAttribute('data-menu-avoid', '')
      if (obstacle) document.body.append(legend)
      const { trigger: button } = renderMenu()
      fireEvent.click(button)
      legend.remove()
      spy.mockRestore()
      vi.unstubAllGlobals()
      return screen.getByRole('menu')
    }

    it('opens upward when the trigger is near the bottom edge', () => {
      const menu = openAt(rectOf(100, 660, 32, 32))
      expect(parseFloat(menu.style.top) + MENU.height).toBeLessThanOrEqual(700)
      expect(parseFloat(menu.style.top)).toBe(660 - MENU.height - 4)
    })

    it('opens leftward when the trigger is near the right edge', () => {
      const menu = openAt(rectOf(970, 100, 24, 24))
      expect(menu.style.left).toBe('')
      expect(parseFloat(menu.style.right)).toBe(1000 - 994)
    })

    it('never covers an element marked data-menu-avoid', () => {
      const legend = rectOf(740, 440, 260, 250)
      const menu = openAt(rectOf(780, 400, 24, 24), legend)
      const left = menu.style.left ? parseFloat(menu.style.left) : 1000 - parseFloat(menu.style.right) - MENU.width
      const top = parseFloat(menu.style.top)
      const overlaps = left < legend.right && left + MENU.width > legend.left && top < legend.bottom && top + MENU.height > legend.top
      expect(overlaps).toBe(false)
    })
  })

  it('runs onTrigger instead of opening when given one', () => {
    const onTrigger = vi.fn()
    render(<ChoiceMenu label="Pick" choices={CHOICES} onChoose={() => {}} onTrigger={onTrigger} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pick' }))
    fireEvent.keyDown(screen.getByRole('button', { name: 'Pick' }), { key: 'ArrowDown' })
    expect(onTrigger).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens itself when autoOpen turns true', () => {
    const { rerender } = render(<ChoiceMenu label="Pick" choices={CHOICES} onChoose={() => {}} />)
    expect(screen.queryByRole('menu')).toBeNull()
    rerender(<ChoiceMenu label="Pick" choices={CHOICES} onChoose={() => {}} autoOpen />)
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('reports onDismiss for Escape, Tab, an outside press and the trigger, but not for a choice', () => {
    const onDismiss = vi.fn()
    render(
      <>
        <ChoiceMenu label="Pick" choices={CHOICES} onChoose={() => {}} onDismiss={onDismiss} />
        <button type="button">Elsewhere</button>
      </>,
    )
    const trigger = screen.getByRole('button', { name: 'Pick' })
    fireEvent.click(trigger)
    fireEvent.keyDown(items()[0], { key: 'Escape' })
    fireEvent.click(trigger)
    fireEvent.keyDown(items()[0], { key: 'Tab' })
    fireEvent.click(trigger)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }))
    fireEvent.click(trigger)
    fireEvent.click(trigger)
    expect(onDismiss).toHaveBeenCalledTimes(4)
    fireEvent.click(trigger)
    fireEvent.click(items()[0])
    expect(onDismiss).toHaveBeenCalledTimes(4)
  })
})

describe('ChoiceMenu group headings', () => {
  const GROUPED = [
    { id: 'copy', label: 'Copy link', control: 'action' },
    { id: 'scope', label: 'Only the current hexagon', checked: false, control: 'switch', group: 'Export image' },
    { id: 'svg', label: 'SVG', control: 'action', group: 'Export image' },
    { id: 'png', label: 'PNG', control: 'action', group: 'Export image' },
  ] as const

  const open = () => {
    render(<ChoiceMenu label="Share" choices={GROUPED} onChoose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
  }

  it('wraps consecutive choices sharing a group in a labelled group, leaving the others outside it', () => {
    open()
    const group = screen.getByRole('group', { name: 'Export image' })
    expect([...group.querySelectorAll('[role^="menuitem"]')].map((i) => i.textContent)).toEqual(['Only the current hexagon', 'SVG', 'PNG'])
    expect(within(group).queryByRole('menuitem', { name: 'Copy link' })).toBeNull()
    expect(group.getAttribute('aria-labelledby')).toBe(screen.getByText('Export image').id)
  })

  it('sets the group apart from the choices before it with a separator, and keeps every item in arrow-key order', () => {
    open()
    const group = screen.getByRole('group', { name: 'Export image' })
    const menuSeparators = [...screen.getByRole('menu').children].filter((child) => child.getAttribute('role') === 'separator')
    expect(menuSeparators).toEqual([group.previousElementSibling])
    expect(group.previousElementSibling?.previousElementSibling?.textContent).toBe('Copy link')
    const names = [...screen.getByRole('menu').querySelectorAll('[role^="menuitem"]')].map((i) => i.textContent)
    expect(names).toEqual(['Copy link', 'Only the current hexagon', 'SVG', 'PNG'])
  })

  it('renders a group once, at its first choice, even when its choices are not consecutive', () => {
    const scattered = [
      { id: 'basic', label: 'Basic', control: 'action', group: 'Hexagonal' },
      { id: 'onion', label: 'Onion basic', control: 'action', group: 'Onion' },
      { id: 'stress', label: 'Stress', control: 'action', group: 'Hexagonal' },
    ] as const
    render(<ChoiceMenu label="File" choices={scattered} onChoose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'File' }))
    expect(screen.getAllByRole('group').map((g) => g.getAttribute('aria-labelledby') && document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent)).toEqual(['Hexagonal', 'Onion'])
    expect(within(screen.getByRole('group', { name: 'Hexagonal' })).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Basic', 'Stress'])
  })

  it('does not count the heading as an item', () => {
    open()
    expect(screen.queryByRole('menuitem', { name: 'Export image' })).toBeNull()
  })
})

describe('ChoiceMenu stayOpen', () => {
  const MIXED = [
    { id: 'a', label: 'Alpha', checked: false, control: 'switch' },
    { id: 'b', label: 'Beta', checked: true, control: 'radio' },
    { id: 'go', label: 'Go', control: 'action' },
  ] as const

  function renderStaying(stayOpen?: boolean) {
    const onChoose = vi.fn()
    render(
      <>
        <ChoiceMenu label="Options" choices={MIXED} onChoose={onChoose} stayOpen={stayOpen} />
        <button type="button">Elsewhere</button>
      </>,
    )
    const trigger = screen.getByRole('button', { name: 'Options' })
    fireEvent.click(trigger)
    return { onChoose, trigger }
  }

  it('keeps the menu open after a switch or a radio is chosen, still reporting each choice', () => {
    const { onChoose } = renderStaying(true)
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Alpha' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Beta' }))
    expect(onChoose.mock.calls).toEqual([['a'], ['b']])
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('still closes after an action', () => {
    const { onChoose, trigger } = renderStaying(true)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Go' }))
    expect(onChoose).toHaveBeenCalledWith('go')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('still closes on Escape, Tab, an outside press and the trigger', () => {
    const { trigger } = renderStaying(true)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(trigger)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(trigger)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }))
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(trigger)
    fireEvent.click(trigger)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes after a toggle by default', () => {
    renderStaying()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Alpha' }))
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('ChoiceMenu submenu', () => {
  const WITH_SUB = [
    { id: 'new', label: 'New', control: 'action' },
    {
      id: 'examples',
      label: 'Start from an example',
      control: 'action',
      submenu: [
        { id: 'hex-basic', label: 'Basic hex', control: 'action', group: 'Hexagonal' },
        { id: 'hex-stress', label: 'Stress hex', control: 'action', group: 'Hexagonal' },
        { id: 'onion-basic', label: 'Basic onion', control: 'action', group: 'Onion' },
      ],
    },
  ] as const

  function renderSub() {
    const onChoose = vi.fn()
    render(<ChoiceMenu label="File" choices={WITH_SUB} onChoose={onChoose} />)
    const trigger = screen.getByRole('button', { name: 'File' })
    fireEvent.click(trigger)
    return { onChoose, trigger, parent: screen.getByRole('menuitem', { name: 'Start from an example' }) }
  }

  it('marks the parent as a menu button and keeps the submenu closed until it is asked for', () => {
    const { parent } = renderSub()
    expect(parent.getAttribute('aria-haspopup')).toBe('menu')
    expect(parent.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getAllByRole('menu')).toHaveLength(1)
    expect(screen.getByRole('menuitem', { name: 'New' }).hasAttribute('aria-haspopup')).toBe(false)
  })

  it.each([
    ['a click', (parent: HTMLElement) => fireEvent.click(parent)],
    ['ArrowRight', (parent: HTMLElement) => fireEvent.keyDown(parent, { key: 'ArrowRight' })],
  ])('opens on %s with its own labelled menu, grouped, focusing the first item and choosing nothing', (_name, act) => {
    const { parent, onChoose } = renderSub()
    act(parent)
    const sub = screen.getByRole('menu', { name: 'Start from an example' })
    expect(parent.getAttribute('aria-expanded')).toBe('true')
    expect(within(sub).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Basic hex', 'Stress hex', 'Basic onion'])
    expect(within(sub).getByRole('group', { name: 'Hexagonal' })).toBeTruthy()
    expect(within(sub).getByRole('group', { name: 'Onion' })).toBeTruthy()
    expect(document.activeElement).toBe(within(sub).getAllByRole('menuitem')[0])
    expect(onChoose).not.toHaveBeenCalled()
  })

  it('keeps arrow-key navigation inside whichever menu has focus', () => {
    const { parent } = renderSub()
    fireEvent.click(parent)
    const [first, second] = within(screen.getByRole('menu', { name: 'Start from an example' })).getAllByRole('menuitem')
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(second)
  })

  it.each(['ArrowLeft', 'Escape'])('%s closes only the submenu and returns focus to its parent', (key) => {
    const { parent } = renderSub()
    const onDocumentKey = vi.fn()
    document.addEventListener('keydown', onDocumentKey)
    try {
      fireEvent.click(parent)
      fireEvent.keyDown(within(screen.getByRole('menu', { name: 'Start from an example' })).getAllByRole('menuitem')[0], { key })
      expect(screen.queryByRole('menu', { name: 'Start from an example' })).toBeNull()
      expect(screen.getByRole('menu', { name: 'File' })).toBeTruthy()
      expect(parent.getAttribute('aria-expanded')).toBe('false')
      expect(document.activeElement).toBe(parent)
      expect(onDocumentKey).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', onDocumentKey)
    }
  })

  it('Tab inside the submenu closes everything, refocuses the trigger and reports the dismissal', () => {
    const onDismiss = vi.fn()
    render(<ChoiceMenu label="File" choices={WITH_SUB} onChoose={() => {}} onDismiss={onDismiss} />)
    const trigger = screen.getByRole('button', { name: 'File' })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Start from an example' }))
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Basic hex' }), { key: 'Tab' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it.each(['ArrowDown', 'ArrowUp'])('%s in the parent menu closes an open submenu and keeps the menu', (key) => {
    const { parent } = renderSub()
    fireEvent.click(parent)
    fireEvent.keyDown(parent, { key })
    expect(screen.queryByRole('menu', { name: 'Start from an example' })).toBeNull()
    expect(screen.getByRole('menu', { name: 'File' })).toBeTruthy()
  })

  it('a press outside closes the submenu and the menu', () => {
    const { parent } = renderSub()
    fireEvent.click(parent)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('choosing a leaf reports its id once and closes everything', () => {
    const { parent, trigger, onChoose } = renderSub()
    fireEvent.click(parent)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stress hex' }))
    expect(onChoose).toHaveBeenCalledTimes(1)
    expect(onChoose).toHaveBeenCalledWith('hex-stress')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('does not reopen a submenu when the menu is opened again', () => {
    const { parent, trigger } = renderSub()
    fireEvent.click(parent)
    fireEvent.click(trigger)
    fireEvent.click(trigger)
    expect(screen.getAllByRole('menu')).toHaveLength(1)
  })

  it('sits beside the parent item, and flips to its left when there is no room on the right', () => {
    const rectOf = (left: number, top: number, width: number, height: number) =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }) as DOMRect
    vi.stubGlobal('innerWidth', 1000)
    vi.stubGlobal('innerHeight', 700)
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'menu' ? rectOf(0, 0, 200, 80) : this.textContent === 'Start from an example' ? this.dataset.far ? rectOf(780, 100, 200, 32) : rectOf(100, 100, 200, 32) : rectOf(100, 20, 32, 32)
    })
    try {
      const { parent } = renderSub()
      fireEvent.click(parent)
      let sub = screen.getByRole('menu', { name: 'Start from an example' })
      expect([sub.style.top, sub.style.left]).toEqual(['100px', '304px'])
      cleanup()
      render(<ChoiceMenu label="File" choices={WITH_SUB} onChoose={() => {}} />)
      fireEvent.click(screen.getByRole('button', { name: 'File' }))
      const far = screen.getByRole('menuitem', { name: 'Start from an example' })
      far.dataset.far = '1'
      fireEvent.click(far)
      sub = screen.getByRole('menu', { name: 'Start from an example' })
      expect([sub.style.top, sub.style.left]).toEqual(['100px', '576px'])
    } finally {
      spy.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('shows a choice’s shortcut beside its label without adding it to the accessible name', () => {
    render(<ChoiceMenu label="File" choices={[{ id: 'save', label: 'Save .hexa', shortcut: 'Ctrl+S' }]} onChoose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'File' }))
    const save = screen.getByRole('menuitem', { name: 'Save .hexa' })
    expect(save.textContent).toBe('Save .hexaCtrl+S')
    expect(save.querySelector('.choice-shortcut')?.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('ChoiceMenu disabled choice', () => {
  const setup = () => {
    const onChoose = vi.fn()
    render(<ChoiceMenu label="Menu" choices={[{ id: 'a', label: 'A' }, { id: 'b', label: '+ New', description: 'No free side', disabled: true }]} onChoose={onChoose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    return { onChoose, disabled: screen.getByRole('menuitem', { name: /\+ New/ }) }
  }

  it('is marked aria-disabled, shows its reason, and stays reachable by arrow keys', () => {
    const { disabled } = setup()
    expect(disabled.getAttribute('aria-disabled')).toBe('true')
    expect(disabled.textContent).toContain('No free side')
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(disabled)
  })

  it('does not choose or close on click or Enter', () => {
    const { onChoose, disabled } = setup()
    fireEvent.click(disabled)
    fireEvent.keyDown(disabled, { key: 'Enter' })
    expect(onChoose).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeTruthy()
  })
})
