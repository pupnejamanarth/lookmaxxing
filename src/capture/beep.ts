/**
 * Short audio cues for the capture screen ("ready", "capture", "error") so a person standing 1.5 m from the phone
 * knows what it is doing without reading it. WebAudio oscillators only: no files, no microphone.
 *
 * Browsers (iOS above all) keep audio silent until it is started from a tap, so call unlockAudio() from the tap that
 * starts the scan. Without a context, or when the browser refuses one, beep() does nothing.
 */

export type BeepKind = 'ready' | 'capture' | 'error'

export interface Tone {
  frequencyHz: number
  /** Start, relative to the call, in ms. */
  startMs: number
  durationMs: number
}

/** ready = one short high tone, capture = a high double tone, error = one long low tone. */
export const BEEP_PATTERNS: Record<BeepKind, readonly Tone[]> = {
  ready: [{ frequencyHz: 1320, startMs: 0, durationMs: 90 }],
  capture: [
    { frequencyHz: 1760, startMs: 0, durationMs: 60 },
    { frequencyHz: 1760, startMs: 110, durationMs: 60 },
  ],
  error: [{ frequencyHz: 180, startMs: 0, durationMs: 320 }],
}

/** Peak gain of every tone: audible across a room on a phone speaker without being harsh. */
const VOLUME = 0.25
/** Fade in and out, seconds: without them an oscillator starts and stops with an audible click. */
const FADE_S = 0.008

interface AudioConstructor {
  new (): AudioContext
}

let context: AudioContext | null = null

function createContext(): AudioContext | null {
  const g = globalThis as { AudioContext?: AudioConstructor; webkitAudioContext?: AudioConstructor }
  const Ctor = g.AudioContext ?? g.webkitAudioContext
  if (!Ctor) return null
  try {
    return new Ctor()
  } catch {
    return null
  }
}

function resume(ctx: AudioContext): void {
  if (ctx.state === 'suspended') ctx.resume().catch(() => undefined)
}

/** Creates and starts the audio context. Call from a tap or click handler. Safe to call again. */
export function unlockAudio(): void {
  context ??= createContext()
  if (!context) return
  resume(context)
  try {
    // A one-sample silent buffer is what unlocks audio on iOS Safari.
    const source = context.createBufferSource()
    source.buffer = context.createBuffer(1, 1, 22050)
    source.connect(context.destination)
    source.start(0)
  } catch {
    // Unlocking is best effort.
  }
}

/** Plays a cue. Silent no-op when there is no AudioContext. */
export function beep(kind: BeepKind): void {
  context ??= createContext()
  const ctx = context
  if (!ctx) return
  resume(ctx)
  try {
    const now = ctx.currentTime
    for (const tone of BEEP_PATTERNS[kind]) {
      const start = now + tone.startMs / 1000
      const end = start + tone.durationMs / 1000
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = tone.frequencyHz
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(VOLUME, start + FADE_S)
      gain.gain.setValueAtTime(VOLUME, Math.max(start + FADE_S, end - FADE_S))
      gain.gain.linearRampToValueAtTime(0, end)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(start)
      osc.stop(end + 0.02)
    }
  } catch {
    // A cue that cannot play is not worth an error.
  }
}

/** Releases the audio context (leaving the capture screen). The next unlockAudio() makes a new one. */
export function closeAudio(): void {
  const ctx = context
  context = null
  if (ctx) ctx.close().catch(() => undefined)
}
