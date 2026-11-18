import { analyzePixels, type PixelStats } from './pixels'
import { faceRegions } from './qc'
import type { FaceFrame } from '../vision/types'

/** Width the quality checks measure pixels at. The live preview and the burst MUST use the same size: sharpness depends on it. */
export const QC_ANALYSIS_WIDTH = 640

function scaleNamed(frame: FaceFrame, k: number) {
  const out: Record<string, { x: number; y: number }> = {}
  for (const [name, p] of Object.entries(frame.named)) out[name] = { x: p.x * k, y: p.y * k }
  return out as unknown as FaceFrame['named']
}

/**
 * Pixel statistics for the quality checks, always measured on a copy no wider than QC_ANALYSIS_WIDTH.
 * `scratch` is reused between calls (the live loop calls this ten times a second).
 */
export function analyzeForQc(source: HTMLCanvasElement | HTMLVideoElement, width: number, height: number, frame: FaceFrame | null, scratch: HTMLCanvasElement): PixelStats {
  const k = Math.min(1, QC_ANALYSIS_WIDTH / width)
  scratch.width = Math.max(1, Math.round(width * k))
  scratch.height = Math.max(1, Math.round(height * k))
  scratch.getContext('2d', { willReadFrequently: true })?.drawImage(source, 0, 0, scratch.width, scratch.height)
  const regions = frame ? faceRegions(scaleNamed(frame, k), scratch.width, scratch.height) : null
  return analyzePixels(scratch, regions ?? {})
}
