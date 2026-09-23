import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { typing } from './keys'

const SHOW_MS = 6000
const LEAVE_MS = 150

interface ToastProps {
  message: string
  /** Stays until closed: for a hint that lasts as long as the mode it explains. */
  sticky?: boolean
  onUndo?: () => void
  onClose: () => void
}

/** A one-row status with Undo. It leaves by itself after 6 s, but never while the pointer or focus is on it. */
export function Toast({ message, sticky, onUndo, onClose }: ToastProps) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const remaining = useRef(SHOW_MS)

  useEffect(() => {
    if (leaving) {
      const timer = setTimeout(onClose, LEAVE_MS)
      return () => clearTimeout(timer)
    }
    if (hovered || focused || sticky) return
    const start = Date.now()
    const timer = setTimeout(() => setLeaving(true), remaining.current)
    return () => {
      clearTimeout(timer)
      remaining.current -= Date.now() - start
    }
  }, [hovered, focused, leaving, sticky, onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLeaving(true)
      if (onUndo && (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing(e.target)) {
        e.preventDefault()
        onUndo()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onUndo])

  return (
    <div
      className={`island toast${leaving ? ' is-leaving' : ''}`}
      role="status"
      aria-live="polite"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setFocused(false)}
    >
      <p>{message}</p>
      {onUndo && (
        <button type="button" className="text-button" onClick={onUndo}>
          Undo
        </button>
      )}
      <button type="button" className="icon-button small" aria-label="Dismiss" onClick={() => setLeaving(true)}>
        <Icon name="close" />
      </button>
    </div>
  )
}
