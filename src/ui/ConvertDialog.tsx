import { useEffect, useRef } from 'react'
import { KINDS } from '../model/kinds'
import type { ArchitectureKind } from '../model/schema'

interface ConvertDialogProps {
  /** The map's own kind before conversion — always Clean or Onion in practice (CONV-01). */
  kind: ArchitectureKind
  /** Which action triggered the question, naming the confirm button (CONV-01.1/01.2). */
  action: 'add' | 'import'
  onConfirm: () => void
  onCancel: () => void
}

const ACTION_LABEL: Record<'add' | 'import', string> = { add: 'Convert and add', import: 'Convert and import' }

/**
 * Asks to convert a Clean/Onion map to hexagonal before growing or importing into it (CONV-01..05). A native
 * `<dialog>` gets modal focus-trapping for free; Cancel is focused imperatively (rather than relying on the
 * browser's own autofocus algorithm, which `showModal` could otherwise race). Esc is caught at the keydown level,
 * like `ChoiceMenu`, so it never reaches the document-level Toast/Stage/fullscreen listeners.
 */
export function ConvertDialog({ kind, action, onConfirm, onCancel }: ConvertDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    dialogRef.current?.showModal()
    cancelRef.current?.focus()
  }, [])

  // Real-browser focus trapping keeps focus inside an open modal <dialog> — a caller's own `.focus()` on the
  // opener (CONV-02.1) is silently blocked until the dialog itself closes, so `close()` runs first, synchronously,
  // before either callback (found via s003-smoke.mjs; invisible in jsdom, which does not trap focus at all).
  const settle = (callback: () => void) => {
    dialogRef.current?.close()
    callback()
  }

  return (
    <dialog
      ref={dialogRef}
      className="island convert-dialog"
      aria-labelledby="convert-dialog-message"
      onCancel={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          settle(onCancel)
          return
        }
        // Undo is a document-level shortcut (Toast); left alone here it would bubble past the modal and undo
        // whatever the question is asking about while it's still on screen (CONV-02.3).
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
          e.preventDefault()
          e.stopPropagation()
        }
      }}
    >
      <p id="convert-dialog-message">
        Maps with several hexagons are hexagonal. Convert this {KINDS[kind].label} map to hexagonal?
      </p>
      <div className="dialog-actions">
        <button ref={cancelRef} type="button" className="text-button" onClick={() => settle(onCancel)}>
          Cancel
        </button>
        <button type="button" className="text-button" onClick={() => settle(onConfirm)}>
          {ACTION_LABEL[action]}
        </button>
      </div>
    </dialog>
  )
}
