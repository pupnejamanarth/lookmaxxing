/**
 * Capture in a REAL browser (Chromium): the metadata-stripping photo import, the camera, and a burst through the real face
 * detector. No test page is shipped. The spec serves a tiny HTML page of its own (page.route) from the dev server's origin
 * (http://localhost:4174, started by playwright.config.ts for the vision harness), so that page can import the app's
 * TypeScript modules straight from Vite. Nothing here is in dist/.
 *
 * Fixtures: tests/fixtures/gps-tagged.jpg (synthetic, made by scripts/make-fixtures.mjs: Exif with Orientation 6 and
 * placeholder GPS, XMP, IPTC and a comment) and the single official MediaPipe sample portrait tests/fixtures/portrait.jpg.
 */
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { hasMetadataMarkers, scanJpegMetadata } from '../../src/capture/metadata'

type Capture = typeof import('../../src/capture')

const TAGGED = readFileSync(new URL('../fixtures/gps-tagged.jpg', import.meta.url))
const PORTRAIT = readFileSync(new URL('../fixtures/portrait.jpg', import.meta.url))

const ORIGIN = 'http://localhost:4174'
const LAB = `${ORIGIN}/lookmaxxing/__capture-lab.html`

const LAB_HTML = `<!doctype html><html lang="en"><meta charset="utf-8"><title>capture lab</title><body><script type="module">
  import * as capture from '/lookmaxxing/src/capture/index.ts'
  import { createFaceDetector } from '/lookmaxxing/src/vision/index.ts'
  window.lab = { capture, createFaceDetector }
  document.documentElement.dataset.ready = 'true'
</script></body></html>`

interface Lab {
  capture: Capture
  createFaceDetector: typeof import('../../src/vision').createFaceDetector
}

/** Opens the lab page; returns the list of every URL the page requested. */
async function openLab(page: Page): Promise<{ requests: string[]; errors: string[] }> {
  const requests: string[] = []
  const errors: string[] = []
  page.on('request', (r) => requests.push(r.url()))
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/__capture-lab.html', (route) => route.fulfill({ body: LAB_HTML, contentType: 'text/html' }))
  await page.route('**/__fixtures/gps-tagged.jpg', (route) => route.fulfill({ body: TAGGED, contentType: 'image/jpeg' }))
  await page.route('**/__fixtures/portrait.jpg', (route) => route.fulfill({ body: PORTRAIT, contentType: 'image/jpeg' }))
  await page.goto(LAB)
  await page.waitForSelector('html[data-ready=true]', { timeout: 60_000 })
  return { requests, errors }
}

const outsideOrigin = (requests: string[]) =>
  requests.filter((u) => {
    const url = new URL(u)
    return !(url.protocol === 'blob:' || url.protocol === 'data:' || url.origin === ORIGIN)
  })

// ───────────────────────────── photo import ─────────────────────────────

test.describe('importPhoto', () => {
  test('strips Exif, GPS, XMP and IPTC, applies the Exif orientation, and the original is not stored', async ({ page }) => {
    // The fixture really carries what the import must strip (checked here with the same scanner the import uses).
    const before = scanJpegMetadata(new Uint8Array(TAGGED))
    expect(before).toMatchObject({ exif: true, gps: true, xmp: true, iptc: true, comment: true })

    const { requests, errors } = await openLab(page)
    const result = await page.evaluate(async () => {
      const { capture } = (window as unknown as { lab: Lab }).lab
      const source = await (await fetch('/lookmaxxing/__fixtures/gps-tagged.jpg')).blob()

      const imported = await capture.importPhoto(source)
      const ctx = imported.canvas.getContext('2d')!
      const px = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data)
      const decoded = await createImageBitmap(imported.blob)
      const bytes = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1] as string)
        reader.readAsDataURL(imported.blob)
      })
      return {
        width: imported.width,
        height: imported.height,
        canvasSize: [imported.canvas.width, imported.canvas.height],
        decodedSize: [decoded.width, decoded.height],
        type: imported.blob.type,
        sourceBytes: source.size,
        bytes,
        topRight: px(imported.width - 6, 6),
        bottomLeft: px(5, imported.height - 6),
        topLeft: px(5, 6),
      }
    })

    expect(errors).toEqual([])
    // As stored the picture is 64×32 (SOF0: height, width); the Exif orientation is what turns it upright.
    const sof = TAGGED.indexOf(Buffer.from([0xff, 0xc0]))
    expect([TAGGED.readUInt16BE(sof + 7), TAGGED.readUInt16BE(sof + 5)]).toEqual([64, 32])
    expect(result.sourceBytes).toBe(TAGGED.length)

    // Orientation 6 = rotate 90° clockwise: 64×32 becomes 32×64, the red top-left block lands top-right, the green
    // bottom-right block lands bottom-left.
    expect([result.width, result.height]).toEqual([32, 64])
    expect(result.canvasSize).toEqual([32, 64])
    expect(result.decodedSize).toEqual([32, 64])
    const [r1, g1, b1] = result.topRight as [number, number, number]
    expect(r1).toBeGreaterThan(180)
    expect(g1).toBeLessThan(80)
    expect(b1).toBeLessThan(80)
    const [r2, g2, b2] = result.bottomLeft as [number, number, number]
    expect(g2).toBeGreaterThan(150)
    expect(r2).toBeLessThan(80)
    expect(b2).toBeLessThan(110)
    const [r3, g3, b3] = result.topLeft as [number, number, number]
    expect(Math.abs(r3 - g3)).toBeLessThan(20) // grey
    expect(Math.abs(g3 - b3)).toBeLessThan(20)

    // The bytes that would be stored: a JPEG with no metadata at all.
    const out = new Uint8Array(Buffer.from(result.bytes, 'base64'))
    expect(result.type).toBe('image/jpeg')
    expect(out.slice(0, 2)).toEqual(new Uint8Array([0xff, 0xd8]))
    expect(out.length).toBeGreaterThan(100)
    expect(hasMetadataMarkers(out)).toBe(false)
    const after = scanJpegMetadata(out)
    expect(after).toMatchObject({ isJpeg: true, exif: false, gps: false, xmp: false, iptc: false, comment: false, other: [] })
    const text = Buffer.from(out).toString('latin1')
    for (const leaked of ['Exif', 'GPS', 'xmpmeta', 'Photoshop', 'SYNTHETIC', 'Nowhere', 'synthetic fixture']) expect(text).not.toContain(leaked)

    // Importing makes no request to anything but the page's own origin.
    expect(outsideOrigin(requests)).toEqual([])
  })

  test('shrinks a picture over 16 megapixels, keeping its proportions; a smaller one keeps its size', async ({ page }) => {
    await openLab(page)
    const result = await page.evaluate(async () => {
      const { capture } = (window as unknown as { lab: Lab }).lab
      const make = async (w: number, h: number) => {
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')!
        const gradient = ctx.createLinearGradient(0, 0, w, h)
        gradient.addColorStop(0, '#203060')
        gradient.addColorStop(1, '#e0c080')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, w, h)
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.5))
        return blob!
      }
      const big = await capture.importPhoto(await make(5000, 4000)) // 20 MP
      const small = await capture.importPhoto(await make(1200, 800))
      return {
        big: [big.width, big.height, big.canvas.width, big.canvas.height],
        small: [small.width, small.height],
        bigType: big.blob.type,
      }
    })
    const [bw, bh, cw, ch] = result.big as [number, number, number, number]
    expect(bw * bh).toBeLessThanOrEqual(16_000_000)
    expect(bw * bh).toBeGreaterThan(15_500_000)
    expect(Math.abs(bw / bh - 1.25)).toBeLessThan(0.001)
    expect([cw, ch]).toEqual([bw, bh])
    expect(result.bigType).toBe('image/jpeg')
    expect(result.small).toEqual([1200, 800])
  })

  test('refuses what it cannot read with a plain message, HEIC included', async ({ page }) => {
    await openLab(page)
    const result = await page.evaluate(async () => {
      const { capture } = (window as unknown as { lab: Lab }).lab
      const attempt = async (blob: Blob) => {
        try {
          await capture.importPhoto(blob)
          return { code: 'imported', message: '' }
        } catch (error) {
          const e = error as { name: string; code?: string; message: string }
          return { name: e.name, code: e.code, message: e.message }
        }
      }
      return {
        garbage: await attempt(new Blob(['this is not a picture'], { type: 'image/jpeg' })),
        heic: await attempt(new Blob(['not really heic either'], { type: 'image/heic' })),
        empty: await attempt(new Blob([], { type: 'image/jpeg' })),
      }
    })
    expect(result.garbage).toMatchObject({ name: 'ImportError', code: 'unreadable' })
    expect(result.garbage.message).toMatch(/could not be read as a photo/)
    expect(result.heic).toMatchObject({ name: 'ImportError', code: 'heic_unsupported' })
    expect(result.heic.message).toMatch(/HEIC/)
    expect(result.empty).toMatchObject({ name: 'ImportError', code: 'empty' })
  })
})

// ───────────────────────────── import, then inspect ─────────────────────────────

test.describe('importPhoto + inspectStill', () => {
  test.describe.configure({ timeout: 120_000 })

  test('a real photo with Exif and XMP is stripped, then checked as a single frame with an honest record', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'one run is enough: the detector does not depend on the device')
    // The official sample portrait is a real JPEG with an Exif block and an XMP packet.
    expect(scanJpegMetadata(new Uint8Array(PORTRAIT))).toMatchObject({ exif: true, xmp: true })

    const { requests, errors } = await openLab(page)
    const result = await page.evaluate(async () => {
      const { capture, createFaceDetector } = (window as unknown as { lab: Lab }).lab
      const source = await (await fetch('/lookmaxxing/__fixtures/portrait.jpg')).blob()
      const imported = await capture.importPhoto(source)
      const detector = createFaceDetector({ delegate: 'CPU', runningMode: 'IMAGE' })
      const smile = await capture.inspectStill({ canvas: imported.canvas, detector, shot: 'frontal_smile' })
      const neutral = await capture.inspectStill({ canvas: imported.canvas, detector, shot: 'frontal_neutral' })
      const bytes = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1] as string)
        reader.readAsDataURL(imported.blob)
      })
      detector.close()
      const brief = (r: typeof smile) => ({
        found: r.frame !== null,
        framesTried: r.shotQc.framesTried,
        framesKept: r.shotQc.framesKept,
        ids: r.shotQc.checks.map((c) => c.id),
        failed: r.shotQc.checks.filter((c) => !c.ok).map((c) => ({ id: c.id, hint: c.hint })),
        spread: r.shotQc.burstSpread,
        iris: r.shotQc.irisPx,
        passed: capture.shotQcPassed(r.shotQc),
      })
      return { size: [imported.width, imported.height], bytes, smile: brief(smile), neutral: brief(neutral) }
    })

    expect(errors).toEqual([])
    expect(result.size).toEqual([820, 1024])
    const out = new Uint8Array(Buffer.from(result.bytes, 'base64'))
    expect(hasMetadataMarkers(out)).toBe(false)

    expect(result.smile.found).toBe(true)
    expect(result.smile.framesTried).toBe(1)
    expect(result.smile.ids).not.toContain('steady')
    expect(result.smile.spread).toBeNull()
    expect(result.smile.iris).toBeGreaterThan(8)
    // The portrait is a close-up crop, nowhere near 1.5 m from a lens: the record says so instead of passing it.
    const failed = result.smile.failed.map((c) => c.id)
    expect(failed).toContain('distance')
    expect(result.smile.failed.find((c) => c.id === 'distance')?.hint).toMatch(/Move back/)
    expect(result.smile.passed).toBe(false)
    expect(result.smile.framesKept).toBe(0)
    // Pose, sharpness, exposure and light are fine; the expression is right for a smile shot.
    for (const id of ['yaw', 'roll', 'pitch', 'sharpness', 'exposure', 'lighting', 'expression']) expect(failed).not.toContain(id)

    // As a neutral shot the same photo also fails on the smile.
    expect(result.neutral.failed.map((c) => c.id)).toContain('expression')
    expect(result.neutral.passed).toBe(false)

    expect(outsideOrigin(requests)).toEqual([])
  })
})

// ───────────────────────────── camera ─────────────────────────────

test.describe('openCamera', () => {
  test('opens the (fake) camera video-only, shows it inline and stops every track', async ({ page }) => {
    await openLab(page)
    const result = await page.evaluate(async () => {
      const { capture } = (window as unknown as { lab: Lab }).lab
      const handle = await capture.openCamera({ facing: 'user' })
      const video = document.createElement('video')
      document.body.append(video)
      await capture.attachToVideo(video, handle)
      const info = {
        audioTracks: handle.stream.getAudioTracks().length,
        videoTracks: handle.stream.getVideoTracks().length,
        label: handle.label,
        settingsWidth: handle.settings.width ?? 0,
        muted: video.muted,
        playsInline: video.playsInline,
        videoWidth: video.videoWidth,
        playing: !video.paused,
        live: handle.track.readyState,
      }
      handle.stop()
      const after = handle.track.readyState
      handle.stop()
      return { ...info, after }
    })
    expect(result.audioTracks).toBe(0)
    expect(result.videoTracks).toBe(1)
    expect(result.live).toBe('live')
    expect(result.settingsWidth).toBeGreaterThan(0)
    expect(result.muted).toBe(true)
    expect(result.playsInline).toBe(true)
    expect(result.playing).toBe(true)
    expect(result.videoWidth).toBeGreaterThan(0)
    expect(result.after).toBe('ended')
  })
})

// ───────────────────────────── burst through the real detector ─────────────────────────────

test.describe('captureBurst', () => {
  test.describe.configure({ timeout: 180_000 })
  const DESKTOP_ONLY = 'the burst pipeline is the same on every device; one run is enough'

  /** In the page: a <video> that plays a canvas, painted by `paint`, redrawn every frame so the stream keeps producing frames. */
  const setup = `
    window.rig = async (paintSource) => {
      const { capture, createFaceDetector } = window.lab
      const canvas = document.createElement('canvas')
      canvas.width = 1080
      canvas.height = 1920
      const ctx = canvas.getContext('2d')
      const bitmap = await createImageBitmap(await (await fetch('/lookmaxxing/__fixtures/portrait.jpg')).blob(), { imageOrientation: 'from-image' })
      let tick = 0
      const paint = () => {
        ctx.filter = 'none'
        ctx.fillStyle = '#808080'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        if (paintSource) {
          // The portrait at 0.7 scale: about 1.5 m from the lens by the iris-size estimate.
          const w = Math.round(bitmap.width * 0.7)
          const h = Math.round(bitmap.height * 0.7)
          const half = document.createElement('canvas')
          half.width = w
          half.height = h
          const hctx = half.getContext('2d')
          hctx.imageSmoothingQuality = 'high'
          hctx.drawImage(bitmap, 0, 0, w, h)
          ctx.drawImage(half, Math.round(canvas.width / 2 - w / 2), Math.round(canvas.height / 2 - h * 0.45))
        }
        ctx.fillStyle = tick++ % 2 ? '#808081' : '#808080'
        ctx.fillRect(0, 0, 2, 2)
      }
      paint()
      const timer = setInterval(paint, 33)
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.srcObject = canvas.captureStream(30)
      document.body.append(video)
      await video.play()
      while (video.readyState < 2 || video.videoWidth === 0) await new Promise((r) => setTimeout(r, 20))
      const detector = createFaceDetector({ delegate: 'CPU', runningMode: 'IMAGE' })
      return { capture, canvas, video, detector, stop: () => { clearInterval(timer); video.srcObject.getTracks().forEach((t) => t.stop()) } }
    }
    window.toBase64 = (blob) => new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(',')[1])
      reader.readAsDataURL(blob)
    })
  `

  test('a person-sized face at about 1.5 m: kept frames, a clean un-mirrored JPEG, an honest record', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', DESKTOP_ONLY)
    const { requests, errors } = await openLab(page)
    await page.evaluate(setup)
    const result = await page.evaluate(async () => {
      const w = window as unknown as {
        rig: (paint: boolean) => Promise<{ capture: Capture; canvas: HTMLCanvasElement; video: HTMLVideoElement; detector: ReturnType<Lab['createFaceDetector']>; stop(): void }>
        toBase64: (b: Blob) => Promise<string>
      }
      const { capture, canvas, video, detector, stop } = await w.rig(true)
      const progress: number[] = []
      // The smile shot: the portrait smiles, and a neutral shot must (and does, below) refuse it.
      const smile = await capture.captureBurst({ video, detector, shot: 'frontal_smile', frames: 5, intervalMs: 80, onProgress: (n) => progress.push(n) })
      const neutral = await capture.captureBurst({ video, detector, shot: 'frontal_neutral', frames: 3, intervalMs: 50 })

      // Un-mirrored: the JPEG matches the video frame, not its mirror image.
      const decoded = await createImageBitmap(smile.jpeg)
      const compare = (mirror: boolean): number => {
        const n = 96
        const m = Math.round((n * canvas.height) / canvas.width)
        const read = (source: CanvasImageSource, flip: boolean) => {
          const c = document.createElement('canvas')
          c.width = n
          c.height = m
          const ctx = c.getContext('2d')!
          if (flip) {
            ctx.translate(n, 0)
            ctx.scale(-1, 1)
          }
          ctx.drawImage(source, 0, 0, n, m)
          return ctx.getImageData(0, 0, n, m).data
        }
        const a = read(decoded, mirror)
        const b = read(canvas, false)
        let sum = 0
        for (let i = 0; i < a.length; i += 4) sum += Math.abs((a[i] as number) - (b[i] as number))
        return sum / (a.length / 4)
      }
      const result = {
        progress,
        smileBytes: await w.toBase64(smile.jpeg),
        smile: {
          framesTried: smile.shotQc.framesTried,
          framesKept: smile.shotQc.framesKept,
          frames: smile.frames.length,
          keptIndexes: smile.keptIndexes,
          bestIndex: smile.bestIndex,
          width: smile.width,
          height: smile.height,
          type: smile.jpeg.type,
          checks: smile.shotQc.checks.map((c) => ({ id: c.id, ok: c.ok, value: c.value, hint: c.hint })),
          irisPx: smile.shotQc.irisPx,
          distance: smile.shotQc.estimatedDistanceM,
          spread: smile.shotQc.burstSpread,
          passed: capture.shotQcPassed(smile.shotQc),
        },
        neutral: {
          framesKept: neutral.shotQc.framesKept,
          expression: neutral.shotQc.checks.find((c) => c.id === 'expression'),
          passed: capture.shotQcPassed(neutral.shotQc),
        },
        diffAsIs: compare(false),
        diffMirrored: compare(true),
      }
      stop()
      detector.close()
      return result
    })

    expect(errors).toEqual([])
    expect(result.progress).toEqual([1, 2, 3, 4, 5])

    // The portrait is a clean, well-lit, front-on shot: every frame passes the smile shot's checks.
    expect(result.smile.framesTried).toBe(5)
    expect(result.smile.frames).toBe(5)
    expect(result.smile.framesKept).toBe(5)
    expect(result.smile.keptIndexes).toEqual([0, 1, 2, 3, 4])
    expect(result.smile.bestIndex).toBeGreaterThanOrEqual(0)
    expect([result.smile.width, result.smile.height]).toEqual([1080, 1920])
    expect(result.smile.type).toBe('image/jpeg')
    const failed = result.smile.checks.filter((c) => !c.ok)
    expect(failed, JSON.stringify(failed)).toEqual([])
    expect(result.smile.passed).toBe(true)
    expect(result.smile.irisPx).toBeGreaterThan(8)
    expect(result.smile.distance).toBeGreaterThan(1.2)
    expect(result.smile.distance).toBeLessThan(2.2)
    expect(result.smile.spread).toBeLessThan(0.05)
    for (const c of result.smile.checks) expect(c.hint.length).toBeGreaterThan(3)

    // The same smiling face is refused as a NEUTRAL shot, with the instruction to fix it.
    expect(result.neutral.passed).toBe(false)
    expect(result.neutral.framesKept).toBe(0)
    expect(result.neutral.expression?.ok).toBe(false)
    expect(result.neutral.expression?.hint).toMatch(/smile|brows|eyes/i)

    // The stored picture: a JPEG without metadata, and not mirrored.
    const jpeg = new Uint8Array(Buffer.from(result.smileBytes, 'base64'))
    expect(hasMetadataMarkers(jpeg)).toBe(false)
    expect(result.diffAsIs).toBeLessThan(6)
    expect(result.diffMirrored).toBeGreaterThan(result.diffAsIs * 3)

    expect(outsideOrigin(requests)).toEqual([])
  })

  test('no face in the picture: nothing is kept, the record says so, the JPEG is still clean', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', DESKTOP_ONLY)
    await openLab(page)
    await page.evaluate(setup)
    const result = await page.evaluate(async () => {
      const w = window as unknown as {
        rig: (paint: boolean) => Promise<{ capture: Capture; video: HTMLVideoElement; detector: ReturnType<Lab['createFaceDetector']>; stop(): void }>
        toBase64: (b: Blob) => Promise<string>
      }
      const { capture, video, detector, stop } = await w.rig(false)
      const burst = await capture.captureBurst({ video, detector, shot: 'frontal_neutral', frames: 3, intervalMs: 50 })
      const out = {
        frames: burst.frames.length,
        bestIndex: burst.bestIndex,
        kept: burst.shotQc.framesKept,
        tried: burst.shotQc.framesTried,
        face: burst.shotQc.checks.find((c) => c.id === 'face'),
        bytes: await w.toBase64(burst.jpeg),
        iris: burst.shotQc.irisPx,
      }
      stop()
      detector.close()
      return out
    })
    expect(result).toMatchObject({ frames: 0, bestIndex: -1, kept: 0, tried: 3, iris: null })
    expect(result.face?.ok).toBe(false)
    expect(result.face?.hint).toMatch(/No face found/)
    expect(hasMetadataMarkers(new Uint8Array(Buffer.from(result.bytes, 'base64')))).toBe(false)
  })

  test('can be aborted between frames', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', DESKTOP_ONLY)
    await openLab(page)
    await page.evaluate(setup)
    const outcome = await page.evaluate(async () => {
      const w = window as unknown as {
        rig: (paint: boolean) => Promise<{ capture: Capture; video: HTMLVideoElement; detector: ReturnType<Lab['createFaceDetector']>; stop(): void }>
      }
      const { capture, video, detector, stop } = await w.rig(false)
      const controller = new AbortController()
      let reached = 0
      const run = capture.captureBurst({
        video,
        detector,
        shot: 'frontal_neutral',
        frames: 5,
        intervalMs: 50,
        signal: controller.signal,
        onProgress: (n) => {
          reached = n
          if (n === 1) controller.abort()
        },
      })
      const name = await run.then(
        () => 'finished',
        (error: { name: string }) => error.name,
      )
      stop()
      detector.close()
      return { name, reached }
    })
    expect(outcome).toEqual({ name: 'AbortError', reached: 1 })
  })
})
