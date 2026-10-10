/**
 * Face structure catalog (category `face`, ids F01–F30, weight total EXACTLY 22).
 *
 * Authoring notes (read before editing):
 *  - Every source here is verified:false. The authoring session had a working web search but NO working
 *    page fetch (WebFetch failed with a DNS error on every host), so no record, abstract or paper was
 *    opened. Search summaries were used only to cross-check bibliographic details and to avoid wrong claims.
 *  - Numeric bands are labelled as one of: a published clinical convention, a typical-range assumption,
 *    or an app-chosen tolerance. None is a measured perceptual limit. Replace them when verified norm
 *    tables are added.
 *  - Overlaps are stated where they exist (F01 uses cheek-to-jaw width, so F17 is not scored again).
 */
import type { Metric, Source } from '../schema'

// ───────────────────────── shared text ─────────────────────────

const NOFETCH =
  'UNVERIFIED. The record could not be opened: the page-fetch tool failed with a DNS error (ENOTFOUND) on every host tried (doi.org, ncbi.nlm.nih.gov, europepmc.org, sagepub.com, sciencedirect.com), so no abstract or full text was read in this session.'

const PHOTO_ERROR =
  'Photo-based proportions carry measurement error: landmark placement is imperfect, and a camera closer than about 1.5 m enlarges features nearer the lens (the nose most of all) relative to the rest of the face.'

const FRONTAL_POSE = [
  'head yaw or roll above 3°',
  'head pitch above 2° from level',
  'face outside the central 50% of the frame',
  'estimated camera distance under 1.2 m',
]

const NOSE_DISTANCE = ['estimated camera distance under 1.5 m']

const NEUTRAL_FACE = [
  'expression not neutral (smiling, frowning, brows raised or squeezed)',
  'mouth open or lips pressed hard together',
]

const PROFILE_POSE = [
  'head not in a true side view (more than 5° away from 90° yaw)',
  'head pitch above 3° from level',
  'estimated camera distance under 1.5 m',
  'hand-placed points not confirmed by the user',
]

// ───────────────────────── metrics ─────────────────────────

export const metrics: Metric[] = [
  // ── F01 ──────────────────────────────────────────────────────────────
  {
    id: 'F01',
    category: 'face',
    name: 'Facial adiposity (fat in cheeks, jaw and neck)',
    measures:
      'How much fat the lower face and neck carry, judged from the outline of the face. In rating studies, faces that look heavier are rated as less healthy and less attractive.',
    howMeasured:
      'Automatic: face-landmark model on the frontal neutral photo. The index combines two face-shape cues that Coetzee et al. (2010) linked to BMI: the ratio of face-outline length to face area, and cheek width ÷ jaw width. It is not a body-fat measurement. The score compares you with your own value at a lean, healthy body fat (see B02), because the same index means different things on different bone structures. Refused when the jaw edge is hidden, the expression is not neutral, or the head is turned or tilted, because head pose changes the cheek and jaw widths. ' +
      PHOTO_ERROR,
    methods: ['AUTO_FRONTAL_PHOTO'],
    scale: {
      unit: 'index',
      min: 0,
      max: 100,
      description: 'Composite face-fat index; 50 = your first scan, lower = leaner-looking face',
      higherIs: 'target_range',
    },
    ideal: {
      summary:
        'Lean enough that the jaw and cheek edges show, but not gaunt. In rating studies, men’s faces are judged best at the lower end of a healthy weight, and faces at both extremes of weight are rated lower.',
      male: null,
      rationale:
        'The index is relative, so no absolute band exists. Rating studies find a noticeable change at about 1.3 BMI points of face weight, and about 2.6 BMI points of loss before men’s faces in edited photos were judged more attractive (Re & Rule 2016).',
      confidenceInIdeal: 'medium',
      populationCaveat:
        'Most rating studies use young adult raters and Western university samples, and some use digitally edited faces rather than real weight change.',
    },
    scoring: {
      kind: 'personal_baseline',
      direction: 'target_range',
      note: 'No absolute ideal exists for this index. The score is closeness to your personal target index, set as the value measured at the body fat chosen in B02. Until a target exists, the first scan is the baseline and the score is shown as “baseline set”. The score falls again if the face reads as gaunt (index well below target).',
    },
    changeability: 'CHANGEABLE',
    changeabilityNote:
      'Face fat follows overall body fat, but where fat comes off first differs between people. Bone structure is fixed.',
    weight: 8.5,
    weightRationale:
      'Largest face weight. It is the face feature with the most consistent rating-study support and the one that real habits change. It also receives the weight freed by downgrading weaker face metrics (F02–F30), so the category total stays at 22.',
    evidence: 'MODERATE',
    evidenceNote:
      'Several rating studies link a heavier-looking face to lower rated health and attractiveness, and face shape tracks BMI. Most of this work uses photo ratings by young adults, and the index here is an estimate from face shape, not a body-fat reading.',
    sourceIds: ['face:coetzee2009', 'face:coetzee2010', 'face:rerule2016'],
    drivers: ['fat_loss', 'nutrition_structure', 'resistance_training', 'consistency'],
    captureRequirements: ['frontal_neutral'],
    refusalConditions: [
      ...FRONTAL_POSE,
      ...NEUTRAL_FACE,
      'jaw edge hidden by beard, hair or collar',
      'user reports swelling, illness or heavy drinking in the last 24 hours',
    ],
    phase: 'M1',
  },

  // ── F02 ──────────────────────────────────────────────────────────────
  {
    id: 'F02',
    category: 'face',
    name: 'Cervicomental angle (under-chin to neck angle)',
    measures:
      'The angle between the underside of the chin and the front of the neck, seen from the side. A smaller angle inside the target band reads as a defined under-chin line; a wider one reads as a soft under-chin.',
    howMeasured:
      'Manual: on a side-view photo you place three points (the underside of the chin, the corner where the chin meets the neck, and a point down the front of the neck). The app computes the angle. The head must be level, like looking at the horizon, because lowering the chin shrinks the angle and lifting it widens it, so head tilt changes the reading directly. ' +
      PHOTO_ERROR,
    methods: ['MANUAL_LANDMARKS', 'AUTO_PROFILE_PHOTO'],
    scale: { unit: '°', min: 80, max: 180, description: 'Angle at the chin-neck corner', higherIs: 'target_range' },
    ideal: {
      summary: '105–120° is the plastic-surgery standard for a youthful, defined neck.',
      male: { lo: 105, hi: 120 },
      rationale:
        'Ellenbogen & Karlin (1980) set this band as a visual criterion for a good neck result. It is a surgical standard, not a result from a rating study of ordinary men.',
      confidenceInIdeal: 'low',
      populationCaveat: 'Clinical standard drawn from surgical practice; not tested across populations or ages.',
    },
    scoring: {
      kind: 'range',
      lo: 105,
      hi: 120,
      tau: 8,
      tauRationale:
        'Head tilt alone can move the reading by several degrees, so tau is set near that error rather than at a perceptual threshold.',
    },
    changeability: 'CHANGEABLE',
    changeabilityNote:
      'Fat under the chin and head and neck posture change the angle. The jaw and neck anatomy underneath does not change.',
    weight: 2,
    weightRationale:
      'The under-chin line is one of the most visible lower-face features that habits change, so it keeps a mid weight despite weak evidence for the exact band.',
    evidence: 'CONVENTION',
    evidenceNote:
      'The 105–120° band is a plastic-surgery standard from 1980, not a tested attractiveness target. Fat under the chin and head position clearly change how this area looks.',
    sourceIds: ['face:ellenbogen1980'],
    drivers: ['fat_loss', 'posture_work', 'nutrition_structure'],
    captureRequirements: ['profile_left', 'profile_right'],
    refusalConditions: [
      ...PROFILE_POSE,
      'chin tucked or lifted (head not level)',
      'beard, collar or hair hiding the under-chin line',
      'mouth open or jaw clenched',
    ],
    phase: 'M2',
  },

  // ── F03 ──────────────────────────────────────────────────────────────
  {
    id: 'F03',
    category: 'face',
    name: 'Jaw angle (gonial angle), soft-tissue estimate',
    measures:
      'The angle at the corner of the lower jaw, seen from the side, estimated from the skin outline. How crisp the jaw edge looks is covered by F01 and F02, because it depends mostly on face fat.',
    howMeasured:
      'Manual: on a side-view photo you place points at the ear base on the jaw, the jaw corner and the underside of the chin; the app computes the angle of the skin outline. This is not the bone angle an X-ray shows: skin, muscle and beard change it. The face-landmark model is unreliable in side view, so the points are hand-placed. ' +
      PHOTO_ERROR,
    methods: ['MANUAL_LANDMARKS'],
    scale: { unit: '°', min: 100, max: 150, description: 'Soft-tissue angle at the jaw corner', higherIs: 'target_range' },
    ideal: {
      summary:
        'No evidence-based ideal. Adult X-ray measurements of the bone angle mostly sit near 119–127°, and the difference between men and women is inconsistent between studies. A lower angle is not “always better”.',
      male: null,
      rationale:
        'We found no rating study that isolates the jaw angle in men’s faces and shows a clear best value. Studies of jaw and profile shape are small or mostly use women’s faces. The scoring band is a typical range, not a preference.',
      confidenceInIdeal: 'low',
      populationCaveat:
        'X-ray norms come from orthodontic patients in several countries; a soft-tissue angle from a photo is a different quantity.',
    },
    scoring: {
      kind: 'range',
      lo: 118,
      hi: 130,
      tau: 8,
      tauRationale:
        'Typical-range band (bone norms plus allowance for soft tissue), not an ideal. Tau of 8° is close to the error of hand-placed points and avoids penalising normal variation.',
    },
    changeability: 'FIXED_BUT_VISIBILITY_CHANGEABLE',
    changeabilityNote:
      'The bone angle is fixed. Face fat and beard length change how sharp the outline looks in a photo.',
    weight: 0.75,
    weightRationale:
      'Capped below 1 because the attractiveness evidence for any particular angle is weak and the photo measurement is not the bone angle.',
    evidence: 'WEAK',
    evidenceNote:
      '“A lower gonial angle is always better” is lookmaxxing folklore. Studies of jaw shape and attractiveness are few and small, and the bone angle cannot be measured from a photo. Treat the number as descriptive.',
    communityClaim: '“A gonial angle below about 120° is ideal, and the lower the better.”',
    sourceIds: [],
    drivers: ['fat_loss', 'beard_design'],
    captureRequirements: ['profile_left', 'profile_right'],
    refusalConditions: [
      ...PROFILE_POSE,
      'jaw corner hidden by beard, hair or collar',
      'jaw clenched or mouth open',
    ],
    phase: 'M2',
  },

  // ── F04 ──────────────────────────────────────────────────────────────
  {
    id: 'F04',
    category: 'face',
    name: 'Chin projection (chin tip vs vertical reference line)',
    measures:
      'How far the chin tip sits in front of or behind a vertical line dropped from the bridge of the nose, seen from the side.',
    howMeasured:
      'Manual: on a level side-view photo you mark the bridge of the nose and the chin tip. The app draws a vertical line through the nose-bridge point, perpendicular to the level plane of the head, and reports the horizontal offset in mm, scaled from iris size (one study found a fixed iris reference about 3–4% off on average). Positive = chin in front of the line. ' +
      PHOTO_ERROR,
    methods: ['MANUAL_LANDMARKS', 'AUTO_PROFILE_PHOTO'],
    scale: { unit: 'mm', min: -15, max: 15, description: 'Chin tip offset from the nose-bridge vertical (+ = forward)', higherIs: 'target_range' },
    ideal: {
      summary:
        'Chin tip close to the vertical line from the nose bridge (the “zero meridian” used in profile surgery). In men, a straight profile was rated most appealing in a review of studies with lay raters.',
      male: { lo: -2, hi: 2 },
      rationale:
        'Surgical profile analysis puts the ideal chin on or just behind this line. A review of lay-rater studies found straight profiles most appealing in men but could not set firm cut-offs because the studies measured differently.',
      confidenceInIdeal: 'low',
      populationCaveat:
        'Studies mix silhouettes and edited photos, raters differ in age and culture, and in the review adult raters preferred more retruded profiles than younger raters.',
    },
    scoring: {
      kind: 'range',
      lo: -2,
      hi: 2,
      tau: 4,
      tauRationale:
        'Band follows the clinical line with ±2 mm for landmark and scale error. Published acceptability limits are inconsistent, so tau of 4 mm makes the score decline gradually instead of at a sharp edge.',
    },
    changeability: 'SURGICAL_ONLY',
    changeabilityNote:
      'Only surgery or implants change chin position. Fat under the chin changes how it looks (see F02) but not where the bone sits.',
    weight: 1.5,
    weightRationale:
      'Profile chin position is a clearly visible feature and several rating studies agree that large departures lower appeal, but the exact limits are unsettled, so it stays at the seed weight.',
    evidence: 'MODERATE',
    evidenceNote:
      'Rating studies agree that chins far behind or far in front of a straight profile lower rated appeal, but they disagree on the exact limits, and many use silhouettes or edited photos. Treat the band as approximate.',
    sourceIds: ['face:gonzalezulloa1962', 'face:profile_review2021'],
    drivers: [],
    captureRequirements: ['profile_left', 'profile_right'],
    refusalConditions: [...PROFILE_POSE, 'chin pushed forward or tucked', 'mouth open or jaw clenched'],
    phase: 'M2',
  },

  // ── F05 ──────────────────────────────────────────────────────────────
  {
    id: 'F05',
    category: 'face',
    name: 'Facial symmetry (left-right mismatch)',
    measures: 'How closely the left and right halves of the face mirror each other in landmark positions.',
    howMeasured:
      'Automatic: face-landmark model on the frontal neutral photo. Each landmark is mirrored across the face midline and the average gap is reported as a percent of the distance between the pupils. Refused unless head yaw, roll and pitch are near zero, because a small head turn creates asymmetry that is not in the face. Smiles are refused because they are rarely even. ' +
      PHOTO_ERROR,
    methods: ['AUTO_FRONTAL_PHOTO'],
    scale: { unit: '% of pupil distance', min: 0, max: 15, description: 'Average left-right landmark mismatch', higherIs: 'worse' },
    ideal: {
      summary:
        'Lower mismatch is rated as more attractive in rating studies, but every real face is asymmetric and the effect of natural differences is small. No numeric ideal.',
      male: null,
      rationale:
        'A review of the evidence (Rhodes 2006) reports that more symmetric faces are rated more attractive in men and women. The effect for natural variation is modest, and whether symmetry signals health is disputed. The scoring bands reflect typical measurement noise, not a perceptual limit.',
      confidenceInIdeal: 'low',
      populationCaveat: 'Most rating studies use young adult raters in Western or similar samples.',
    },
    scoring: {
      kind: 'range',
      lo: 0,
      hi: 3,
      tau: 2.5,
      tauRationale:
        'App assumption, not a published threshold: landmark noise and tiny pose errors alone add some apparent mismatch, and no study gives the mismatch at which people notice. Replace with pilot data from the app.',
    },
    changeability: 'FIXED',
    changeabilityNote:
      'Bone and soft-tissue symmetry are fixed. Hair parting, head tilt and expression change how symmetric a photo looks.',
    weight: 2.25,
    weightRationale:
      'The best-supported fixed trait in the face category, but the effect for natural faces is small and 2D photos add noise, so it receives only a moderate weight.',
    evidence: 'MODERATE',
    evidenceNote:
      'Symmetric faces are rated as more attractive in many studies, but the effect for real, natural faces is small and the claim that symmetry signals health is disputed. Asymmetry measured from a photo also includes pose and expression error.',
    sourceIds: ['face:rhodes2006'],
    drivers: [],
    captureRequirements: ['frontal_neutral'],
    refusalConditions: [
      ...FRONTAL_POSE,
      ...NEUTRAL_FACE,
      'uneven lighting with a strong shadow on one side of the face',
      'hair or glasses frames covering landmarks on one side',
    ],
    phase: 'M1',
  },

  // ── F06 ──────────────────────────────────────────────────────────────
  {
    id: 'F06',
    category: 'face',
    name: 'Facial thirds balance',
    measures:
      'How equal the three vertical sections of the face are: hairline to brow, brow to base of the nose, and base of the nose to chin.',
    howMeasured:
      'Automatic landmarks for the brow, nose base and chin on the frontal neutral photo; you tap the hairline because hair makes it ambiguous. Reported as the longest third ÷ the shortest third (1.00 means perfectly equal). ' +
      PHOTO_ERROR,
    methods: ['AUTO_FRONTAL_PHOTO', 'MANUAL_LANDMARKS'],
    scale: { unit: 'ratio', min: 1, max: 2, description: 'Longest third ÷ shortest third', higherIs: 'worse' },
    ideal: {
      summary:
        'The classical art canon says equal thirds. Measured faces mostly differ from it, and no study shows that equal thirds are rated as more attractive.',
      male: null,
      rationale:
        'Farkas et al. (1985) measured young adult North American Caucasians and revised the neoclassical canons because most faces did not match them. A later study of young adults from the Arabian Peninsula also found unequal thirds. The canon is a drawing convention.',
      confidenceInIdeal: 'low',
      populationCaveat: 'Measured norms come from small samples of young adults in a few populations.',
    },
    scoring: {
      kind: 'range',
      lo: 1,
      hi: 1.3,
      tau: 0.2,
      tauRationale:
        'App-chosen tolerance, not a measured norm: real faces mostly are not equal, so the band avoids penalising ordinary faces and only large imbalance costs points. Replace with a verified adult-male norm band.',
    },
    changeability: 'FIXED',
    changeabilityNote:
      'Haircut changes how the top third looks, not the measured value (see H04).',
    weight: 0.5,
    weightRationale:
      'Classical canon with no rating evidence behind the equal-thirds target, and the top third depends on a hairline that moves with age.',
    evidence: 'CONVENTION',
    evidenceNote:
      'The idea that the face should split into equal thirds comes from classical art, not from attractiveness research. Measured faces mostly depart from it. Treat it as a drawing rule.',
    sourceIds: ['face:farkas1985', 'face:alsebaei2015'],
    drivers: [],
    captureRequirements: ['frontal_neutral'],
    refusalConditions: [
      ...FRONTAL_POSE,
      ...NEUTRAL_FACE,
      'hairline not visible or not tapped by the user',
      'forehead covered by hair, hat or band',
    ],
    phase: 'M2',
  },

  // ── F07 ──────────────────────────────────────────────────────────────
  {
    id: 'F07',
    category: 'face',
    name: 'Facial fifths (eye width vs gap between the eyes)',
    measures:
      'Compares the width of one eye with the gap between the inner corners of the two eyes. This is the core of the classical rule that the face is five eye-widths wide.',
    howMeasured:
      'Automatic from the inner and outer eye corners on the frontal neutral photo. Reported as inner-eye gap ÷ eye width (the canon says 1.0). Both distances are small, so a one-pixel landmark error moves the ratio noticeably. ' +
      PHOTO_ERROR,
    methods: ['AUTO_FRONTAL_PHOTO'],
    scale: { unit: 'ratio', min: 0.6, max: 1.6, description: 'Inner-eye gap ÷ eye width', higherIs: 'target_range' },
    ideal: {
      summary:
        'The classical canon says the gap equals one eye width (ratio 1.0). In one small study of young adults, most had a gap wider than the eye width.',
      male: null,
      rationale:
        'This is a drawing convention. The one published check we found in young adults found a wider gap than eye width in most people, so a ratio above 1.0 is common.',
      confidenceInIdeal: 'low',
      populationCaveat: 'Check came from a single young-adult sample from the Arabian Peninsula; other populations differ.',
    },
    scoring: {
      kind: 'range',
      lo: 0.9,
      hi: 1.3,
      tau: 0.2,
      tauRationale:
        'App-chosen tolerance around the 1.0 canon, widened upward because measured faces often exceed it. Not a measured norm.',
    },
    changeability: 'FIXED',
    weight: 0.25,
    weightRationale:
      'Smallest weight: a canon with no attractiveness evidence and a ratio of two small distances that photo error distorts easily.',
    evidence: 'CONVENTION',
    evidenceNote:
      'A classical art rule, not a result from attractiveness research. Measured faces often do not follow it.',
    sourceIds: ['face:farkas1985', 'face:alsebaei2015'],
    drivers: [],
    captureRequirements: ['frontal_neutral'],
    refusalConditions: [
      ...FRONTAL_POSE,
      ...NEUTRAL_FACE,
      'eyes closed, squinting or looking away from the lens',
      'glasses glare or thick frames covering the eye corners',
    ],
    phase: 'M1',
  },

  // ── F08 ──────────────────────────────────────────────────────────────
  {
    id: 'F08',
    category: 'face',
    name: 'Eye spacing (pupil distance ÷ face width)',
    measures: 'How far apart the eyes sit compared with the width of the face at the cheekbones.',
    howMeasured:
      'Automatic: pupil centres from the iris landmarks; face width from the left and right cheekbone points. The original study’s face-width landmarks may differ from these. ' +
      PHOTO_ERROR,
    methods: ['AUTO_FRONTAL_PHOTO'],
    scale: { unit: '% of face width', min: 35, max: 55, description: 'Pupil distance ÷ cheekbone-to-cheekbone width', higherIs: 'target_range' },
    ideal: {
      summary:
        'About 46% in the one study that found a preferred value. That study used women’s faces, and the value matched an average face.',
      male: null,
      rationale:
        'Pallett et al. (2010) found rating peaks near 46% of face width for eye spacing and 36% of face length for eye-to-mouth distance, using female faces, and noted that these match an average face. No comparable male data were found, so the result mostly says “be close to average”.',
      confidenceInIdeal: 'low',
      populationCaveat: 'White female faces rated by university students; not tested on men.',
    },
    scoring: {
      kind: 'range',
      lo: 43,
      hi: 49,
      tau: 3,
      tauRationale:
        'Average-face proxy taken from the female result and applied to men as an assumption. Tau of 3 points is wide because the value has not been tested in men.',
    },
    changeability: 'FIXED',
    weight: 0.5,
    weightRationale:
      'Downgraded from the seed weight of 1: the only evidence comes from female faces, and the result describes the average face rather than a better-than-average one.',
    evidence: 'WEAK',
    evidenceNote:
      'The preferred spacing was found with women’s faces and matches an average face. It has not been shown to hold for men.',
    sourceIds: ['face:pallett2010'],
    drivers: [],
    captureRequirements: ['frontal_neutral'],
    refusalConditions: [...FRONTAL_POSE, ...NEUTRAL_FACE, 'eyes closed, squinting or looking away from the lens'],
    phase: 'M1',
  },

  // ── F09 ──────────────────────────────────────────────────────────────
  {
    id: 'F09',
    category: 'face',
    name: 'Eye-to-mouth distance (pupils to mouth ÷ face length)',
    measures: 'How long the gap is between the eye line and the mouth, compared with the full length of the face.',
    howMeasured:
      'Automatic: pupil line and mouth line from landmarks; face length from the tapped hairline to the chin. Hairline recession changes the face length and so changes this percentage without any change in the eye-to-mouth distance. ' +
      PHOTO_ERROR,
    methods: ['AUTO_FRONTAL_PHOTO', 'MANUAL_LANDMARKS'],
    scale: { unit: '% of face length', min: 30, max: 42, description: 'Pupil line to mouth line ÷ hairline-to-chin length', higherIs: 'target_range' },
    ideal: {
      summary:
        'About 36% in the one study that found a preferred value. That study used women’s faces, and the value matched an average face.',
      male: null,
      rationale:
        'Same single source as F08 (Pallett et al. 2010), female faces only. For men the result is unknown, and the hairline-based face length makes this metric unstable.',
      confidenceInIdeal: 'low',
      populationCaveat: 'White female faces rated by university students; not tested on men.',
    },
    scoring: {
      kind: 'range',
      lo: 34,
      hi: 38,
      tau: 2.5,
      tauRationale:
        'Average-face proxy from the female result applied to men as an assumption; tau is wide because of hairline uncertainty in the face length.',
    },
    changeability: 'FIXED',
    weight: 0.25,
    weightRationale:
      'Smallest weight: female-only evidence, and face length depends on a hairline that changes with age and haircut.',
    evidence: 'WEAK',
    evidenceNote:
      'Found with women’s faces and matching an average face. There is no male data, and the hairline makes the measurement unstable.',
    sourceIds: ['face:pallett2010'],
    drivers: [],
    captureRequirements: ['frontal_neutral'],
    refusalConditions: [
      ...FRONTAL_POSE,
      ...NEUTRAL_FACE,
      'hairline not visible or not tapped by the user',
      'forehead covered by hair, hat or band',
    ],
    phase: 'M2',
  },

  // ── F10 ──────────────────────────────────────────────────────────────
  {
    id: 'F10',
    category: 'face',
    name: 'Facial width-to-height ratio (FWHR)',
    measures:
      'Cheekbone-to-cheekbone width divided by the height from the upper lip to the brow line (mid-brow). A common internet “dominance score”.',
    howMeasured:
      'Automatic: face-landmark model on the frontal neutral photo (left and right cheekbone points; mid-brow to upper lip). Refused unless head yaw, roll and pitch are near zero, because small tilts and a raised brow change the ratio. Published studies use different landmarks for the height, so their values are not directly comparable with this one. ' +
      PHOTO_ERROR,
    methods: ['AUTO_FRONTAL_PHOTO'],
    scale: { unit: 'ratio', min: 1.2, max: 2.6, description: 'Cheekbone width ÷ brow-to-upper-lip height (no units)', higherIs: 'not_applicable' },
    ideal: {
      summary:
        'No evidence-based attractiveness ideal exists. A higher FWHR is linked to how threatening or dominant a man looks, with small effects. Its link with attractiveness is mixed.',
      male: null,
      rationale:
        'A meta-analysis (Geniole et al. 2015) found FWHR larger in men, tied to perceived threat and dominance, and wider faces judged less attractive overall. One speed-dating study (Valentine et al. 2014) found wider-faced men chosen more for short-term dating. The directions disagree, so no target is claimed.',
      confidenceInIdeal: 'low',
      populationCaveat: 'Most samples are young adults from Western universities.',
    },
    scoring: {
      kind: 'range',
      lo: 1.75,
      hi: 2.05,
      tau: 0.25,
      tauRationale:
        'Unverified estimate of the typical adult-male range (about the mean ±1 SD of published values, which differ with landmark definition). It is a typical range, not an ideal, so only far-out values lose points. Replace with a measured norm.',
    },
    changeability: 'FIXED',
    changeabilityNote: 'Bone width is fixed. Face fat changes the ratio a little, and that change is tracked in F01.',
    weight: 0.25,
    weightRationale:
      'Capped at 0.25: popular in forums, but the research does not show it makes a face more attractive.',
    evidence: 'PSEUDOSCIENCE',
    evidenceNote:
      'Popular in lookmaxxing forums as a “dominance score”, but research does not show a wide ratio makes a face more attractive: one meta-analysis found wider faces rated less attractive, and one speed-dating study found the opposite for short-term dating. Treat as trivia, not a goal.',
    communityClaim: '“A facial width-to-height ratio above about 1.9 is the male ideal; wider means more dominant and more attractive.”',
    sourceIds: ['face:geniole2015', 'face:valentine2014'],
    drivers: [],
    captureRequirements: ['frontal_neutral'],
    refusalConditions: [
      ...FRONTAL_POSE,
      ...NEUTRAL_FACE,
      'brow hidden by hair or glasses frames',
      'estimated camera distance under 1.5 m',
    ],
    phase: 'M1',
  },

  // ── F11 ──────────────────────────────────────────────────────────────
  {
    id: 'F11',
    category: 'face',
    name: 'Midface ratio (pupil distance ÷ pupil-to-upper-lip height)',
    measures:
      'The distance between the pupils divided by the vertical distance from the pupil line to the upper lip. A forum-made number meant to show how compact the middle of the face is.',
    howMeasured:
      'Automatic: pupil centres and upper-lip point from the face-landmark model on the frontal neutral photo. Refused unless head pose is near zero and the mouth is closed and relaxed. ' +
      PHOTO_ERROR,
    methods: ['AUTO_FRONTAL_PHOTO'],
    scale: { unit: 'ratio', min: 0.7, max: 1.4, description: 'Pupil distance ÷ pupil-to-upper-lip height (no units)', higherIs: 'not_applicable' },
    ideal: {
      summary:
        'No ideal exists. The “about 1.0” target comes from forums, not from published research.',
      male: null,
      rationale:
        'We found no peer-reviewed study of this ratio. The nearest published work (Pallett et al. 2010) measured different distances in women’s faces and found a preferred value that matches an average face.',
      confidenceInIdeal: 'low',
    },
    scoring: { kind: 'none', reason: 'context_only' },
    changeability: 'FIXED',
    weight: 0,
    weightRationale:
      'Set to 0 (seed value 0.25): there is no peer-reviewed basis, so it is shown as trivia and does not change the score. The freed weight moves to F01 and F05.',
    evidence: 'PSEUDOSCIENCE',
    evidenceNote:
      'A number invented in lookmaxxing forums. No peer-reviewed study supports an ideal value, so it is displayed for curiosity and never scored.',
    communityClaim: '“A midface ratio of about 1.0 is ideal and a compact midface is more attractive.”',
    sourceIds: ['face:pallett2010'],
    drivers: [],
    captureRequirements: ['frontal_neutral'],
    refusalConditions: [...FRONTAL_POSE, ...NEUTRAL_FACE],
    phase: 'M1',
  },

  // ── F12 ──────────────────────────────────────────────────────────────
  {
    id: 'F12',
    category: 'face',
    name: 'Canthal tilt (angle of the eye line)',
    measures:
      'The angle of a line from the inner corner to the outer corner of each eye. Positive means the outer corner sits higher than the inner corner.',
    howMeasured:
      'Automatic: eye-corner landmarks on the frontal neutral photo, measured against the line joining the two pupils. That reference cancels head roll but can differ by 1–2° from papers that use the true horizontal. Left and right eyes are averaged. Eye corners are small targets, so landmark error moves the angle noticeably. ' +
      PHOTO_ERROR,
    methods: ['AUTO_FRONTAL_PHOTO'],
    scale: { unit: '°', min: -10, max: 15, description: 'Eye-line angle (+ = outer corner higher)', higherIs: 'target_range' },
    ideal: {
      summary:
        'No evidence-based band for men. The one rating study found a positive tilt preferred in women’s edited faces. “Hunter eyes” is internet language, not a studied category.',
      male: null,
      rationale:
        'Bashour & Geist (2007) reported that female faces edited to a larger tilt were chosen 93% of the time over unedited ones. That is one study of edited female faces: it says nothing direct about men, and it gives no degree values. The degree band used here is a typical-range assumption.',
      confidenceInIdeal: 'low',
      populationCaveat: 'Eye shape differs by ancestry; the study tested women only.',
    },
    scoring: {
      kind: 'range',
      lo: 0,
      hi: 10,
      tau: 5,
      tauRationale:
        'Typical-range assumption (most adult eyes tilt up a few degrees) with a wide tau of 5° because corner placement error is a few degrees and no male preference band exists.',
    },
    changeability: 'FIXED',
    changeabilityNote:
      'Eyelid and bone structure set the tilt. Brow position, lid swelling and photo angle change how it reads.',
    weight: 0.75,
    weightRationale:
      'Downgraded from 1: one old study on edited female faces. It stays above the smallest weights only because the eye area draws attention in every face.',
    evidence: 'WEAK',
    evidenceNote:
      'Based on one small study that edited women’s faces. Nothing shows that a particular tilt makes a man’s face more attractive, and the “hunter eyes” hype goes far beyond the data.',
    communityClaim: '“A strongly positive canthal tilt (“hunter eyes”) is the key male attractiveness trait; a negative tilt is a flaw.”',
    sourceIds: ['face:bashour2007'],
    drivers: [],
    captureRequirements: ['frontal_neutral'],
    refusalConditions: [
      ...FRONTAL_POSE,
      ...NEUTRAL_FACE,
      'eyes closed, squinting or looking away from the lens',
      'eye corners hidden by glasses frames or glare',
    ],
    phase: 'M1',
  },

  // ── F13 ──────────────────────────────────────────────────────────────
  {
    id: 'F13',
    category: 'face',
    name: 'Upper-eyelid show and hooding',
    measures:
      'How much of the upper eyelid you can see between the lash line and the brow when your eyes are open and looking straight ahead. Heavy hooding hides the lid fold.',
    howMeasured:
      'Automatic estimate from eye and brow landmarks on the frontal neutral photo (visible lid height ÷ pupil distance), checked by a self-grade against reference images: 0 = full lid visible, 1 = thin visible band, 2 = lid mostly covered, 3 = lid fully covered by a skin fold. Self-grading never gives high confidence. Camera height changes how much lid shows, so level, relaxed capture is required. ' +
      PHOTO_ERROR,
    methods: ['AUTO_FRONTAL_PHOTO', 'SELF_GRADE_REFERENCE'],
    scale: { unit: 'grade', min: 0, max: 3, description: '0 = full lid visible, 3 = fully hooded', higherIs: 'worse' },
    ideal: {
      summary:
        'No evidence-based ideal for men. Heavy hooding can make a face look tired or older. Some surgeons say low brows with fuller upper lids are common in conventionally handsome male faces, but that is opinion, not data.',
      male: null,
      rationale:
        'The one firm finding is that faces after sleep loss show more “hanging” eyelids and look more tired (Sundelin et al. 2013). Structural hooding from genes or age has no good male rating study, so the scoring only separates the extremes (grade 0–1 full marks, heavy hooding lower).',
      confidenceInIdeal: 'low',
    },
    scoring: {
      kind: 'one_sided',
      points: [
        { x: 0, y: 100 },
        { x: 1, y: 100 },
        { x: 2, y: 90 },
        { x: 3, y: 70 },
      ],
    },
    changeability: 'FIXED_BUT_VISIBILITY_CHANGEABLE',
    changeabilityNote:
      'Structure and age set the baseline. Short sleep adds lid droop and puffiness; camera height and eye openness in photos change what is visible.',
    weight: 0.5,
    weightRationale:
      'Downgraded from 1 and kept small: only the sleep-loss link is established, and the scoring of structural hooding is a judgment call.',
    evidence: 'WEAK',
    evidenceNote:
      'The only established link is between lack of sleep and droopier-looking lids. How much lid men “should” show has not been tested, so the scoring only penalises heavy hooding.',
    sourceIds: ['face:sundelin2013'],
    drivers: ['sleep', 'photo_technique'],
    captureRequirements: ['frontal_neutral'],
    refusalConditions: [
      ...FRONTAL_POSE,
      ...NEUTRAL_FACE,
      'eyes closed, squinting or looking away from the lens',
      'brows raised or lowered on purpose',
      'glasses frames or glare covering the eyelids',
    ],
    medicalFlag:
      'A drooping lid on one side only, or a lid that has newly dropped, should be checked by a doctor.',
    phase: 'M2',
  },

  // ── F14 ──────────────────────────────────────────────────────────────
  {
    id: 'F14',
    category: 'face',
    name: 'Nose width vs eye spacing (nostril width ÷ inner-eye gap)',
    measures:
      'The width of the nose at the nostrils compared with the gap between the inner corners of the eyes. The nose angles seen from the side are scored separately in F26 and F27.',
    howMeasured:
      'Automatic: nostril-edge and inner-eye-corner landmarks on the frontal neutral photo. Close cameras distort this metric the most: a model of selfie-distance photos (about 30 cm) found the nose base looks about 30% wider than at 1.5 m (Ward et al. 2018), so it is refused for close shots. ' +
      PHOTO_ERROR,
    methods: ['AUTO_FRONTAL_PHOTO'],
    scale: { unit: 'ratio', min: 0.8, max: 1.6, description: 'Nostril width ÷ inner-eye gap', higherIs: 'target_range' },
    ideal: {
      summary:
        'The classical canon says nose width equals the inner-eye gap (ratio 1.0). Small studies in other populations found most adults do not match it.',
      male: null,
      rationale:
        'A drawing and rhinoplasty convention, tested and revised by Farkas et al. (1985), who found that most faces departed from the canons. No rating study sets a male target.',
      confidenceInIdeal: 'low',
      populationCaveat: 'Norms come mostly from white North American samples; nose width differs strongly by ancestry.',
    },
    scoring: {
      kind: 'range',
      lo: 0.9,
      hi: 1.2,
      tau: 0.15,
      tauRationale:
        'App-chosen tolerance around the 1.0 canon, widened because most measured faces differ from it. Not a measured norm.',
    },
    changeability: 'SURGICAL_ONLY',
    changeabilityNote: 'Only surgery changes nose structure. Camera distance changes how wide it looks in photos.',
    weight: 0.75,
    weightRationale:
      'The nose is among the most noticed features, but this ratio is a convention and the most distortion-sensitive of the frontal metrics, so it stays mid-low.',
    evidence: 'CONVENTION',
    evidenceNote:
      'A rule from art and nose surgery, not a rating-study result. Measured faces often differ from it, and close-up photos widen the nose.',
    sourceIds: ['face:farkas1985', 'face:ward2018'],
    drivers: [],
    captureRequirements: ['frontal_neutral'],
    refusalConditions: [...FRONTAL_POSE, ...NOSE_DISTANCE, ...NEUTRAL_FACE, 'nostril edges hidden by shadow or glare'],
    phase: 'M1',
  },

  // ── F15 ──────────────────────────────────────────────────────────────
  {
    id: 'F15',
    category: 'face',
    name: 'Lip proportion (upper : lower lip height)',
    measures: 'The height of the lower lip divided by the height of the upper lip, at rest. A value of 2.0 means the lower lip is twice as tall.',
    howMeasured:
      'Automatic: lip-edge landmarks on the frontal neutral photo with lips closed and relaxed. Lip edges are small and vary with lighting, so the ratio is noisy. ' +
      PHOTO_ERROR,
    methods: ['AUTO_FRONTAL_PHOTO'],
    scale: { unit: 'ratio', min: 0.8, max: 3, description: 'Lower-lip height ÷ upper-lip height', higherIs: 'target_range' },
    ideal: {
      summary:
        'The classical canon is 1 : 1.6 (upper : lower). A rating study using women’s faces found 1 : 2. No male data were found.',
      male: null,
      rationale:
        'Popenko et al. (2017) built female face images with varied lips and found 1 : 2 preferred. Men’s lips were not tested, so the scoring band only spans the two female-based values.',
      confidenceInIdeal: 'low',
      populationCaveat: 'Young white female faces rated online; not tested on men.',
    },
    scoring: {
      kind: 'range',
      lo: 1.3,
      hi: 2.2,
      tau: 0.5,
      tauRationale:
        'App-chosen band that spans the classical 1 : 1.6 canon and the 1 : 2 female result; there is no male norm, so tau is wide.',
    },
    changeability: 'SURGICAL_ONLY',
    changeabilityNote: 'Lip structure is fixed. Expression and lighting change how lips read in photos.',
    weight: 0.5,
    weightRationale:
      'Downgraded from 1: the only rating evidence is for women’s faces.',
    evidence: 'WEAK',
    evidenceNote:
      'The one rating study found used women’s faces. There is no comparable work on men’s lips.',
    sourceIds: ['face:popenko2017'],
    drivers: [],
    captureRequirements: ['frontal_neutral'],
    refusalConditions: [
      ...FRONTAL_POSE,
      ...NEUTRAL_FACE,
      'lips visibly pursed, stretched or licked wet',
      'strong glare or shadow on the lips',
    ],
    phase: 'M1',
  },

  // ── F16 ──────────────────────────────────────────────────────────────
  {
    id: 'F16',
    category: 'face',
    name: 'Lower-third split (nose base to mouth : mouth to chin)',
    measures:
      'How the distance from the base of the nose to the chin divides at the mouth line. The classical canon puts the mouth one third of the way down.',
    howMeasured:
      'Automatic: nose-base, mouth-line and chin landmarks on the frontal neutral photo with lips closed. Reported as (mouth line to chin) ÷ (nose base to mouth line); the canon is 2.0. Mouth position moves with jaw posture, so open mouths are refused. ' +
      PHOTO_ERROR,
    methods: ['AUTO_FRONTAL_PHOTO'],
    scale: { unit: 'ratio', min: 1.2, max: 3, description: 'Mouth-to-chin height ÷ nose-base-to-mouth height', higherIs: 'target_range' },
    ideal: {
      summary:
        'The classical canon is 1 : 2. No study shows that faces closer to it are rated as more attractive.',
      male: null,
      rationale:
        'A drawing convention in the same canon family that Farkas et al. (1985) tested and revised. We did not open the paper, so whether it reports this exact split is unconfirmed.',
      confidenceInIdeal: 'low',
      populationCaveat: 'Norms come mostly from white North American samples.',
    },
    scoring: {
      kind: 'range',
      lo: 1.7,
      hi: 2.4,
      tau: 0.4,
      tauRationale:
        'App-chosen band of roughly ±20% around the 2.0 canon. Not a measured norm.',
    },
    changeability: 'FIXED',
    weight: 0.5,
    weightRationale: 'A canon with no rating evidence and a lower-face region that expression and jaw posture change.',
    evidence: 'CONVENTION',
    evidenceNote: 'A classical proportion rule, not a rating-study result.',
    sourceIds: ['face:farkas1985'],
    drivers: [],
    captureRequirements: ['frontal_neutral'],
    refusalConditions: [
      ...FRONTAL_POSE,
      ...NEUTRAL_FACE,
      'chin raised or tucked',
      'beard hiding the chin tip',
    ],
    phase: 'M1',
  },

  // ── F17 ──────────────────────────────────────────────────────────────
  {
    id: 'F17',
    category: 'face',
    name: 'Cheekbone prominence (cheekbone width ÷ jaw width)',
    measures:
      'The width of the face at the cheekbones divided by the width at the jaw corners. A higher value means the cheekbones are wider than the jaw.',
    howMeasured:
      'Automatic: cheekbone and jaw-corner landmarks on the frontal neutral photo. Reported for information only. It is the same cheek-to-jaw measurement that feeds F01, so scoring it again would count one measurement twice. ' +
      PHOTO_ERROR,
    methods: ['AUTO_FRONTAL_PHOTO'],
    scale: { unit: 'ratio', min: 1, max: 1.8, description: 'Cheekbone width ÷ jaw width', higherIs: 'not_applicable' },
    ideal: {
      summary:
        'No numeric ideal. One 1990 study found men with prominent cheekbones, large eyes, a large chin and a big smile rated more attractive.',
      male: null,
      rationale:
        'Cunningham et al. (1990) reported these male features in three quasi-experiments with 1990-era photos and raters. It does not give a ratio. The ratio itself moves with face fat (Coetzee et al. 2010), which F01 already tracks.',
      confidenceInIdeal: 'low',
      populationCaveat: 'Old, small samples from one place and time.',
    },
    scoring: { kind: 'none', reason: 'context_only' },
    changeability: 'FIXED',
    changeabilityNote:
      'Bone width is fixed. The ratio shifts with face fat, which F01 tracks.',
    weight: 0,
    weightRationale:
      'Set to 0 (seed value 0.75): it shares its measurement with F01, and the male cheekbone evidence is a single old study without a ratio. The freed weight moves to F01 and F05.',
    evidence: 'WEAK',
    evidenceNote:
      'A single 1990 study links prominent cheekbones to male attractiveness and gives no ratio. Because the ratio changes with face fat, it is shown but not scored.',
    sourceIds: ['face:cunningham1990', 'face:coetzee2010'],
    drivers: [],
    captureRequirements: ['frontal_neutral'],
    refusalConditions: [
      ...FRONTAL_POSE,
      ...NEUTRAL_FACE,
      'jaw corners hidden by beard, hair or collar',
    ],
    phase: 'M1',
  },

  // ── F18 ──────────────────────────────────────────────────────────────
  {
    id: 'F18',
    category: 'face',
    name: 'Profile convexity (brow–nose base–chin angle)',
    measures:
      'How much the face profile bulges forward or dips back between the brow, the base of the nose and the chin tip. 180° would be a perfectly straight line.',
    howMeasured:
      'Manual: on a level side-view photo you place the brow point, the nose-base point and the chin tip; the app computes the angle at the nose base. The face-landmark model is unreliable in side view, so the points are hand-placed. ' +
      PHOTO_ERROR,
    methods: ['MANUAL_LANDMARKS', 'AUTO_PROFILE_PHOTO'],
    scale: { unit: '°', min: 150, max: 190, description: 'Inside angle at the nose base (180° = straight profile)', higherIs: 'target_range' },
    ideal: {
      summary:
        'Surgical analysis (Legan & Burstone) treats about 12° ±4° of bulge as typical, which is an inside angle near 164–172°.',
      male: { lo: 164, hi: 172 },
      rationale:
        'This is an orthognathic-surgery norm from white European-American patients. The 12° ±4° value could not be confirmed against the original paper in this session; a search found a North Indian sample averaging about 13°.',
      confidenceInIdeal: 'low',
      populationCaveat: 'Original norms come from white European-American subjects and differ in other groups.',
    },
    scoring: {
      kind: 'range',
      lo: 164,
      hi: 172,
      tau: 5,
      tauRationale:
        'Band is the clinical norm; tau of 5° reflects hand-placed point error and the fact that the norm is a surgical planning value, not a rating-study optimum.',
    },
    changeability: 'FIXED',
    changeabilityNote: 'Bone-driven. Fat and beard change soft-tissue outline slightly but not the structure.',
    weight: 0.5,
    weightRationale:
      'Kept at the seed weight of 0.5: it is a surgical planning value from one population and it overlaps with chin projection (F04), so it gets no more.',
    evidence: 'CONVENTION',
    evidenceNote:
      'A surgeon’s planning norm from one population, not an attractiveness result. It also overlaps with chin position (F04).',
    sourceIds: ['face:legan1980'],
    drivers: [],
    captureRequirements: ['profile_left', 'profile_right'],
    refusalConditions: [...PROFILE_POSE, 'brow or chin tip hidden by hair or beard', 'mouth open or jaw clenched'],
    phase: 'M2',
  },

  // ── F19 ──────────────────────────────────────────────────────────────
  {
    id: 'F19',
    category: 'face',
    name: 'Lips closed at rest',
    measures:
      'Whether the lips rest together without effort when the face is relaxed. Lips held apart at rest, or closed only by tensing the chin, count as not closed.',
    howMeasured:
      'Self-grade on the neutral photo plus an automatic lip-gap check: 0 = lips closed and relaxed, 1 = closed with visible chin strain or a gap under 3 mm, 2 = lips apart by 3 mm or more. Take the photo after three relaxed breaths through the nose. ' +
      PHOTO_ERROR,
    methods: ['SELF_GRADE_REFERENCE', 'AUTO_FRONTAL_PHOTO'],
    scale: { unit: 'grade', min: 0, max: 2, description: '0 = closed and relaxed, 2 = lips apart', higherIs: 'worse' },
    ideal: {
      summary: 'Lips closed and relaxed. No rating study of this was found; it is a clinical and style convention.',
      male: { lo: 0, hi: 0 },
      rationale:
        'Lip competence is treated as part of a balanced face in orthodontics, but a search found no study that tests lips-apart against lips-closed for attractiveness. The scoring is a small habit-level penalty.',
      confidenceInIdeal: 'low',
    },
    scoring: {
      kind: 'one_sided',
      points: [
        { x: 0, y: 100 },
        { x: 1, y: 75 },
        { x: 2, y: 45 },
      ],
    },
    changeability: 'CHANGEABLE',
    changeabilityNote:
      'The resting habit and the pose in photos can change. If the lips are apart because of anatomy, habit alone will not close them.',
    weight: 0.25,
    weightRationale: 'Smallest weight: no attractiveness test found, and part of the result is anatomy.',
    evidence: 'WEAK',
    evidenceNote:
      'No study was found that rates faces with lips apart against lips closed. The idea that closed lips look better is a convention.',
    sourceIds: [],
    drivers: ['photo_technique'],
    captureRequirements: ['frontal_neutral'],
    refusalConditions: [
      ...FRONTAL_POSE,
      'expression not neutral (smiling or frowning)',
      'user reports a blocked nose or illness today',
    ],
    medicalFlag:
      'If you cannot breathe through your nose most of the time, or mouth breathing is constant, see a doctor or dentist.',
    phase: 'M2',
  },

  // ── F20 ──────────────────────────────────────────────────────────────
  {
    id: 'F20',
    category: 'face',
    name: 'Ear protrusion',
    measures: 'How far the ears stand out from the side of the head, estimated from how much of the ear rim shows past the head outline in the front view.',
    howMeasured:
      'Self-grade against reference images with an automatic check of the visible ear rim on the frontal neutral photo: 0 = ears lie flat, 1 = ears visibly out, 2 = clearly prominent. The measure cannot be taken when hair covers the ears. Surgeons measure the angle between ear and scalp (about 25–35° in one open surgical atlas); a front photo cannot measure that angle. ' +
      PHOTO_ERROR,
    methods: ['SELF_GRADE_REFERENCE', 'AUTO_FRONTAL_PHOTO'],
    scale: { unit: 'grade', min: 0, max: 2, description: '0 = flat, 2 = clearly prominent', higherIs: 'worse' },
    ideal: {
      summary: 'Ears that lie close to the head. No rating study sets a threshold; surgeons treat angles above roughly 30° as prominent.',
      male: { lo: 0, hi: 0 },
      rationale:
        'Prominent ears are a recognised reason for ear surgery, but the cut-offs come from surgeon-written sources and vary (about 20–35° across them).',
      confidenceInIdeal: 'low',
    },
    scoring: {
      kind: 'one_sided',
      points: [
        { x: 0, y: 100 },
        { x: 1, y: 80 },
        { x: 2, y: 55 },
      ],
    },
    changeability: 'FIXED_BUT_VISIBILITY_CHANGEABLE',
    changeabilityNote: 'Ear shape is fixed. Hair length and style change how visible the ears are.',
    weight: 0.25,
    weightRationale: 'Smallest weight: weak evidence, and hair can hide the feature.',
    evidence: 'WEAK',
    evidenceNote:
      'The cut-offs come from surgeons’ guides, not from rating studies, and a front photo cannot measure the true angle.',
    sourceIds: ['face:otoplasty_atlas'],
    drivers: ['haircut'],
    captureRequirements: ['frontal_neutral'],
    refusalConditions: [
      ...FRONTAL_POSE,
      'ears covered by hair, hat, headphones or glasses arms',
      'head tilted toward one shoulder',
    ],
    phase: 'M2',
  },

  // ── F21 ──────────────────────────────────────────────────────────────
  {
    id: 'F21',
    category: 'face',
    name: 'Golden ratio / “phi mask” fit',
    measures:
      'Whether the face fits Marquardt’s “phi mask”, a template built from golden-ratio (1.618) proportions. The app does not fit or score this.',
    howMeasured:
      'Not measured. The app shows this entry as a myth card only, and will not overlay or score any golden-ratio mask.',
    methods: ['COMPUTED_FROM_OTHER_METRICS'],
    scale: { unit: 'n/a', min: null, max: null, description: 'Not scored (myth)', higherIs: 'not_applicable' },
    ideal: {
      summary: 'There is no golden-ratio ideal for faces.',
      male: null,
      rationale:
        'Holland (2008) found that the mask fits masculinised white women best, suits non-European faces poorly, and conflicts with what most people prefer in a face. The one search for preferred face proportions (Pallett et al. 2010) found values that match an average face, not 1.618.',
      confidenceInIdeal: 'low',
    },
    scoring: { kind: 'none', reason: 'myth' },
    changeability: 'FIXED',
    weight: 0,
    weightRationale: 'Myth: no weight at any level.',
    evidence: 'MYTH',
    evidenceNote:
      'The golden-ratio face mask has no support as a beauty standard. It was built from selected photos of fashion models, and the independent test of it found it fits some groups poorly and conflicts with what most people prefer. Any “score” from it is meaningless.',
    communityClaim:
      '“Faces that fit the golden ratio or the phi mask are the most beautiful; measure your face against the mask to see how close you are.”',
    sourceIds: ['face:holland2008', 'face:pallett2010'],
    drivers: [],
    captureRequirements: ['frontal_neutral'],
    refusalConditions: [],
    phase: 'M1',
  },

  // ── F22 ──────────────────────────────────────────────────────────────
  {
    id: 'F22',
    category: 'face',
    name: 'Philtrum length (nose base to upper-lip edge)',
    measures:
      'The length of the groove between the base of the nose and the upper-lip edge, as a percent of the distance between the pupils.',
    howMeasured:
      'Automatic: nose-base and upper-lip-edge landmarks on the frontal neutral photo with lips closed and relaxed, divided by pupil distance so the camera scale cancels. This is a short distance (two small studies reported roughly 16 mm in adult men), so a one-pixel landmark error is a large share of it and a smile or a raised lip changes it. No philtrum-to-lip ratio is scored, because we found no evidence for one. ' +
      PHOTO_ERROR,
    methods: ['AUTO_FRONTAL_PHOTO'],
    scale: { unit: '% of pupil distance', min: 15, max: 40, description: 'Nose base to upper-lip edge ÷ pupil distance', higherIs: 'target_range' },
    ideal: {
      summary:
        'No evidence-based ideal. Two small studies put adult male philtrum length near 16 mm, which is about 25% of a typical 64 mm pupil distance.',
      male: null,
      rationale:
        'The ~16 mm figure comes from search summaries of two small samples that were not opened, and the pupil distance is a survey mean. We found no rating study tying male philtrum length to attractiveness. A government morphology reference notes that distances this short are measured inaccurately.',
      confidenceInIdeal: 'low',
      populationCaveat: 'Two small, mixed-ancestry samples; definitions of the endpoints differ between sources.',
    },
    scoring: {
      kind: 'range',
      lo: 20,
      hi: 30,
      tau: 4,
      tauRationale:
        'Typical-range assumption around 25% (about 16 mm ÷ 64 mm), not an ideal. Tau is wide because photo error is large for such a short distance.',
    },
    changeability: 'FIXED',
    weight: 0.25,
    weightRationale: 'Smallest weight: no attractiveness evidence for men and a very error-prone short distance.',
    evidence: 'WEAK',
    evidenceNote:
      'No study was found linking men’s philtrum length to attractiveness. The metric describes where you sit in a typical range and nothing more.',
    sourceIds: ['face:nih_philtrum', 'face:dodgson2004'],
    drivers: [],
    captureRequirements: ['frontal_neutral'],
    refusalConditions: [
      ...FRONTAL_POSE,
      ...NEUTRAL_FACE,
      'moustache or stubble hiding the upper-lip edge',
      'nose base hidden by shadow',
    ],
    phase: 'M1',
  },

  // ── F23 ──────────────────────────────────────────────────────────────
  {
    id: 'F23',
    category: 'face',
    name: 'Interpupillary distance, absolute (mm)',
    measures:
      'The distance between the centres of the two pupils in millimetres. It is the size reference the app uses to turn pixels into millimetres for other face measurements. It is not an attractiveness score.',
    howMeasured:
      'Automatic: pixel distance between the two iris centres, converted to millimetres using the iris diameter (about 11–12.5 mm in 95% of adults according to one source; one study using a fixed iris reference was off by about 3–4% on average). A value you measure yourself (a ruler against a mirror, or an eye-test record) replaces the estimate and is more accurate. ' +
      PHOTO_ERROR,
    methods: ['AUTO_FRONTAL_PHOTO', 'MANUAL_INPUT'],
    scale: { unit: 'mm', min: 50, max: 80, description: 'Pupil-centre to pupil-centre distance', higherIs: 'not_applicable' },
    ideal: {
      summary:
        'No ideal. Adult male means are about 64–65 mm (spread about 3.5 mm), and values differ by ancestry.',
      male: null,
      rationale:
        'Two datasets reported through secondary sources put adult male means at 64.0–64.7 mm. This is a size reference, so a “better” value does not exist.',
      confidenceInIdeal: 'low',
      populationCaveat: 'Averages differ between ancestry groups; the app does not assume one.',
    },
    scoring: { kind: 'none', reason: 'context_only' },
    changeability: 'FIXED',
    weight: 0,
    weightRationale: 'Context only: used to scale other measurements, never scored.',
    evidence: 'MODERATE',
    evidenceNote:
      'Population means come from anthropometric surveys, and iris-based scaling is accurate to a few percent on average, not exactly. A directly measured value is better than the estimate.',
    sourceIds: ['face:dodgson2004', 'face:iris_scale2023'],
    drivers: [],
    captureRequirements: ['frontal_neutral'],
    refusalConditions: [
      ...FRONTAL_POSE,
      'iris not detected in both eyes',
      'eyes closed, squinting or looking away from the lens',
      'coloured or tinted contact lenses, or glasses glare over the iris',
    ],
    phase: 'M1',
  },

  // ── F24 ──────────────────────────────────────────────────────────────
  {
    id: 'F24',
    category: 'face',
    name: 'Brow position (brow-to-eye distance)',
    measures:
      'The vertical distance from the middle of the pupil to the lower edge of the eyebrow, as a percent of the pupil distance. Low brows sit close to the eyes; high brows leave more lid and forehead showing.',
    howMeasured:
      'Automatic from brow and iris landmarks on the frontal neutral photo with the face relaxed. Raising or lowering the brows even slightly changes the reading, so expression is checked; plucked or shaved brows change the lower edge (see H07). ' +
      PHOTO_ERROR,
    methods: ['AUTO_FRONTAL_PHOTO'],
    scale: { unit: '% of pupil distance', min: 15, max: 60, description: 'Pupil centre to lower brow edge ÷ pupil distance', higherIs: 'not_applicable' },
    ideal: {
      summary:
        'No verified male band. Photogrammetric studies find men’s brows sit lower than women’s, and brow height changes how tired, surprised or stern a face looks.',
      male: null,
      rationale:
        'Studies confirm brows differ by sex and that eyebrows matter for how faces are recognised and read (Packiriswamy et al. 2013; Sadr et al. 2003). We found no study that says which brow height is rated best in men, so no band is claimed.',
      confidenceInIdeal: 'low',
      populationCaveat: 'Measurement studies we found used South Indian and Malaysian Indian young adults.',
    },
    scoring: { kind: 'none', reason: 'deferred' },
    changeability: 'FIXED',
    changeabilityNote:
      'Bone and skin set resting brow height. Grooming changes the visible lower edge (H07); lighting and expression change the reading.',
    weight: 0,
    weightRationale:
      'Tracked, not scored, until a defensible male band exists. Brow grooming itself is scored under H07.',
    evidence: 'WEAK',
    evidenceNote:
      'Studies show brows differ by sex and matter to how faces are read, but none says what brow height men should have. So this is tracked and not scored.',
    sourceIds: ['face:packiriswamy2013', 'face:sadr2003'],
    drivers: [],
    captureRequirements: ['frontal_neutral'],
    refusalConditions: [
      ...FRONTAL_POSE,
      ...NEUTRAL_FACE,
      'brows raised, lowered or squeezed on purpose',
      'brows hidden by hair or glasses frames',
    ],
    phase: 'M2',
  },

  // ── F25 ──────────────────────────────────────────────────────────────
  {
    id: 'F25',
    category: 'face',
    name: 'Face-shape label (oval, round, square, oblong…)',
    measures:
      'A rough label for the overall outline of the face, taken from the ratios of face length, cheekbone width, jaw width and forehead width. Used only by haircut and beard rules.',
    howMeasured:
      'Computed from frontal landmarks: face length ÷ cheekbone width, jaw width ÷ cheekbone width, and forehead width ÷ cheekbone width, with fixed cut-offs, with the hair pulled back. Category boundaries are stylist convention, so faces near a boundary get a “between shapes” label instead of being forced into one. ' +
      PHOTO_ERROR,
    methods: ['AUTO_FRONTAL_PHOTO', 'COMPUTED_FROM_OTHER_METRICS'],
    scale: { unit: 'category', min: null, max: null, description: 'One of oval, round, square, oblong, heart, diamond, or between shapes', higherIs: 'not_applicable' },
    ideal: {
      summary: 'No ideal: it is a label, not a quality.',
      male: null,
      rationale:
        'Stylist rules link face shapes to cuts and beards. The published work we found trains software to reproduce expert shape labels; none tests whether following the matching rule makes a haircut look better.',
      confidenceInIdeal: 'low',
    },
    scoring: { kind: 'none', reason: 'context_only' },
    changeability: 'FIXED',
    weight: 0,
    weightRationale: 'Context only: it feeds haircut rules and is never scored.',
    evidence: 'CONVENTION',
    evidenceNote:
      'A stylist convention. No study was found showing that matching a cut to face shape raises rated attractiveness, so haircut rules that use it (H04) are styling advice, not science.',
    sourceIds: [],
    drivers: [],
    captureRequirements: ['frontal_neutral'],
    refusalConditions: [
      ...FRONTAL_POSE,
      ...NEUTRAL_FACE,
      'forehead or jaw outline hidden by hair, hat or beard',
    ],
    phase: 'M2',
  },

  // ── F26 ──────────────────────────────────────────────────────────────
  {
    id: 'F26',
    category: 'face',
    name: 'Nasolabial angle (nose tip to upper lip, side view)',
    measures:
      'The angle between the underside of the nose and the upper lip, seen from the side. It describes how far the nose tip points up or down.',
    howMeasured:
      'Manual: on a level side-view photo you place a point on the nose tip, the base of the nose and the upper-lip edge. The app computes the angle at the nose base. A small up or down tilt of the head changes this angle directly, so pitch is checked. ' +
      PHOTO_ERROR,
    methods: ['MANUAL_LANDMARKS'],
    scale: { unit: '°', min: 70, max: 130, description: 'Angle at the base of the nose', higherIs: 'target_range' },
    ideal: {
      summary:
        'Nose-surgery convention gives 90–95° for men and 95–110° for women. It is a surgeon’s aim, not a rating-study result.',
      male: { lo: 90, hi: 95 },
      rationale:
        'Powell & Humphreys (1984) is the usual source, as quoted in later papers; the original book was not opened. We found no rating study confirming that lay raters prefer these values.',
      confidenceInIdeal: 'low',
      populationCaveat: 'Norms come from white patients; the angle differs by ancestry.',
    },
    scoring: {
      kind: 'range',
      lo: 90,
      hi: 95,
      tau: 10,
      tauRationale:
        'The convention is narrow, but hand-placed points on a profile photo add error of a few degrees and the band comes from surgeons rather than rating data, so tau is wide at 10°.',
    },
    changeability: 'SURGICAL_ONLY',
    weight: 0.5,
    weightRationale: 'A clinical convention for a feature the eye notices in profile; kept small because no rating data support the band.',
    evidence: 'CONVENTION',
    evidenceNote: 'A nose-surgery planning value, not an attractiveness result.',
    sourceIds: ['face:powell1984'],
    drivers: [],
    captureRequirements: ['profile_left', 'profile_right'],
    refusalConditions: [...PROFILE_POSE, 'nose tip or upper lip hidden by moustache or hair', 'mouth open or lip raised'],
    phase: 'M2',
  },

  // ── F27 ──────────────────────────────────────────────────────────────
  {
    id: 'F27',
    category: 'face',
    name: 'Nasofrontal angle (forehead to nose bridge, side view)',
    measures:
      'The angle between the forehead and the line of the nose bridge, seen from the side at the dip between the brows. It describes how deep that dip is.',
    howMeasured:
      'Manual: on a level side-view photo you place a point on the forehead, at the dip between the brows, and on the nose bridge. The app computes the angle at the dip. Heavy brows or shadow make the dip hard to place. ' +
      PHOTO_ERROR,
    methods: ['MANUAL_LANDMARKS'],
    scale: { unit: '°', min: 100, max: 150, description: 'Angle at the dip between the brows', higherIs: 'target_range' },
    ideal: {
      summary:
        'Nose-surgery convention gives roughly 115–130° (sources differ at the upper end). It is a surgeon’s aim, not a rating-study result.',
      male: { lo: 115, hi: 130 },
      rationale:
        'Quoted from secondary sources of the Powell & Humphreys norms; a male-specific value and the upper limit (some sources say 135°) were not confirmed.',
      confidenceInIdeal: 'low',
      populationCaveat: 'Norms come from white patients; brow-ridge shape differs by ancestry and by sex.',
    },
    scoring: {
      kind: 'range',
      lo: 115,
      hi: 130,
      tau: 8,
      tauRationale:
        'Convention band with allowance for hand-placed point error and source disagreement about the upper limit.',
    },
    changeability: 'SURGICAL_ONLY',
    weight: 0.25,
    weightRationale: 'Smallest weight: unconfirmed male band and a hard-to-place landmark.',
    evidence: 'CONVENTION',
    evidenceNote: 'A nose-surgery planning value with source disagreement, not an attractiveness result.',
    sourceIds: ['face:powell1984'],
    drivers: [],
    captureRequirements: ['profile_left', 'profile_right'],
    refusalConditions: [...PROFILE_POSE, 'forehead covered by hair', 'brow dip hidden by glasses frames'],
    phase: 'M2',
  },

  // ── F28 ──────────────────────────────────────────────────────────────
  {
    id: 'F28',
    category: 'face',
    name: 'Averageness (distance from the average male face)',
    measures:
      'How close your face shape is to the average face shape of adult men, compared point by point after the faces are aligned.',
    howMeasured:
      'Deferred. It needs a reference average built from many measured adult male faces. The app has no such reference at launch, so this is not scored.',
    methods: ['AUTO_FRONTAL_PHOTO', 'COMPUTED_FROM_OTHER_METRICS'],
    scale: { unit: 'index', min: null, max: null, description: 'Shape distance from the reference average (smaller = closer)', higherIs: 'worse' },
    ideal: {
      summary:
        'Closer to average is rated as more attractive in blended-face studies. No score is possible without a reference population.',
      male: null,
      rationale:
        'Langlois & Roggman (1990) found blended faces rated more attractive than most of the individual faces they were made from, and a review (Rhodes 2006) finds averageness appealing in men and women. What counts as “average” depends on the reference group.',
      confidenceInIdeal: 'low',
      populationCaveat: 'The reference group decides the answer; most studies used young white adults.',
    },
    scoring: { kind: 'none', reason: 'deferred' },
    changeability: 'FIXED',
    weight: 0,
    weightRationale: 'Deferred: cannot be computed honestly without a reference population.',
    evidence: 'MODERATE',
    evidenceNote:
      'Blended faces are rated as more attractive than most real faces. Blends also look smoother and more symmetric than real faces, so shape alone may not explain the effect, and “average” depends on who is in the reference group.',
    sourceIds: ['face:langlois1990', 'face:rhodes2006'],
    drivers: [],
    captureRequirements: ['frontal_neutral'],
    refusalConditions: [...FRONTAL_POSE, ...NEUTRAL_FACE],
    phase: 'V3',
  },

  // ── F29 ──────────────────────────────────────────────────────────────
  {
    id: 'F29',
    category: 'face',
    name: 'Facial masculinity (how male-typical the face shape is)',
    measures:
      'How strongly the face follows the typical male pattern (wider jaw and brow, longer lower face) compared with the typical female pattern.',
    howMeasured:
      'Deferred. It needs a reference set of measured male and female faces to compute a masculinity axis. The app has none at launch, so this is not scored.',
    methods: ['AUTO_FRONTAL_PHOTO', 'COMPUTED_FROM_OTHER_METRICS'],
    scale: { unit: 'index', min: null, max: null, description: 'Position on the female-to-male shape axis', higherIs: 'not_applicable' },
    ideal: {
      summary:
        'No ideal. Studies disagree on whether more masculine male faces are rated as more attractive, and masculine faces are also judged more aggressive.',
      male: null,
      rationale:
        'A review (Rhodes 2006) reports that sex-typical shape appeals in both sexes, while a 12-population study (Scott et al. 2014) found preferences for exaggerated masculinity mainly in highly developed, urban settings. Preference depends on culture and context.',
      confidenceInIdeal: 'low',
      populationCaveat: 'Preferences differ by culture, setting and who is judging.',
    },
    scoring: { kind: 'none', reason: 'deferred' },
    changeability: 'FIXED',
    weight: 0,
    weightRationale: 'Deferred: no reference set at launch, and the preference direction is context-dependent.',
    evidence: 'WEAK',
    evidenceNote:
      'Studies disagree and the preference changes with culture and setting. It is tracked for information and never treated as a goal.',
    sourceIds: ['face:scott2014', 'face:rhodes2006'],
    drivers: [],
    captureRequirements: ['frontal_neutral'],
    refusalConditions: [...FRONTAL_POSE, ...NEUTRAL_FACE],
    phase: 'V3',
  },

  // ── F30 ──────────────────────────────────────────────────────────────
  {
    id: 'F30',
    category: 'face',
    name: 'Lip position vs nose–chin line (E-line, side view)',
    measures:
      'How far the lips sit behind or in front of a straight line drawn from the nose tip to the chin tip, seen from the side. Negative means behind the line.',
    howMeasured:
      'Manual: on a level side-view photo you mark the nose tip, chin tip, and the most forward point of the upper and lower lip. The app reports the average of the two lip distances to the line in mm, scaled from iris size. ' +
      PHOTO_ERROR,
    methods: ['MANUAL_LANDMARKS'],
    scale: { unit: 'mm', min: -12, max: 6, description: 'Average lip distance to the nose–chin line (+ = in front)', higherIs: 'target_range' },
    ideal: {
      summary:
        'The orthodontic convention puts the upper lip about 4 mm and the lower lip about 2 mm behind the line in an average white adult, which averages about −3 mm.',
      male: { lo: -5, hi: -1 },
      rationale:
        'Ricketts (1968) set the line. The norms come through secondary sources and shift with ancestry and with fashion toward fuller lips, so they are not a fixed target.',
      confidenceInIdeal: 'low',
      populationCaveat: 'Norms come from white Caucasian averages; other groups, and current tastes, differ.',
    },
    scoring: {
      kind: 'range',
      lo: -5,
      hi: -1,
      tau: 3,
      tauRationale:
        'Band is the average of the two published lip norms ±2 mm; tau of 3 mm covers hand-placed point and scale error.',
    },
    changeability: 'FIXED',
    changeabilityNote: 'Set by nose, lip and chin structure. Beard and lip tension change the outline in photos.',
    weight: 0.25,
    weightRationale: 'Smallest weight: an orthodontic convention that overlaps with chin projection (F04) and varies with ancestry and fashion.',
    evidence: 'CONVENTION',
    evidenceNote: 'An orthodontic planning convention that shifts with ancestry and fashion, not an attractiveness result.',
    sourceIds: ['face:ricketts1968'],
    drivers: [],
    captureRequirements: ['profile_left', 'profile_right'],
    refusalConditions: [...PROFILE_POSE, 'lips pursed, open or tensed', 'beard or moustache hiding the lip outline'],
    phase: 'M2',
  },
]

// ───────────────────────── sources ─────────────────────────

export const sources: Source[] = [
  {
    id: 'face:coetzee2009',
    kind: 'peer_reviewed',
    citation: 'Coetzee, V., Perrett, D. I., & Stephen, I. D. (2009). Facial adiposity: A cue to health? Perception, 38(11), 1700–1711.',
    url: 'https://doi.org/10.1068/p6423',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A web search on 2026-10-10 returned a summary consistent with the citation and DOI. It reported that perceived facial adiposity predicts perceived health and attractiveness and relates to measures such as BMI, blood pressure and frequency of colds and flu. That is a search summary, not the record. Check the sample (faces, sex, raters) before setting verified:true.',
    supports: 'Faces that look heavier are rated as less healthy and less attractive; facial adiposity is a health cue.',
  },
  {
    id: 'face:coetzee2010',
    kind: 'peer_reviewed',
    citation: 'Coetzee, V., Chen, J., Perrett, D. I., & Stephen, I. D. (2010). Deciphering faces: Quantifiable visual cues to weight. Perception, 39(1), 51–61.',
    url: 'https://doi.org/10.1068/p6560',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A web search on 2026-10-10 returned a summary of the abstract: the face width-to-height ratio, perimeter-to-area ratio and cheek-to-jaw-width ratio related to BMI (all three in males), and observers used all three cues to judge weight. That is a search summary, not the record.',
    supports: 'Perimeter-to-area and cheek-to-jaw width ratios in a face photo track BMI and are used by observers to judge weight.',
  },
  {
    id: 'face:rerule2016',
    kind: 'peer_reviewed',
    citation: 'Re, D. E., & Rule, N. O. (2016). Heavy Matters (full subtitle not confirmed in this session). Social Psychological and Personality Science.',
    url: 'https://rule.psych.utoronto.ca/pubs/2016/Re&Rule(2016_SPPS).pdf',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A web search on 2026-10-10 returned summaries stating that about 1.33 BMI points of face weight was noticeable and about 2.59 BMI points (men) and 2.38 (women) was needed for faces to be judged more attractive, using digitally altered photos of faces aged 20–40. The exact title wording and journal volume were not confirmed.',
    supports: 'How much face weight change is noticeable and how much is needed before a face is rated more attractive.',
  },
  {
    id: 'face:ellenbogen1980',
    kind: 'peer_reviewed',
    citation: 'Ellenbogen, R., & Karlin, J. V. (1980). Visual criteria for success in restoring the youthful neck. Plastic and Reconstructive Surgery, 66, 826–837.',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A web search on 2026-10-10 found the citation (volume and pages) in a reference list and several secondary sources attributing the 105–120° cervicomental angle to this paper. The original text was not seen, so the wording and sample of the criterion are unconfirmed. No URL was recorded because none was seen for the original.',
    supports: 'A cervicomental angle of about 105–120° as a surgical standard for a youthful neck.',
  },
  {
    id: 'face:gonzalezulloa1962',
    kind: 'convention',
    citation: 'Gonzalez-Ulloa, M. (1962). Original description of the “zero meridian” profile reference line, as cited in later profile-analysis literature (exact title and pages not confirmed in this session).',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A web search on 2026-10-10 found later papers describing the zero meridian as a line perpendicular to the Frankfort plane through the nasion, with the ideal chin on or just behind it, and dating the origin to Gonzalez-Ulloa in 1962. No URL was recorded.',
    supports: 'The zero-meridian line used as the chin-projection reference, with the ideal chin on or just behind it.',
  },
  {
    id: 'face:profile_review2021',
    kind: 'peer_reviewed',
    citation: 'Laypeople’s perception of facial profile aesthetics: a systematic review. Journal of Aligner Orthodontics (2021). Authors not confirmed in this session.',
    url: 'https://admin.quintessence-publishing.com/anz/en/article/1128713/journal-of-aligner-orthodontics/2021/01/laypeoples-perception-of-facial-profile-aesthetics-a-systematic-review',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A web search on 2026-10-10 returned a summary: across included studies straight profiles were considered most appealing in men and a retruded chin preferred in women, adult observers preferred more retruded profiles than younger ones, and acceptability thresholds could not be set because measurements differed. That is a search summary, not the review.',
    supports: 'In men a straight profile is rated most appealing, and firm chin-position cut-offs could not be set.',
  },
  {
    id: 'face:rhodes2006',
    kind: 'peer_reviewed',
    citation: 'Rhodes, G. (2006). The evolutionary psychology of facial beauty. Annual Review of Psychology, 57, 199–226.',
    url: 'https://doi.org/10.1146/annurev.psych.57.102904.190208',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A web search on 2026-10-10 found the citation, DOI and a summary of the abstract: averageness, symmetry and sexual dimorphism were each found attractive in male and female faces across cultures in the review’s meta-analyses, with debate over whether these are adaptations or by-products. Effect sizes were not seen.',
    supports: 'Symmetry, averageness and sex-typical shape are rated as more attractive in men and women; the health-signal explanation is debated.',
  },
  {
    id: 'face:farkas1985',
    kind: 'peer_reviewed',
    citation: 'Farkas, L. G., Hreczko, T. A., Kolar, J. C., & Munro, I. R. (1985). Vertical and horizontal proportions of the face in young adult North American Caucasians: revision of neoclassical canons. Plastic and Reconstructive Surgery, 75, 328–337.',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A web search on 2026-10-10 found the citation (a publisher listing gave pages 328–337) and secondary descriptions that the paper tested the neoclassical canons against measured young adults and revised them. The paper’s own numbers (for example the share of faces matching each canon, or the exact lower-third and nose-width canons) were not seen. No URL was recorded.',
    supports: 'The neoclassical facial canons (equal thirds, fifths and others) were tested against measured faces and revised because most faces did not match.',
  },
  {
    id: 'face:alsebaei2015',
    kind: 'peer_reviewed',
    citation: 'Al-Sebaei, M. O. (2015). Study of the neoclassical facial canons in young adults of Arabian Peninsula origin (exact title not confirmed in this session). Head & Face Medicine, 11, 4.',
    url: 'https://head-face-med.biomedcentral.com/articles/10.1186/s13005-015-0064-y',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A web search on 2026-10-10 returned a summary: 168 dental students aged 20–24, the upper, middle and lower facial thirds were not equal, and the most frequent departure from the orbital canon was an inner-eye gap wider than the eye width. That is a search summary, not the paper.',
    supports: 'In one young-adult sample, facial thirds were unequal and the inner-eye gap was usually wider than the eye width.',
  },
  {
    id: 'face:pallett2010',
    kind: 'peer_reviewed',
    citation: 'Pallett, P. M., Link, S., & Lee, K. (2010). New “golden” ratios for facial beauty. Vision Research, 50(2), 149–154.',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2814183',
    verified: false,
    verificationNote:
      NOFETCH +
      ' The PMC address above is the one a web search returned on 2026-10-10 but it could not be opened. Search summaries agree that attractiveness peaked when the eye-to-mouth distance was about 36% of face length and the eye spacing about 46% of face width, using female faces rated by university students in paired comparisons, and that the authors said the values match an average face. How face length was defined is unconfirmed.',
    supports: 'Preferred eye spacing (about 46% of face width) and eye-to-mouth distance (about 36% of face length), found in female faces and matching an average face.',
  },
  {
    id: 'face:geniole2015',
    kind: 'peer_reviewed',
    citation: 'Geniole, S. N., Denson, T. F., Dixson, B. J., Carré, J. M., & McCormick, C. M. (2015). Evidence from meta-analyses of the facial width-to-height ratio as an evolved cue of threat. PLoS ONE, 10(7), e0132726.',
    url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4504483/',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A web search on 2026-10-10 returned a summary of the abstract: FWHR was larger in men (small effect), predicted threat and dominance behaviour weakly, was strongly tied to perceived threat and dominance, and larger FWHR was judged less attractive (r about -0.26), especially by women. Those figures were not checked against the paper.',
    supports: 'FWHR relates to perceived threat and dominance with small behavioural effects, and wider faces were judged less attractive on average.',
  },
  {
    id: 'face:valentine2014',
    kind: 'peer_reviewed',
    citation: 'Valentine, K. A., et al. (2014). Judging a man by the width of his face: The role of facial ratios and dominance in mate choice at speed-dating events. Psychological Science.',
    url: 'https://research-portal.st-andrews.ac.uk/en/publications/judging-a-man-by-the-width-of-his-face-the-role-of-facial-ratios-/',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A web search on 2026-10-10 returned a summary: men with a higher FWHR were perceived as more dominant and were more likely to be chosen for a second date, and judged more attractive for short-term but not long-term relationships. The full author list and volume were not confirmed.',
    supports: 'Wider male faces were chosen more for short-term dating in one speed-dating study, so the attractiveness link is mixed.',
  },
  {
    id: 'face:bashour2007',
    kind: 'peer_reviewed',
    citation: 'Bashour, M., & Geist, C. E. (2007). Is medial canthal tilt a powerful cue for facial attractiveness? Ophthalmic Plastic and Reconstructive Surgery, 23(1).',
    url: 'https://hsrc.himmelfarb.gwu.edu/smhs_ophthalm_facpubs/302',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A web search on 2026-10-10 returned a summary: a forced-choice experiment with female faces edited to exaggerate medial canthal tilt, which won 93% of the time. The search could not confirm any degree thresholds and the study covered only women. Page numbers were not confirmed.',
    supports: 'A larger positive canthal tilt was preferred in edited female faces; no male data.',
  },
  {
    id: 'face:sundelin2013',
    kind: 'peer_reviewed',
    citation: 'Sundelin, T., et al. (2013). Cues of fatigue: effects of sleep deprivation on facial appearance. Sleep.',
    url: 'https://research.vu.nl/en/publications/cues-of-fatigue-effects-of-sleep-deprivation-on-facial-appearance/',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A web search on 2026-10-10 returned a summary: 40 observers rated photos of 10 people after normal sleep and after 31 hours awake, and sleep-deprived faces had more hanging eyelids, redder and more swollen eyes, darker circles and paler skin. The full author list and volume were not confirmed.',
    supports: 'Sleep loss makes faces show more hanging eyelids and look more tired.',
  },
  {
    id: 'face:ward2018',
    kind: 'peer_reviewed',
    citation: 'Ward, B., Ward, M., Fried, O., & Paskhover, B. (2018). Nasal distortion in short-distance photographs: The selfie effect. JAMA Facial Plastic Surgery.',
    url: 'https://doi.org/10.1001/jamafacial.2018.0009',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A web search on 2026-10-10 returned summaries: a mathematical model in which a photo taken at about 30 cm makes the nasal base look about 30% wider, relative to cheekbone width, than a photo at 1.5 m. It is a model and a short research letter. Volume and pages were not confirmed.',
    supports: 'Close-range photos widen the nose relative to the rest of the face, so close shots are refused.',
  },
  {
    id: 'face:powell1984',
    kind: 'textbook',
    citation: 'Powell, N., & Humphreys, B. (1984). Proportions of the Aesthetic Face. New York: Thieme-Stratton.',
    url: 'https://find.library.upenn.edu/catalog/991134533503681',
    verified: false,
    verificationNote:
      NOFETCH +
      ' The URL is a library catalogue entry that a web search returned on 2026-10-10; the book itself was not seen. Two secondary papers quote 90–95° (men) and 95–110° (women) for the nasolabial angle; one Spanish-language source gave 115–130° for the nasofrontal angle with no sex split. The male nasofrontal value is unconfirmed.',
    supports: 'Nose-surgery norms for the nasolabial angle (90–95° in men) and the nasofrontal angle (about 115–130°).',
  },
  {
    id: 'face:popenko2017',
    kind: 'peer_reviewed',
    citation: 'Popenko, N. A., et al. (2017). A quantitative approach to determining the ideal female lip aesthetic and its effect on facial attractiveness. JAMA Facial Plastic Surgery, 19(4), 261–267.',
    url: 'https://doi.org/10.1001/jamafacial.2016.2049',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A web search on 2026-10-10 returned the citation and DOI and a summary: synthetic images of 20 young white women’s faces, an online panel of 428 raters, an ideal upper : lower lip ratio of 1 : 2. The classical 1 : 1.6 figure is not this study’s result. Full author list not confirmed.',
    supports: 'In female faces, an upper : lower lip ratio of 1 : 2 was preferred; no male data.',
  },
  {
    id: 'face:cunningham1990',
    kind: 'peer_reviewed',
    citation: 'Cunningham, M. R., Barbee, A. P., & Pike, C. L. (1990). What do women want? Facialmetric assessment of multiple motives in the perception of male facial physical attractiveness. Journal of Personality and Social Psychology, 59(1), 61–72.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/2213490/',
    verified: false,
    verificationNote:
      NOFETCH +
      ' The PubMed address is the one a web search returned on 2026-10-10 but it could not be opened. The search summary of the abstract: three quasi-experiments found men with large eyes, prominent cheekbones, a large chin, a big smile and high-status clothing rated more attractive. No ratio was reported.',
    supports: 'Prominent cheekbones were among the male features linked with higher attractiveness ratings in 1990 studies.',
  },
  {
    id: 'face:legan1980',
    kind: 'peer_reviewed',
    citation: 'Legan, H. L., & Burstone, C. J. (1980). Soft tissue cephalometric analysis for orthognathic surgery. Journal of Oral Surgery, 38(10), 744–751.',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A web search on 2026-10-10 found this citation (volume, issue, pages) in a journal reference list and confirmed that the analysis measures facial convexity at the glabella–subnasale–pogonion angle. The 12° ±4° norm was not confirmed; one search result reported a North Indian sample averaging about 13°, and another said the original norms came from white European-American subjects. No URL was recorded.',
    supports: 'A surgical soft-tissue norm for facial convexity (about 12° ±4°) from white European-American subjects.',
  },
  {
    id: 'face:holland2008',
    kind: 'peer_reviewed',
    citation: 'Holland, E. (2008). Marquardt’s Phi mask: pitfalls of relying on fashion models and the golden ratio to describe a beautiful face. Aesthetic Plastic Surgery, 32, 200–208.',
    url: 'https://link.springer.com/doi/10.1007/s00266-007-9080-z',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A web search on 2026-10-10 returned the citation and DOI and a summary of the abstract: the mask’s goodness-of-fit method is faulty, the mask suits non-European faces (especially sub-Saharan African and East Asian) poorly, it best matches masculinised white women, and it conflicts with what most people prefer in a face. That is a search summary, not the paper.',
    supports: 'The golden-ratio phi mask is not a valid beauty standard.',
  },
  {
    id: 'face:otoplasty_atlas',
    kind: 'textbook',
    citation: 'Open Access Atlas of Otolaryngology, Head & Neck Operative Surgery: Otoplasty surgical technique (University of Cape Town). Authors not confirmed in this session.',
    url: 'https://med.libretexts.org/Bookshelves/Anatomy_and_Physiology/Atlas_of_Otolaryngology_Head_and_Neck_Operative_Surgery/02%3A_Otology/2.15%3A_Otoplasty_Surgical_Technique',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A web search on 2026-10-10 returned a summary: the atlas gives an auriculocephalic angle of about 25–35° and ear-to-scalp distances of 10–12 mm (top), 16–18 mm (middle) and 20–22 mm (lobe). Practice websites gave narrower or older ranges (15–30°), so cut-offs are approximate.',
    supports: 'Surgeons’ approximate normal range for ear angle (about 25–35°) used to define prominent ears.',
  },
  {
    id: 'face:nih_philtrum',
    kind: 'government_or_standards',
    citation: 'NIH Elements of Morphology (NHGRI). Anatomy of the philtrum. Standard terminology reference.',
    url: 'https://elementsofmorphology.nih.gov/anatomy-philtrum.shtml',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A web search on 2026-10-10 returned a summary of the page: it defines the philtrum between the base of the nose and the upper-lip edge, notes that short soft-tissue distances like nasolabial length are measured inaccurately, and lists Farkas norms only for ages 1–18. The adult male values near 16 mm (two small studies) came from search snippets and are not recorded as sources here.',
    supports: 'Philtrum anatomy, and that very short facial distances are measured with large relative error.',
  },
  {
    id: 'face:dodgson2004',
    kind: 'peer_reviewed',
    citation: 'Dodgson, N. A. (2004). Variation and extrema of human interpupillary distance. Proceedings of SPIE, 5291, 36–46.',
    url: 'https://doi.org/10.1117/12.529999',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A web search on 2026-10-10 found the citation and DOI in a reference list but not the paper. A patent summarising it quoted a male mean of 64.7 mm (SD 3.7 mm); a separate 2012 US Army survey table (not this paper) listed 64.0 mm (SD 3.4). Treat 64–65 mm as approximate.',
    supports: 'Adult male interpupillary distance averages about 64–65 mm with a spread of about 3.5 mm.',
  },
  {
    id: 'face:iris_scale2023',
    kind: 'peer_reviewed',
    citation: 'A deep learning framework to scale linear facial measurements to actual size using horizontal visible iris diameter: a study on an Iranian population. Scientific Reports (2023). Authors not confirmed in this session.',
    url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10447546/',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A web search on 2026-10-10 returned a summary: with a fixed iris diameter of 12.2 mm the mean absolute percentage error of scaled measurements was about 2.9% horizontally and 4.3% vertically, and the authors describe iris diameter as a narrow-range scale reference. Another source gave 11.0–12.5 mm for 95% of adults.',
    supports: 'Iris diameter can scale face photos to millimetres to within a few percent on average.',
  },
  {
    id: 'face:packiriswamy2013',
    kind: 'peer_reviewed',
    citation: 'Packiriswamy, V., Kumar, P., & Bashour, M. (2013). Photogrammetric analysis of eyebrow and upper eyelid dimensions in young adults (exact title wording not confirmed). Aesthetic Surgery Journal.',
    url: 'https://researcher.manipal.edu/en/publications/photogrammetric-analysis-of-eyebrow-and-upper-eyelid-dimensions-i/',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A web search on 2026-10-10 returned a summary: photographs of 200 South Indian and 200 Malaysian South Indian adults aged 18–26, with eyebrow height, apex position and lid measures showing sex differences in every category. Sex-specific means were not seen. Author order and title wording are from the search summary only.',
    supports: 'Eyebrow position differs between men and women in photogrammetric measurements.',
  },
  {
    id: 'face:sadr2003',
    kind: 'peer_reviewed',
    citation: 'Sadr, J., Jarudi, I., & Sinha, P. (2003). The role of eyebrows in face recognition. Perception, 32(3), 285–293.',
    url: 'https://doi.org/10.1068/p5027',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A web search on 2026-10-10 returned the citation and DOI and a summary of the abstract: removing eyebrows from familiar faces hurt recognition more than removing the eyes. This supports that brows matter for how faces are read, not any attractiveness claim.',
    supports: 'Eyebrows carry a large share of the information people use to read and recognise faces.',
  },
  {
    id: 'face:langlois1990',
    kind: 'peer_reviewed',
    citation: 'Langlois, J. H., & Roggman, L. A. (1990). Attractive faces are only average. Psychological Science, 1(2), 115–121.',
    url: 'https://digitalcommons.usu.edu/fchd_facpub/237',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A web search on 2026-10-10 returned the citation and a summary: digitised male and female faces were averaged, and the composites were rated more attractive than almost all the individual faces, more so as more faces were blended. That is a search summary, not the paper.',
    supports: 'Blended (average) faces are rated as more attractive than most individual faces.',
  },
  {
    id: 'face:scott2014',
    kind: 'peer_reviewed',
    citation: 'Scott, I. M. L., et al. (2014). Human preferences for sexually dimorphic faces may be evolutionarily novel. Proceedings of the National Academy of Sciences, 111(40), 14388–14393.',
    url: 'https://doi.org/10.1073/pnas.1409643111',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A web search on 2026-10-10 returned the citation and DOI and a summary: data from 12 populations of very different development found preferences for exaggerated sex-typical traits mainly in highly developed environments, and perceptions that masculine males look aggressive rose with development and urbanisation. Effect sizes were not seen.',
    supports: 'Preference for masculine male faces varies with culture and setting; masculine faces are also judged more aggressive.',
  },
  {
    id: 'face:ricketts1968',
    kind: 'peer_reviewed',
    citation: 'Ricketts, R. M. (1968). Esthetics, environment, and the law of lip relation. American Journal of Orthodontics, 54, 272–289. (Title and pages given from memory; a search confirmed only that Ricketts (1968) is the source of the E-line.)',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A web search on 2026-10-10 confirmed that Ricketts (1968) is cited as the origin of the E-line (nose tip to chin tip) but did not return the paper. Secondary sources gave norms of about 4 mm (upper lip) and 2 mm (lower lip) behind the line for an average white face, and noted that these differ in other populations. Title wording and page numbers are unconfirmed.',
    supports: 'The E-line and its orthodontic lip-position norms (upper lip about 4 mm and lower lip about 2 mm behind).',
  },
]
