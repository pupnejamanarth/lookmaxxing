import { afterEach, describe, expect, it, vi } from 'vitest'
import { BEEP_PATTERNS, beep, closeAudio, unlockAudio } from '../../src/capture/beep'

interface Started {
  frequency: number
  start: number
  stop: number
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  state: 'running' | 'suspended' = 'suspended'
  currentTime = 10
  destination = {}
  oscillators: Started[] = []
  resume = vi.fn(async () => {
    this.state = 'running'
  })
  close = vi.fn(async () => undefined)
  bufferSources = 0
  constructor() {
    FakeAudioContext.instances.push(this)
  }
  createBuffer = () => ({})
  createBufferSource = () => {
    this.bufferSources++
    return { buffer: null as unknown, connect: () => undefined, start: () => undefined }
  }
  createGain = () => ({
    gain: { setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined },
    connect: () => undefined,
  })
  createOscillator = () => {
    const record: Started = { frequency: 0, start: 0, stop: 0 }
    this.oscillators.push(record)
    return {
      type: 'square',
      frequency: {
        set value(v: number) {
          record.frequency = v
        },
      },
      connect: () => undefined,
      start: (t: number) => {
        record.start = t
      },
      stop: (t: number) => {
        record.stop = t
      },
    }
  }
}

afterEach(() => {
  closeAudio()
  vi.unstubAllGlobals()
  FakeAudioContext.instances = []
})

describe('beep patterns', () => {
  it('ready is one short high tone, capture a high double tone, error one long low tone', () => {
    const { ready, capture, error } = BEEP_PATTERNS
    expect(ready).toHaveLength(1)
    expect(ready[0]!.frequencyHz).toBeGreaterThan(1000)
    expect(ready[0]!.durationMs).toBeLessThan(150)
    expect(capture).toHaveLength(2)
    expect(capture[1]!.startMs).toBeGreaterThan(capture[0]!.startMs + capture[0]!.durationMs - 1)
    expect(capture.every((t) => t.frequencyHz > 1000)).toBe(true)
    expect(error).toHaveLength(1)
    expect(error[0]!.frequencyHz).toBeLessThan(300)
    expect(error[0]!.durationMs).toBeGreaterThan(ready[0]!.durationMs)
  })
})

describe('unlockAudio and beep', () => {
  it('unlockAudio creates the context, resumes it and plays the silent unlock buffer', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext)
    unlockAudio()
    unlockAudio()
    expect(FakeAudioContext.instances).toHaveLength(1)
    expect(FakeAudioContext.instances[0]!.resume).toHaveBeenCalled()
    expect(FakeAudioContext.instances[0]!.bufferSources).toBe(2)
  })

  it('each cue schedules its tones at the right pitch and time', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext)
    unlockAudio()
    const ctx = FakeAudioContext.instances[0]!

    beep('ready')
    expect(ctx.oscillators).toHaveLength(1)
    expect(ctx.oscillators[0]!.frequency).toBe(BEEP_PATTERNS.ready[0]!.frequencyHz)
    expect(ctx.oscillators[0]!.start).toBeCloseTo(10, 6)

    ctx.oscillators.length = 0
    beep('capture')
    expect(ctx.oscillators).toHaveLength(2)
    expect(ctx.oscillators[1]!.start - ctx.oscillators[0]!.start).toBeCloseTo(0.11, 6)

    ctx.oscillators.length = 0
    beep('error')
    expect(ctx.oscillators[0]!.frequency).toBeLessThan(300)
    expect(ctx.oscillators[0]!.stop).toBeGreaterThan(ctx.oscillators[0]!.start + 0.3)
  })

  it('resumes a suspended context before playing', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext)
    unlockAudio()
    const ctx = FakeAudioContext.instances[0]!
    ctx.state = 'suspended'
    ctx.resume.mockClear()
    beep('ready')
    expect(ctx.resume).toHaveBeenCalled()
  })

  it('falls back to webkitAudioContext', () => {
    vi.stubGlobal('webkitAudioContext', FakeAudioContext)
    unlockAudio()
    expect(FakeAudioContext.instances).toHaveLength(1)
  })

  it('is a silent no-op when there is no AudioContext, or when it cannot be created', () => {
    expect(() => unlockAudio()).not.toThrow()
    expect(() => beep('capture')).not.toThrow()
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          throw new Error('not allowed')
        }
      },
    )
    expect(() => unlockAudio()).not.toThrow()
    expect(() => beep('error')).not.toThrow()
  })

  it('never throws when the browser fails while scheduling', () => {
    vi.stubGlobal(
      'AudioContext',
      class extends FakeAudioContext {
        override createOscillator = (): never => {
          throw new Error('boom')
        }
      },
    )
    unlockAudio()
    expect(() => beep('ready')).not.toThrow()
  })

  it('closeAudio closes the context and the next unlock makes a new one', () => {
    vi.stubGlobal('AudioContext', FakeAudioContext)
    unlockAudio()
    const first = FakeAudioContext.instances[0]!
    closeAudio()
    expect(first.close).toHaveBeenCalled()
    unlockAudio()
    expect(FakeAudioContext.instances).toHaveLength(2)
  })
})
