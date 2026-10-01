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
  'ring-custom': '#DFEAE7',
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
  'ring-custom': '#1E3336',
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
  purple: {
    label: 'Purple',
    description: 'Violet, teal-blue and copper',
    light: {
      bg: '#F4F0FA',
      ink: '#1A1426',
      muted: '#62586F',
      line: '#D3C9E3',
      teal: '#6B3FB5',
      'teal-soft': '#E6DCF6',
      'teal-deep': '#5B3399',
      slate: '#54495F',
      'slate-soft': '#E8E1F2',
      card: '#FCFAFF',
      'ring-custom': '#E3D9F3',
      'domain-ink': '#FAF7FF',
      'driving-fill': '#1F6E8C',
      'driving-line': '#3D8CAA',
      'driving-ink': '#F4FBFF',
      'driven-fill': '#9C5A14',
      'driven-line': '#C27B2E',
      'driven-ink': '#FFF8EE',
      error: '#B42318',
    },
    dark: {
      bg: '#17101F',
      ink: '#F0EAF7',
      muted: '#A99BBB',
      line: '#3B2F4D',
      teal: '#B48CF0',
      'teal-soft': '#2E1F47',
      'teal-deep': '#4E2C85',
      slate: '#C3B6D3',
      'slate-soft': '#251B33',
      card: '#1E1629',
      'ring-custom': '#2B2040',
      'domain-ink': '#F0EAF7',
      'driving-fill': '#1B6482',
      'driving-line': '#3A86A6',
      'driving-ink': '#F2FAFF',
      'driven-fill': '#8A5214',
      'driven-line': '#A8691F',
      'driven-ink': '#FFF6EA',
      error: '#B42318',
    },
  },
  terracotta: {
    label: 'Terracotta',
    description: 'Teal, olive and terracotta',
    light: {
      bg: '#F6EFE6',
      ink: '#22160F',
      muted: '#6B5A4D',
      line: '#DCCDBA',
      teal: '#B24A2A',
      'teal-soft': '#F3DCCD',
      'teal-deep': '#9C3F22',
      slate: '#5A4A3E',
      'slate-soft': '#EDE3D6',
      card: '#FDF9F4',
      'ring-custom': '#F0E0D0',
      'domain-ink': '#FFF7F1',
      'driving-fill': '#1F5F73',
      'driving-line': '#3D7F94',
      'driving-ink': '#F2FBFF',
      'driven-fill': '#6B6A1C',
      'driven-line': '#878632',
      'driven-ink': '#FCFCEC',
      error: '#B42318',
    },
    dark: {
      bg: '#1A110C',
      ink: '#F3EAE0',
      muted: '#B09E8D',
      line: '#43332A',
      teal: '#E58A66',
      'teal-soft': '#3D2218',
      'teal-deep': '#8A3A1F',
      slate: '#CDBBA8',
      'slate-soft': '#2A1D15',
      card: '#22170F',
      'ring-custom': '#33211A',
      'domain-ink': '#F3EAE0',
      'driving-fill': '#1E5A70',
      'driving-line': '#3A7C94',
      'driving-ink': '#F0FAFF',
      'driven-fill': '#6A691F',
      'driven-line': '#868533',
      'driven-ink': '#FAFAE8',
      error: '#B42318',
    },
  },
  cool: {
    label: 'Cool',
    description: 'Violet, rust and petrol blue',
    light: {
      bg: '#EDF2F7',
      ink: '#0E1A26',
      muted: '#55687A',
      line: '#C4D2E0',
      teal: '#14639A',
      'teal-soft': '#D8E8F4',
      'teal-deep': '#1C5E8C',
      slate: '#4A5B6B',
      'slate-soft': '#E0E8F0',
      card: '#F8FBFE',
      'ring-custom': '#D9E6F2',
      'domain-ink': '#F5FAFF',
      'driving-fill': '#6A45C8',
      'driving-line': '#8666DC',
      'driving-ink': '#FAF8FF',
      'driven-fill': '#B5502A',
      'driven-line': '#CC6642',
      'driven-ink': '#FFF8F4',
      error: '#B42318',
    },
    dark: {
      bg: '#0D1620',
      ink: '#E8F0F8',
      muted: '#8FA5B8',
      line: '#2A3B4D',
      teal: '#5EB6EA',
      'teal-soft': '#12344D',
      'teal-deep': '#1A5A86',
      slate: '#B0C3D4',
      'slate-soft': '#172430',
      card: '#121D29',
      'ring-custom': '#1A2F44',
      'domain-ink': '#E8F0F8',
      'driving-fill': '#5B45B5',
      'driving-line': '#7660CC',
      'driving-ink': '#F6F3FF',
      'driven-fill': '#964625',
      'driven-line': '#B35C38',
      'driven-ink': '#FFF6F1',
      error: '#B42318',
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
  ['muted', 'ring-custom'],
  ['ink', 'ring-custom'],
  ['ink', 'slate-soft'],
  ['ink', 'teal-soft'],
  ['card', 'teal'],
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

const RING_FILLS = ['card', 'slate-soft', 'teal-soft', 'teal-deep', 'ring-custom'] as const

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
