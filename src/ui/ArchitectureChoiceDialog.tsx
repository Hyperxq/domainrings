import { useEffect, useRef } from 'react'

export type ArchitectureChoice = 'hexagonal' | 'onion'

interface ArchitectureChoiceDialogProps {
  onChoose: (kind: ArchitectureChoice) => void
  onCancel: () => void
}

const CHOICES: { kind: ArchitectureChoice; label: string }[] = [
  { kind: 'hexagonal', label: 'Hexagonal' },
  { kind: 'onion', label: 'Onion' },
]

/**
 * The one-time, permanent architecture choice for a brand-new file (REQ-01) — Hexagonal or Onion only, Clean is
 * not offered until it exists natively. Same modal `<dialog>` pattern as ConvertDialog: real focus-trapping,
 * Esc closes without choosing, Undo never bubbles past it.
 */
export function ArchitectureChoiceDialog({ onChoose, onCancel }: ArchitectureChoiceDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const firstRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    dialogRef.current?.showModal()
    firstRef.current?.focus()
  }, [])

  const settle = (callback: () => void) => {
    dialogRef.current?.close()
    callback()
  }

  return (
    <dialog
      ref={dialogRef}
      className="island architecture-choice-dialog"
      aria-labelledby="architecture-choice-message"
      onCancel={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          settle(onCancel)
          return
        }
        // Undo is a document-level shortcut (Toast); left alone here it would bubble past the modal.
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
          e.preventDefault()
          e.stopPropagation()
        }
      }}
    >
      <p id="architecture-choice-message">Choose an architecture for the new file. This cannot be changed later.</p>
      <div className="dialog-actions">
        {CHOICES.map((choice, i) => (
          <button
            key={choice.kind}
            ref={i === 0 ? firstRef : undefined}
            type="button"
            className="text-button"
            onClick={() => settle(() => onChoose(choice.kind))}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </dialog>
  )
}
