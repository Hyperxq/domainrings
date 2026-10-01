import { useEffect, useRef, useState } from 'react'
import type { MapHexagonLayout } from '../../layout/map'

/** How long the pointer must rest on a context's empty area before its name appears. */
const REST_MS = 400

export type Reveal = 'blur' | 'name'

/** Which contexts show their name over the canvas, and how: pointer rest and Alt blur the whole region, keyboard
 * focus on a hexagon names its context without blur. Ephemeral, so it lives here rather than in a store. */
export function useContextReveal(hexagons: MapHexagonLayout[]) {
  const [rested, setRested] = useState<string | null>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const [alt, setAlt] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    const track = (e: KeyboardEvent) => setAlt(e.altKey)
    const release = () => setAlt(false)
    window.addEventListener('keydown', track)
    window.addEventListener('keyup', track)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', track)
      window.removeEventListener('keyup', track)
      window.removeEventListener('blur', release)
      clearTimeout(timer.current)
    }
  }, [])

  /** The pointer is over context `id`'s empty area, or over anything else (`null`): every move restarts the wait. */
  const rest = (id: string | null) => {
    clearTimeout(timer.current)
    if (id !== null && id === rested) return
    setRested(null)
    if (id !== null) timer.current = setTimeout(() => setRested(id), REST_MS)
  }

  const focus = (hexId: string | null) => setFocused(hexagons.find((h) => h.id === hexId)?.contextId ?? null)

  const reveals = (contextId: string): Reveal | undefined => (alt || rested === contextId ? 'blur' : focused === contextId ? 'name' : undefined)

  return { reveals, rest, focus }
}
