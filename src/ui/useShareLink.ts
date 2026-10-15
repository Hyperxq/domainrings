import { useEffect, useRef, useState } from 'react'
import type { StoredFile } from '../model/fileFormat'
import { decodeSharePayload, SHARE_HASH_PREFIX } from './shareLink'
import { useNoticeStore } from './state/noticeStore'
import { openForReading } from './state/preferencesStore'

/** An instant link never flashes the indicator. */
export const OPENING_DELAY_MS = 150

const showError = (message: string) => useNoticeStore.getState().show({ tone: 'error', message })

interface ShareLinkActions {
  parseSource: (text: string, label: string) => Promise<StoredFile | undefined>
  swap: (file: StoredFile, message: string) => void
}

const finishLink = () => history.replaceState(null, '', location.pathname)

/** REQ-01/02/03/04: a share link in the address is consumed on mount, and again whenever a share hash is pasted
 * into the open tab. `opening` is true while a link that takes a noticeable time is being resolved. */
export function useShareLink(actions: ShareLinkActions) {
  const [opening, setOpening] = useState(false)
  // Read at call time: `swap` captures the undo snapshot of the render it was made in, which a listener attached
  // once would otherwise keep using.
  const latest = useRef(actions)
  latest.current = actions
  // Set before any await so React StrictMode's double-invoke of the mount effect never re-enters the async branch.
  const mountHandled = useRef(false)
  // jsdom and some browsers report the address change that was already there on load; a link is never opened twice.
  const inFlight = useRef('')

  useEffect(() => {
    const openLinkedText = async (text: string, view: string | null) => {
      const parsed = await latest.current.parseSource(text, 'This link')
      if (!parsed) return
      latest.current.swap(parsed, 'Opened from a link.')
      openForReading(view === 'detailed' ? 'detailed' : 'overview')
    }
    const resolveLink = async () => {
      if (location.hash.startsWith(SHARE_HASH_PREFIX)) {
        // The payload is base64url, which never contains '&', so anything after it is link options.
        const [payload, ...options] = location.hash.slice(SHARE_HASH_PREFIX.length).split('&')
        const text = await decodeSharePayload(payload)
        if (text === undefined) {
          showError('This link could not be read.')
          return finishLink()
        }
        await openLinkedText(text, new URLSearchParams(options.join('&')).get('view'))
        return finishLink()
      }
      const query = new URLSearchParams(location.search)
      const src = query.get('src')
      if (src === null) return
      if (!src.startsWith('https://')) {
        showError("This link's address is not https, so nothing was fetched.")
        return finishLink()
      }
      let text: string
      try {
        const response = await fetch(src)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        text = await response.text()
      } catch {
        showError("This link's file could not be reached.")
        return finishLink()
      }
      await openLinkedText(text, query.get('view'))
      finishLink()
    }
    const openLink = async () => {
      inFlight.current = location.hash
      const timer = setTimeout(() => setOpening(true), OPENING_DELAY_MS)
      try {
        await resolveLink()
      } finally {
        clearTimeout(timer)
        inFlight.current = ''
        setOpening(false)
      }
    }

    if (!mountHandled.current) {
      mountHandled.current = true
      void openLink()
    }
    const onHashChange = () => {
      if (location.hash.startsWith(SHARE_HASH_PREFIX) && location.hash !== inFlight.current) void openLink()
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return { opening }
}
