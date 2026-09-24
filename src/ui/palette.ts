/**
 * The single source of the colour tokens. `paletteCss` turns these tables into the theme CSS (system default plus
 * the explicit data-theme override, per palette), and the contrast test reads the same tables.
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

type Theme = 'light' | 'dark'

/**
 * Curated alternatives keep every token's role: driving and driven stay two distinct hues apart from the accent,
 * the accent's `teal-deep` stays its deepest solid, `slate` stays neutral. The first entry is the default.
 */
export const PALETTES = {
  default: { label: 'Default', description: 'Indigo, rust and teal', light: LIGHT, dark: DARK },
  ink: {
    label: 'Ink',
    description: 'Cobalt, copper and forest',
    light: {
      bg: '#F5F2EC',
      ink: '#1A1814',
      muted: '#655E54',
      line: '#D8D1C5',
      teal: '#2D6247',
      'teal-soft': '#E1EADF',
      'teal-deep': '#2F5A44',
      slate: '#5B544A',
      'slate-soft': '#EAE5DC',
      card: '#FCFAF6',
      'domain-ink': '#F8F6F0',
      'driving-fill': '#2F4C8C',
      'driving-line': '#4D68A8',
      'driving-ink': '#F7F9FF',
      'driven-fill': '#A5542A',
      'driven-line': '#C06E40',
      'driven-ink': '#FFF8F2',
      error: '#B42318',
    },
    dark: {
      bg: '#14120F',
      ink: '#EFEBE3',
      muted: '#A39B8E',
      line: '#3A352E',
      teal: '#86C39E',
      'teal-soft': '#1E3328',
      'teal-deep': '#2B5840',
      slate: '#C4BCAF',
      'slate-soft': '#26231E',
      card: '#1C1A16',
      'domain-ink': '#EFEBE3',
      'driving-fill': '#2E4682',
      'driving-line': '#4A63A3',
      'driving-ink': '#F2F5FF',
      'driven-fill': '#8C4622',
      'driven-line': '#AA5D34',
      'driven-ink': '#FFF5EE',
      error: '#F97066',
    },
  },
  moss: {
    label: 'Moss',
    description: 'Plum, ochre and moss',
    light: {
      bg: '#F2F3F4',
      ink: '#15191C',
      muted: '#5A636A',
      line: '#CDD2D6',
      teal: '#4B6428',
      'teal-soft': '#E5EBDA',
      'teal-deep': '#465C28',
      slate: '#525B63',
      'slate-soft': '#E4E7E9',
      card: '#FAFBFB',
      'domain-ink': '#F6F7F2',
      'driving-fill': '#6A3E6D',
      'driving-line': '#88598B',
      'driving-ink': '#FCF6FC',
      'driven-fill': '#9A5618',
      'driven-line': '#B8732F',
      'driven-ink': '#FFF8EF',
      error: '#B42318',
    },
    dark: {
      bg: '#121517',
      ink: '#ECEFF0',
      muted: '#98A2A8',
      line: '#323A40',
      teal: '#A6C173',
      'teal-soft': '#283221',
      'teal-deep': '#3E5126',
      slate: '#B7C0C5',
      'slate-soft': '#20262A',
      card: '#191D20',
      'domain-ink': '#ECEFF0',
      'driving-fill': '#5E3A63',
      'driving-line': '#7A5280',
      'driving-ink': '#FAF2FB',
      'driven-fill': '#854B16',
      'driven-line': '#A6652A',
      'driven-ink': '#FFF6EC',
      error: '#F97066',
    },
  },
} satisfies Record<string, { label: string; description: string } & Record<Theme, Record<Token, string>>>

export type PaletteId = keyof typeof PALETTES

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
function hoverTint(hex: string, theme: Theme) {
  const [target, amount] = theme === 'dark' ? [255, 0.06] : [0, 0.04]
  const mix = (i: number) => Math.round(parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) * (1 - amount) + target * amount)
  return `#${[0, 1, 2].map((i) => mix(i).toString(16).padStart(2, '0')).join('')}`
}

const RING_FILLS = ['card', 'slate-soft', 'teal-soft', 'teal-deep'] as const

function block(id: PaletteId, theme: Theme) {
  const table: Record<Token, string> = PALETTES[id][theme]
  const colours = [
    ...Object.entries(table).map(([k, v]) => `--${k}: ${v};`),
    ...RING_FILLS.map((k) => `--${k}-hover: ${hoverTint(table[k], theme)};`),
    `--guide-opacity: ${GUIDE_OPACITY[theme]};`,
  ]
  return [`color-scheme: ${theme};`, ...colours, `--shadow: ${SHADOW[theme]};`, `--chevron: ${chevron(table.muted)};`].join('\n  ')
}

/**
 * The default palette sits on bare `:root`; every other one repeats the three theme blocks with a `data-palette`
 * attribute added, so each of its selectors is exactly one attribute more specific than the default's counterpart.
 */
export function paletteCss(): string {
  return (Object.keys(PALETTES) as PaletteId[])
    .flatMap((id) => {
      const root = id === 'default' ? ':root' : `:root[data-palette='${id}']`
      return [
        `${root} {\n  ${block(id, 'light')}\n}`,
        `@media (prefers-color-scheme: dark) {\n  ${root}:not([data-theme='light']) {\n  ${block(id, 'dark')}\n  }\n}`,
        `${root}[data-theme='dark'] {\n  ${block(id, 'dark')}\n}`,
      ]
    })
    .join('\n')
}
