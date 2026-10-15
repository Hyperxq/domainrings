import { describe, expect, it } from 'vitest'
import type { Pair } from './elements'
import { planHops, type Terminal } from './routes'

const useCase = (u: number): Terminal => ({ wall: 'e', layer: 1, u, width: 100, height: 40 })
const intoDomain: Pair = { key: 'useCase:a->domain', from: 'useCase:a', to: 'domain', fromRef: 'a', owner: 'a' }
const landing = (core: number, u: number) => planHops([intoDomain], new Map([['useCase:a', useCase(u)]]), () => 0, core)[0].b.u

describe('planHops into the domain', () => {
  it('lands under the use case when the domain wall is long enough', () => {
    expect(landing(200, 30)).toBeCloseTo(30, 6)
  })

  it('stays within the wall that is left clear of the ends', () => {
    expect(landing(200, 500)).toBeCloseTo(200 / Math.sqrt(3) - 12, 6)
    expect(landing(200, -500)).toBeCloseTo(-(200 / Math.sqrt(3) - 12), 6)
  })

  it('aims at the middle of a wall too short to leave the ends clear', () => {
    expect(landing(10, 30)).toBeCloseTo(0, 6)
    expect(landing(10, -30)).toBeCloseTo(0, 6)
    expect(landing(0, 30)).toBeCloseTo(0, 6)
  })
})
