import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
      <ChoiceMenu label="Add hexagon from file…" choices={CHOICES} onChoose={onChoose} />
      <button type="button">Elsewhere</button>
    </>,
  )
  return { onChoose, trigger: screen.getByRole('button', { name: 'Add hexagon from file…' }) }
}

const items = () => screen.getAllByRole('menuitem')

describe('ChoiceMenu', () => {
  it('is a closed menu button until pressed, then lists every choice and focuses the first', () => {
    const { trigger } = renderMenu()
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.click(trigger)

    const menu = screen.getByRole('menu', { name: 'Add hexagon from file…' })
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
})
