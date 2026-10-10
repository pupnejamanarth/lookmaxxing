import { FaceLandmarker } from '@mediapipe/tasks-vision'
import { describe, expect, it } from 'vitest'
import { MESH, MESH_POINT_COUNT, TRICHION_EXTENSION, estimateTrichion, namedPointsFromLandmarks } from '../../src/vision/namedPoints'
import { NAMED_POINTS } from '../../src/vision/types'
import type { FaceLandmarks, NamedPoint, Point2, Point3 } from '../../src/vision/types'

// ───────────────────────────── a synthetic, anatomically laid-out face ─────────────────────────────
// Image pixels, y down, face centred on x = 400, viewed from the front on an 800 × 1000 frame. The subject's right
// is the viewer's left, so every "R" point has the SMALLER x. Written out by hand from the canonical vertex numbers
// (not from the MESH table), so a wrong id in namedPoints.ts shows up here.

const CX = 400
const OVAL_IDS = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234,
  127, 162, 21, 54, 103, 67, 109,
]

function syntheticFace(): Point3[] {
  const points: Point3[] = Array.from({ length: MESH_POINT_COUNT }, () => ({ x: 0, y: 0, z: 0 }))
  const set = (id: number, x: number, y: number) => {
    points[id] = { x, y, z: 0 }
  }

  // Face oval: an ellipse, 10° apart, from the top of the forehead clockwise on screen (toward the subject's left).
  OVAL_IDS.forEach((id, k) => {
    const theta = ((-90 + 10 * k) * Math.PI) / 180
    set(id, CX + 105 * Math.cos(theta), 470 + 180 * Math.sin(theta))
  })

  // Irises: centre + left / top / right / bottom ring points.
  const iris = (center: number, cx: number, left: number, top: number, right: number, bottom: number) => {
    set(center, cx, 400)
    set(left, cx - 8.5, 400)
    set(top, cx, 393)
    set(right, cx + 8.5, 400)
    set(bottom, cx, 407)
  }
  iris(468, 355, 469, 470, 471, 472) //  subject's right iris
  iris(473, 445, 474, 475, 476, 477) //  subject's left iris

  // Eyes: subject's right = 33 outer, 133 inner, 159 upper lid, 145 lower lid; left = 263 outer, 362 inner, 386 upper, 374 lower.
  set(33, 320, 402)
  set(133, 385, 404)
  set(159, 352, 392)
  set(145, 352, 410)
  set(263, 480, 402)
  set(362, 415, 404)
  set(386, 448, 392)
  set(374, 448, 410)

  // Brows: [upper, lower] edge at the inner end, middle and outer end.
  set(107, 385, 360)
  set(55, 385, 366)
  set(105, 350, 350)
  set(52, 350, 358)
  set(70, 315, 362)
  set(46, 315, 368)
  set(336, 415, 360)
  set(285, 415, 366)
  set(334, 450, 350)
  set(282, 450, 358)
  set(300, 485, 362)
  set(276, 485, 368)

  // Nose, mouth, forehead.
  set(168, CX, 395) // nasion
  set(9, CX, 370) //   glabella
  set(1, CX, 480) //   nose tip
  set(2, CX, 500) //   subnasale
  set(129, 370, 495) // alar, subject's right
  set(358, 430, 495) // alar, subject's left
  set(0, CX, 530) //   upper lip, top of the vermilion
  set(13, CX, 545) //  where the lips meet, upper side
  set(14, CX, 550) //  lower side
  set(17, CX, 575) //  bottom of the lower lip
  set(61, 360, 548) // mouth corner, subject's right
  set(291, 440, 548) // subject's left
  return points
}

function face(points: Point3[] = syntheticFace()): FaceLandmarks {
  return { points, width: 800, height: 1000, blendshapes: {}, transform: null }
}

const named = (lm: FaceLandmarks = face()) => namedPointsFromLandmarks(lm)

// ───────────────────────────── the mapping, checked against the library's own tables ─────────────────────────────

describe('MESH ids agree with the MediaPipe library\'s own connection tables', () => {
  const idsOf = (connections: { start: number; end: number }[]) => new Set(connections.flatMap((c) => [c.start, c.end]))
  const eyeR = idsOf(FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE)
  const eyeL = idsOf(FaceLandmarker.FACE_LANDMARKS_LEFT_EYE)
  const browR = idsOf(FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW)
  const browL = idsOf(FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW)
  const irisR = idsOf(FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS)
  const irisL = idsOf(FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS)
  const lips = idsOf(FaceLandmarker.FACE_LANDMARKS_LIPS)
  const oval = idsOf(FaceLandmarker.FACE_LANDMARKS_FACE_OVAL)

  it('subject\'s RIGHT features are the library\'s "right" ones, LEFT the "left" ones', () => {
    for (const id of [MESH.eyeOuterR, MESH.eyeInnerR, MESH.eyeTopR, MESH.eyeBottomR]) expect(eyeR.has(id)).toBe(true)
    for (const id of [MESH.eyeOuterL, MESH.eyeInnerL, MESH.eyeTopL, MESH.eyeBottomL]) expect(eyeL.has(id)).toBe(true)
    for (const id of [...MESH.browInnerR, ...MESH.browMidR, ...MESH.browOuterR]) expect(browR.has(id)).toBe(true)
    for (const id of [...MESH.browInnerL, ...MESH.browMidL, ...MESH.browOuterL]) expect(browL.has(id)).toBe(true)
    for (const id of MESH.irisRingR) expect(irisR.has(id)).toBe(true)
    for (const id of MESH.irisRingL) expect(irisL.has(id)).toBe(true)
  })

  it('the iris centres are the vertices right after the 468 face vertices, one per eye, centre before its ring', () => {
    expect(MESH.irisCenterR).toBe(468)
    expect(Math.min(...MESH.irisRingR)).toBe(MESH.irisCenterR + 1)
    expect(MESH.irisCenterL).toBe(473)
    expect(Math.min(...MESH.irisRingL)).toBe(MESH.irisCenterL + 1)
  })

  it('the lip points are on the lip outline and the face-contour points are on the face oval', () => {
    for (const id of [MESH.upperLipTop, MESH.upperLipBottom, MESH.lowerLipTop, MESH.lowerLipBottom, MESH.cheilionR, MESH.cheilionL]) {
      expect(lips.has(id)).toBe(true)
    }
    for (const id of [MESH.faceTop, MESH.chinTip, MESH.zygionR, MESH.zygionL, MESH.gonionR, MESH.gonionL]) expect(oval.has(id)).toBe(true)
    expect([...MESH.faceOval].sort((a, b) => a - b)).toEqual([...oval].sort((a, b) => a - b))
  })

  it('the hand-written oval order in this test is the library\'s', () => {
    const order = FaceLandmarker.FACE_LANDMARKS_FACE_OVAL.map((c) => c.start)
    expect(order).toEqual(OVAL_IDS)
  })
})

// ───────────────────────────── structure and anatomy ─────────────────────────────

describe('namedPointsFromLandmarks', () => {
  it('returns every NamedPoint, nothing else, all finite', () => {
    const n = named()
    expect(Object.keys(n).sort()).toEqual([...NAMED_POINTS].sort())
    for (const name of NAMED_POINTS) {
      expect(Number.isFinite(n[name].x)).toBe(true)
      expect(Number.isFinite(n[name].y)).toBe(true)
    }
  })

  it('refuses a mesh that is not the 478-point one (an iris-less 468-point mesh is not enough)', () => {
    expect(() => named(face(syntheticFace().slice(0, 468)))).toThrow(RangeError)
    expect(() => named(face([]))).toThrow(/478/)
  })

  it('"L" is the subject\'s left = larger x, "R" the smaller x, on every pair', () => {
    const n = named()
    const pairs: [NamedPoint, NamedPoint][] = [
      ['pupilL', 'pupilR'],
      ['irisCenterL', 'irisCenterR'],
      ['eyeInnerL', 'eyeInnerR'],
      ['eyeOuterL', 'eyeOuterR'],
      ['eyeTopL', 'eyeTopR'],
      ['eyeBottomL', 'eyeBottomR'],
      ['browInnerL', 'browInnerR'],
      ['browMidL', 'browMidR'],
      ['browOuterL', 'browOuterR'],
      ['zygionL', 'zygionR'],
      ['gonionL', 'gonionR'],
      ['alarL', 'alarR'],
      ['cheilionL', 'cheilionR'],
      ['faceLeft', 'faceRight'],
    ]
    for (const [left, right] of pairs) expect(n[left].x, `${left} vs ${right}`).toBeGreaterThan(n[right].x)
  })

  it('is laid out like a face from the midline outward: outer eye corner beyond inner, inner beyond the nose, cheek beyond jaw', () => {
    const n = named()
    expect(n.eyeOuterL.x).toBeGreaterThan(n.eyeInnerL.x)
    expect(n.eyeInnerL.x).toBeGreaterThan(n.nasion.x)
    expect(n.nasion.x).toBeGreaterThan(n.eyeInnerR.x)
    expect(n.eyeInnerR.x).toBeGreaterThan(n.eyeOuterR.x)
    expect(n.browOuterL.x).toBeGreaterThan(n.browInnerL.x)
    expect(n.zygionL.x - n.zygionR.x).toBeGreaterThan(n.gonionL.x - n.gonionR.x)
    expect(n.alarL.x - n.alarR.x).toBeGreaterThan(0)
    for (const name of ['noseTip', 'subnasale', 'nasion', 'cupidBow', 'chinTip', 'menton', 'trichion', 'faceTop', 'faceBottom'] as const) {
      expect(n[name].x).toBeCloseTo(CX, 6)
    }
  })

  it('orders the face top to bottom: hairline, forehead, brows, eyes, nose, lips, chin', () => {
    const n = named()
    const order: NamedPoint[] = [
      'trichion',
      'faceTop',
      'browMidL',
      'nasion',
      'pupilL',
      'eyeBottomL',
      'noseTip',
      'subnasale',
      'upperLipTop',
      'upperLipBottom',
      'lowerLipTop',
      'lowerLipBottom',
      'chinTip',
    ]
    for (let i = 1; i < order.length; i++) expect(n[order[i]!].y, `${order[i]} below ${order[i - 1]}`).toBeGreaterThan(n[order[i - 1]!].y)
    expect(n.eyeTopL.y).toBeLessThan(n.pupilL.y)
    expect(n.pupilL.y).toBeLessThan(n.eyeBottomL.y)
    expect(n.browInnerL.y).toBeLessThan(n.eyeTopL.y)
    expect(n.faceBottom.y).toBeGreaterThanOrEqual(n.chinTip.y)
  })

  it('maps the single-vertex points to the canonical ids', () => {
    const n = named()
    const lm = syntheticFace()
    const same = (a: Point2, id: number) => expect(a).toEqual({ x: lm[id]!.x, y: lm[id]!.y })
    same(n.noseTip, 1)
    same(n.subnasale, 2)
    same(n.nasion, 168)
    same(n.alarR, 129)
    same(n.alarL, 358)
    same(n.upperLipTop, 0)
    same(n.upperLipBottom, 13)
    same(n.lowerLipTop, 14)
    same(n.lowerLipBottom, 17)
    same(n.cheilionR, 61)
    same(n.cheilionL, 291)
    same(n.chinTip, 152)
    same(n.eyeOuterR, 33)
    same(n.eyeInnerR, 133)
    same(n.eyeOuterL, 263)
    same(n.eyeInnerL, 362)
    same(n.eyeTopR, 159)
    same(n.eyeBottomR, 145)
    same(n.eyeTopL, 386)
    same(n.eyeBottomL, 374)
    same(n.irisCenterR, 468)
    same(n.irisCenterL, 473)
    same(n.zygionR, 234)
    same(n.zygionL, 454)
    same(n.gonionR, 172)
    same(n.gonionL, 397)
  })

  it('names that the 2D mesh cannot tell apart are the same point, on purpose', () => {
    const n = named()
    expect(n.cupidBow).toEqual(n.upperLipTop)
    expect(n.menton).toEqual(n.chinTip)
  })

  it('brow points are the centre line between the upper and lower edge', () => {
    const n = named()
    expect(n.browInnerR).toEqual({ x: 385, y: 363 })
    expect(n.browMidR).toEqual({ x: 350, y: 354 })
    expect(n.browOuterR).toEqual({ x: 315, y: 365 })
    expect(n.browInnerL).toEqual({ x: 415, y: 363 })
    expect(n.browMidL).toEqual({ x: 450, y: 354 })
    expect(n.browOuterL).toEqual({ x: 485, y: 365 })
  })

  it('a pupil is the iris centre averaged with the centroid of its ring', () => {
    const lm = syntheticFace()
    expect(named(face(lm)).pupilR).toEqual({ x: 355, y: 400 })
    // Pull the right iris ring 4 px to the right: the ring centroid moves 4 px, the pupil moves 2.
    for (const id of [469, 470, 471, 472]) lm[id] = { ...lm[id]!, x: lm[id]!.x + 4 }
    const n = named(face(lm))
    expect(n.pupilR.x).toBeCloseTo(357, 10)
    expect(n.irisCenterR.x).toBe(355)
  })

  it('face extremes are the extremes of the oval along the image axes (subject\'s left = largest x)', () => {
    const n = named()
    const lm = syntheticFace()
    const oval = OVAL_IDS.map((id) => lm[id]!)
    expect(n.faceTop.y).toBeCloseTo(Math.min(...oval.map((p) => p.y)), 9)
    expect(n.faceBottom.y).toBeCloseTo(Math.max(...oval.map((p) => p.y)), 9)
    expect(n.faceLeft.x).toBeCloseTo(Math.max(...oval.map((p) => p.x)), 9)
    expect(n.faceRight.x).toBeCloseTo(Math.min(...oval.map((p) => p.x)), 9)
    // In this layout the widest oval vertices are NOT the zygion vertices.
    expect(n.faceLeft.x).toBeGreaterThan(n.zygionL.x)
  })

  it('is a rigid-motion equivariant map: turn the whole face 20° and every point-derived name turns with it', () => {
    const base = syntheticFace()
    const angle = (20 * Math.PI) / 180
    const cx = 400
    const cy = 450
    const rot = (p: Point2): Point2 => ({
      x: cx + (p.x - cx) * Math.cos(angle) - (p.y - cy) * Math.sin(angle),
      y: cy + (p.x - cx) * Math.sin(angle) + (p.y - cy) * Math.cos(angle),
    })
    const turned = base.map((p) => ({ ...rot(p), z: 0 }))
    const a = named(face(base))
    const b = named(face(turned))
    const axisAligned: NamedPoint[] = ['faceTop', 'faceBottom', 'faceLeft', 'faceRight']
    for (const name of NAMED_POINTS) {
      if (axisAligned.includes(name)) continue
      const expected = rot(a[name])
      expect(b[name].x, `${name}.x`).toBeCloseTo(expected.x, 6)
      expect(b[name].y, `${name}.y`).toBeCloseTo(expected.y, 6)
    }
  })
})

describe('trichion is an estimate, extended from the glabella through the top of the mesh', () => {
  it('sits TRICHION_EXTENSION × (glabella → faceTop) beyond the top vertex', () => {
    expect(TRICHION_EXTENSION).toBeGreaterThan(0)
    const n = named()
    // vertex 10 at y = 290, glabella at y = 370 → 80 px up; extended by the factor.
    expect(n.trichion.x).toBeCloseTo(CX, 9)
    expect(n.trichion.y).toBeCloseTo(290 - 80 * TRICHION_EXTENSION, 9)
    expect(n.trichion.y).toBeLessThan(n.faceTop.y)
  })

  it('follows the face axis when the head is tilted, instead of going straight up the image', () => {
    expect(estimateTrichion({ x: 100, y: 100 }, { x: 80, y: 180 })).toEqual({
      x: 100 + (100 - 80) * TRICHION_EXTENSION,
      y: 100 + (100 - 180) * TRICHION_EXTENSION,
    })
  })

  it('collapses onto the top vertex rather than inventing a direction when the forehead has no height', () => {
    expect(estimateTrichion({ x: 50, y: 60 }, { x: 50, y: 60 })).toEqual({ x: 50, y: 60 })
  })
})
