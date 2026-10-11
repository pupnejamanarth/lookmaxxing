import { describe, expect, it } from 'vitest'
import {
  ASSUMED_LONG_EDGE_FOV_DEG,
  NEUTRAL_RULES,
  QC_LIMITS,
  assumedHfovDeg,
  distanceFromIris,
  evaluateFrameQc,
  faceBox,
  faceRegions,
  shotQcPassed,
  steadyCheck,
  worstChecks,
} from '../../src/capture/qc'
import type { FrameQcArgs } from '../../src/capture/qc'
import type { QcCheck, ShotQc } from '../../src/domain/types'
import { IRIS_OVER_IPD, goodPixels, ipdPxAt, makeFrame, neutralBlendshapes } from './capture-frames'

const W = 1920
const H = 1080

function run(overrides: Partial<FrameQcArgs> = {}) {
  return evaluateFrameQc({ frame: makeFrame(), pixels: goodPixels(), shot: 'frontal_neutral', imageWidth: W, imageHeight: H, ...overrides })
}
const check = (qc: ReturnType<typeof run>, id: QcCheck['id']): QcCheck => {
  const c = qc.checks.find((x) => x.id === id)
  if (!c) throw new Error(`no ${id} check`)
  return c
}

describe('the limits are the ones docs/PLAN.md §5 states', () => {
  it('has the protocol thresholds', () => {
    expect(QC_LIMITS.maxYawDeg).toBe(3)
    expect(QC_LIMITS.maxRollDeg).toBe(3)
    expect(QC_LIMITS.maxPitchDeg).toBe(4)
    expect(QC_LIMITS.baselineIrisTolerance).toBe(0.05)
    expect(QC_LIMITS.minDistanceM).toBe(1.2)
    expect(QC_LIMITS.maxDistanceM).toBe(2.2)
    expect(QC_LIMITS.centralShare).toBe(0.5)
    expect(QC_LIMITS.maxClippedShare).toBe(0.01)
    expect(QC_LIMITS.profileYawDeg - QC_LIMITS.profileYawToleranceDeg).toBe(85)
    expect(QC_LIMITS.profileYawDeg + QC_LIMITS.profileYawToleranceDeg).toBe(95)
  })
})

describe('a good frontal frame', () => {
  it('passes every check, in the order a person should fix things', () => {
    const qc = run()
    expect(qc.allOk).toBe(true)
    expect(qc.checks.map((c) => c.id)).toEqual(['face', 'yaw', 'roll', 'pitch', 'distance', 'centered', 'sharpness', 'exposure', 'expression', 'lighting'])
    expect(qc.checks.every((c) => c.ok)).toBe(true)
  })

  it('gives every check a limit, a non-empty hint and a value that is a finite number or null (JSON-safe)', () => {
    for (const qc of [run(), run({ frame: null }), run({ frame: makeFrame({ pose: { yaw: 9, roll: -9, pitch: 9 } }) })]) {
      for (const c of qc.checks) {
        expect(c.limit.length).toBeGreaterThan(3)
        expect(c.hint.trim().length).toBeGreaterThan(3)
        expect(c.hint.length).toBeLessThanOrEqual(300)
        expect(c.value === null || Number.isFinite(c.value)).toBe(true)
      }
      expect(JSON.parse(JSON.stringify(qc.checks))).toEqual(qc.checks)
    }
  })

  it('a frame drawn at 1.5 m estimates 1.5 m, in a landscape and in a portrait frame', () => {
    const land = makeFrame({ imageWidth: 1920, imageHeight: 1080, distanceM: 1.5 })
    const port = makeFrame({ imageWidth: 1080, imageHeight: 1920, distanceM: 1.5 })
    expect(distanceFromIris(land.irisPx, 1920, 1080)).toBeCloseTo(1.5, 6)
    expect(distanceFromIris(port.irisPx, 1080, 1920)).toBeCloseTo(1.5, 6)
    expect(evaluateFrameQc({ frame: port, pixels: goodPixels(), shot: 'frontal_neutral', imageWidth: 1080, imageHeight: 1920 }).allOk).toBe(true)
  })
})

describe('head pose', () => {
  it('passes at the limit and fails just past it', () => {
    expect(check(run({ frame: makeFrame({ pose: { yaw: 3 } }) }), 'yaw').ok).toBe(true)
    expect(check(run({ frame: makeFrame({ pose: { yaw: 3.1 } }) }), 'yaw').ok).toBe(false)
    expect(check(run({ frame: makeFrame({ pose: { roll: -3 } }) }), 'roll').ok).toBe(true)
    expect(check(run({ frame: makeFrame({ pose: { roll: -3.1 } }) }), 'roll').ok).toBe(false)
    expect(check(run({ frame: makeFrame({ pose: { pitch: 4 } }) }), 'pitch').ok).toBe(true)
    expect(check(run({ frame: makeFrame({ pose: { pitch: 4.1 } }) }), 'pitch').ok).toBe(false)
  })

  it('records the signed angle', () => {
    expect(check(run({ frame: makeFrame({ pose: { yaw: -2.5 } }) }), 'yaw').value).toBeCloseTo(-2.5)
  })

  it('says which way to correct', () => {
    // Positive yaw = face turned toward the image's right = the subject's left, so the fix is to turn right.
    expect(check(run({ frame: makeFrame({ pose: { yaw: 6 } }) }), 'yaw').hint).toMatch(/to your right/)
    expect(check(run({ frame: makeFrame({ pose: { yaw: -6 } }) }), 'yaw').hint).toMatch(/to your left/)
    // Positive roll = clockwise on the image = head tipped toward the subject's left, so the fix is to tilt right.
    expect(check(run({ frame: makeFrame({ pose: { roll: 6 } }) }), 'roll').hint).toMatch(/to your right/)
    expect(check(run({ frame: makeFrame({ pose: { roll: -6 } }) }), 'roll').hint).toMatch(/to your left/)
    // Positive pitch = chin down.
    expect(check(run({ frame: makeFrame({ pose: { pitch: 7 } }) }), 'pitch').hint).toMatch(/Raise your chin/)
    expect(check(run({ frame: makeFrame({ pose: { pitch: -7 } }) }), 'pitch').hint).toMatch(/Tilt your chin down a little/)
  })

  it('fails (never passes silently) when the angle is not a number', () => {
    const c = check(run({ frame: makeFrame({ pose: { yaw: Number.NaN } }) }), 'yaw')
    expect(c.ok).toBe(false)
    expect(c.value).toBeNull()
    expect(c.hint).toMatch(/could not be measured/)
  })
})

describe('distance', () => {
  const at = (distanceM: number, extra: Partial<FrameQcArgs> = {}) =>
    check(run({ frame: makeFrame({ distanceM }), ...extra }), 'distance')

  it('accepts 1.2–2.2 m and refuses outside it', () => {
    expect(at(1.25).ok).toBe(true)
    expect(at(2.15).ok).toBe(true)
    expect(at(1.1).ok).toBe(false)
    expect(at(2.3).ok).toBe(false)
  })

  it('too close: tells the person to move back and why', () => {
    const c = at(0.4)
    expect(c.ok).toBe(false)
    expect(c.hint).toMatch(/Move back/)
    expect(c.hint).toMatch(/too close and this distorts your nose and face width/)
    expect(c.value).toBeCloseTo(0.4, 2)
  })

  it('too far: tells the person to move closer', () => {
    const c = at(3.5)
    expect(c.ok).toBe(false)
    expect(c.hint).toMatch(/Move closer/)
    expect(c.hint).toMatch(/too small/)
  })

  it('with a baseline, the iris must be within ±5% of it', () => {
    const base = ipdPxAt(1.5, W, H) * IRIS_OVER_IPD
    const frameWith = (factor: number) => makeFrame({ irisPx: base * factor })
    expect(check(run({ frame: frameWith(1), baselineIrisPx: base }), 'distance').ok).toBe(true)
    expect(check(run({ frame: frameWith(1.049), baselineIrisPx: base }), 'distance').ok).toBe(true)
    expect(check(run({ frame: frameWith(0.951), baselineIrisPx: base }), 'distance').ok).toBe(true)
    const closer = check(run({ frame: frameWith(1.08), baselineIrisPx: base }), 'distance')
    expect(closer.ok).toBe(false)
    expect(closer.hint).toMatch(/Move back/)
    expect(closer.hint).toMatch(/8% closer than in your last scan/)
    const farther = check(run({ frame: frameWith(0.92), baselineIrisPx: base }), 'distance')
    expect(farther.ok).toBe(false)
    expect(farther.hint).toMatch(/Move closer/)
  })

  it('the same 8% drift passes without a baseline (only the 1.2–2.2 m range applies)', () => {
    const base = ipdPxAt(1.5, W, H) * IRIS_OVER_IPD
    expect(check(run({ frame: makeFrame({ irisPx: base * 1.08 }) }), 'distance').ok).toBe(true)
  })

  it('still enforces the range when the baseline matches', () => {
    const tooClose = makeFrame({ distanceM: 0.8 })
    expect(check(run({ frame: tooClose, baselineIrisPx: tooClose.irisPx }), 'distance').ok).toBe(false)
  })

  it('fails with a plain reason when no iris could be read', () => {
    const c = check(run({ frame: makeFrame({ irisPx: 0 }) }), 'distance')
    expect(c.ok).toBe(false)
    expect(c.value).toBeNull()
    expect(c.hint).toMatch(/irises could not be read/)
  })

  it('the assumed field of view is 65° across the long edge and narrower across a portrait width', () => {
    expect(assumedHfovDeg(1920, 1080)).toBeCloseTo(ASSUMED_LONG_EDGE_FOV_DEG, 6)
    expect(assumedHfovDeg(1080, 1920)).toBeLessThan(45)
    expect(assumedHfovDeg(0, 0)).toBe(ASSUMED_LONG_EDGE_FOV_DEG)
  })
})

describe('face position', () => {
  it('passes inside the middle half and fails outside it', () => {
    expect(check(run(), 'centered').ok).toBe(true)
    const corner = makeFrame({ center: { x: 200, y: 150 } })
    const c = check(run({ frame: corner }), 'centered')
    expect(c.ok).toBe(false)
    expect(c.value).toBeGreaterThan(0)
    expect(c.hint).toMatch(/Centre your face/)
  })

  it('names the direction it is off', () => {
    expect(check(run({ frame: makeFrame({ center: { x: W / 2, y: 150 } }) }), 'centered').hint).toMatch(/too high/)
    expect(check(run({ frame: makeFrame({ center: { x: W / 2, y: H - 120 } }) }), 'centered').hint).toMatch(/too low/)
    expect(check(run({ frame: makeFrame({ center: { x: 150, y: H / 2 } }) }), 'centered').hint).toMatch(/to the side/)
  })

  it('a face bigger than the middle half asks to move back', () => {
    const c = check(run({ frame: makeFrame({ distanceM: 0.3 }) }), 'centered')
    expect(c.ok).toBe(false)
    expect(c.hint).toMatch(/Move back/)
  })

  it('the box is the extremes of the face outline', () => {
    const box = faceBox(makeFrame().named)
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThan(0)
    expect(box!.height).toBeGreaterThan(box!.width)
  })
})

describe('sharpness and exposure', () => {
  it('a blurred frame fails sharpness with a plain hint; the limit is inclusive', () => {
    const blur = check(run({ pixels: goodPixels({ sharpness: 3 }) }), 'sharpness')
    expect(blur.ok).toBe(false)
    expect(blur.hint).toMatch(/blurred/)
    expect(check(run({ pixels: goodPixels({ sharpness: QC_LIMITS.minSharpness }) }), 'sharpness').ok).toBe(true)
    expect(check(run({ pixels: goodPixels({ sharpness: QC_LIMITS.minSharpness - 0.01 }) }), 'sharpness').ok).toBe(false)
  })

  it('clipped highlights: under 1% is fine, 1% or more is not', () => {
    expect(check(run({ pixels: goodPixels({ clippedShare: 0.0099 }) }), 'exposure').ok).toBe(true)
    const blown = check(run({ pixels: goodPixels({ clippedShare: 0.02 }) }), 'exposure')
    expect(blown.ok).toBe(false)
    expect(blown.hint).toMatch(/Too bright/)
  })

  it('a dark frame fails as too dark, a dim but readable one passes', () => {
    const dark = check(run({ pixels: goodPixels({ lumaP95: 30, meanLuma: 12 }) }), 'exposure')
    expect(dark.ok).toBe(false)
    expect(dark.hint).toMatch(/Too dark/)
    // A correctly exposed deep skin tone has a low mean but highlights well above the floor: must not be refused.
    expect(check(run({ pixels: goodPixels({ lumaP95: 110, meanLuma: 60, lumaP5: 15 }) }), 'exposure').ok).toBe(true)
  })
})

describe('expression', () => {
  const withShapes = (extra: Record<string, number>) => makeFrame({ blendshapes: { ...neutralBlendshapes(), ...extra } })

  it('a relaxed face is neutral', () => {
    const c = check(run(), 'expression')
    expect(c.ok).toBe(true)
    expect(c.value).toBeLessThan(1)
  })

  it('every neutral rule can fail, and its hint says what to do', () => {
    for (const rule of NEUTRAL_RULES) {
      const shapes = Object.fromEntries(rule.keys.map((k) => [k, Math.min(1, rule.limit + 0.15)]))
      const c = check(run({ frame: withShapes(shapes) }), 'expression')
      expect(c.ok, rule.keys.join('+')).toBe(false)
      expect(c.hint).toBe(rule.hint)
    }
  })

  it('a smile fails a neutral shot, with the first thing to fix named', () => {
    const c = check(run({ frame: withShapes({ mouthSmileLeft: 0.9, mouthSmileRight: 0.9 }) }), 'expression')
    expect(c.ok).toBe(false)
    expect(c.hint).toMatch(/Relax your smile/)
  })

  it('an open mouth, closed eyes and raised brows each fail', () => {
    expect(check(run({ frame: withShapes({ jawOpen: 0.4 }) }), 'expression').hint).toMatch(/Close your mouth/)
    expect(check(run({ frame: withShapes({ eyeBlinkLeft: 0.9, eyeBlinkRight: 0.9 }) }), 'expression').hint).toMatch(/Open your eyes/)
    expect(check(run({ frame: withShapes({ browInnerUp: 0.8 }) }), 'expression').hint).toMatch(/brows/)
  })

  it('the same smile is what a smile shot asks for', () => {
    const smiling = withShapes({ mouthSmileLeft: 0.9, mouthSmileRight: 0.9 })
    expect(check(run({ frame: smiling, shot: 'frontal_smile' }), 'expression').ok).toBe(true)
    expect(check(run({ frame: makeFrame(), shot: 'frontal_smile' }), 'expression').ok).toBe(false)
    expect(check(run({ frame: makeFrame(), shot: 'frontal_smile' }), 'expression').hint).toMatch(/Smile naturally/)
    expect(check(run({ frame: withShapes({ mouthSmileLeft: 0.9, mouthSmileRight: 0.9, eyeBlinkLeft: 0.9, eyeBlinkRight: 0.9 }), shot: 'frontal_smile' }), 'expression').ok).toBe(false)
  })

  it('no blendshapes at all is a failure, not a pass', () => {
    const c = check(run({ frame: makeFrame({ blendshapes: {} }) }), 'expression')
    expect(c.ok).toBe(false)
    expect(c.value).toBeNull()
  })
})

describe('lighting', () => {
  it('side light fails with a plain hint, even light passes, the limit is relative', () => {
    const lit = check(run({ pixels: goodPixels({ leftLuma: 190, rightLuma: 90 }) }), 'lighting')
    expect(lit.ok).toBe(false)
    expect(lit.hint).toMatch(/light is uneven/i)
    expect(check(run({ pixels: goodPixels({ leftLuma: 140, rightLuma: 130 }) }), 'lighting').ok).toBe(true)
    // 20% of the mean: 110 vs 90 → |20| / 100 = 0.2 → ok; 112 vs 88 → 0.24 → fails.
    expect(check(run({ pixels: goodPixels({ leftLuma: 110, rightLuma: 90 }) }), 'lighting').ok).toBe(true)
    expect(check(run({ pixels: goodPixels({ leftLuma: 112, rightLuma: 88 }) }), 'lighting').ok).toBe(false)
  })

  it('is skipped only when the caller supplied no left/right brightness', () => {
    const pixels = goodPixels()
    delete pixels.leftLuma
    delete pixels.rightLuma
    expect(run({ pixels }).checks.some((c) => c.id === 'lighting')).toBe(false)
  })

  it('a frame too dark to judge fails the lighting check instead of passing', () => {
    expect(check(run({ pixels: goodPixels({ leftLuma: 10, rightLuma: 12 }) }), 'lighting').ok).toBe(false)
  })
})

describe('no face', () => {
  const qc = run({ frame: null })

  it('fails, with the face check first and a hint a person can act on', () => {
    expect(qc.allOk).toBe(false)
    expect(qc.checks[0]?.id).toBe('face')
    expect(qc.checks[0]?.ok).toBe(false)
    expect(qc.checks[0]?.hint).toMatch(/No face found/)
  })

  it('every face-dependent check fails with a null value; the picture checks still run', () => {
    for (const id of ['yaw', 'roll', 'pitch', 'distance', 'centered', 'expression', 'lighting'] as const) {
      expect(check(qc, id).ok, id).toBe(false)
      expect(check(qc, id).value, id).toBeNull()
    }
    expect(check(qc, 'sharpness').ok).toBe(true)
    expect(check(qc, 'exposure').ok).toBe(true)
  })
})

describe('other shots', () => {
  it('shots that are not a head at 1.5 m only get the picture checks and need no face', () => {
    for (const shot of ['body_front', 'body_side', 'skin_zones', 'eye_closeup', 'crown_top', 'outfit'] as const) {
      const qc = run({ frame: null, shot })
      expect(qc.checks.map((c) => c.id), shot).toEqual(['sharpness', 'exposure'])
      expect(qc.allOk).toBe(true)
    }
  })

  it('a profile is judged by the size of the turn (85–95°), to either side', () => {
    const yaw = (deg: number) => check(run({ frame: makeFrame({ pose: { yaw: deg } }), shot: 'profile_left' }), 'yaw')
    expect(yaw(90).ok).toBe(true)
    expect(yaw(-90).ok).toBe(true)
    expect(yaw(85).ok).toBe(true)
    expect(yaw(95).ok).toBe(true)
    expect(yaw(80).ok).toBe(false)
    expect(yaw(100).ok).toBe(false)
    expect(yaw(0).ok).toBe(false)
    expect(yaw(0).limit).toMatch(/85–95/)
  })

  it('a profile has no left/right light check', () => {
    expect(run({ shot: 'profile_right', frame: makeFrame({ pose: { yaw: 90 } }) }).checks.some((c) => c.id === 'lighting')).toBe(false)
  })
})

describe('faceRegions', () => {
  it('gives the padded face box and one cheek patch per side, each between the cheek edge and the nose', () => {
    const frame = makeFrame()
    const regions = faceRegions(frame.named, W, H)!
    const box = faceBox(frame.named)!
    expect(regions.face.x).toBeLessThan(box.x)
    expect(regions.face.width).toBeGreaterThan(box.width)
    const left = regions.left!
    const right = regions.right!
    // Image-left cheek sits between zygionR and alarR.
    expect(left.x).toBeGreaterThan(frame.named.zygionR.x)
    expect(left.x + left.width).toBeLessThan(frame.named.alarR.x)
    expect(right.x).toBeGreaterThan(frame.named.alarL.x)
    expect(right.x + right.width).toBeLessThan(frame.named.zygionL.x)
    expect(left.y).toBeGreaterThan(frame.named.eyeBottomL.y)
    expect(left.y + left.height).toBeLessThanOrEqual(frame.named.cheilionL.y + 0.001)
  })

  it('answers null for a face with no outline', () => {
    const frame = makeFrame()
    frame.named.faceTop = { x: Number.NaN, y: Number.NaN }
    expect(faceRegions(frame.named, W, H)).toBeNull()
  })
})

describe('the record of a shot', () => {
  const failing = (id: QcCheck['id'], value: number): QcCheck => ({ id, ok: false, value, limit: 'x within', hint: 'fix it' })

  it('worstChecks keeps, per check, the frame where it was worst', () => {
    const calm = run({ frame: makeFrame({ pose: { yaw: 0.5 } }) })
    const worse = run({ frame: makeFrame({ pose: { yaw: 2.8 } }) })
    const middle = run({ frame: makeFrame({ pose: { yaw: 1.5 } }) })
    const worst = worstChecks([calm, worse, middle])
    expect(worst.find((c) => c.id === 'yaw')?.value).toBeCloseTo(2.8)
    expect(worst.map((c) => c.id)).toEqual(['face', 'yaw', 'roll', 'pitch', 'distance', 'centered', 'sharpness', 'exposure', 'expression', 'lighting'])
  })

  it('worstChecks prefers a failing instance over a passing one', () => {
    const ok = run()
    const bad = run({ pixels: goodPixels({ sharpness: 2 }) })
    expect(worstChecks([bad, ok]).find((c) => c.id === 'sharpness')?.ok).toBe(false)
    expect(worstChecks([ok, bad]).find((c) => c.id === 'sharpness')?.ok).toBe(false)
  })

  it('worstChecks works on checks it did not build (a stored record)', () => {
    const stored = [{ allOk: false, checks: [failing('yaw', 5)] }, { allOk: true, checks: [{ id: 'yaw' as const, ok: true, value: 1, limit: 'x', hint: 'ok' }] }]
    expect(worstChecks(stored).find((c) => c.id === 'yaw')?.ok).toBe(false)
  })

  it('steadyCheck passes at 5% of the pupil distance, fails beyond, and fails (not passes) when it cannot be known', () => {
    expect(steadyCheck(0.02).ok).toBe(true)
    expect(steadyCheck(0.05).ok).toBe(true)
    const loose = steadyCheck(0.08)
    expect(loose.ok).toBe(false)
    expect(loose.hint).toMatch(/Hold still/)
    const unknown = steadyCheck(null)
    expect(unknown.ok).toBe(false)
    expect(unknown.value).toBeNull()
    expect(unknown.id).toBe('steady')
  })

  it('shotQcPassed needs enough kept frames and every check', () => {
    const base: ShotQc = {
      shot: 'frontal_neutral',
      framesTried: 5,
      framesKept: 4,
      checks: run().checks,
      burstSpread: 0.01,
      estimatedDistanceM: 1.5,
      irisPx: 12,
      greyCard: false,
    }
    expect(shotQcPassed(base)).toBe(true)
    expect(shotQcPassed({ ...base, framesKept: QC_LIMITS.minKeptFrames })).toBe(true)
    expect(shotQcPassed({ ...base, framesKept: QC_LIMITS.minKeptFrames - 1 })).toBe(false)
    expect(shotQcPassed({ ...base, checks: [...base.checks, failing('steady', 0.1)] })).toBe(false)
    expect(shotQcPassed({ ...base, checks: [] })).toBe(false)
  })
})
