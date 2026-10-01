import { afterEach } from 'vitest'
import { usePreferencesStore } from '../ui/state/preferencesStore'
import { useHistoryStore } from '../ui/state/historyStore'
import { useViewStore } from '../ui/state/viewStore'

// The stores outlive a test: each one starts from an empty storage and its initial state.
afterEach(() => {
  localStorage.clear()
  usePreferencesStore.persist.rehydrate()
  useViewStore.setState(useViewStore.getInitialState(), true)
  useHistoryStore.setState(useHistoryStore.getInitialState(), true)
})
