import { describe, expect, it } from 'vitest'
import { CAMERA_MESSAGE, createStableTracker, firstFailing, nextAllowedText, scaleNamed } from '../../src/routes/quickscan/helpers'
import type { FrameQc } from '../../src/domain/types'
import { NAMED_POINTS } from '../../src/vision/types'

const qc = (oks: boolean[]): FrameQc => ({
  allOk: oks.every(Boolean),
  checks: oks.map((ok, i) => ({ id: (['face', 'yaw', 'roll'] as const)[i]!, ok, value: 1, limit: 'x', hint: `fix ${i}` })),
})

describe('quick-scan helpers', () => {
  it('names the first failing check', () => {
    expect(firstFailing(qc([true, false, false]))?.hint).toBe('fix 1')
    expect(firstFailing(qc([true, true, true]))).toBeNull()
    expect(firstFailing(null)).toBeNull()
  })

  it('auto-capture needs an unbroken green run', () => {
    const t = createStableTracker(1000)
    expect(t.update(true, 0)).toEqual({ progress: 0, ready: false })
    expect(t.update(true, 500).progress).toBeCloseTo(0.5)
    expect(t.update(false, 600)).toEqual({ progress: 0, ready: false })
    expect(t.update(true, 700).progress).toBe(0)
    expect(t.update(true, 1699).ready).toBe(false)
    expect(t.update(true, 1700).ready).toBe(true)
  })

  it('scales every named point', () => {
    const named = Object.fromEntries(NAMED_POINTS.map((n, i) => [n, { x: i * 10, y: i * 20 }])) as never
    const scaled = scaleNamed(named, 0.5) as unknown as Record<string, { x: number; y: number }>
    expect(scaled.pupilL).toEqual({ x: 0, y: 0 })
    expect(scaled.pupilR).toEqual({ x: 5, y: 10 })
    expect(Object.keys(scaled)).toHaveLength(NAMED_POINTS.length)
  })

  it('has a plain message for every camera error', () => {
    for (const code of ['denied', 'no_camera', 'in_use', 'insecure', 'unknown'] as const) expect(CAMERA_MESSAGE[code].length).toBeGreaterThan(20)
    expect(nextAllowedText(null)).toBe('tomorrow')
  })
})
