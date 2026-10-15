import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { flowsOf, isHexagonal, readMap, resolveFlow, shareLink } from './link.mjs'

// Same slug as the app's file names.
const slug = (title) => title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map'

export const outputName = (map, flow, format) => `${flow ? `${slug(flow.hexagonTitle)}-${slug(flow.name)}` : slug(map.title)}.${format}`

/** `undefined` stands for the whole map with nothing focused. */
export function targetsOf(map, flow, hexagonId) {
  if (flow === undefined) return [undefined]
  if (flow !== 'all') return [resolveFlow(map, flow, hexagonId)]
  if (!isHexagonal(map)) throw new Error('--flow only applies to hexagonal maps.')
  return flowsOf(map)
}

export async function launchBrowser(chromium) {
  try {
    return await chromium.launch({ channel: 'chrome' })
  } catch {
    try {
      return await chromium.launch()
    } catch {
      throw new Error('No browser found: install Google Chrome, or run `npx playwright install chromium`.')
    }
  }
}

async function renderOne(browser, url, format, path) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
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
    await page.close()
  }
}

export async function render(file, { flow, hex, out = '.', format = 'png', baseUrl }, { chromium, log = console.log }) {
  if (!['png', 'svg'].includes(format)) throw new Error('--format must be png or svg.')
  const map = readMap(file)
  const targets = targetsOf(map, flow, hex)
  mkdirSync(out, { recursive: true })
  const browser = await launchBrowser(chromium)
  try {
    for (const target of targets) {
      const path = resolve(join(out, outputName(map, target, format)))
      await renderOne(browser, shareLink(map, { baseUrl, flow: target }), format, path)
      log(path)
    }
  } finally {
    await browser.close()
  }
}
