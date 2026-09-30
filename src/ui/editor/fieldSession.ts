import type { FocusEvent } from 'react'
import type { HexaMap, Link } from '../../model/schema'
import { useMapStore } from '../../model/store'

/** Reports the links a port change/removal broke (SEAM-06), with the map/focus from just before the edit, so the
 * caller can toast and offer undo — Section calls the store directly, so this is how App finds out. */
export type OnPrune = (pruned: Link[], before: { map: HexaMap; focus: string }) => void

/** Records a silent undo step: the map/focus from just before an edit that raises no toast of its own. */
export type OnRecord = (before: { map: HexaMap; focus: string }) => void

/** Tracks the one text field being edited, so its whole session (focus → blur) becomes a single undo step. */
export interface FieldSession {
  begin: (before: { map: HexaMap; focus: string }, field: Element) => void
  end: () => void
}

export const sessionOf = (fieldSession: FieldSession) => ({
  onFocus: (e: FocusEvent<HTMLElement>) => {
    const { map, focus } = useMapStore.getState()
    fieldSession.begin({ map, focus }, e.currentTarget)
  },
  onBlur: fieldSession.end,
})
