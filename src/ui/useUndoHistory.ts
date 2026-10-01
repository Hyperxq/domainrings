import { useEffect } from 'react'
import type { StoredFile } from '../model/fileFormat'
import { typing } from './keys'
import type { UndoSnapshot } from './notice'
import { useHistoryStore } from './state/historyStore'
import { useViewStore } from './state/viewStore'

interface UndoHistoryContext {
  /** The active document's whole file, as this render sees it. */
  activeFile: StoredFile
  hexId: string
  /** Undo was asked for over a document it doesn't track. */
  onUnavailable: () => void
  /** The entry's document is back in its store; the view and notice that belong to it are the caller's to bring back. */
  onRestored: (entry: UndoSnapshot) => void
}

/** Wires the history to the render it belongs to: refreshes what it trusts after every render, and answers
 * Ctrl/Cmd+Z. Returns the one undo the toast's button shares. */
export function useUndoHistory({ activeFile, hexId, onUnavailable, onRestored }: UndoHistoryContext) {
  // Subscribed so a step recorded outside a render still gets the render that refreshes the trusted document.
  useHistoryStore((s) => s.renders)
  const undoLast = () => {
    const result = useHistoryStore.getState().undo(activeFile)
    if (result === 'unavailable') onUnavailable()
    else if (result) onRestored(result)
  }
  // No dependency array on purpose: re-subscribing every render is what keeps `undoLast` fresh.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== 'z' || e.defaultPrevented || typing(e.target) || useViewStore.getState().choosingArchitecture || !useHistoryStore.getState().stack.length) return
      // An open menu owns the keyboard; the choose-architecture dialog is tracked above, any other modal is a native one.
      if (document.querySelector('[role="menu"], dialog[open]')) return
      e.preventDefault()
      undoLast()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })
  useEffect(() => useHistoryStore.getState().settle(activeFile, hexId))
  return undoLast
}
