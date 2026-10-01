import type { FocusEvent } from 'react'
import { useMapStore } from '../../model/store'
import { useHistoryStore } from '../state/historyStore'

/** Tracks the one text field being edited, so its whole session (focus → blur) becomes a single undo step. */
export const session = {
  onFocus: (e: FocusEvent<HTMLElement>) => {
    const { map, focus } = useMapStore.getState()
    useHistoryStore.getState().beginField({ map, focus }, e.currentTarget)
  },
  onBlur: () => useHistoryStore.getState().endField(),
}
