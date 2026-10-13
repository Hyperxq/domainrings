/** The label's face and weight: keep in step with `.box-label` in styles.css. */
const WEIGHT = 600
/** Without a canvas the width is estimated; wider than the face's real advance so a label is never undercounted. */
const FALLBACK_EM = 0.66

let family: string | undefined
let context: CanvasRenderingContext2D | null | undefined
const widths = new Map<string, number>()

export function resetLabelFont() {
  family = undefined
  context = undefined
  widths.clear()
}

function canvas() {
  if (context === undefined) {
    family = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace'
    context = document.createElement('canvas').getContext('2d')
  }
  return context
}

/** The rendered width of `text` in the label face at `px`: measured on a canvas (cached), estimated where there is none. */
export function labelTextWidth(text: string, px: number): number {
  const ctx = canvas()
  if (!ctx) return text.length * px * FALLBACK_EM
  const key = `${px}|${text}`
  let width = widths.get(key)
  if (width === undefined) {
    ctx.font = `${WEIGHT} ${px}px ${family}`
    width = ctx.measureText(text).width
    widths.set(key, width)
  }
  return width
}
