import type { Box } from '../layout/layout'
import { LEGEND_GAP } from '../layout/legend'

const FONT_CSS =
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;600&display=swap'

// Resolved from the live DOM so the file carries the current theme without the app's stylesheet.
const INLINED = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray',
  'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-style',
  'font-weight', 'letter-spacing', 'text-anchor', 'dominant-baseline', 'paint-order',
] as const

const readAsDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

/** Inlines the Latin IBM Plex faces so the file renders the same without network access. */
async function fontFaces(): Promise<string> {
  try {
    const css = await (await fetch(FONT_CSS)).text()
    const latin = css.split('@font-face').filter((block) => /unicode-range:\s*U\+0000-00FF/.test(block))
    const faces = await Promise.all(
      latin.map(async (block) => {
        const url = block.match(/url\((https:[^)]+)\)/)?.[1]
        if (!url) return ''
        const data = await readAsDataUrl(await (await fetch(url)).blob())
        return `@font-face${block.slice(0, block.indexOf('}') + 1).replace(url, data)}`
      }),
    )
    return faces.join('')
  } catch {
    return ''
  }
}

export interface ExportOptions {
  /** Draw the legend block under the diagram's bottom-right corner. */
  legend: boolean
  legendHeight: number
  /** Restricts the export to one hexagon's `[data-hex]` group — every other hexagon, the map link and the map
   * title are dropped (EXPORT-02). Omitted (or unset) exports the whole map (EXPORT-01). */
  only?: string
}

/** The exported frame: the diagram bounds, grown downward to make room for the legend when it is included. */
export const exportBounds = (bounds: Box, options: ExportOptions): Box =>
  options.legend ? { ...bounds, height: bounds.height + options.legendHeight + LEGEND_GAP } : bounds

/** Whether the legend actually ends up drawn for this export — the single source of truth `svgMarkup` (the
 * strip and the viewBox) and the PNG size both defer to, so neither can grow the frame for a legend the map
 * scope's multi-hexagon rule (EXPORT-01) has already dropped. */
export const legendDrawn = (svg: SVGSVGElement, options: ExportOptions): boolean =>
  options.legend && !(!options.only && svg.querySelectorAll('[data-hex]').length > 1)

// Hooks for styling and editing on the canvas; an exported file is a picture, not a control. Inline styles go
// too: the resolved paint is already inlined as attributes, and a style could carry canvas motion into the file.
const CANVAS_ONLY = ['class', 'style', 'tabindex', 'role', 'aria-label', 'data-ref', 'data-band', 'data-layer', 'data-selected', 'data-link-target']
// Map-scoping attributes (SEAM-07): stripped in a SECOND pass, after the `only` filter and the cue removal have
// used `data-hex`/`data-map-link`/`data-map-title`/`data-hull`/`data-chip`/`data-hulls`/`data-link-pattern` as
// selectors — stripping them earlier would leave nothing to select.
const SCOPE_ONLY = ['data-hex', 'aria-current', 'aria-hidden', 'data-map-link', 'data-map-title', 'data-hover', 'data-hull', 'data-chip', 'data-hulls', 'data-link-pattern']

export async function svgMarkup(svg: SVGSVGElement, bounds: Box, title: string, options: ExportOptions): Promise<string> {
  // Exports ignore hover: drop it from the svg root and from whichever hexagon group carries it (CANVAS-03 scopes
  // hover to the current hexagon's group, not the svg root), and freeze transitions so computed styles are the
  // resting ones, not mid-fade.
  const hovered = [svg, ...svg.querySelectorAll('[data-hover]')]
  const hoverValues = hovered.map((el) => el.getAttribute('data-hover'))
  hovered.forEach((el) => el.removeAttribute('data-hover'))
  svg.classList.add('exporting')
  getComputedStyle(svg).opacity
  const clone = svg.cloneNode(true) as SVGSVGElement
  const live = svg.querySelectorAll('*')
  clone.querySelectorAll('*').forEach((el, i) => {
    const computed = getComputedStyle(live[i])
    for (const prop of INLINED) el.setAttribute(prop, computed.getPropertyValue(prop))
    for (const attr of CANVAS_ONLY) el.removeAttribute(attr)
  })

  svg.classList.remove('exporting')
  hovered.forEach((el, i) => {
    if (hoverValues[i]) el.setAttribute('data-hover', hoverValues[i]!)
  })

  // Map scope never shows the legend, whatever the user's preference — a legend enumerates one hexagon's layers,
  // which is ambiguous once more than one hexagon shares the frame (EXPORT-01).
  const showLegend = legendDrawn(svg, options)
  const hexGroups = clone.querySelectorAll('[data-hex]')

  // Scope to one hexagon (EXPORT-02): every other hexagon's group, plus the map-level link, title and every
  // context's hull/chip — none of which make sense scoped to one hexagon — are dropped entirely, not just
  // stripped of their scoping attribute.
  if (options.only) {
    hexGroups.forEach((g) => {
      if (g.getAttribute('data-hex') !== options.only) g.remove()
    })
    clone.querySelectorAll('[data-map-link], [data-map-title], [data-hulls], [data-chip], [data-link-pattern]').forEach((el) => el.remove())
  }
  // The current-hexagon cue is a canvas-only affordance, never part of an export, in either scope.
  clone.querySelectorAll('[data-cue]').forEach((el) => el.remove())
  // A non-current hexagon's native tooltip (its <title>, for the "make current" affordance) is canvas-only
  // too: left in, it would leak as a stray tooltip over a map-scope export (EXPORT-01.2).
  clone.querySelectorAll('[data-hex] > title').forEach((el) => el.remove())
  clone.querySelectorAll('*').forEach((el) => {
    for (const attr of SCOPE_ONLY) el.removeAttribute(attr)
  })

  // The live canvas hides the legend group; its classes are stripped above, so what stays in the clone shows.
  if (!showLegend) clone.querySelector('[data-legend]')?.remove()

  const ns = 'http://www.w3.org/2000/svg'
  const { x, y, width, height } = exportBounds(bounds, { ...options, legend: showLegend })
  for (const attr of ['class', 'style', 'role', 'aria-label']) clone.removeAttribute(attr)
  clone.setAttribute('xmlns', ns)
  clone.setAttribute('viewBox', `${x} ${y} ${width} ${height}`)
  clone.setAttribute('width', String(Math.ceil(width)))
  clone.setAttribute('height', String(Math.ceil(height)))

  const background = document.createElementNS(ns, 'rect')
  for (const [k, v] of Object.entries({ x, y, width, height })) background.setAttribute(k, String(v))
  background.setAttribute('fill', getComputedStyle(svg).getPropertyValue('--bg').trim() || '#F3F4F1')
  const style = document.createElementNS(ns, 'style')
  style.textContent = await fontFaces()
  // The standalone file names itself; the live canvas uses aria-label so no native tooltip shows over it.
  const name = document.createElementNS(ns, 'title')
  name.textContent = title || 'Architecture diagram'
  clone.prepend(name, style, background)

  return new XMLSerializer().serializeToString(clone)
}

export async function pngBlob(markup: string, bounds: Box, pixelRatio = 2): Promise<Blob> {
  const image = new Image()
  // A data URL (not a blob URL) keeps the canvas untainted in every engine.
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(bounds.width * pixelRatio)
  canvas.height = Math.ceil(bounds.height * pixelRatio)
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The browser could not encode the PNG.'))), 'image/png'),
  )
}

export function download(content: Blob | string, filename: string, type = 'application/octet-stream') {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const fileSlug = (title: string) =>
  title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'architecture'
