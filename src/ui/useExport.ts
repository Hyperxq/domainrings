import { useEffect, useRef } from 'react'
import type { Box } from '../layout/geometry'
import { legendSize, type LegendModel } from '../layout/legend'
import type { StoredFile } from '../model/fileFormat'
import { toHexa } from '../model/hexa'
import { useNoticeStore } from './state/noticeStore'
import { typing } from './keys'
import { download, exportBounds, fileSlug, legendDrawn, pngBlob, svgMarkup } from './exporters'

export type ExportFormat = 'hexa' | 'svg' | 'png' | 'png-copy'

export interface ActiveDocument {
  file: StoredFile
  bounds: Box
  title: string
  scoped: boolean
  legend: boolean
  /** An image export framed around the focused flow's hexagons instead of the whole map. */
  frame?: { only: ReadonlySet<string>; links: ReadonlySet<string> }
}

/** Builds and downloads the active document as `.hexa`, SVG or PNG, or copies the PNG (also on Ctrl/Cmd+C). Owns the ref the stages hand their `<svg>` to. */
const { show } = useNoticeStore.getState()

export function useExport(active: ActiveDocument, legend: LegendModel, hexId: string) {
  const svgRef = useRef<SVGSVGElement>(null)
  const exportAs = async (format: ExportFormat) => {
    const svg = svgRef.current
    if (format !== 'hexa' && !svg) return
    try {
      if (format === 'hexa') return download(toHexa(active.file), `${fileSlug(active.file.title)}.hexa`, 'application/json')
      const name = fileSlug(active.title)
      const options = { legend: active.legend, legendHeight: legendSize(legend).height, only: active.frame?.only ?? (active.scoped ? new Set([hexId]) : undefined), links: active.frame?.links }
      const requested = 2
      const png = async () => pngBlob(await svgMarkup(svg!, active.bounds, active.title, options), exportBounds(active.bounds, { ...options, legend: legendDrawn(svg!, options) }), requested)
      const reportScale = (pixelRatio: number) =>
        pixelRatio < requested && show({ tone: 'status', message: `Exported at ${Math.round((pixelRatio / requested) * 100)}% resolution. Use SVG for full resolution.` })
      if (format === 'svg') download(await svgMarkup(svg!, active.bounds, active.title, options), `${name}.svg`, 'image/svg+xml')
      else if (format === 'png') {
        const { blob, pixelRatio } = await png()
        download(blob, `${name}.png`)
        reportScale(pixelRatio)
      } else {
        // Safari only honours a clipboard write started inside the gesture, so the item is built now around the pending PNG.
        const rendered = png()
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': rendered.then((r) => r.blob) })])
        show({ tone: 'status', message: 'Copied the image to the clipboard.' })
        reportScale((await rendered).pixelRatio)
      }
    } catch (error) {
      show({ tone: 'error', message: `${format === 'png-copy' ? 'Copy' : 'Export'} failed: ${(error as Error).message}` })
    }
  }
  // No dependency array on purpose: re-subscribing every render keeps `exportAs` on the current document.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'c' || e.defaultPrevented || typing(e.target)) return
      // Selected text and open menus or dialogs keep the browser's own copy.
      if (getSelection()?.toString() || document.querySelector('[role="menu"], dialog[open]')) return
      e.preventDefault()
      void exportAs('png-copy')
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })
  return { svgRef, exportAs }
}
