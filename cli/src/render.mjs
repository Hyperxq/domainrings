import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { flowsOf, isHexagonal, readMap, resolveFlow, shareLink } from './link.mjs'

// Same slug as the app's file names.
const slug = (title) => title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map'

// Duplicated from the app's PALETTES; src/cli.test.ts fails if they drift.
export const PALETTE_IDS = ['default', 'purple', 'terracotta', 'cool']
const THEMES = ['dark', 'light']

export function appearanceOf({ palette = 'purple', theme = 'dark' }, warn) {
  if (!PALETTE_IDS.includes(palette)) {
    warn(`Unknown palette "${palette}"; using purple. Valid palettes: ${PALETTE_IDS.join(', ')}.`)
    palette = 'purple'
  }
  if (!THEMES.includes(theme)) {
    warn(`Unknown theme "${theme}"; using dark. Valid themes: ${THEMES.join(', ')}.`)
    theme = 'dark'
  }
  return { palette, theme }
}

/** The app's preference keys; it stores the default palette as an absent key (null here). */
export const storageEntries = ({ palette, theme }) => ({
  'domainrings:palette': palette === 'default' ? null : palette,
  'domainrings:theme': theme,
})

export const outputName = (map, flow, format) => `${flow ? `${slug(flow.hexagonTitle)}-${slug(flow.name)}` : slug(map.title)}.${format}`

export function uniqueName(name, taken) {
  const dot = name.lastIndexOf('.')
  const [stem, ext] = [name.slice(0, dot), name.slice(dot)]
  let candidate = name
  for (let n = 2; taken.has(candidate); n++) candidate = `${stem}-${n}${ext}`
  taken.add(candidate)
  return candidate
}

/** `undefined` stands for the whole map with nothing focused. */
export function targetsOf(map, flow, hexagonId) {
  if (flow === undefined) return [undefined]
  if (flow !== 'all') return [resolveFlow(map, flow, hexagonId)]
  if (!isHexagonal(map)) throw new Error('--flow only applies to hexagonal maps.')
  const flows = flowsOf(map)
  if (hexagonId === undefined) return flows
  if (!(map.hexagons ?? []).some((h) => h.id === hexagonId)) throw new Error(`No hexagon "${hexagonId}".`)
  return flows.filter((f) => f.hexagonId === hexagonId)
}

export async function launchBrowser(chromium) {
  try {
    return await chromium.launch({ channel: 'chrome' })
  } catch (chromeError) {
    try {
      return await chromium.launch()
    } catch {
      throw new Error(`Could not start Chrome (${chromeError.message.split('\n')[0]}) and no bundled chromium was found: install Google Chrome, or run \`npx playwright install chromium\`.`)
    }
  }
}

async function renderOne(browser, url, format, path, appearance) {
  // colorScheme keeps anything the stored theme does not cover from following the system.
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: appearance.theme })
  await context.addInitScript((entries) => {
    for (const [key, value] of Object.entries(entries)) value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value)
  }, storageEntries(appearance))
  const page = await context.newPage()
  try {
    await page.goto(url)
    // The app consumes the share hash once the map is swapped in and the flow is focused.
    await page.waitForFunction(() => !location.hash.startsWith('#m='))
    const alert = page.getByRole('alert')
    if (await alert.count()) throw new Error(`The app could not open the link: ${(await alert.first().innerText()).trim()}`)
    await page.getByRole('button', { name: 'Share' }).click()
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: `Download ${format.toUpperCase()}` }).click()])
    await download.saveAs(path)
  } finally {
    await context.close()
  }
}

export async function render(file, { flow, hex, out = '.', format = 'png', baseUrl, palette, theme }, { chromium, log = console.log, warn = console.error }) {
  if (!['png', 'svg'].includes(format)) throw new Error('--format must be png or svg.')
  const map = readMap(file)
  const targets = targetsOf(map, flow, hex)
  const appearance = appearanceOf({ palette, theme }, warn)
  mkdirSync(out, { recursive: true })
  const browser = await launchBrowser(chromium)
  const taken = new Set()
  let failed = 0
  try {
    for (const target of targets) {
      const path = resolve(join(out, uniqueName(outputName(map, target, format), taken)))
      try {
        await renderOne(browser, shareLink(map, { baseUrl, flow: target }), format, path, appearance)
        log(path)
      } catch (error) {
        failed++
        warn(`${target ? `${target.hexagonTitle} / ${target.name}` : map.title}: ${error.message}`)
      }
    }
  } finally {
    await browser.close()
  }
  if (failed > 0) throw new Error(`${failed} of ${targets.length} renders failed.`)
}
