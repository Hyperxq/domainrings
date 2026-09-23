export type LineStyle = 'eyebrow' | 'title' | 'name' | 'mono' | 'muted' | 'minor' | 'strong' | 'tag' | 'label'

export interface TextLine {
  text: string
  style: LineStyle
  /** A type tag drawn inline, before the text, in the tag style. */
  tag?: string
}

interface Metrics {
  size: number
  height: number
  /** Average advance per character, in em, for IBM Plex at this weight. */
  em: number
  tracking: number
}

// The engine never measures the DOM; these averages over-estimate IBM Plex so boxes never clip.
export const LINE_METRICS: Record<LineStyle, Metrics> = {
  eyebrow: { size: 13, height: 18, em: 0.6, tracking: 0 },
  title: { size: 14, height: 20, em: 0.6, tracking: 0 },
  /** A code name as a pill's label. */
  name: { size: 14, height: 19, em: 0.6, tracking: 0 },
  mono: { size: 13, height: 18, em: 0.6, tracking: 0 },
  muted: { size: 13, height: 18, em: 0.56, tracking: 0 },
  minor: { size: 12, height: 16, em: 0.6, tracking: 0 },
  strong: { size: 13, height: 18, em: 0.62, tracking: 0 },
  tag: { size: 11, height: 14, em: 0.6, tracking: 0 },
  /** An overview socket's port name, beside its notch. */
  label: { size: 11, height: 14, em: 0.6, tracking: 0 },
}

export const RING_LABEL = { size: 13, em: 0.68, tracking: 1.6 } as const
export const RING_SUBTITLE = { size: 12, em: 0.56 } as const
/** The domain's title is the one big, sentence-case heading. */
export const DOMAIN_TITLE = { size: 22, em: 0.62, tracking: 0 } as const
export const EDGE_LABEL = { size: 13, em: 0.56 } as const
export const TITLE = { size: 24, em: 0.58 } as const
export const SUBTITLE = { size: 14, em: 0.56 } as const

export const measure = (text: string, m: { size: number; em: number; tracking?: number }) =>
  text.length * (m.size * m.em + (m.tracking ?? 0))

export const TAG_GAP = 6
export const lineWidth = (line: TextLine) =>
  measure(line.text, LINE_METRICS[line.style]) + (line.tag ? measure(line.tag, LINE_METRICS.tag) + TAG_GAP : 0)

/** Greedy wrap that only breaks after separators or at camelCase humps, never inside a word. */
export function wrapLabel(text: string, maxChars: number): string[] {
  const tokens = text.split(/(?<=[/.\s·_-])|(?<=[a-z0-9])(?=[A-Z])/)
  const lines: string[] = []
  let current = ''
  for (const token of tokens) {
    if (current && (current + token).trimEnd().length > maxChars) {
      lines.push(current.trim())
      current = token.trimStart()
    } else {
      current += token
    }
  }
  if (current.trim() || !lines.length) lines.push(current.trim())
  return lines
}

export const styled = (style: LineStyle, text: string | undefined, maxChars = Infinity): TextLine[] =>
  text?.trim() ? wrapLabel(text.trim(), maxChars).map((t) => ({ text: t, style })) : []

export const noteLines = (note: string | undefined, style: LineStyle = 'muted'): TextLine[] =>
  (note ?? '').split('\n').flatMap((line) => styled(style, line, 34))
