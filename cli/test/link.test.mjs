import { describe, expect, it } from 'vitest'
import { openerCommand, resolveFlow, shareLink } from '../src/link.mjs'

const hexagon = (id, title, useCases) => ({ id, title, useCases })
const map = {
  app: 'domainrings',
  version: 5,
  kind: 'hexagonal',
  title: 'Shop',
  hexagons: [
    hexagon('h1', 'Orders', [{ id: 'place', name: 'PlaceOrder' }, { id: 'cancel', name: 'Cancel' }]),
    hexagon('h2', 'Billing', [{ id: 'charge', name: 'ChargeOrder' }, { id: 'cancel', name: 'Cancel' }]),
  ],
}

describe('resolveFlow', () => {
  it('matches a use case id', () => {
    expect(resolveFlow(map, 'place')).toMatchObject({ hexagonId: 'h1', useCaseId: 'place', hexagonTitle: 'Orders', name: 'PlaceOrder' })
  })

  it('matches a use case name when no id matches', () => {
    expect(resolveFlow(map, 'ChargeOrder')).toMatchObject({ hexagonId: 'h2', useCaseId: 'charge' })
  })

  it('prefers an id over a name', () => {
    const tricky = { ...map, hexagons: [hexagon('h1', 'A', [{ id: 'x', name: 'y' }, { id: 'y', name: 'x' }])] }
    expect(resolveFlow(tricky, 'x').useCaseId).toBe('x')
  })

  it('fails on a flow found in several hexagons, listing them', () => {
    expect(() => resolveFlow(map, 'cancel')).toThrow(/Orders.*Billing/s)
  })

  it('disambiguates with a hexagon id', () => {
    expect(resolveFlow(map, 'cancel', 'h2')).toMatchObject({ hexagonId: 'h2', useCaseId: 'cancel' })
  })

  it('fails when the flow is not in the requested hexagon', () => {
    expect(() => resolveFlow(map, 'place', 'h2')).toThrow(/h2/)
  })

  it('fails on an unknown flow, listing the available ones', () => {
    expect(() => resolveFlow(map, 'nope')).toThrow(/PlaceOrder.*ChargeOrder/s)
  })

  it('refuses flow options on a map that is not hexagonal', () => {
    expect(() => resolveFlow({ app: 'domainrings', version: 5, kind: 'onion', title: 'O' }, 'x')).toThrow(/hexagonal/)
  })
})

describe('shareLink', () => {
  it('uses the default base address and no flow options', () => {
    expect(shareLink(map)).toMatch(/^https:\/\/diagrams\.pbuilder\.dev\/#m=[\w-]+$/)
  })

  it('normalises a custom base address and appends the flow and hexagon', () => {
    const link = shareLink(map, { baseUrl: 'http://localhost:5179', flow: { hexagonId: 'h 1', useCaseId: 'place' } })
    expect(link).toMatch(/^http:\/\/localhost:5179\/#m=[\w-]+&flow=place&hex=h%201$/)
  })

  it('rejects an address that is not a URL', () => {
    expect(() => shareLink(map, { baseUrl: 'not a url' })).toThrow(/--base-url/)
  })
})

describe('openerCommand', () => {
  it.each([
    ['darwin', 'open', ['https://x/']],
    ['linux', 'xdg-open', ['https://x/']],
    ['win32', 'rundll32', ['url.dll,FileProtocolHandler', 'https://x/']],
  ])('picks the %s opener', (platform, command, args) => {
    expect(openerCommand(platform, 'https://x/')).toEqual({ command, args })
  })

  it('passes a url with & to the Windows opener untouched, since it does not go through cmd', () => {
    const url = 'https://x/#m=abc&flow=a&hex=b'
    expect(openerCommand('win32', url).args.at(-1)).toBe(url)
  })
})
