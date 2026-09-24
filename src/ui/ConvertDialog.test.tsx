import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ConvertDialog } from './ConvertDialog'

beforeAll(() => {
  // jsdom does not implement the dialog element's modal behaviour (v30).
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})
afterEach(cleanup)

function renderDialog(overrides: { kind?: 'clean' | 'onion'; action?: 'add' | 'import' } = {}) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(<ConvertDialog kind={overrides.kind ?? 'clean'} action={overrides.action ?? 'add'} onConfirm={onConfirm} onCancel={onCancel} />)
  return { onConfirm, onCancel }
}

describe('ConvertDialog (CONV-01, CONV-02)', () => {
  it('opens as a modal dialog and asks to convert, naming the map’s own kind (CONV-01.1)', () => {
    renderDialog({ kind: 'clean' })
    const dialog = screen.getByRole('dialog')
    expect(dialog.hasAttribute('open')).toBe(true)
    expect(dialog.textContent).toContain('Maps with several hexagons are hexagonal. Convert this Clean map to hexagonal?')
  })

  it('names the Onion kind and offers "Convert and import" for the import trigger (CONV-01.2)', () => {
    renderDialog({ kind: 'onion', action: 'import' })
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('Convert this Onion map to hexagonal?')
    expect(screen.getByRole('button', { name: 'Convert and import' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Convert and add' })).toBeNull()
  })

  it('offers "Convert and add" for the grow trigger', () => {
    renderDialog({ action: 'add' })
    expect(screen.getByRole('button', { name: 'Convert and add' })).toBeTruthy()
  })

  it('focuses Cancel by default', () => {
    renderDialog()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  })

  it('Cancel calls onCancel without calling onConfirm', () => {
    const { onCancel, onConfirm } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('the confirm button calls onConfirm without calling onCancel', () => {
    const { onCancel, onConfirm } = renderDialog({ action: 'add' })
    fireEvent.click(screen.getByRole('button', { name: 'Convert and add' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('Esc calls onCancel and keeps the key from document listeners', () => {
    const { onCancel } = renderDialog()
    const onDocumentKey = vi.fn()
    document.addEventListener('keydown', onDocumentKey)
    try {
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
      expect(onCancel).toHaveBeenCalledOnce()
      expect(onDocumentKey).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', onDocumentKey)
    }
  })
})
