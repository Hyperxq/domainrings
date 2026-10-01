import { UNTITLED_HEXAGON } from '../model/map'
import type { HexaMap, Link } from '../model/schema'
import { useMapStore } from '../model/store'
import { useNoticeStore } from './state/noticeStore'

/** The toast for an edit that pruned one or more links (LINK-01): "Deleted"/"Moved" is told apart by whether the
 * edited end's port still exists after the edit — the only two ways pruneLinks ever fires. The editor's own
 * remove/update handlers call the store directly, so they report here too. */
export function pruneToast(pruned: Link[], before: { map: HexaMap; focus: string }) {
  if (!pruned.length) return
  const beforeHexagon = before.map.hexagons.find((h) => h.id === before.focus)!
  const afterHexagon = useMapStore.getState().map.hexagons.find((h) => h.id === before.focus)
  const editedEnd = (l: Link) => (l.from.hexagonId === before.focus ? l.from : l.to)
  const otherHexagonTitle = (l: Link) => {
    const end = l.from.hexagonId === before.focus ? l.to : l.from
    return before.map.hexagons.find((h) => h.id === end.hexagonId)?.title || UNTITLED_HEXAGON
  }
  const portId = editedEnd(pruned[0]).portId
  const portName = beforeHexagon.ports.find((p) => p.id === portId)?.name ?? 'the port'
  const stillExists = afterHexagon?.ports.some((p) => p.id === portId) ?? false
  const plural = pruned.length > 1 ? 's' : ''
  const hexes = pruned.map(otherHexagonTitle).join(' and ')
  const message = stillExists ? `Moved ${portName} and removed its link${plural} to ${hexes}.` : `Deleted ${portName} and its link${plural} to ${hexes}.`
  useNoticeStore.getState().show({ tone: 'status', message, undo: before })
}
