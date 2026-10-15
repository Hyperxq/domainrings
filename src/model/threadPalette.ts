export const THREAD_SLOTS = 50
export type ThreadMode = 'light' | 'dark'

/**
 * Categorical colours for use-case threads, generated in OKLab: every slot has contrast >= 3 against every app
 * surface in its mode, and any 4 consecutive slots are pairwise distinct for normal and colour-blind vision. Beyond
 * that the palette cannot separate more threads at once, so colour only tells neighbours apart; dots and the legend
 * carry identity.
 */
const HEXES: Record<ThreadMode, readonly string[]> = {
  light: [
  '#813450', '#033ffe', '#2d8f09', '#ea02a1', '#853533',
  '#2778fa', '#548c03', '#7900b4', '#94221d', '#3282c6',
  '#608a05', '#5804d0', '#980b40', '#0c82bf', '#9b7802',
  '#7902fc', '#94045d', '#0573aa', '#f90c17', '#b33cff',
  '#882c50', '#278e69', '#1844b9', '#b242fa', '#932601',
  '#168c6b', '#1b46b4', '#b047f6', '#8f2b0d', '#5a8b26',
  '#0050a2', '#c925fb', '#990a39', '#778309', '#124ca9',
  '#bc30fb', '#9e024a', '#7d8118', '#0553a6', '#b038fb',
  '#9f0042', '#827f11', '#0e599d', '#ad1afd', '#a10a4c',
  '#888024', '#0e509d', '#af2bfc', '#a20845', '#877d09',
  ],
  dark: [
  '#4f8b4f', '#d72af9', '#fd171c', '#b871a1', '#418d50',
  '#1380f7', '#fc3006', '#e80cbb', '#32925e', '#4f84fe',
  '#fd2c29', '#e61fc8', '#1d966d', '#1e86fe', '#f83918',
  '#e90bca', '#2f956e', '#3d84fa', '#f53512', '#e317c5',
  '#18936a', '#1983fb', '#f92725', '#e025c3', '#109067',
  '#5b81fe', '#f1300b', '#dd2fc1', '#308e63', '#4087fd',
  '#ed391a', '#f208c3', '#278e69', '#0f90fe', '#e84306',
  '#de3bc2', '#2b916b', '#058dfa', '#ec460e', '#e72fc9',
  '#239970', '#2d8afc', '#f74807', '#ea25cc', '#009b6e',
  '#5285f8', '#fc3d1d', '#e133c4', '#2f996a', '#2987f8',
  ],
}

export const threadColour = (slot: number, mode: ThreadMode): string => HEXES[mode][slot]

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
type Rgb = [number, number, number]
const MACHADO: Record<'protan' | 'deutan', number[][]> = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
}
const toLab = ([r, g, b]: Rgb): Rgb => {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}
const simulate = (rgb: Rgb, m: number[][]): Rgb => m.map((row) => Math.min(1, Math.max(0, row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]))) as Rgb
const views = (hex: string) => {
  const rgb = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255)) as Rgb
  return { normal: toLab(rgb), protan: toLab(simulate(rgb, MACHADO.protan)), deutan: toLab(simulate(rgb, MACHADO.deutan)) }
}
const delta = (p: Rgb, q: Rgb) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 100

/** How far a pair clears the gates (normal vision 15, colour-blind 8): at least 1 means distinct. */
function pairScore(a: string, b: string): number {
  const [x, y] = [views(a), views(b)]
  return Math.min(delta(x.normal, y.normal) / 15, Math.min(delta(x.protan, y.protan), delta(x.deutan, y.deutan)) / 8)
}

let scores: number[][] | undefined
/** The worse of the two modes, so a pair told apart in light is told apart in dark too. */
export function slotScore(a: number, b: number): number {
  scores ??= HEXES.light.map((_, i) => HEXES.light.map((__, j) => Math.min(pairScore(HEXES.light[i], HEXES.light[j]), pairScore(HEXES.dark[i], HEXES.dark[j]))))
  return a === b ? 0 : scores[a][b]
}

export const distinctSlots = (a: number, b: number): boolean => slotScore(a, b) >= 1
