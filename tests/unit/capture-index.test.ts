import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as capture from '../../src/capture'

describe('src/capture/index.ts', () => {
  it('exports the functions of the CAPTURE contract', () => {
    for (const name of ['openCamera', 'analyzePixels', 'evaluateFrameQc', 'captureBurst', 'importPhoto', 'hasMetadataMarkers', 'sampleGreyCard', 'whiteBalanceGains', 'beep', 'unlockAudio']) {
      expect(typeof (capture as Record<string, unknown>)[name], name).toBe('function')
    }
  })

  it('exports the error classes and helpers the screens need, and nothing unexpected', () => {
    expect(Object.keys(capture).sort()).toEqual(
      [
        'CameraError', 'ImportError', 'MetadataLeakError', 'QC_LIMITS', 'analyzePixels', 'attachToVideo', 'beep', 'captureBurst',
        'distanceFromIris', 'evaluateFrameQc', 'faceRegions', 'hasMetadataMarkers', 'importPhoto', 'inspectStill', 'openCamera',
        'sampleGreyCard', 'scanJpegMetadata', 'shotQcPassed', 'unlockAudio', 'whiteBalanceGains',
      ].sort(),
    )
  })
})

describe('the capture sources never ask for the microphone', () => {
  it('has no audio: true and no second getUserMedia call outside camera.ts', () => {
    const dir = new URL('../../src/capture/', import.meta.url)
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const text = readFileSync(new URL(file, dir), 'utf8')
      expect(text, file).not.toMatch(/audio\s*:\s*(true|\{)/)
      if (file !== 'camera.ts') expect(text, file).not.toMatch(/getUserMedia\(/)
    }
  })
})
