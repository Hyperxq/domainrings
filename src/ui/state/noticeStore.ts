import { create } from 'zustand'
import type { Recovery } from '../../model/persistence'
import { useMapStore } from '../../model/store'
import type { Notice } from '../notice'
import { useHistoryStore } from './historyStore'

const RECOVERY_MESSAGE: Record<'kept' | 'not-kept', string> = {
  kept: "Your last session couldn't be restored, so the example is open. Your saved work is kept in this browser; nothing was deleted.",
  'not-kept': "Your last session couldn't be restored and a copy couldn't be kept, so autosave is off.",
}

interface NoticeStore {
  notice: Notice | null
  // Its own slot, never touched by show(): it stays until the user dismisses it (REQ-03.2), whatever status
  // toasts or link-mode hints come and go in the meantime.
  recovery: Notice | null
  seq: number
  show: (next: Omit<Notice, 'id'>) => void
  /** Retracts the toast for an add that was immediately cancelled (naming Esc'd out) without offering it as an
   * undo step — the add already unwound itself. */
  retract: () => void
  /** The link-mode hint replaces any status toast; an error stays until it is read. */
  clearStatus: () => void
  /** The notice that offered `entry` as its Undo goes once that Undo has been taken. */
  clearUndone: (entry: Notice['undo']) => void
  reportRecovery: (recovery: Recovery, unreadableText?: string) => void
}

export const useNoticeStore = create<NoticeStore>()((set, get) => ({
  notice: null,
  recovery: null,
  seq: 0,
  show: (next) => {
    if (next.undo) useHistoryStore.getState().record(next.undo)
    set(({ seq }) => ({ notice: { ...next, id: seq + 1 }, seq: seq + 1 }))
  },
  retract: () => {
    useHistoryStore.getState().dropUndo(get().notice?.undo)
    set({ notice: null })
  },
  clearStatus: () => set(({ notice }) => ({ notice: notice?.tone === 'error' ? notice : null })),
  clearUndone: (entry) => set(({ notice }) => ({ notice: notice?.undo === entry ? null : notice })),
  reportRecovery: (recovery, unreadableText) => {
    if (recovery === 'none') return
    set({ recovery: { id: 0, tone: 'recovery', message: RECOVERY_MESSAGE[recovery], download: recovery === 'kept' ? unreadableText : undefined } })
  },
}))

// A sticky toast (DEL-02) clears itself the moment the map next changes for any OTHER reason — not on a timer.
useMapStore.subscribe(({ map }) => {
  const { notice } = useNoticeStore.getState()
  if (notice?.sticky && notice.staleWhenMapIsnt && map !== notice.staleWhenMapIsnt) useNoticeStore.setState({ notice: null })
})
