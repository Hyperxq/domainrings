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

  return (
    <dialog
      ref={dialogRef}
      className="island convert-dialog"
      aria-labelledby="convert-dialog-message"
      onCancel={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.stopPropagation()
        onCancel()
      }}
    >
      <p id="convert-dialog-message">
        Maps with several hexagons are hexagonal. Convert this {KINDS[kind].label} map to hexagonal?
      </p>
      <div className="dialog-actions">
        <button ref={cancelRef} type="button" className="text-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="text-button" onClick={onConfirm}>
          {ACTION_LABEL[action]}
        </button>
      </div>
    </dialog>
  )
}
