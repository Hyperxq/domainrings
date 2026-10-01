import { afterEach } from 'vitest'
import { usePreferencesStore } from '../ui/state/preferencesStore'
import { useHistoryStore } from '../ui/state/historyStore'
import { useNoticeStore } from '../ui/state/noticeStore'
import { useViewStore } from '../ui/state/viewStore'

// The stores outlive a test: each one starts from an empty storage and its initial state.
afterEach(() => {
  localStorage.clear()
  usePreferencesStore.persist.rehydrate()
  useViewStore.setState(useViewStore.getInitialState(), true)
  useHistoryStore.setState(useHistoryStore.getInitialState(), true)
  useNoticeStore.setState(useNoticeStore.getInitialState(), true)
})

// jsdom has no matchMedia. Motion-sensitive code reads this as "reduce", so a viewport change lands instantly
// unless a test opts in to animation; any other query reports no match, as before.
window.matchMedia ??= ((media: string) => ({ matches: media.includes('prefers-reduced-motion'), media, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia
