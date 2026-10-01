import { useEffect, useRef } from 'react'
import type { StoredFile } from '../model/fileFormat'
import { decodeSharePayload, SHARE_HASH_PREFIX } from './shareLink'
import { useNoticeStore } from './state/noticeStore'

const showError = (message: string) => useNoticeStore.getState().show({ tone: 'error', message })

interface ShareLinkActions {
  parseSource: (text: string, label: string) => Promise<StoredFile | undefined>
  swap: (file: StoredFile, message: string) => void
}

/** REQ-01/02/03/04: a share link in the address is consumed once, on mount. The ref is set before any await so
 * React StrictMode's double-invoke of this effect never re-enters the async branch below. */
export function useShareLinkOnMount({ parseSource, swap }: ShareLinkActions) {
  const linkHandled = useRef(false)
  useEffect(() => {
    if (linkHandled.current) return
    linkHandled.current = true
    const finishLink = () => history.replaceState(null, '', location.pathname)
    const openLinkedText = async (text: string) => {
      const parsed = await parseSource(text, 'This link')
      if (parsed) swap(parsed, 'Opened from a link.')
    }
    void (async () => {
      if (location.hash.startsWith(SHARE_HASH_PREFIX)) {
        const text = await decodeSharePayload(location.hash.slice(SHARE_HASH_PREFIX.length))
        if (text === undefined) {
          showError('This link could not be read.')
          return finishLink()
        }
        await openLinkedText(text)
        return finishLink()
      }
      const src = new URLSearchParams(location.search).get('src')
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
      await openLinkedText(text)
      finishLink()
    })()
    // Runs once on mount only — the effect reads location/hash as they are at load, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
