import { useRef } from 'react'
import type { Box } from '../layout/geometry'
import { legendSize, type LegendModel } from '../layout/legend'
import type { StoredFile } from '../model/fileFormat'
import { toHexa } from '../model/hexa'
import { useNoticeStore } from './state/noticeStore'
import { download, exportBounds, fileSlug, legendDrawn, pngBlob, svgMarkup } from './exporters'

export interface ActiveDocument {
  file: StoredFile
  bounds: Box
  title: string
  scoped: boolean
  legend: boolean
}

/** Builds and downloads the active document as `.hexa`, SVG or PNG. Owns the ref the stages hand their `<svg>` to. */
const { show } = useNoticeStore.getState()

export function useExport(active: ActiveDocument, legend: LegendModel, hexId: string) {
  const svgRef = useRef<SVGSVGElement>(null)
  const exportAs = async (format: 'hexa' | 'svg' | 'png') => {
    try {
      if (format === 'hexa') return download(toHexa(active.file), `${fileSlug(active.file.title)}.hexa`, 'application/json')
      if (!svgRef.current) return
      const name = fileSlug(active.title)
      const options = { legend: active.legend, legendHeight: legendSize(legend).height, only: active.scoped ? hexId : undefined }
      const markup = await svgMarkup(svgRef.current, active.bounds, active.title, options)
      if (format === 'svg') download(markup, `${name}.svg`, 'image/svg+xml')
      else {
        const requested = 2
        const { blob, pixelRatio } = await pngBlob(markup, exportBounds(active.bounds, { ...options, legend: legendDrawn(svgRef.current, options) }), requested)
        download(blob, `${name}.png`)
        if (pixelRatio < requested) show({ tone: 'status', message: `Exported at ${Math.round((pixelRatio / requested) * 100)}% resolution. Use SVG for full resolution.` })
      }
    } catch (error) {
      show({ tone: 'error', message: `Export failed: ${(error as Error).message}` })
    }
  }
  return { svgRef, exportAs }
}
