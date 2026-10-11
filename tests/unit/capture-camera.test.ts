import { afterEach, describe, expect, it, vi } from 'vitest'
import { CameraError, attachToVideo, buildConstraints, mapCameraError, openCamera, pickTelephoto } from '../../src/capture/camera'
import type { CameraHandle } from '../../src/capture/camera'

function fakeTrack(deviceId: string, label: string) {
  return {
    kind: 'video',
    label,
    readyState: 'live',
    stop: vi.fn(function (this: { readyState: string }) {
      this.readyState = 'ended'
    }),
    getSettings: () => ({ deviceId, width: 1920, height: 1080 }),
  }
}
type Track = ReturnType<typeof fakeTrack>
function fakeStream(track: Track) {
  return { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream
}
const domError = (name: string) => Object.assign(new Error(name), { name })

interface Devices {
  getUserMedia: ReturnType<typeof vi.fn>
  enumerateDevices: ReturnType<typeof vi.fn>
}
function stubNavigator(devices: Partial<Devices>, secure = true): void {
  vi.stubGlobal('navigator', { mediaDevices: devices })
  vi.stubGlobal('isSecureContext', secure)
}

afterEach(() => vi.unstubAllGlobals())

describe('buildConstraints', () => {
  it('asks for video only, never audio', () => {
    for (const facing of ['user', 'environment'] as const) {
      const c = buildConstraints({ facing })
      expect(c.audio).toBe(false)
      expect(JSON.stringify(c)).not.toMatch(/"audio":true/)
    }
  })

  it('prefers the facing mode and 1920×1080 as ideals (never as hard requirements)', () => {
    const c = buildConstraints({ facing: 'user' })
    expect(c.video).toEqual({ width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: { ideal: 'user' } })
    expect(buildConstraints({ facing: 'environment', idealWidth: 1280 }).video).toMatchObject({ width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: 'environment' } })
  })

  it('pins a device when given an id, and then asks for no facing mode', () => {
    const c = buildConstraints({ facing: 'environment' }, 'abc')
    expect(c.video).toMatchObject({ deviceId: { exact: 'abc' } })
    expect((c.video as MediaTrackConstraints).facingMode).toBeUndefined()
  })
})

describe('pickTelephoto', () => {
  const dev = (deviceId: string, label: string, kind: MediaDeviceKind = 'videoinput') => ({ deviceId, label, kind })

  it('finds the rear telephoto lens by its label', () => {
    expect(pickTelephoto([dev('a', 'Back Camera'), dev('b', 'Back Telephoto Camera'), dev('c', 'Front Camera')])).toBe('b')
    expect(pickTelephoto([dev('a', 'camera2 0, facing back'), dev('t', 'camera2 3, facing back, tele')])).toBe('t')
  })

  it('returns null when there is none, the label is empty (no permission yet) or the id is empty', () => {
    expect(pickTelephoto([dev('a', 'Back Camera'), dev('c', 'Front Camera')])).toBeNull()
    expect(pickTelephoto([dev('a', ''), dev('b', '')])).toBeNull()
    expect(pickTelephoto([dev('', 'Back Telephoto Camera')])).toBeNull()
    expect(pickTelephoto([dev('m', 'Telephoto Mic', 'audioinput')])).toBeNull()
    expect(pickTelephoto([])).toBeNull()
  })

  it('never picks a front camera', () => {
    expect(pickTelephoto([dev('f', 'Front Telephoto Camera')])).toBeNull()
  })
})

describe('mapCameraError', () => {
  const code = (name: string) => mapCameraError(domError(name)).code

  it('maps the DOMException names to codes with a plain message', () => {
    stubNavigator({})
    expect(code('NotAllowedError')).toBe('denied')
    expect(code('PermissionDeniedError')).toBe('denied')
    expect(code('NotFoundError')).toBe('no_camera')
    expect(code('OverconstrainedError')).toBe('no_camera')
    expect(code('NotReadableError')).toBe('in_use')
    expect(code('AbortError')).toBe('in_use')
    expect(code('SomethingElse')).toBe('unknown')
    expect(mapCameraError('weird').code).toBe('unknown')
    expect(mapCameraError(null).code).toBe('unknown')
    for (const name of ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'SomethingElse']) {
      const e = mapCameraError(domError(name))
      expect(e).toBeInstanceOf(CameraError)
      expect(e.message.length).toBeGreaterThan(30)
      expect(e.message).not.toMatch(/Error\b/)
    }
  })

  it('a refusal on an insecure page is "insecure", not "denied"', () => {
    stubNavigator({}, false)
    expect(code('NotAllowedError')).toBe('insecure')
    expect(code('SecurityError')).toBe('insecure')
  })

  it('keeps the original error as the cause and returns a CameraError unchanged', () => {
    const original = domError('NotReadableError')
    expect(mapCameraError(original).cause).toBe(original)
    const e = new CameraError('denied')
    expect(mapCameraError(e)).toBe(e)
  })
})

describe('openCamera', () => {
  it('requests video only and hands back a stream, its label, settings and a stop() that ends the tracks once', async () => {
    const track = fakeTrack('front', 'Front Camera')
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream(track))
    stubNavigator({ getUserMedia })
    const handle = await openCamera({ facing: 'user' })

    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(getUserMedia.mock.calls[0]?.[0]).toMatchObject({ audio: false, video: { facingMode: { ideal: 'user' } } })
    expect(handle.label).toBe('Front Camera')
    expect(handle.settings).toMatchObject({ width: 1920 })
    handle.stop()
    handle.stop()
    expect(track.stop).toHaveBeenCalledTimes(1)
  })

  it('maps a refused permission to a CameraError', async () => {
    stubNavigator({ getUserMedia: vi.fn().mockRejectedValue(domError('NotAllowedError')) })
    await expect(openCamera({ facing: 'user' })).rejects.toMatchObject({ name: 'CameraError', code: 'denied' })
  })

  it('without mediaDevices it says the page is insecure (or there is no camera)', async () => {
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('isSecureContext', false)
    await expect(openCamera({ facing: 'user' })).rejects.toMatchObject({ code: 'insecure' })
    vi.stubGlobal('isSecureContext', true)
    await expect(openCamera({ facing: 'user' })).rejects.toMatchObject({ code: 'no_camera' })
  })

  it('retries once with only the facing preference when the size preference is rejected', async () => {
    const track = fakeTrack('d', 'Camera')
    const getUserMedia = vi.fn().mockRejectedValueOnce(domError('OverconstrainedError')).mockResolvedValueOnce(fakeStream(track))
    stubNavigator({ getUserMedia })
    await openCamera({ facing: 'environment' })
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(getUserMedia.mock.calls[1]?.[0]).toEqual({ video: { facingMode: { ideal: 'environment' } }, audio: false })
  })

  it('switches to the telephoto lens when asked, after permission, stopping the first stream', async () => {
    const wide = fakeTrack('wide', 'Back Camera')
    const tele = fakeTrack('tele', 'Back Telephoto Camera')
    const getUserMedia = vi.fn().mockResolvedValueOnce(fakeStream(wide)).mockResolvedValueOnce(fakeStream(tele))
    const enumerateDevices = vi.fn().mockResolvedValue([
      { deviceId: 'wide', kind: 'videoinput', label: 'Back Camera' },
      { deviceId: 'tele', kind: 'videoinput', label: 'Back Telephoto Camera' },
    ])
    stubNavigator({ getUserMedia, enumerateDevices })
    const handle = await openCamera({ facing: 'environment', preferTelephoto: true })

    expect(wide.stop).toHaveBeenCalledTimes(1)
    expect(getUserMedia.mock.calls[1]?.[0]).toMatchObject({ audio: false, video: { deviceId: { exact: 'tele' } } })
    expect(handle.label).toBe('Back Telephoto Camera')
    handle.stop()
    expect(tele.stop).toHaveBeenCalledTimes(1)
  })

  it('keeps the current lens when it already is the telephoto or no telephoto is listed, and never switches the front camera', async () => {
    const wide = fakeTrack('wide', 'Back Camera')
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream(wide))
    const enumerateDevices = vi.fn().mockResolvedValue([{ deviceId: 'wide', kind: 'videoinput', label: 'Back Camera' }])
    stubNavigator({ getUserMedia, enumerateDevices })
    await openCamera({ facing: 'environment', preferTelephoto: true })
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(wide.stop).not.toHaveBeenCalled()

    getUserMedia.mockClear()
    enumerateDevices.mockResolvedValue([{ deviceId: 't', kind: 'videoinput', label: 'Back Telephoto Camera' }])
    await openCamera({ facing: 'user', preferTelephoto: true })
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(enumerateDevices).toHaveBeenCalledTimes(1) // only from the environment run above
  })

  it('falls back to the original lens when the telephoto will not open, and still returns a live stream', async () => {
    const wide = fakeTrack('wide', 'Back Camera')
    const again = fakeTrack('wide', 'Back Camera')
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(fakeStream(wide))
      .mockRejectedValueOnce(domError('NotReadableError'))
      .mockResolvedValueOnce(fakeStream(again))
    const enumerateDevices = vi.fn().mockResolvedValue([{ deviceId: 'tele', kind: 'videoinput', label: 'Back Telephoto Camera' }])
    stubNavigator({ getUserMedia, enumerateDevices })
    const handle = await openCamera({ facing: 'environment', preferTelephoto: true })
    expect(handle.track).toBe(again)
    expect(wide.stop).toHaveBeenCalled()
    handle.stop()
    expect(again.stop).toHaveBeenCalled()
  })

  it('ignores a failing device list and keeps the stream it has', async () => {
    const wide = fakeTrack('wide', 'Back Camera')
    stubNavigator({ getUserMedia: vi.fn().mockResolvedValue(fakeStream(wide)), enumerateDevices: vi.fn().mockRejectedValue(new Error('no')) })
    const handle = await openCamera({ facing: 'environment', preferTelephoto: true })
    expect(handle.track).toBe(wide)
    expect(wide.stop).not.toHaveBeenCalled()
  })
})

describe('attachToVideo', () => {
  const handle = { stream: {} as MediaStream } as CameraHandle

  function fakeVideo(play: () => Promise<void>) {
    const attributes: Record<string, string> = {}
    return {
      muted: false,
      defaultMuted: false,
      playsInline: false,
      srcObject: null as unknown,
      play: vi.fn(play),
      setAttribute: (k: string, v: string) => {
        attributes[k] = v
      },
      attributes,
    }
  }

  it('sets the iOS Safari prerequisites (muted, inline) before play()', async () => {
    const video = fakeVideo(async () => undefined)
    await attachToVideo(video as unknown as HTMLVideoElement, handle)
    expect(video.muted).toBe(true)
    expect(video.playsInline).toBe(true)
    expect(video.attributes).toMatchObject({ playsinline: '', muted: '' })
    expect(video.srcObject).toBe(handle.stream)
    expect(video.play).toHaveBeenCalledTimes(1)
  })

  it('turns a refused play() into a CameraError that says to tap again', async () => {
    const video = fakeVideo(async () => {
      throw domError('NotAllowedError')
    })
    await expect(attachToVideo(video as unknown as HTMLVideoElement, handle)).rejects.toMatchObject({ name: 'CameraError', code: 'unknown', message: expect.stringMatching(/Tap the button again/) })
  })
})
