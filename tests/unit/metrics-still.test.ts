import { describe, expect, it } from 'vitest'
import { minFramesFor } from '../../src/metrics/refusals'

describe('single still photos', () => {
  it('need one good frame; a burst still needs three', () => {
    expect(minFramesFor({ framesTried: 1 })).toBe(1)
    expect(minFramesFor({ framesTried: 5 })).toBeGreaterThanOrEqual(3)
  })
})
