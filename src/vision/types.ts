/** Vision contracts. Landmarks come from MediaPipe Face Landmarker (478 points incl. iris) running on-device. */

export interface Point2 {
  x: number
  y: number
}
export interface Point3 extends Point2 {
  z: number
}

/** Raw landmark set for one frame. `points` are in PIXELS of the analysed image (already de-normalised). */
export interface FaceLandmarks {
  points: Point3[]
  width: number
  height: number
  /** 52 ARKit-style blendshape scores 0–1 keyed by category name (mouthSmileLeft, jawOpen, eyeBlinkLeft…). */
  blendshapes: Record<string, number>
  /** Row-major 4×4 facial transformation matrix from MediaPipe (null if unavailable). */
  transform: number[] | null
}

/** Head pose in degrees. Positive pitch = chin down, positive yaw = face turned to the image's right, positive roll = clockwise. */
export interface HeadPose {
  yaw: number
  pitch: number
  roll: number
}

/**
 * Named anatomical points derived from the 478 landmarks (all in image pixels, "L"/"R" = the subject's left/right,
 * which is the viewer's right/left on a non-mirrored image). Implemented in src/vision/namedPoints.ts.
 */
export const NAMED_POINTS = [
  'pupilL', 'pupilR', 'irisCenterL', 'irisCenterR',
  'eyeInnerL', 'eyeInnerR', 'eyeOuterL', 'eyeOuterR',
  'eyeTopL', 'eyeTopR', 'eyeBottomL', 'eyeBottomR',
  'browInnerL', 'browInnerR', 'browOuterL', 'browOuterR', 'browMidL', 'browMidR',
  'zygionL', 'zygionR',
  'gonionL', 'gonionR',
  'noseTip', 'subnasale', 'nasion', 'alarL', 'alarR',
  'cupidBow', 'upperLipTop', 'upperLipBottom', 'lowerLipTop', 'lowerLipBottom', 'cheilionL', 'cheilionR',
  'chinTip', 'menton',
  'trichion',
  'faceTop', 'faceLeft', 'faceRight', 'faceBottom',
] as const
export type NamedPoint = (typeof NAMED_POINTS)[number]
export type NamedPoints = Record<NamedPoint, Point2>

/** One analysed video/photo frame. */
export interface FaceFrame {
  landmarks: FaceLandmarks
  pose: HeadPose
  /** Iris diameter in px (mean of both eyes) – the scale/distance proxy. */
  irisPx: number
  named: NamedPoints
}

export interface FaceDetector {
  /** Resolves when the model is loaded (WASM + .task, same-origin only). */
  ready(): Promise<void>
  /** Detect on a still image / canvas / video frame. Returns null when no face. */
  detect(source: CanvasImageSource, timestampMs?: number): FaceFrame | null
  /** Release GPU/WASM resources. */
  close(): void
  readonly delegate: 'GPU' | 'CPU' | 'unknown'
}
