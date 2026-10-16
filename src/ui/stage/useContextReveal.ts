import { useEffect, useState } from 'react'
import type { MapHexagonLayout } from '../../layout/map'

export type Reveal = 'blur' | 'name'

/** Which contexts show their name over the canvas, and how: holding Alt blurs every region, keyboard focus on a
 * hexagon names its context without blur. Hover never reveals, so exploring a hexagon is not interrupted.
 * Ephemeral, so it lives here rather than in a store. */
export function useContextReveal(hexagons: MapHexagonLayout[]) {
  const [focused, setFocused] = useState<string | null>(null)
  const [alt, setAlt] = useState(false)

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
    }
  }, [])

  const focus = (hexId: string | null) => setFocused(hexagons.find((h) => h.id === hexId)?.contextId ?? null)

  const reveals = (contextId: string): Reveal | undefined => (alt ? 'blur' : focused === contextId ? 'name' : undefined)

  return { reveals, focus }
}
