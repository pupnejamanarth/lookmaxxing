import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CameraError, ImportError, analyzePixels, attachToVideo, beep, captureBurst, evaluateFrameQc, faceRegions, importPhoto, inspectStill, openCamera, unlockAudio,
  type CameraHandle,
} from '../capture'
import type { FrameQc } from '../domain/types'
import { navigate } from '../router'
import {
  QUICK_SHOT, QuickScanBlockedError, assertQuickScanAllowed, defaultDeps, inputFromBurst, inputFromStill, latestIrisPx, runQuickScan, saveDraft,
  type QuickScanDraft,
} from '../scan/quickScan'
import { scans } from '../store'
import { Banner, Button, Card, PageHeader, Spinner } from '../ui'
import { createFaceDetector } from '../vision'
import type { FaceDetector } from '../vision/types'
import { CAMERA_MESSAGE, CHECK_LABEL, IMPORT_MESSAGE, createStableTracker, firstFailing, nextAllowedText, scaleNamed } from './quickscan/helpers'
import './quickscan/quickscan.css'

type Phase = 'prep' | 'starting' | 'live' | 'working' | 'refused' | 'blocked' | 'error'

const HOLD_MS = 1000
const TICK_MS = 100
const LIVE_MAX_WIDTH = 640

export default function QuickScan() {
  const [phase, setPhase] = useState<Phase>('prep')
  const [message, setMessage] = useState('')
  const [nextAt, setNextAt] = useState<number | null>(null)
  const [qc, setQc] = useState<FrameQc | null>(null)
  const [hint, setHint] = useState('Starting')
  const [progress, setProgress] = useState(0)
  const [draft, setDraft] = useState<QuickScanDraft | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const detectorRef = useRef<FaceDetector | null>(null)
  const cameraRef = useRef<CameraHandle | null>(null)
  const loopRef = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const baselineRef = useRef<number | null>(null)
  const alive = useRef(true)

  const stopLoop = useCallback(() => {
    if (loopRef.current !== null) window.clearTimeout(loopRef.current)
    loopRef.current = null
  }, [])
  const releaseAll = useCallback(() => {
    stopLoop()
    abortRef.current?.abort()
    cameraRef.current?.stop()
    cameraRef.current = null
    detectorRef.current?.close()
    detectorRef.current = null
  }, [stopLoop])

  useEffect(() => {
    alive.current = true
    const deps = defaultDeps(scans)
    assertQuickScanAllowed(deps).catch((e: unknown) => {
      if (alive.current && e instanceof QuickScanBlockedError) {
        setNextAt(e.nextAllowedAt)
        setPhase('blocked')
      }
    })
    latestIrisPx(
      () => scans.listScans(),
      async (id) => (await scans.getScanBundle(id))?.photos[0],
    ).then((v) => { baselineRef.current = v }, () => undefined)
    return () => {
      alive.current = false
      releaseAll()
    }
  }, [releaseAll])

  const fail = useCallback((text: string) => {
    if (!alive.current) return
    releaseAll()
    setMessage(text)
    setPhase('error')
  }, [releaseAll])

  const finishWith = useCallback(async (run: () => ReturnType<typeof runQuickScan>) => {
    setPhase('working')
    try {
      const outcome = await run()
      if (!alive.current) return
      if (outcome.status === 'saved') {
        releaseAll()
        navigate(`/scans/${outcome.scanId}`)
      } else {
        setDraft(outcome.draft)
        setPhase('refused')
      }
    } catch (e) {
      if (e instanceof QuickScanBlockedError) {
        setNextAt(e.nextAllowedAt)
        releaseAll()
        setPhase('blocked')
      } else fail(e instanceof Error ? e.message : 'The scan could not be completed.')
    }
  }, [fail, releaseAll])

  const startLoop = useCallback(() => {
    const video = videoRef.current
    const detector = detectorRef.current
    if (!video || !detector) {
      fail('The camera preview could not be started. Reload the page and try again.')
      return
    }
    const canvas = document.createElement('canvas')
    const tracker = createStableTracker(HOLD_MS)
    let busy = false
    let wasOk = false
    let lastHint = ''
    let lastTs = 0
    const tick = () => {
      loopRef.current = window.setTimeout(tick, TICK_MS)
      if (busy || video.readyState < 2 || !(video.videoWidth > 0)) return
      busy = true
      try {
        const w = video.videoWidth
        const h = video.videoHeight
        lastTs = Math.max(performance.now(), lastTs + 1)
        const frame = detector.detect(video, lastTs)
        const k = Math.min(1, LIVE_MAX_WIDTH / w)
        canvas.width = Math.round(w * k)
        canvas.height = Math.round(h * k)
        canvas.getContext('2d', { willReadFrequently: true })?.drawImage(video, 0, 0, canvas.width, canvas.height)
        const regions = frame ? faceRegions(scaleNamed(frame.named, k), canvas.width, canvas.height) : null
        const pixels = analyzePixels(canvas, regions ?? {})
        const result = evaluateFrameQc({ frame, pixels, shot: QUICK_SHOT, imageWidth: w, imageHeight: h, baselineIrisPx: baselineRef.current })
        setQc(result)
        const failing = firstFailing(result)
        const text = failing ? failing.hint : 'Hold still'
        if (text !== lastHint) {
          lastHint = text
          setHint(text)
        }
        if (result.allOk && !wasOk) beep('ready')
        wasOk = result.allOk
        const t = tracker.update(result.allOk, performance.now())
        setProgress(t.progress)
        if (t.ready) {
          stopLoop()
          void capture()
        }
      } catch (e) {
        stopLoop()
        fail(e instanceof Error ? e.message : 'Face detection stopped working.')
      } finally {
        busy = false
      }
    }
    tick()
    async function capture() {
      const video2 = videoRef.current
      const det = detectorRef.current
      if (!video2 || !det) return
      beep('capture')
      const controller = new AbortController()
      abortRef.current = controller
      await finishWith(async () => {
        const burst = await captureBurst({ video: video2, detector: det, shot: QUICK_SHOT, baselineIrisPx: baselineRef.current, signal: controller.signal })
        return runQuickScan(inputFromBurst(burst), defaultDeps(scans))
      })
    }
  }, [fail, finishWith, stopLoop])

  const startCamera = async () => {
    unlockAudio()
    setPhase('starting')
    setMessage('')
    try {
      const detector = createFaceDetector({ runningMode: 'VIDEO' })
      detectorRef.current = detector
      const [handle] = await Promise.all([openCamera({ facing: 'user', idealWidth: 2160 }), detector.ready()])
      if (!alive.current) { handle.stop(); return }
      cameraRef.current = handle
      setPhase('live')
      // React mounts the <video> after the phase change: wait for it instead of assuming one frame is enough.
      for (let i = 0; i < 120 && !videoRef.current; i++) await new Promise((r) => requestAnimationFrame(r))
      if (!videoRef.current) throw new Error('The camera preview could not be shown. Reload the page and try again.')
      await attachToVideo(videoRef.current, handle)
      startLoop()
    } catch (e) {
      fail(e instanceof CameraError ? CAMERA_MESSAGE[e.code] : e instanceof Error ? e.message : CAMERA_MESSAGE.unknown)
    }
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setPhase('working')
    try {
      const detector = detectorRef.current ?? createFaceDetector({ runningMode: 'VIDEO' })
      detectorRef.current = detector
      await detector.ready()
      const photo = await importPhoto(file)
      const inspection = await inspectStill({ canvas: photo.canvas, detector, shot: QUICK_SHOT, baselineIrisPx: baselineRef.current })
      await finishWith(() => runQuickScan(inputFromStill(photo, inspection), defaultDeps(scans)))
    } catch (e) {
      fail(e instanceof ImportError ? IMPORT_MESSAGE[e.code] : e instanceof Error ? e.message : IMPORT_MESSAGE.unreadable)
    }
  }

  const retake = () => {
    setDraft(null)
    if (cameraRef.current) {
      setPhase('live')
      startLoop()
    } else setPhase('prep')
  }

  const saveAnyway = async () => {
    if (!draft) return
    try {
      const id = await saveDraft(draft, { store: scans })
      releaseAll()
      navigate(`/scans/${id}`)
    } catch (e) {
      fail(e instanceof Error ? e.message : 'The scan could not be saved.')
    }
  }

  return (
    <div>
      <PageHeader title="Quick scan" back={{ to: '/', label: 'Home' }} subtitle="One front-facing photo, measured on this device. Nothing is uploaded." />

      {phase === 'blocked' && (
        <Banner tone="warn" title="One quick scan per day">
          Today's quick scan is done. The next opens {nextAllowedText(nextAt)}. Daily changes are mostly water and lighting, so more scans add noise, not information.
        </Banner>
      )}

      {phase === 'error' && (
        <>
          <Banner tone="danger" title="Scan stopped" live>{message}</Banner>
          <div className="qs-actions">
            <Button onClick={() => { setPhase('prep'); setMessage('') }}>Back</Button>
          </div>
        </>
      )}

      {(phase === 'prep' || phase === 'starting') && (
        <Card title="Before you start">
          <ul className="qs-list">
            <li>Phone on a stand at eye level, about 1.5 m away.</li>
            <li>Face a window. Switch overhead lights off.</li>
            <li>Neutral face, mouth closed, glasses off, hair back.</li>
            <li>Same time of day as your other scans.</li>
          </ul>
          <div className="qs-actions">
            <Button onClick={startCamera} loading={phase === 'starting'}>
              {phase === 'starting' ? 'Loading the on-device face model (about 4 MB)' : 'Start camera'}
            </Button>
            <label>
              <span style={{ fontSize: '0.9375rem' }}>Or use a photo you already took (a native camera photo is sharper):</span>
              <input type="file" accept="image/*" disabled={phase === 'starting'} onChange={(e) => void onFile(e.target.files?.[0])} />
            </label>
          </div>
        </Card>
      )}

      {(phase === 'live' || (phase === 'working' && cameraRef.current)) && (
        <div>
          <div className="qs-stage">
            <video ref={videoRef} className="qs-video" playsInline muted autoPlay />
            <svg className="qs-guide" viewBox="0 0 300 400" aria-hidden="true">
              <ellipse cx="150" cy="190" rx="95" ry="125" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeDasharray="6 6" />
              <line x1="40" y1="150" x2="260" y2="150" stroke="rgba(124,242,196,0.6)" strokeWidth="1" />
            </svg>
          </div>
          <p className="qs-hint" aria-live="polite">{phase === 'working' ? 'Capturing' : hint}</p>
          <div className="qs-bar" aria-hidden="true"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <div className="qs-pills">
            {qc?.checks.map((c) => <span key={c.id} className="qs-pill" data-ok={c.ok}>{CHECK_LABEL[c.id]}</span>)}
          </div>
        </div>
      )}

      {phase === 'working' && !cameraRef.current && <p role="status"><Spinner /> Measuring on this device</p>}

      {phase === 'refused' && draft && (
        <Card title="Nothing could be measured">
          <p>Every metric was refused, so there is nothing to score. The reasons:</p>
          <ul className="qs-list">
            {[...new Set(draft.bundle.measurements.flatMap((m) => m.refusal?.reasons ?? []))].slice(0, 6).map((r) => <li key={r}>{r}</li>)}
          </ul>
          <div className="qs-actions">
            <Button onClick={retake}>Retake</Button>
            <Button variant="secondary" onClick={() => void saveAnyway()}>Save anyway</Button>
          </div>
        </Card>
      )}
    </div>
  )
}
