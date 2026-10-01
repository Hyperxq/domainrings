import { create } from 'zustand'
import { toHexa } from '../../model/hexa'
import { useCleanStore } from '../../model/cleanStore'
import { useOnionStore } from '../../model/onionStore'
import { useMapStore } from '../../model/store'
import type { StoredFile } from '../../model/fileFormat'
import type { CleanFile, HexaMap, OnionFile } from '../../model/schema'
import type { UndoSnapshot } from '../notice'

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

interface PendingField {
  before: { map: HexaMap; focus: string }
  field: Element
}

interface HistoryStore {
  stack: UndoSnapshot[]
  // Snapshots are whole documents, so undoing over an edit that never went through show() would silently discard
  // it. The document as the newest step left it is kept here (refreshed after the render that follows a recorded
  // step); undo refuses, and drops the now-unsafe history, once the active document has moved off it.
  trusted: StoredFile | undefined
  recordedStep: boolean
  // The text field being edited, if any: its session ends on blur, or when the field leaves the page without one.
  pending: PendingField | null
  /** Bumped by a step recorded outside a render, which the host must see to refresh `trusted`. */
  renders: number
  /** `after` is the document the session left: a discrete edit flushing it has already changed the store since. */
  endField: (after?: HexaMap) => void
  beginField: (before: { map: HexaMap; focus: string }, field: Element) => void
  /** A step with no toast, for edits that never raised one (adding an item); a pending field session ends first. */
  record: (undo: UndoSnapshot) => void
  /** For an edit that unwinds itself (naming cancelled): its step must not stay behind as an undo. */
  dropUndo: (entry?: UndoSnapshot) => void
  /** Naming a just-added element completes the add step Undo already covers, so the document it leaves is trusted. */
  absorbEdit: () => void
  /** Pops the newest step back into its store: that step, `'unavailable'` when the active document has moved off
   * what history tracks, or `undefined` when there is nothing to undo. */
  undo: (activeFile: StoredFile) => UndoSnapshot | 'unavailable' | undefined
  /** After a render: ends a field session its field outlived, and trusts the document a recorded step left. */
  settle: (activeFile: StoredFile, hexId: string) => void
}

/** One in-memory history for all three kinds, fed by every notice that offers an Undo: the toast's button and
 * Ctrl/Cmd+Z both pop it, so they can never undo the same step twice. */
export const useHistoryStore = create<HistoryStore>()((set, get) => {
  // The stack push alone: `endField` uses it directly so ending a session can never end one again.
  const pushStep = (undo: UndoSnapshot) => {
    const { trusted, stack } = get()
    // A step that doesn't lead back from the document the last one left means an unrecorded edit sits between them.
    const contiguous = !trusted || sameDoc(trusted, undo.map)
    // The flag is only consumed by a render, and a step recorded once its edit is done (a field session ends on blur) has none coming.
    set((s) => ({ stack: [...(contiguous ? stack : []), undo].slice(-UNDO_LIMIT), recordedStep: true, renders: s.renders + 1 }))
  }
  const endField = (after: HexaMap = useMapStore.getState().map) => {
    const { pending } = get()
    set({ pending: null })
    if (!pending || sameDoc(pending.before.map, after)) return
    pushStep(pending.before)
    set({ trusted: after })
  }
  return {
    stack: [],
    trusted: undefined,
    recordedStep: false,
    pending: null,
    renders: 0,
    endField,
    beginField: (before, field) => {
      endField()
      set({ pending: { before, field } })
    },
    record: (undo) => {
      endField(undo.map.kind === 'hexagonal' ? undo.map : undefined)
      pushStep(undo)
    },
    dropUndo: (entry) => {
      set({ recordedStep: true })
      const { stack } = get()
      if (entry && stack.at(-1) === entry) set({ stack: stack.slice(0, -1) })
    },
    absorbEdit: () => set((s) => ({ recordedStep: true, renders: s.renders + 1 })),
    undo: (activeFile) => {
      const { trusted, stack, pending } = get()
      if (!trusted || !sameDoc(activeFile, trusted)) {
        set({ stack: [] })
        return 'unavailable'
      }
      const entry = stack.at(-1)
      if (!entry) return undefined
      set({ stack: stack.slice(0, -1), pending: null })
      restoreUndo(entry)
      // A field still focused keeps recording: its next edit starts a session from the restored document.
      if (pending?.field.isConnected && document.activeElement === pending.field) {
        const { map, focus } = useMapStore.getState()
        set({ pending: { before: { map, focus }, field: pending.field } })
      }
      set({ recordedStep: true })
      return entry
    },
    settle: (activeFile, hexId) => {
      const { pending, recordedStep } = get()
      // A browser does not reliably blur a field that is removed, and a still-mounted one can outlive its hexagon.
      if (pending && (!pending.field.isConnected || pending.before.focus !== hexId)) endField()
      if (!recordedStep) return
      set({ trusted: activeFile, recordedStep: false })
    },
  }
})
