import { describe, expect, it, vi } from 'vitest'
import { launchBrowser, outputName, targetsOf } from '../src/render.mjs'

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

  it('suggests installing chromium when no browser is available', async () => {
    const pw = chromium(async () => {
      throw new Error('missing')
    })
    await expect(launchBrowser(pw)).rejects.toThrow(/npx playwright install chromium/)
  })
})
