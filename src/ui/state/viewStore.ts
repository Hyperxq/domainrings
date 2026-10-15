import { flushSync } from 'react-dom'
import { create } from 'zustand'
import { collectionOf } from '../../model/links'
import { diagramOf } from '../../model/map'
import type { HexaMap } from '../../model/schema'
import { useMapStore } from '../../model/store'
import { revealInEditor } from '../revealInEditor'
import { useHistoryStore } from './historyStore'
import { useNoticeStore } from './noticeStore'
import { usePreferencesStore } from './preferencesStore'

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
  /** Editor tree branches (`context:<id>`, `subdomain:<id>`) that are open. */
  openNodes: ReadonlySet<string>
  /** Grow: the just-added hexagon's own inline title field is open until it commits or is undone (GROW-03). */
  growing: { hexId: string; before: { map: HexaMap; focus: string } } | null
  /** Counts the requests to refit the view; the viewport chrome answers each one as it does the Fit button. */
  fitRequest: number
  /** The toolbar's measured bottom edge in px, which the islands below it hang from; null until measured. */
  toolbarBottom: number | null
  /** The use case whose flow the View mode panel isolates on the canvas; null shows every flow. */
  focusedFlow: string | null
  /** The step of the focused flow being walked through; null while not presenting. */
  presentStep: number | null
}

interface ViewStore extends ViewData {
  /** Opens the editor at the card for `ref` (an item id, `composition` or `layer:<role>`); `focus` selects its first field.
   * `hexId` is the subdomain the card belongs to: its branch opens first, and the search stays inside it. */
  reveal: (ref: string, focus: boolean, hexId?: string) => void
  toggleNode: (key: string) => void
  /** Expands a compact hexagon in full, or compacts an expanded one back. */
  toggleExpanded: (id: string) => void
  expandAll: (ids: string[]) => void
  requestFit: () => void
  /** Focusing another flow, or none, also ends a walkthrough. */
  focusFlow: (useCaseId: string | null) => void
  present: (step: number | null) => void
  /** Enters link mode on `ref`, or leaves it with `null`. */
  startLinking: (ref: string | null) => void
  /** Names the just-grown hexagon, which completes the add step Undo already covers. */
  commitGrow: (title: string) => void
  /** Esc while naming: the grow is undone, exactly as a one-step undo. */
  cancelGrow: () => void
}

const branchOf = (map: HexaMap, hexId: string) => {
  const contextId = map.hexagons.find((h) => h.id === hexId)?.contextId
  return contextId ? [`context:${contextId}`, `subdomain:${hexId}`] : []
}

const initialView = (): ViewData => ({
  openNodes: new Set(branchOf(useMapStore.getState().map, useMapStore.getState().focus)),
  editorOpen: typeof matchMedia === 'function' ? !matchMedia('(max-width: 720px)').matches : true,
  expanded: new Set(),
  exportScope: 'map',
  choosingArchitecture: false,
  linking: null,
  growing: null,
  fitRequest: 0,
  toolbarBottom: null,
  focusedFlow: null,
  presentStep: null,
})

export const useViewStore = create<ViewStore>()((set, get) => ({
  ...initialView(),
  reveal: (ref, focus, hexId) => {
    if (usePreferencesStore.getState().viewOnly) return
    // The card only exists to scroll to once the collapsed editor has rendered open.
    flushSync(() => set(({ openNodes }) => ({ editorOpen: true, openNodes: hexId ? new Set([...openNodes, ...branchOf(useMapStore.getState().map, hexId)]) : openNodes })))
    revealInEditor(ref, focus, hexId)
  },
  toggleNode: (key) => set(({ openNodes }) => ({ openNodes: new Set(openNodes.has(key) ? [...openNodes].filter((k) => k !== key) : [...openNodes, key]) })),
  toggleExpanded: (id) => set(({ expanded }) => ({ expanded: new Set(expanded.has(id) ? [...expanded].filter((x) => x !== id) : [...expanded, id]) })),
  expandAll: (ids) => set({ expanded: new Set(ids) }),
  requestFit: () => set(({ fitRequest }) => ({ fitRequest: fitRequest + 1 })),
  focusFlow: (focusedFlow) => set({ focusedFlow, presentStep: null }),
  present: (presentStep) => set({ presentStep }),
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
  const { linking, focusedFlow } = useViewStore.getState()
  if (revision !== prev.revision) useViewStore.setState({ expanded: new Set(), linking: null, focusedFlow: null, presentStep: null, openNodes: new Set(branchOf(map, focus)) })
  else {
    if (linking && !collectionOf(diagramOf(map, focus), linking)) useViewStore.setState({ linking: null })
    if (focusedFlow && (focus !== prev.focus || !diagramOf(map, focus).useCases.some((u) => u.id === focusedFlow))) useViewStore.setState({ focusedFlow: null, presentStep: null })
    // The panel follows the selection: the previous subdomain closes, so its fields never sit above the new one's.
    if (focus !== prev.focus) useViewStore.setState(({ openNodes }) => ({ openNodes: new Set([...[...openNodes].filter((k) => k !== `subdomain:${prev.focus}`), ...branchOf(map, focus)]) }))
  }
})

// Isolating a flow is a View mode reading aid: Edit mode shows the whole diagram.
usePreferencesStore.subscribe(({ viewOnly }, prev) => {
  if (prev.viewOnly && !viewOnly) useViewStore.setState({ focusedFlow: null, presentStep: null })
})
