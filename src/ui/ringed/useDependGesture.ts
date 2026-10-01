import { useEffect, useState } from 'react'
import { isInwardOrSame } from '../../model/rings'
import { usePreferencesStore } from '../state/preferencesStore'

const NO_TARGETS = new Set<string>()

interface RingedDependElement {
  ref: string
  ringRole: string
  name: string
  x: number
  y: number
}

/** The "Depend on…" gesture (REQ-04/REQ-06): select an element, choose another in the same or a more inward
 * ring; a valid target is marked with `data-link-target` (via the returned `linkTargetRefs`) while linking, and
 * choosing one that is not valid cancels the gesture and reports why via `onReject`, leaving the document
 * unchanged either way. Shared by Onion and Clean (ADR-01) — generic over any laid-out element carrying a
 * `ringRole` (Clean's own is resolved through its sector at layout time, ADR-02, so this hook never needs to
 * know the difference). */
export function useDependGesture({
  elements,
  rings,
  onCreate,
  onReject,
  rejectMessage,
}: {
  elements: readonly RingedDependElement[]
  rings: readonly { role: string }[]
  onCreate: (fromId: string, toId: string) => void
  onReject: (message: string) => void
  rejectMessage: string
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)
  const viewOnly = usePreferencesStore((s) => s.viewOnly)

  useEffect(() => {
    if (viewOnly) setLinking(false)
  }, [viewOnly])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (linking) setLinking(false)
      else setSelected(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [linking])

  const selectedElement = selected ? elements.find((e) => e.ref === selected) : undefined
  const validTargets = selectedElement ? elements.filter((e) => e.ref !== selected && isInwardOrSame(rings, selectedElement.ringRole, e.ringRole)) : []
  const linkTargetRefs = linking ? new Set(validTargets.map((e) => e.ref)) : NO_TARGETS

  const clickTarget = (ref: string | null) => {
    if (!ref) {
      setLinking(false)
      setSelected(null)
      return
    }
    if (linking && selected) {
      if (validTargets.some((e) => e.ref === ref)) onCreate(selected, ref)
      else onReject(rejectMessage)
      setLinking(false)
      setSelected(null)
      return
    }
    setSelected(ref)
  }

  return { selected, linking, setLinking, selectedElement, validTargets, linkTargetRefs, clickTarget }
}
