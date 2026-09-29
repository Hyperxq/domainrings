import { useCleanStore } from './cleanStore'
import { useOnionStore } from './onionStore'
import { autosave, useSaveFailed, type Recovery } from './persistence'
import { useMapStore } from './store'

// Only the store whose map actually changes ever writes (its subscribe callback is a no-op otherwise) — safe to
// wire every document store to the same slot, since only the active view's store ever mutates (ADR-02).
// Without storage nothing can ever be saved, so the author gets the save-failed notice up front instead of silence.
export function wireAutosave(storage: Storage | undefined, recovery: Recovery): () => void {
  if (!storage) {
    useSaveFailed.setState({ failed: true })
    return () => {}
  }
  const onSave = (ok: boolean) => useSaveFailed.setState({ failed: !ok })
  const stops = [useMapStore, useOnionStore, useCleanStore].map((store) => autosave(store as never, storage, recovery, { onSave }))
  return () => stops.forEach((stop) => stop())
}
