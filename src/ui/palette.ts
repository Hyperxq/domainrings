/**
 * The single source of the colour tokens. `paletteCss` turns this table into the theme CSS (system default plus
 * the explicit data-theme override), and the contrast test reads the same table.
 */
const LIGHT = {
  bg: '#F3F4F1',
  ink: '#10171D',
  muted: '#5B6770',
  line: '#C9D0CB',
  teal: '#0F6E5F',
  'teal-soft': '#DDEFE9',
  'teal-deep': '#2E7D63',
  slate: '#4E5964',
  'slate-soft': '#E6E9E5',
  card: '#FBFBF9',
  'domain-ink': '#F7F8F6',
  'driving-fill': '#5B5FD6',
  'driving-line': '#7C80E4',
  'driving-ink': '#FAFAFF',
  'driven-fill': '#B5562C',
  'driven-line': '#CC6C41',
  'driven-ink': '#FFF8F4',
  error: '#B42318',
}

type Token = keyof typeof LIGHT

const DARK: Record<Token, string> = {
  bg: '#10171D',
  ink: '#EEF1EE',
  muted: '#9AA7AE',
  line: '#34404A',
  teal: '#4FC2AD',
  'teal-soft': '#163B35',
  'teal-deep': '#1F5A48',
  slate: '#B5C2C4',
  'slate-soft': '#222B33',
  card: '#171F26',
  'domain-ink': '#EEF1EE',
  'driving-fill': '#4B4BB5',
  'driving-line': '#6464CC',
  'driving-ink': '#F4F4FF',
  'driven-fill': '#8F4424',
  'driven-line': '#AD5A36',
  'driven-ink': '#FFF6F1',
  error: '#F97066',
}

export const PALETTE = { light: LIGHT, dark: DARK } satisfies Record<'light' | 'dark', Record<Token, string>>

/** Every text colour the diagram draws on a fill, as [text, fill]; each pair must reach WCAG AA. */
export const TEXT_PAIRS: [Token, Token][] = [
  ['ink', 'bg'],
  ['ink', 'card'],
  ['muted', 'card'],
  ['muted', 'bg'],
  ['muted', 'slate-soft'],
  ['ink', 'slate-soft'],
  ['ink', 'teal-soft'],
  ['driving-ink', 'driving-fill'],
  ['driven-ink', 'driven-fill'],
  ['domain-ink', 'teal-deep'],
]

const SHADOW = {
  light: '0 0 0 1px rgba(16, 23, 29, 0.04), 0 2px 4px rgba(16, 23, 29, 0.06), 0 8px 24px rgba(16, 23, 29, 0.08)',
  dark: '0 0 0 1px rgba(255, 255, 255, 0.04), 0 2px 4px rgba(0, 0, 0, 0.35), 0 8px 24px rgba(0, 0, 0, 0.4)',
}

const channel = (hex: string, i: number) => {
  const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const luminance = (hex: string) => 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2)

/** The colour a semi-transparent stroke actually shows over a background. */
export function blend(fg: string, bg: string, alpha: number): string {
  const mix = (i: number) =>
    Math.round(parseInt(fg.slice(1 + 2 * i, 3 + 2 * i), 16) * alpha + parseInt(bg.slice(1 + 2 * i, 3 + 2 * i), 16) * (1 - alpha))
  return `#${[0, 1, 2].map((i) => mix(i).toString(16).padStart(2, '0')).join('')}`
}

/**
 * Guide spokes: --muted, faded to ≈2.5:1 against the bands they cross (measured: light 2.50/2.53, dark 2.56/2.35).
 * Light needs more opacity because --muted sits closer to its pale bands.
 */
export const GUIDE_TOKEN = 'muted' satisfies Token
export const GUIDE_OPACITY = { light: 0.65, dark: 0.5 } as const

/** WCAG 2 contrast ratio between two #RRGGBB colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const chevron = (stroke: string) =>
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5 6 8l3.5-3.5' fill='none' stroke='%23${stroke.slice(1)}' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`

/** Mixes a colour toward white (dark theme) or black (light theme): the one-step brighter fill of a hovered ring. */
function hoverTint(hex: string, theme: 'light' | 'dark') {
  const [target, amount] = theme === 'dark' ? [255, 0.06] : [0, 0.04]
  const mix = (i: number) => Math.round(parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) * (1 - amount) + target * amount)
  return `#${[0, 1, 2].map((i) => mix(i).toString(16).padStart(2, '0')).join('')}`
}

const RING_FILLS = ['card', 'slate-soft', 'teal-soft', 'teal-deep'] as const

function block(theme: 'light' | 'dark') {
  const colours = [
    ...Object.entries(PALETTE[theme]).map(([k, v]) => `--${k}: ${v};`),
    ...RING_FILLS.map((k) => `--${k}-hover: ${hoverTint(PALETTE[theme][k], theme)};`),
    `--guide-opacity: ${GUIDE_OPACITY[theme]};`,
  ]
  return [`color-scheme: ${theme};`, ...colours, `--shadow: ${SHADOW[theme]};`, `--chevron: ${chevron(PALETTE[theme].muted)};`].join('\n  ')
}

export function paletteCss(): string {
  return [
    `:root {\n  ${block('light')}\n}`,
    `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme='light']) {\n  ${block('dark')}\n  }\n}`,
    `:root[data-theme='dark'] {\n  ${block('dark')}\n}`,
  ].join('\n')
}
