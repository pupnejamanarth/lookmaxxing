/**
 * Capture: camera, per-frame quality control, burst capture and the metadata-stripping photo import.
 * What is exported here is the contract the scan screens and the metrics module code against.
 */
export { CameraError, attachToVideo, openCamera } from './camera'
export type { CameraErrorCode, CameraHandle, OpenCameraOptions } from './camera'
export { analyzePixels } from './pixels'
export type { PixelBuffer, PixelRegions, PixelStats, Rect } from './pixels'
export { QC_LIMITS, distanceFromIris, evaluateFrameQc, faceRegions, shotQcPassed } from './qc'
export type { FaceRegions, FrameQcArgs } from './qc'
export { captureBurst, inspectStill } from './burst'
export type { BurstResult, CaptureBurstArgs, InspectStillArgs, StillInspection } from './burst'
export { ImportError, importPhoto } from './importPhoto'
export type { ImportedPhoto } from './importPhoto'
export { MetadataLeakError, hasMetadataMarkers, scanJpegMetadata } from './metadata'
export type { MetadataReport } from './metadata'
export { sampleGreyCard, whiteBalanceGains } from './greyCard'
export type { GreyCardSample } from './greyCard'
export { beep, unlockAudio } from './beep'
export type { BeepKind } from './beep'
