import { flushSync } from 'react-dom'
import { create } from 'zustand'
import { collectionOf } from '../../model/links'
import { diagramOf } from '../../model/map'
import type { HexaMap } from '../../model/schema'
import { useMapStore } from '../../model/store'
import { revealInEditor } from '../revealInEditor'
import { useHistoryStore } from './historyStore'
import { useNoticeStore } from './noticeStore'

export type ExportScope = 'map' | 'hexagon'

/** View state, not part of the document. */
interface ViewData {
  editorOpen: boolean
  /** Which hexagons the author expanded, kept for the document they were chosen in. */
  expanded: ReadonlySet<string>
  exportScope: ExportScope
  choosingArchitecture: boolean
  /** Link mode: the element being linked. It ends when that element goes, or the whole map is swapped. */
  linking: string | null
  /** Grow: the just-added hexagon's own inline title field is open until it commits or is undone (GROW-03). */
  growing: { hexId: string; before: { map: HexaMap; focus: string } } | null
}

interface ViewStore extends ViewData {
  /** Opens the editor at the card for `ref` (an item id, `composition` or `layer:<role>`); `focus` selects its first field. */
  reveal: (ref: string, focus: boolean) => void
  /** Expands a compact hexagon in full, or compacts an expanded one back. */
  toggleExpanded: (id: string) => void
  expandAll: (ids: string[]) => void
  /** Enters link mode on `ref`, or leaves it with `null`. */
  startLinking: (ref: string | null) => void
  /** Names the just-grown hexagon, which completes the add step Undo already covers. */
  commitGrow: (title: string) => void
  /** Esc while naming: the grow is undone, exactly as a one-step undo. */
  cancelGrow: () => void
}

const initialView = (): ViewData => ({
  editorOpen: typeof matchMedia === 'function' ? !matchMedia('(max-width: 720px)').matches : true,
  expanded: new Set(),
  exportScope: 'map',
  choosingArchitecture: false,
  linking: null,
  growing: null,
})

export const useViewStore = create<ViewStore>()((set, get) => ({
  ...initialView(),
  reveal: (ref, focus) => {
    // The card only exists to scroll to once the collapsed editor has rendered open.
    flushSync(() => set({ editorOpen: true }))
    revealInEditor(ref, focus)
  },
  toggleExpanded: (id) => set(({ expanded }) => ({ expanded: new Set(expanded.has(id) ? [...expanded].filter((x) => x !== id) : [...expanded, id]) })),
  expandAll: (ids) => set({ expanded: new Set(ids) }),
  startLinking: (ref) => {
    if (ref) useNoticeStore.getState().clearStatus()
    set({ linking: ref })
  },
  commitGrow: (title) => {
    useHistoryStore.getState().absorbEdit()
    useMapStore.getState().setMeta(get().growing!.hexId, { title })
    set({ growing: null })
  },
  cancelGrow: () => {
    const { before } = get().growing!
    useHistoryStore.getState().dropUndo(before)
    useMapStore.getState().restore(before)
    set({ growing: null })
    useNoticeStore.setState({ notice: null })
  },
}))

// The expanded set and link mode belong to the document they were chosen in: a swapped map ends both, and
// link mode also ends once the element being linked is gone.
useMapStore.subscribe(({ map, focus, revision }, prev) => {
  const { linking } = useViewStore.getState()
  if (revision !== prev.revision) useViewStore.setState({ expanded: new Set(), linking: null })
  else if (linking && !collectionOf(diagramOf(map, focus), linking)) useViewStore.setState({ linking: null })
})
