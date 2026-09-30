import type { HexaMap, CleanFile, OnionFile } from '../model/schema'

/** What a toast's Undo restores — one shape per kind (REQ-09): Hexagonal's own map+focus, or a bare Onion/Clean
 * document. Each snapshot carries its own kind through `map.kind`, so `restoreUndo` needs no separate
 * discriminant field to route it — one undo mechanism for every kind, matching the single active-document
 * resolution `activeKind` already drives. */
export type UndoSnapshot = { map: HexaMap; focus: string; swap?: boolean } | { map: OnionFile; swap?: boolean } | { map: CleanFile; swap?: boolean }

export interface Notice {
  /** A new notice restarts the toast's countdown even when its text repeats. */
  id: number
  tone: 'status' | 'error' | 'recovery'
  message: string
  details?: string[]
  undo?: UndoSnapshot
  /** The unreadable text a "recovery" notice offers to download, when a copy was kept. */
  download?: string
  /** Stays up past the usual 6 s countdown (DEL-02) — clears on the map's next edit, tracked via `staleWhenMapIsnt`. */
  sticky?: boolean
  /** For a sticky notice: the map right after the action it reports. The notice clears once `map` moves past it. */
  staleWhenMapIsnt?: HexaMap
}
