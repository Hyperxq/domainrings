import { afterEach } from 'vitest'
import { usePreferencesStore } from '../ui/state/preferencesStore'

// The preferences store reads storage once, so each test starts from an empty one and a freshly rehydrated store.
afterEach(() => {
  localStorage.clear()
  usePreferencesStore.persist.rehydrate()
})
