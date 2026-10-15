import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PALETTE_IDS, appearanceOf, launchBrowser, outputName, render, storageEntries, targetsOf, uniqueName } from '../src/render.mjs'

const map = {
  app: 'domainrings',
  version: 5,
  kind: 'hexagonal',
  title: 'Shop Floor!',
  hexagons: [
    { id: 'h1', title: 'Orders & Co', useCases: [{ id: 'a', name: 'Place Order' }] },
    { id: 'h2', title: 'Billing', useCases: [{ id: 'b', name: 'Charge' }] },
  ],
}

describe('outputName', () => {
  it('names a flow after its hexagon and use case', () => {
    expect(outputName(map, { hexagonTitle: 'Orders & Co', name: 'Place Order' }, 'png')).toBe('orders-co-place-order.png')
  })

  it('names the whole map after its title', () => {
    expect(outputName(map, undefined, 'svg')).toBe('shop-floor.svg')
  })
})

describe('targetsOf', () => {
  it('renders the whole map when no flow is given', () => {
    expect(targetsOf(map, undefined)).toEqual([undefined])
  })

  it('renders every use case of every hexagon for "all"', () => {
    expect(targetsOf(map, 'all').map((f) => f.useCaseId)).toEqual(['a', 'b'])
  })

  it('resolves a single flow', () => {
    expect(targetsOf(map, 'Charge').map((f) => f.hexagonId)).toEqual(['h2'])
  })

  it('limits "all" to the hexagon given with --hex', () => {
    expect(targetsOf(map, 'all', 'h2').map((f) => f.useCaseId)).toEqual(['b'])
  })

  it('fails for "all" with an unknown hexagon', () => {
    expect(() => targetsOf(map, 'all', 'nope')).toThrow(/nope/)
  })

  it('fails for "all" with a hexagon that has no use cases', () => {
    const empty = { ...map, hexagons: [...map.hexagons, { id: 'h3', title: 'Empty', useCases: [] }] }
    expect(() => targetsOf(empty, 'all', 'h3')).toThrow(/"h3".*no use cases/)
  })

  it('fails for "all" on a map without flows', () => {
    expect(() => targetsOf({ ...map, kind: 'onion', version: 5 }, 'all')).toThrow(/hexagonal/)
  })
})

describe('launchBrowser', () => {
  const chromium = (impl) => ({ launch: vi.fn(impl) })

  it('uses the installed Chrome first', async () => {
    const browser = {}
    const pw = chromium(async () => browser)
    expect(await launchBrowser(pw)).toBe(browser)
    expect(pw.launch).toHaveBeenCalledWith({ channel: 'chrome' })
  })

  it('falls back to a bundled chromium', async () => {
    const browser = {}
    const pw = chromium(async (options) => {
      if (options?.channel) throw new Error('no chrome')
      return browser
    })
    expect(await launchBrowser(pw)).toBe(browser)
  })

  it('keeps the Chrome failure reason when both launches fail', async () => {
    const pw = chromium(async (options) => {
      throw new Error(options?.channel ? 'chrome crashed' : 'no bundled')
    })
    await expect(launchBrowser(pw)).rejects.toThrow(/chrome crashed[\s\S]*npx playwright install chromium/)
  })

  it('copes with a launch failure that is not an Error', async () => {
    const pw = chromium(async (options) => {
      throw options?.channel ? 'chrome string failure' : 'no bundled'
    })
    await expect(launchBrowser(pw)).rejects.toThrow(/chrome string failure[\s\S]*npx playwright install chromium/)
  })

  it('suggests installing chromium when no browser is available', async () => {
    const pw = chromium(async () => {
      throw new Error('missing')
    })
    await expect(launchBrowser(pw)).rejects.toThrow(/npx playwright install chromium/)
  })
})

describe('uniqueName', () => {
  it('suffixes a name already taken in this run, before the extension', () => {
    const taken = new Set()
    expect(['a.png', 'a.png', 'a.png', 'b.png'].map((n) => uniqueName(n, taken))).toEqual(['a.png', 'a-2.png', 'a-3.png', 'b.png'])
  })
})

describe('appearanceOf', () => {
  it('defaults to purple and dark', () => {
    const warn = vi.fn()
    expect(appearanceOf({}, warn)).toEqual({ palette: 'purple', theme: 'dark' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('accepts every palette and both themes', () => {
    const warn = vi.fn()
    for (const palette of PALETTE_IDS) expect(appearanceOf({ palette, theme: 'light' }, warn)).toEqual({ palette, theme: 'light' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('falls back to purple with a warning naming the valid palettes', () => {
    const warn = vi.fn()
    expect(appearanceOf({ palette: 'neon' }, warn).palette).toBe('purple')
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/neon.*default, purple, terracotta, cool/))
  })

  it('falls back to dark with a warning on an unknown theme', () => {
    const warn = vi.fn()
    expect(appearanceOf({ theme: 'sepia' }, warn).theme).toBe('dark')
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/sepia.*dark, light/))
  })
})

describe('storageEntries', () => {
  it('stores the theme and a non-default palette under the app keys', () => {
    expect(storageEntries({ palette: 'terracotta', theme: 'light' })).toEqual({ 'domainrings:palette': 'terracotta', 'domainrings:theme': 'light' })
  })

  it('leaves the palette key absent for the default palette, as the app does', () => {
    expect(storageEntries({ palette: 'default', theme: 'dark' })).toEqual({ 'domainrings:palette': null, 'domainrings:theme': 'dark' })
  })
})

describe('render', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'render-')), 'map.hexa')
  writeFileSync(file, JSON.stringify(map))

  const browserWith = (fail) => {
    const page = {
      goto: vi.fn(async (url) => {
        if (fail(url)) throw new Error('boom')
      }),
      waitForFunction: vi.fn(),
      getByRole: vi.fn(() => ({ count: async () => 0, click: vi.fn() })),
      waitForEvent: vi.fn(async () => ({ saveAs: async () => {} })),
      close: vi.fn(),
    }
    const context = { addInitScript: vi.fn(), newPage: vi.fn(async () => page), close: vi.fn() }
    const browser = { newContext: vi.fn(async () => context), close: vi.fn() }
    return { browser, context, page }
  }

  it('applies the colour scheme and storage before the page loads', async () => {
    const { browser, context } = browserWith(() => false)
    await render(file, { flow: 'Charge', palette: 'cool', theme: 'light', out: dirname(file) }, { chromium: { launch: async () => browser }, log: () => {}, warn: () => {} })
    expect(browser.newContext).toHaveBeenCalledWith(expect.objectContaining({ colorScheme: 'light' }))
    expect(context.addInitScript).toHaveBeenCalledWith(expect.any(Function), { 'domainrings:palette': 'cool', 'domainrings:theme': 'light' })
  })

  it('runs an init script that writes the keys and removes the absent ones', async () => {
    const { browser, context } = browserWith(() => false)
    await render(file, { flow: 'Charge', palette: 'default', theme: 'light', out: dirname(file) }, { chromium: { launch: async () => browser }, log: () => {}, warn: () => {} })
    const [script, entries] = context.addInitScript.mock.calls[0]
    const localStorage = { setItem: vi.fn(), removeItem: vi.fn() }
    vi.stubGlobal('localStorage', localStorage)
    try {
      script(entries)
    } finally {
      vi.unstubAllGlobals()
    }
    expect(localStorage.setItem).toHaveBeenCalledWith('domainrings:theme', 'light')
    expect(localStorage.removeItem).toHaveBeenCalledWith('domainrings:palette')
  })

  it('finds the Share button and download item by their exact names, not by a substring a map element could share', async () => {
    const { browser, page } = browserWith(() => false)
    await render(file, { flow: 'Charge', out: dirname(file) }, { chromium: { launch: async () => browser }, log: () => {}, warn: () => {} })
    expect(page.getByRole).toHaveBeenCalledWith('button', { name: 'Share', exact: true })
    expect(page.getByRole).toHaveBeenCalledWith('menuitem', { name: 'Download PNG', exact: true })
  })

  it('asks the app to frame a flow image, and leaves a whole-map image alone', async () => {
    const { browser, page } = browserWith(() => false)
    await render(file, { flow: 'Charge', out: dirname(file) }, { chromium: { launch: async () => browser }, log: () => {}, warn: () => {} })
    expect(page.goto.mock.calls[0][0]).toMatch(/&flow=b&hex=h2&frame=flow$/)
    page.goto.mockClear()
    await render(file, { out: dirname(file) }, { chromium: { launch: async () => browser }, log: () => {}, warn: () => {} })
    expect(page.goto.mock.calls[0][0]).not.toContain('frame=')
  })

  it('closes the context when setup after creating it fails', async () => {
    const { browser, context } = browserWith(() => false)
    context.addInitScript.mockRejectedValue(new Error('init failed'))
    await expect(render(file, { flow: 'Charge', out: dirname(file) }, { chromium: { launch: async () => browser }, log: () => {}, warn: () => {} })).rejects.toThrow(/1 of 1/)
    expect(context.close).toHaveBeenCalledTimes(1)
    expect(browser.close).toHaveBeenCalledTimes(1)
  })

  it('keeps rendering after a failed flow, reports it, and fails at the end', async () => {
    const { browser } = browserWith((url) => url.includes('flow=a'))
    const log = vi.fn()
    const warn = vi.fn()
    await expect(render(file, { flow: 'all', out: dirname(file) }, { chromium: { launch: async () => browser }, log, warn })).rejects.toThrow(/1 of 2/)
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Place Order.*boom/))
    expect(log).toHaveBeenCalledTimes(1)
  })
})
