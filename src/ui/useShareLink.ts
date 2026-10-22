import { useEffect, useRef, useState } from 'react'
import type { StoredFile } from '../model/fileFormat'
import { decodeSharePayload, fetchStoredPayload, SHARE_HASH_PREFIX, STORED_HASH_PREFIX } from './shareLink'
import { useNoticeStore } from './state/noticeStore'
import { openForReading } from './state/preferencesStore'
import { useViewStore } from './state/viewStore'
import { useMapStore } from '../model/store'

/** An instant link never flashes the indicator. */
export const OPENING_DELAY_MS = 150

const showError = (message: string) => useNoticeStore.getState().show({ tone: 'error', message })

interface ShareLinkActions {
  parseSource: (text: string, label: string, isCurrent?: () => boolean) => Promise<StoredFile | undefined>
  swap: (file: StoredFile, message: string) => void
}

const finishLink = () => history.replaceState(null, '', location.pathname)

const shareHashPrefix = (hash: string) => [SHARE_HASH_PREFIX, STORED_HASH_PREFIX].find((prefix) => hash.startsWith(prefix))

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
  // Loads can overlap; only the latest one may touch the map, the notices or the indicator, so a slower older link
  // never replaces what the user pasted after it.
  const generation = useRef(0)

  useEffect(() => {
    const openLinkedText = async (text: string, options: URLSearchParams, isLatest: () => boolean) => {
      const parsed = await latest.current.parseSource(text, 'This link', isLatest)
      if (!parsed || !isLatest()) return
      latest.current.swap(parsed, 'Opened from a link.')
      openForReading(options.get('view') === 'detailed' ? 'detailed' : 'overview')
      const flow = options.get('flow')
      if (flow === null || parsed.kind !== 'hexagonal') return
      const hexId = options.get('hex')
      const owner = useMapStore.getState().map.hexagons.find((h) => (hexId === null || h.id === hexId) && h.useCases.some((u) => u.id === flow))
      if (!owner) return
      // Swapping the map and moving focus each clear the focused flow, so it is set last.
      useMapStore.getState().setFocus(owner.id)
      useViewStore.getState().focusFlow(flow)
      useViewStore.setState({ framedFlow: options.get('frame') === 'flow' ? flow : null })
    }
    const resolveLink = async (isLatest: () => boolean) => {
      const prefix = shareHashPrefix(location.hash)
      if (prefix) {
        // The payload is base64url (plus a ',' in a stored link), which never contains '&', so anything after it is
        // link options.
        const [payload, ...options] = location.hash.slice(prefix.length).split('&')
        const text = prefix === SHARE_HASH_PREFIX ? await decodeSharePayload(payload) : await fetchStoredPayload(payload)
        if (!isLatest()) return
        if (text === undefined) {
          if (prefix === SHARE_HASH_PREFIX) {
            showError('This link could not be read.')
            return finishLink()
          }
          // A stored link can fail for a passing reason (timeout, daily quota), so it stays for a reload to retry.
          showError('This link could not be opened. Reload the page to try again.')
          return
        }
        await openLinkedText(text, new URLSearchParams(options.join('&')), isLatest)
        return isLatest() ? finishLink() : undefined
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
        if (!isLatest()) return
        showError("This link's file could not be reached.")
        return finishLink()
      }
      await openLinkedText(text, query, isLatest)
      if (isLatest()) finishLink()
    }
    const openLink = async () => {
      const id = ++generation.current
      const isLatest = () => id === generation.current
      inFlight.current = location.hash
      const timer = setTimeout(() => isLatest() && setOpening(true), OPENING_DELAY_MS)
      try {
        await resolveLink(isLatest)
      } finally {
        clearTimeout(timer)
        if (isLatest()) {
          inFlight.current = ''
          setOpening(false)
        }
      }
    }

    if (!mountHandled.current) {
      mountHandled.current = true
      void openLink()
    }
    const onHashChange = () => {
      if (shareHashPrefix(location.hash) && location.hash !== inFlight.current) void openLink()
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return { opening }
}
