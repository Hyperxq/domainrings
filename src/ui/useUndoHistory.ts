import { useEffect, useReducer, useRef } from 'react'
import { toHexa } from '../model/hexa'
import { useCleanStore } from '../model/cleanStore'
import { useOnionStore } from '../model/onionStore'
import { useMapStore } from '../model/store'
import type { StoredFile } from '../model/fileFormat'
import type { CleanFile, HexaMap, OnionFile } from '../model/schema'
import { typing } from './keys'
import type { UndoSnapshot } from './notice'

export const UNDO_LIMIT = 20

const { restore } = useMapStore.getState()
const { restore: restoreOnion } = useOnionStore.getState()
const { restore: restoreClean } = useCleanStore.getState()

/** Undo, generalized over all three kinds (REQ-09): routes to whichever store the snapshot's own document
 * belongs to — the one restore path every kind's toast shares. The runtime check IS the type guard; the cast
 * only tells TS what it already knows once `map.kind` has been read. */
const restoreUndo = (undo: UndoSnapshot) => {
  if (undo.map.kind === 'hexagonal') restore(undo as Extract<UndoSnapshot, { map: HexaMap }>)
  else if (undo.map.kind === 'onion') restoreOnion(undo as Extract<UndoSnapshot, { map: OnionFile }>)
  else restoreClean(undo as Extract<UndoSnapshot, { map: CleanFile }>)
}

const sameDoc = (a: StoredFile, b: StoredFile) => a === b || toHexa(a) === toHexa(b)

interface UndoHistoryContext {
  /** The active document's whole file, as this render sees it. */
  activeFile: StoredFile
  hexId: string
  choosingArchitecture: boolean
  /** Undo was asked for over a document it doesn't track. */
  onUnavailable: () => void
  /** The entry's document is back in its store; the view and notice that belong to it are the caller's to bring back. */
  onRestored: (entry: UndoSnapshot) => void
}

/** One in-memory history for all three kinds, fed by every notice that offers an Undo: the toast's button and
 * Ctrl/Cmd+Z both pop it, so they can never undo the same step twice. */
export function useUndoHistory({ activeFile, hexId, choosingArchitecture, onUnavailable, onRestored }: UndoHistoryContext) {
  const undoStack = useRef<UndoSnapshot[]>([])
  // Snapshots are whole documents, so undoing over an edit that never went through show() would silently discard
  // it. The document as the newest step left it is kept here (refreshed after the render that follows a recorded
  // step); undo refuses, and drops the now-unsafe history, once the active document has moved off it.
  const trustedDoc = useRef<StoredFile | undefined>(undefined)
  const recordedStep = useRef(false)
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  // The text field being edited, if any: its session ends on blur, or when the field leaves the page without one.
  const pendingField = useRef<{ before: { map: HexaMap; focus: string }; field: Element } | null>(null)
  // `after` is the document the session left: a discrete edit flushing it has already changed the store since.
  const endField = (after: HexaMap = useMapStore.getState().map) => {
    const pending = pendingField.current
    pendingField.current = null
    if (!pending || sameDoc(pending.before.map, after)) return
    pushStep(pending.before)
    trustedDoc.current = after
  }
  const beginField = (before: { map: HexaMap; focus: string }, field: Element) => {
    endField()
    pendingField.current = { before, field }
  }
  // A step with no toast, for edits that never raised one (adding an item); a pending field session ends first.
  const record = (undo: UndoSnapshot) => {
    endField(undo.map.kind === 'hexagonal' ? undo.map : undefined)
    pushStep(undo)
  }
  // The stack push alone: `endField` uses it directly so ending a session can never end one again.
  const pushStep = (undo: UndoSnapshot) => {
    // A step that doesn't lead back from the document the last one left means an unrecorded edit sits between them.
    const contiguous = !trustedDoc.current || sameDoc(trustedDoc.current, undo.map)
    undoStack.current = [...(contiguous ? undoStack.current : []), undo].slice(-UNDO_LIMIT)
    recordedStep.current = true
    // The flag is only consumed by a render, and a step recorded once its edit is done (a field session ends on blur) has none coming.
    rerender()
  }
  // For an edit that unwinds itself (naming cancelled): its step must not stay behind as an undo.
  const dropUndo = (entry?: UndoSnapshot) => {
    recordedStep.current = true
    if (entry && undoStack.current.at(-1) === entry) undoStack.current.pop()
  }
  const undoLast = () => {
    if (!trustedDoc.current || !sameDoc(activeFile, trustedDoc.current)) {
      undoStack.current = []
      onUnavailable()
      return
    }
    const entry = undoStack.current.pop()
    if (!entry) return
    const live = pendingField.current
    pendingField.current = null
    restoreUndo(entry)
    // A field still focused keeps recording: its next edit starts a session from the restored document.
    if (live?.field.isConnected && document.activeElement === live.field) {
      const { map, focus } = useMapStore.getState()
      pendingField.current = { before: { map, focus }, field: live.field }
    }
    recordedStep.current = true
    onRestored(entry)
  }
  // No dependency array on purpose: re-subscribing every render is what keeps `choosingArchitecture` and `undoLast` fresh.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== 'z' || e.defaultPrevented || typing(e.target) || choosingArchitecture || !undoStack.current.length) return
      // An open menu owns the keyboard; the choose-architecture dialog is tracked above, any other modal is a native one.
      if (document.querySelector('[role="menu"], dialog[open]')) return
      e.preventDefault()
      undoLast()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })
  useEffect(() => {
    // A browser does not reliably blur a field that is removed, and a still-mounted one can outlive its hexagon.
    if (pendingField.current && (!pendingField.current.field.isConnected || pendingField.current.before.focus !== hexId)) endField()
    if (!recordedStep.current) return
    trustedDoc.current = activeFile
    recordedStep.current = false
  })
  // Naming a just-added element completes the add step Undo already covers, so the document it leaves is trusted.
  const absorbEdit = () => {
    recordedStep.current = true
    rerender()
  }
  return { record, beginField, endField, dropUndo, undoLast, absorbEdit }
}
