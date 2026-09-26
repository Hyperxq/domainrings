import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { validated } from './validated'

const PositiveSchema = z.object({ n: z.number().positive() })

describe('validated', () => {
  it('returns the candidate unchanged when it satisfies the schema', () => {
    const candidate = { n: 1 }
    expect(validated(PositiveSchema, candidate)).toBe(candidate)
  })

  it('returns undefined when the candidate fails the schema', () => {
    expect(validated(PositiveSchema, { n: -1 })).toBeUndefined()
  })
})
