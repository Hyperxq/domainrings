import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ArchitectureChoiceDialog } from './ArchitectureChoiceDialog'
import { installDialogPolyfill } from '../test/fixtures'

beforeAll(installDialogPolyfill)
afterEach(cleanup)

function renderDialog() {
  const onChoose = vi.fn()
  const onCancel = vi.fn()
  render(<ArchitectureChoiceDialog onChoose={onChoose} onCancel={onCancel} />)
  return { onChoose, onCancel }
}

describe('ArchitectureChoiceDialog (REQ-01)', () => {
  it('opens as a modal dialog offering exactly Hexagonal and Onion', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog')
    expect(dialog.hasAttribute('open')).toBe(true)
    expect(screen.getByRole('button', { name: 'Hexagonal' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Onion' })).toBeTruthy()
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('picking Hexagonal calls onChoose with "hexagonal", never onCancel', () => {
    const { onChoose, onCancel } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Hexagonal' }))
    expect(onChoose).toHaveBeenCalledExactlyOnceWith('hexagonal')
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('picking Onion calls onChoose with "onion", never onCancel', () => {
    const { onChoose, onCancel } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Onion' }))
    expect(onChoose).toHaveBeenCalledExactlyOnceWith('onion')
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('Esc calls onCancel, calling onChoose for neither choice, and keeps the key from document listeners', () => {
    const { onChoose, onCancel } = renderDialog()
    const onDocumentKey = vi.fn()
    document.addEventListener('keydown', onDocumentKey)
    try {
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
      expect(onCancel).toHaveBeenCalledOnce()
      expect(onChoose).not.toHaveBeenCalled()
      expect(onDocumentKey).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', onDocumentKey)
    }
  })
})
