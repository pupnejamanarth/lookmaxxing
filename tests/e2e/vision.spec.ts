/**
 * The face detector in a REAL browser (Chromium, CPU delegate unless a test says otherwise), on the one official
 * sample portrait tests/fixtures/portrait.jpg.
 *
 * It runs the same checks twice, against two pages that load the same harness (harness/vision-harness.ts):
 *   - dev        http://localhost:4174  `vite` dev server, no CSP
 *   - production http://localhost:4175  a throwaway production build served with the app's real CSP <meta>
 *                                       (harness/vite.prod.config.ts), which proves the detector needs nothing the
 *                                       policy forbids: no blob: in connect-src, no other host, no inline script.
 * Both pages install the app's network guard, so a stray request to another origin would be refused AND counted.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { CSP } from '../../config/csp'
import type { Analysis, AnalyseOptions, VisionHarness } from '../../harness/vision-harness'
// The package entry on purpose: it has to load under Playwright's own TypeScript loader (no Vite), for other specs too.
import { NAMED_POINTS, estimateDistanceM, headPoseFromTransform, lineAngleDeg } from '../../src/vision'
import type { FaceLandmarks, NamedPoints } from '../../src/vision'

const PORTRAIT = readFileSync(new URL('../fixtures/portrait.jpg', import.meta.url))
const MODEL = readFileSync(new URL('../../public/models/face_landmarker.task', import.meta.url))
const MODEL_SHA = createHash('sha256').update(MODEL).digest('hex')
const FIXTURE_URL = '/lookmaxxing/__fixtures/portrait.jpg'
const PAGE = '/lookmaxxing/harness/vision-harness.html'

interface Suite {
  name: string
  origin: string
  production: boolean
}
const SUITES: Suite[] = [
  { name: 'dev harness', origin: 'http://localhost:4174', production: false },
  { name: 'production build under the app CSP', origin: 'http://localhost:4175', production: true },
]

interface Session {
  page: Page
  /** Every request the page made (URL strings), in order. */
  requests: string[]
  /** Uncaught exceptions in the page. */
  errors: string[]
}

async function open(page: Page, suite: Suite): Promise<Session> {
  const requests: string[] = []
  const errors: string[] = []
  page.on('request', (r) => requests.push(r.url()))
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/__fixtures/portrait.jpg', (route) => route.fulfill({ body: PORTRAIT, contentType: 'image/jpeg' }))
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] }
    w.__csp = []
    document.addEventListener('securitypolicyviolation', (e) => w.__csp.push(`${e.effectiveDirective} ${e.blockedURI}`))
  })
  await page.goto(`${suite.origin}${PAGE}`)
  await page.waitForSelector('html[data-ready=true]')
  return { page, requests, errors }
}

const vision = (page: Page) => ({
  analyse: (options: AnalyseOptions = {}): Promise<Analysis> =>
    page.evaluate(([url, o]) => (window as unknown as { vision: VisionHarness }).vision.analyse(url, o), [FIXTURE_URL, options] as const),
  /** Calls one harness function in the page by name. */
  call: <K extends keyof VisionHarness>(name: K, ...args: Parameters<VisionHarness[K]>): Promise<Awaited<ReturnType<VisionHarness[K]>>> =>
    page.evaluate(
      ([fn, list]) => ((window as unknown as { vision: Record<string, (...a: unknown[]) => unknown> }).vision[fn as string] as (...a: unknown[]) => unknown)(...(list as unknown[])),
      [name, args] as const,
    ) as Promise<Awaited<ReturnType<VisionHarness[K]>>>,
})

const outsideOrigin = (requests: string[], origin: string) =>
  requests.filter((u) => {
    const url = new URL(u)
    return !(url.protocol === 'blob:' || url.protocol === 'data:' || url.origin === origin)
  })

const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance

/** Point-by-point list for failure messages. */
const fmt = (n: NamedPoints) => NAMED_POINTS.map((k) => `${k}=(${n[k].x.toFixed(0)},${n[k].y.toFixed(0)})`).join(' ')

for (const suite of SUITES) {
  test.describe(suite.name, () => {
    test('finds the face in the portrait: 478 landmarks, 52 blendshapes, a rotation matrix, near-frontal pose', async ({ page }) => {
      const { errors } = await open(page, suite)
      const a = await vision(page).analyse({ delegate: 'CPU', withPoints: true })

      expect(a.found).toBe(true)
      expect(a.delegate).toBe('CPU')
      expect(a.pointCount).toBe(478)
      expect(a.points).toHaveLength(478)
      expect(a.width).toBe(820)
      expect(a.height).toBe(1024)
      expect(a.blendshapeCount).toBe(52)
      expect(a.blendshapes.jawOpen).toBeGreaterThanOrEqual(0)

      // Row-major 4×4, bottom row 0 0 0 1, rotation columns of equal length.
      expect(a.transform).toHaveLength(16)
      expect(a.transform!.slice(12)).toEqual([0, 0, 0, 1])

      const pose = a.pose!
      expect(Math.abs(pose.yaw)).toBeLessThan(8)
      expect(Math.abs(pose.roll)).toBeLessThan(8)
      expect(Math.abs(pose.pitch)).toBeLessThan(10)

      // Landmarks are in pixels of the analysed image (x, y inside it; z a depth on the same scale).
      for (const p of a.points!) {
        expect(p.x).toBeGreaterThan(-5)
        expect(p.x).toBeLessThan(a.width + 5)
        expect(p.y).toBeGreaterThan(-5)
        expect(p.y).toBeLessThan(a.height + 5)
        expect(Math.abs(p.z)).toBeLessThan(a.width)
      }

      // Iris: a plausible number of pixels, a plausible share of the pupil distance, and a finite distance estimate.
      expect(a.irisPx!).toBeGreaterThan(8)
      expect(a.irisPx!).toBeLessThan(40)
      const n = a.named!
      const ipd = Math.hypot(n.pupilL.x - n.pupilR.x, n.pupilL.y - n.pupilR.y)
      expect(ipd).toBeGreaterThan(60)
      expect(ipd).toBeLessThan(120)
      expect(a.irisPx! / ipd).toBeGreaterThan(0.12) // a 11.7 mm iris on a ~63 mm pupil distance is 0.19
      expect(a.irisPx! / ipd).toBeLessThan(0.3)
      const distance = estimateDistanceM(a.irisPx!, a.width)
      expect(Number.isFinite(distance)).toBe(true)
      expect(distance).toBeGreaterThan(0.2)
      expect(distance).toBeLessThan(20)

      expect(errors).toEqual([])
    })

    test('named points: all present, inside the image, anatomically ordered, left/right consistent', async ({ page }, testInfo) => {
      await open(page, suite)
      const a = await vision(page).analyse({ delegate: 'CPU' })
      const n = a.named!
      expect(Object.keys(n).sort()).toEqual([...NAMED_POINTS].sort())

      for (const k of NAMED_POINTS) {
        expect(Number.isFinite(n[k].x) && Number.isFinite(n[k].y), k).toBe(true)
        expect(n[k].x, `${k}.x inside the image`).toBeGreaterThanOrEqual(0)
        expect(n[k].x, `${k}.x inside the image`).toBeLessThanOrEqual(a.width)
        expect(n[k].y, `${k}.y inside the image`).toBeGreaterThanOrEqual(0)
        expect(n[k].y, `${k}.y inside the image`).toBeLessThanOrEqual(a.height)
      }

      // Top to bottom (y grows downward): hairline estimate, forehead top, brows, eyes, nose, lips, chin.
      const topToBottom = [
        'trichion', 'faceTop', 'browMidL', 'pupilL', 'noseTip', 'subnasale', 'upperLipTop', 'upperLipBottom', 'lowerLipTop', 'lowerLipBottom', 'chinTip',
      ] as const
      for (let i = 1; i < topToBottom.length; i++) {
        const [above, below] = [topToBottom[i - 1]!, topToBottom[i]!]
        expect(n[below].y, `${below} should be below ${above}\n${fmt(n)}`).toBeGreaterThanOrEqual(n[above].y)
      }
      expect(n.pupilR.y).toBeGreaterThan(n.browMidR.y)
      expect(n.nasion.y).toBeGreaterThan(n.browMidL.y)
      expect(n.nasion.y).toBeLessThan(n.noseTip.y)
      expect(n.eyeTopL.y).toBeLessThan(n.eyeBottomL.y)
      expect(n.eyeTopR.y).toBeLessThan(n.eyeBottomR.y)
      expect(n.menton).toEqual(n.chinTip)
      expect(n.faceTop.y).toBeLessThanOrEqual(n.faceBottom.y)

      // Subject's left is the viewer's right (larger x) on a non-mirrored image, for every pair.
      const pairs = ['pupil', 'irisCenter', 'eyeInner', 'eyeOuter', 'eyeTop', 'eyeBottom', 'browInner', 'browMid', 'browOuter', 'zygion', 'gonion', 'alar', 'cheilion', 'face'] as const
      for (const p of pairs) {
        const [l, r] = p === 'face' ? [n.faceLeft, n.faceRight] : [n[`${p}L` as keyof NamedPoints], n[`${p}R` as keyof NamedPoints]]
        expect(l.x, `${p}: L must be right of R`).toBeGreaterThan(r.x)
      }
      // From the midline outward on the subject's left: nasion < inner corner < outer corner; cheek wider than jaw.
      expect(n.eyeInnerL.x).toBeGreaterThan(n.nasion.x)
      expect(n.eyeOuterL.x).toBeGreaterThan(n.eyeInnerL.x)
      expect(n.nasion.x).toBeGreaterThan(n.eyeInnerR.x)
      expect(n.eyeInnerR.x).toBeGreaterThan(n.eyeOuterR.x)
      expect(n.zygionL.x - n.zygionR.x).toBeGreaterThan(n.gonionL.x - n.gonionR.x)
      expect(n.noseTip.x).toBeGreaterThan(n.zygionR.x)
      expect(n.noseTip.x).toBeLessThan(n.zygionL.x)
      expect(n.cheilionL.x).toBeGreaterThan(n.noseTip.x)
      expect(n.cheilionR.x).toBeLessThan(n.noseTip.x)

      // Proportions of a real adult face, wide bounds only (this is a mapping check, not a metric): pupil distance
      // is 0.35–0.6 of the cheek width; the alar width is below the eye-to-eye outer width; the mouth is wider than the nose.
      const width = (l: { x: number }, r: { x: number }) => l.x - r.x
      expect(width(n.pupilL, n.pupilR) / width(n.zygionL, n.zygionR)).toBeGreaterThan(0.35)
      expect(width(n.pupilL, n.pupilR) / width(n.zygionL, n.zygionR)).toBeLessThan(0.6)
      expect(width(n.alarL, n.alarR)).toBeLessThan(width(n.eyeOuterL, n.eyeOuterR))
      expect(width(n.cheilionL, n.cheilionR)).toBeGreaterThan(width(n.alarL, n.alarR) * 0.8)
      // Pupils sit on a nearly level line, and each lies between its own eye corners.
      expect(Math.abs(lineAngleDeg(n.pupilR, n.pupilL))).toBeLessThan(5)
      expect(n.pupilL.x).toBeGreaterThan(n.eyeInnerL.x)
      expect(n.pupilL.x).toBeLessThan(n.eyeOuterL.x)
      expect(n.pupilR.x).toBeLessThan(n.eyeInnerR.x)
      expect(n.pupilR.x).toBeGreaterThan(n.eyeOuterR.x)

      if (!suite.production && testInfo.project.name === 'desktop') {
        // For a human: every named point drawn with its label over the portrait (the mapping was checked this way).
        await page.evaluate(([url]) => (window as unknown as { vision: VisionHarness }).vision.drawNamed(url as string, { zoom: 2 }), [FIXTURE_URL] as const)
        await testInfo.attach('named-points.png', { body: await page.locator('#view').screenshot(), contentType: 'image/png' })
      }
    })

    test('head pose signs and size: a clockwise-tilted picture reads positive roll, a mirrored one flips yaw and roll', async ({ page }) => {
      await open(page, suite)
      const v = vision(page)
      const base = await v.analyse({ delegate: 'CPU', withPoints: true })
      const cw = await v.analyse({ delegate: 'CPU', rotateDeg: 10, withPoints: true })
      const ccw = await v.analyse({ delegate: 'CPU', rotateDeg: -10, withPoints: true })
      const mirrored = await v.analyse({ delegate: 'CPU', mirror: true, withPoints: true })
      for (const a of [base, cw, ccw, mirrored]) expect(a.found).toBe(true)

      // Ground truth for roll: the picture itself was rotated by a known angle.
      expect(near(cw.pose!.roll - base.pose!.roll, 10, 2.5), `roll ${base.pose!.roll} -> ${cw.pose!.roll}`).toBe(true)
      expect(near(ccw.pose!.roll - base.pose!.roll, -10, 2.5), `roll ${base.pose!.roll} -> ${ccw.pose!.roll}`).toBe(true)
      // ...and the pupil line, read through lineAngleDeg, turns by the same amount in the same direction.
      const pupilLine = (a: Analysis) => lineAngleDeg(a.named!.pupilR, a.named!.pupilL)
      expect(near(pupilLine(cw) - pupilLine(base), 10, 2.5)).toBe(true)
      expect(near(pupilLine(ccw) - pupilLine(base), -10, 2.5)).toBe(true)
      // Turning the picture in its plane must not invent yaw or pitch.
      for (const a of [cw, ccw]) {
        expect(near(a.pose!.yaw, base.pose!.yaw, 3.5)).toBe(true)
        expect(near(a.pose!.pitch, base.pose!.pitch, 3.5)).toBe(true)
      }

      // A mirror image is the same head with yaw and roll reversed.
      expect(near(mirrored.pose!.yaw, -base.pose!.yaw, 3.5), `yaw ${base.pose!.yaw} vs mirrored ${mirrored.pose!.yaw}`).toBe(true)
      expect(near(mirrored.pose!.roll, -base.pose!.roll, 2.5)).toBe(true)
      expect(near(mirrored.pose!.pitch, base.pose!.pitch, 3.5)).toBe(true)

      // The landmark-only fallback agrees with the matrix on every variant (it is an approximation: wider bounds).
      for (const a of [base, cw, ccw, mirrored]) {
        const lm: FaceLandmarks = { points: a.points!, width: a.width, height: a.height, blendshapes: a.blendshapes, transform: null }
        const fb = headPoseFromTransform(null, lm)
        expect(near(fb.yaw, a.pose!.yaw, 4), `fallback yaw ${fb.yaw} vs matrix ${a.pose!.yaw}`).toBe(true)
        expect(near(fb.roll, a.pose!.roll, 2.5), `fallback roll ${fb.roll} vs matrix ${a.pose!.roll}`).toBe(true)
        expect(near(fb.pitch, a.pose!.pitch, 5), `fallback pitch ${fb.pitch} vs matrix ${a.pose!.pitch}`).toBe(true)
      }
    })

    test('a small face (what a 1× lens sees at 1.5 m) is found by looking at the middle of the frame, mapped back to the full frame', async ({ page }) => {
      await open(page, suite)
      const v = vision(page)
      const base = await v.analyse({ delegate: 'CPU' })
      // Shrinking the picture inside the same frame puts the face at 14% (scale 0.6) … 5% (0.2) of the frame width. On the
      // whole frame MediaPipe's detector misses it below about 14%; the centred crops are what find it.
      for (const scale of [0.6, 0.5, 0.33, 0.2]) {
        const a = await v.analyse({ delegate: 'CPU', scale })
        expect(a.found, `scale ${scale}`).toBe(true)
        expect(a.width).toBe(base.width) // coordinates are in the full frame, not in the crop
        const [cx, cy] = [a.width / 2, a.height / 2]
        const bounds = ['trichion', 'faceTop', 'faceBottom', 'faceLeft', 'faceRight'] // vertex extremes jump between neighbours
        for (const k of NAMED_POINTS.filter((name) => !bounds.includes(name))) {
          const expected = { x: cx + scale * (base.named![k].x - cx), y: cy + scale * (base.named![k].y - cy) }
          const error = Math.hypot(a.named![k].x - expected.x, a.named![k].y - expected.y)
          expect(error, `${k} at scale ${scale}`).toBeLessThan(scale >= 0.33 ? 4 : 6)
        }
        expect(a.irisPx!).toBeGreaterThan(base.irisPx! * scale * 0.8)
        expect(a.irisPx!).toBeLessThan(base.irisPx! * scale * 1.2)
        expect(near(a.pose!.yaw, base.pose!.yaw, 3)).toBe(true)
        expect(near(a.pose!.pitch, base.pose!.pitch, 4)).toBe(true)
        expect(near(a.pose!.roll, base.pose!.roll, 2)).toBe(true)
      }
      // Smaller than that there is nothing to find: null, not a guess.
      expect((await v.analyse({ delegate: 'CPU', scale: 0.08 })).found).toBe(false)
    })

    test('a <video> element fed from a stream works like a camera: whole-frame and small faces, frame after frame', async ({ page }) => {
      await open(page, suite)
      const v = vision(page)
      const still = await v.analyse({ delegate: 'CPU' })
      const call = (scale?: number) =>
        page.evaluate(([url, o]) => (window as unknown as { vision: VisionHarness }).vision.analyseVideo(url, o), [FIXTURE_URL, { scale, frames: 4 }] as const)

      const big = await call()
      expect(big.videoWidth).toBe(still.width)
      expect(big.videoHeight).toBe(still.height)
      expect(big.frames).toHaveLength(4)
      for (const f of big.frames) {
        expect(f.found).toBe(true)
        expect(Math.abs(f.named!.noseTip.x - still.named!.noseTip.x)).toBeLessThan(3)
        expect(near(f.pose!.roll, still.pose!.roll, 2.5)).toBe(true)
      }

      const small = await call(0.4) // 9% of the frame width: only the centred crop sees it
      for (const f of small.frames) {
        expect(f.found).toBe(true)
        const cx = small.videoWidth / 2
        const cy = small.videoHeight / 2
        expect(Math.abs(f.named!.noseTip.x - (cx + 0.4 * (still.named!.noseTip.x - cx)))).toBeLessThan(4)
        expect(Math.abs(f.named!.noseTip.y - (cy + 0.4 * (still.named!.noseTip.y - cy)))).toBeLessThan(4)
      }
    })

    test('returns no frame for an image without a face', async ({ page }) => {
      await open(page, suite)
      const blank = await vision(page).call('analyseBlank', 640, 480)
      expect(blank.found).toBe(false)
      expect(blank.pointCount).toBe(0)
      expect(blank.pose).toBeNull()
    })

    test('VIDEO mode runs on the same image with increasing timestamps', async ({ page }) => {
      await open(page, suite)
      const v = vision(page)
      const first = await v.analyse({ delegate: 'CPU', runningMode: 'VIDEO' })
      const second = await v.analyse({ delegate: 'CPU', runningMode: 'VIDEO' })
      expect(first.found).toBe(true)
      expect(second.found).toBe(true)
      expect(second.pose!.yaw).toBeCloseTo(first.pose!.yaw, 0)
      expect(second.named!.noseTip.x).toBeCloseTo(first.named!.noseTip.x, 0)

      // The same detector then sees the face at 9% of the frame width (found by the centred crop, which it keeps using
      // from frame to frame so MediaPipe's tracking sees one geometry) and again at full size.
      const small = [
        await v.analyse({ delegate: 'CPU', runningMode: 'VIDEO', scale: 0.4 }),
        await v.analyse({ delegate: 'CPU', runningMode: 'VIDEO', scale: 0.4 }),
        await v.analyse({ delegate: 'CPU', runningMode: 'VIDEO', scale: 0.4 }),
      ]
      for (const a of small) {
        expect(a.found).toBe(true)
        expect(Math.abs(a.named!.noseTip.x - small[0]!.named!.noseTip.x)).toBeLessThan(1.5)
        expect(Math.abs(a.named!.noseTip.y - small[0]!.named!.noseTip.y)).toBeLessThan(1.5)
      }
      const again = await v.analyse({ delegate: 'CPU', runningMode: 'VIDEO' })
      expect(again.found).toBe(true)
      expect(Math.abs(again.named!.noseTip.x - first.named!.noseTip.x)).toBeLessThan(2)
    })

    test('model integrity: the served model is exactly the committed one, and ready() passes', async ({ page }) => {
      await open(page, suite)
      const integrity = await vision(page).call('modelIntegrity')
      expect(integrity.expected).toBe(MODEL_SHA)
      expect(integrity.actual).toBe(MODEL_SHA)
      expect(integrity.bytes).toBe(MODEL.length)
      const started = await vision(page).call('tryStart', 'CPU')
      expect(started).toEqual({ ok: true, delegate: 'CPU' })
    })

    test('a tampered model is refused, and the MediaPipe runtime is never started for it', async ({ page }) => {
      const { requests } = await open(page, suite)
      await page.route('**/models/face_landmarker.task', async (route) => {
        const bytes = new Uint8Array(MODEL)
        bytes[Math.floor(bytes.length / 2)] ^= 0x01 // one flipped bit
        await route.fulfill({ body: Buffer.from(bytes), contentType: 'application/octet-stream' })
      })
      const before = requests.length
      const refused = await vision(page).call('tryStart', 'CPU')
      expect(refused.ok).toBe(false)
      expect(refused.name).toBe('ModelIntegrityError')
      expect(refused.message).toContain('not run')
      expect(requests.slice(before).filter((u) => u.includes('/mediapipe/'))).toEqual([])

      // Truncated and empty files are refused the same way.
      await page.unroute('**/models/face_landmarker.task')
      await page.route('**/models/face_landmarker.task', (route) => route.fulfill({ body: MODEL.subarray(0, 1000) }))
      expect((await vision(page).call('tryStart', 'CPU')).name).toBe('ModelIntegrityError')

      // The untouched file still starts.
      await page.unroute('**/models/face_landmarker.task')
      expect((await vision(page).call('tryStart', 'CPU')).ok).toBe(true)
    })

    test('nothing leaves the origin: no foreign request, nothing blocked, no CSP violation, and exactly the minimal runtime files', async ({ page }) => {
      const { requests, errors } = await open(page, suite)
      const v = vision(page)
      await v.analyse({ delegate: 'CPU' })
      await v.analyse({ delegate: 'CPU', runningMode: 'VIDEO' })
      const closed = await vision(page).call('closeAll') // closing is where MediaPipe flushes its metrics

      expect(outsideOrigin(requests, suite.origin)).toEqual([])
      expect(closed.blockedCount, `the guard refused: ${JSON.stringify(closed.recent)}`).toBe(0)
      expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([])
      expect(errors).toEqual([])

      // Which runtime files does a real load fetch? The patched library and the SIMD pair, and nothing else under /mediapipe/.
      const runtime = requests.filter((u) => u.includes('/mediapipe/')).map((u) => new URL(u).pathname.split('/').pop())
      expect([...new Set(runtime)].sort()).toEqual(['vision_bundle_nometrics.js', 'vision_wasm_internal.js', 'vision_wasm_internal.wasm'])
      const models = requests.filter((u) => u.endsWith('/models/face_landmarker.task'))
      expect(models).toHaveLength(2) // one per detector (IMAGE and VIDEO), each hashed before use
    })

    test('MediaPipe\'s own usage-metrics sender: the npm library tries to POST to Google on close; the copy this site ships cannot', async ({ page }) => {
      const { requests } = await open(page, suite)
      // The unmodified npm package, closed: it asks to POST. The guard refuses, so nothing is sent; what matters is that it asked.
      const raw = await vision(page).call('rawLibraryCloseProbe')
      expect(raw.length).toBeGreaterThan(0)
      expect(raw.every((r) => r.origin === 'https://odml.pa.googleapis.com' && r.kind === 'fetch')).toBe(true)

      // The file the detector actually loads has the sender cut out: no endpoint, the patched call, the marker.
      const shipped = await page.evaluate(async (url) => (await fetch(url)).text(), `${suite.origin}/lookmaxxing/mediapipe/vision_bundle_nometrics.js`)
      expect(shipped.includes('odml.pa.googleapis.com')).toBe(false)
      expect(shipped.includes('await fetch(t.url,')).toBe(false)
      expect(shipped.includes('usage metrics are not sent')).toBe(true)
      expect(shipped.trimEnd().endsWith('export const lmxMetricsRemoved=!0;')).toBe(true)
      expect(outsideOrigin(requests, suite.origin)).toEqual([])
    })

    test('a start that fails half-way leaves no timer that could send metrics later', async ({ page }) => {
      await page.addInitScript(() => {
        // Record MediaPipe's 60 s metrics timers so "a minute later" can be played by hand.
        const w = window as unknown as { __minuteTimers: (() => void)[] }
        w.__minuteTimers = []
        const original = window.setInterval.bind(window)
        window.setInterval = ((fn: () => void, ms?: number, ...rest: unknown[]) => {
          if (ms === 60000) w.__minuteTimers.push(fn)
          return original(fn, ms, ...(rest as []))
        }) as typeof window.setInterval
      })
      await open(page, suite)
      const outcome = await page.evaluate(async () => {
        // WebGL works for the detector's own pre-check and then stops working, so MediaPipe builds part of itself and fails.
        const getContext = HTMLCanvasElement.prototype.getContext
        ;(window as unknown as { OffscreenCanvas?: unknown }).OffscreenCanvas = undefined // MediaPipe then draws through <canvas>
        let webgl2Calls = 0
        HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
          if (String(type).startsWith('webgl') && ++webgl2Calls > 1) return null
          return (getContext as (...a: unknown[]) => unknown).call(this, type, ...rest)
        } as typeof getContext
        const harness = (window as unknown as { vision: VisionHarness }).vision
        const started = await harness.tryStart('GPU')
        const timers = (window as unknown as { __minuteTimers: (() => void)[] }).__minuteTimers
        const created = timers.length
        timers.forEach((fire) => fire()) // a minute passes: every metrics timer fires
        return { started, created, blocked: harness.netStats().blockedCount }
      })
      expect(outcome.started.ok).toBe(false)
      expect(outcome.created, 'the failed start did leave MediaPipe timers behind').toBeGreaterThan(0)
      expect(outcome.blocked).toBe(0)
    })

    test('the network monitor itself is live: a request to another origin is refused and counted', async ({ page }) => {
      await open(page, suite)
      const outcome = await page.evaluate(async () => {
        const result = await fetch('https://example.com/probe').then(() => 'resolved', (e: unknown) => (e as Error).message)
        const stats = (window as unknown as { vision: VisionHarness }).vision.netStats()
        return { result, blocked: stats.blockedCount, origin: stats.recent.at(-1)?.origin }
      })
      expect(outcome.result).toContain('Blocked by privacy guard')
      expect(outcome.blocked).toBe(1)
      expect(outcome.origin).toBe('https://example.com')
    })

    test('GPU delegate first, CPU fallback: the detector starts and reports which one ran', async ({ page }) => {
      test.setTimeout(90_000)
      await open(page, suite)
      const started = await vision(page).call('tryStart', 'GPU')
      expect(started.ok, JSON.stringify(started)).toBe(true)
      expect(['GPU', 'CPU']).toContain(started.delegate)
    })

    // A phone takes a backgrounded page's WebGL context away (iOS Safari does). MediaPipe does not notice: its detect()
    // then returns "no face" for ever, with no error. The detector has to notice and rebuild itself.
    const lossCases: { name: string; options: { delegate: 'CPU' | 'GPU'; runningMode?: 'IMAGE' | 'VIDEO'; htmlCanvas?: boolean } }[] = [
      { name: 'CPU delegate, OffscreenCanvas', options: { delegate: 'CPU' } },
      { name: 'GPU delegate asked for', options: { delegate: 'GPU' } },
      { name: 'VIDEO mode', options: { delegate: 'CPU', runningMode: 'VIDEO' } },
      { name: 'no OffscreenCanvas (older Safari renders through a <canvas>)', options: { delegate: 'CPU', htmlCanvas: true } },
    ]
    for (const { name, options } of lossCases) {
      test(`a lost WebGL context is recovered, twice in a row: ${name}`, async ({ page }) => {
        test.setTimeout(90_000)
        const { errors } = await open(page, suite)
        const report = await page.evaluate(
          ([url, o]) => (window as unknown as { vision: VisionHarness }).vision.contextLossRecovery(url, o),
          [FIXTURE_URL, options] as const,
        )
        expect(report.foundBefore).toBe(true)
        expect(report.rounds).toHaveLength(2)
        for (const round of report.rounds) {
          expect(round.taken, 'the test took a live context away').toBeGreaterThan(0)
          // The loss is noticed quietly: a null for the frame in hand, not an exception and not a stale face.
          expect(round.immediate).toEqual({ found: false, threw: null })
          // ready() is where the app waits for a working detector, and after it the same face is found where it was.
          expect(round.found).toBe(true)
          expect(round.healthyNow, 'recovery built a new, live WebGL context').toBeGreaterThan(0)
          expect(round.delegate).toBe('CPU') // after a loss the detector stays off the GPU
          // Same face, same place: within what a different delegate (GPU before, CPU after) computes differently.
          expect(Math.abs(round.noseTip!.x - report.noseTipBefore!.x)).toBeLessThan(3)
          expect(Math.abs(round.noseTip!.y - report.noseTipBefore!.y)).toBeLessThan(3)
        }
        expect(errors).toEqual([])
      })
    }

    if (suite.production) {
      test('the page carries exactly the app\'s CSP, and the detector works under it', async ({ page }) => {
        await open(page, suite)
        expect(await page.locator('meta[http-equiv="Content-Security-Policy" i]').getAttribute('content')).toBe(CSP)
        expect(CSP).toContain("connect-src 'self'")
        expect(CSP).not.toMatch(/connect-src[^;]*blob:/) // MediaPipe does not need blob: to connect
        const a = await vision(page).analyse({ delegate: 'CPU' })
        expect(a.found).toBe(true)
        expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([])
      })
    }
  })
}

test('PWA precache holds the face model, the patched library and the SIMD runtime, and neither the no-SIMD nor the module build', async ({ request, baseURL }) => {
  // The main app's service worker, from the production build served on :4173.
  const response = await request.get(new URL('sw.js', baseURL!).href)
  expect(response.ok()).toBe(true)
  const sw = await response.text()
  const precached = [...sw.matchAll(/\burl:"([^"]+)"/g)].map((m) => m[1])

  expect(precached).toContain('models/face_landmarker.task')
  expect(precached).toContain('mediapipe/vision_bundle_nometrics.js')
  expect(precached).toContain('mediapipe/wasm/vision_wasm_internal.js')
  expect(precached).toContain('mediapipe/wasm/vision_wasm_internal.wasm')
  expect(precached.filter((u) => /nosimd|module/.test(u!))).toEqual([])
  expect(precached.every((u) => !/^(?:[a-z]+:)?\/\//i.test(u!))).toBe(true)

  // The no-SIMD build is cached the first time a browser without SIMD asks for it, from this origin only.
  expect(sw).toContain('vision_wasm_nosimd_internal')
  expect(sw).toContain('lmx-mediapipe-nosimd')
})

test('offline, the service worker still serves the face model, the patched library and the SIMD runtime, with the right MIME types', async ({ page, context, baseURL }) => {
  test.setTimeout(90_000)
  await page.goto('./')
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true)) // install = precache finished
  await page.reload()
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true)

  await context.setOffline(true)
  const probe = (path: string) =>
    page.evaluate(async (url) => {
      try {
        const r = await fetch(url)
        return { status: r.status, type: r.headers.get('content-type'), bytes: (await r.arrayBuffer()).byteLength }
      } catch {
        return null
      }
    }, new URL(path, baseURL!).href)

  const model = await probe('models/face_landmarker.task')
  expect(model).toMatchObject({ status: 200, bytes: MODEL.length })
  const wasm = await probe('mediapipe/wasm/vision_wasm_internal.wasm')
  expect(wasm).toMatchObject({ status: 200, type: 'application/wasm' }) // instantiateStreaming needs this
  expect(wasm!.bytes).toBeGreaterThan(10_000_000)
  expect((await probe('mediapipe/wasm/vision_wasm_internal.js'))?.status).toBe(200)
  const library = await probe('mediapipe/vision_bundle_nometrics.js')
  expect(library?.status).toBe(200)
  expect(library?.type).toMatch(/javascript/)

  // Not precached on purpose: a browser that has never needed the no-SIMD build cannot get it offline.
  expect(await probe('mediapipe/wasm/vision_wasm_nosimd_internal.wasm')).toBeNull()
})
