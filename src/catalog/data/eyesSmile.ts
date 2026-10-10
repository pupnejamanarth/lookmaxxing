/**
 * Eyes and smile catalog (category `eyes_smile`, ids E01–E16, weight total EXACTLY 8).
 *
 * Authoring notes (read before editing):
 *  - Every source here is verified:false. The authoring session had a working web search but no working
 *    page fetch: the fetch tool failed with a DNS error, and the network policy refused direct connections
 *    to PubMed, DOI and publisher hosts (HTTP 403 on connect). No abstract or paper was opened. Search-result
 *    summaries were used only to cross-check bibliographic details and to avoid wrong claims, and each
 *    verificationNote says what a summary reported.
 *  - Numeric bands are labelled as one of: a published lay-rater threshold range (taken from a review
 *    summary, not read in full), a typical-range assumption, or an app-chosen tolerance. None is a measured
 *    perceptual limit for men. Replace them when verified norm tables are added.
 *  - Weight accounting against the v0 seed (8.0 → 8.0). Cut where the evidence is weaker than the seed
 *    assumed: E01 1.5 → 0.75 (yellowness split out as E11 at 0.25), E02 0.5 → 0.25, E03 1.0 → 0.5,
 *    E07 1.0 → 0.5. Raised where the evidence is stronger: E04 1.5 → 1.75, E06 0.5 → 0.75. Unchanged:
 *    E05 1.5, E08 0.5. New: E09 0.5, E12 0.25, E13 0.25, E15 0.25. Context only (weight 0): E10, E14, E16.
 *  - Overlaps are stated where they exist: F13 (lid show), F24 (brow height) and S09 (under-eye darkness)
 *    live in other categories and are not scored again here.
 *  - No product, chemical, abrasive or topical is recommended anywhere in this file. Changing the base shade
 *    or the position of teeth is dentist-only work and is out of the action plan.
 */
import type { Metric, Source } from '../schema'

// ───────────────────────── shared text ─────────────────────────

const NOT_OPENED =
  'UNVERIFIED. The record was not opened in this session: the page-fetch tool failed with a DNS error and the network policy refused direct connections to PubMed, DOI and publisher hosts (HTTP 403), so no abstract or full text was read. What is written below comes from web-search result summaries only. '

const COLOUR_REFUSALS = [
  'grey card not visible in the frame',
  'flash used',
  'mixed light sources, for example a window plus a warm lamp',
  'coloured light or a coloured wall close to the face',
  'grey card patch over- or under-exposed',
]

const EYE_CLOSEUP_REFUSALS = [
  'eye not fully open or not looking at the lens',
  'glare or a window reflection on the eye',
  'glasses frames or lens glare over the eye',
  'coloured or tinted contact lenses',
]

const FRONTAL_SMILE_POSE = [
  'head yaw or roll above 3°',
  'head pitch above 3° from level',
  'face outside the central 50% of the frame',
  'estimated camera distance under 1.2 m',
  'smile not a full smile (lips relaxed, closed or half raised)',
  'mouth open wide from speaking or laughing',
]

const TEETH_VISIBLE_REFUSALS = [
  'lips covering the front teeth',
  'braces, aligners or a temporary retainer in place',
  'saliva glare or a bright reflection on the front teeth',
]

const SCALING_NOTE =
  'Millimetres are scaled from the visible iris width, which is accurate to a few percent on average (see F04 for the scaling error); the larger error is where the landmarks are placed.'

// ───────────────────────── metrics ─────────────────────────

export const metrics: Metric[] = [
  // ── E01 ──────────────────────────────────────────────────────────────
  {
    id: 'E01',
    category: 'eyes_smile',
    name: 'Eye-white redness (sclera redness)',
    measures: 'How red the white of the eye (the sclera) looks, mostly from small blood vessels on its surface.',
    howMeasured:
      'Eye close-up with a grey card in the frame, no flash and even light. The face-landmark model finds the white of each eye between the lids and the iris. The app keeps the middle of that area, away from the corners and the lid edges, and reports the median a* value (the green-to-red axis of the CIELAB colour scale; higher is redder) after white balance against the grey card. Left and right eyes are shown separately, because redness in one eye only points to local irritation. Brightness is displayed but not scored, because eyelid shadow and exposure change it more than the eye does.',
    methods: ['COLOR_CALIBRATED_PHOTO', 'SEGMENTATION_PHOTO'],
    scale: {
      unit: 'a* (CIELAB redness, grey-card calibrated)',
      min: null,
      max: null,
      description: 'Median redness of the visible eye white; higher is redder',
      higherIs: 'worse',
    },
    ideal: {
      summary:
        'No numeric target. In rating studies, eye whites edited to look less red made faces look healthier and more attractive. The app compares you with your own clear-eyed baseline.',
      male: null,
      rationale:
        'Two studies edited the colour of the eye whites in face photos and found that redder whites were rated less healthy and less attractive (Provine et al. 2013; Russell et al. 2014). Neither gives a colour value to aim for, and we found no norm for phone-photo readings, so no absolute band is claimed.',
      confidenceInIdeal: 'low',
      populationCaveat:
        'The Russell study used photographs of white women. We found no study of men’s eye-white colour on its own, or of people with darker skin, and eye-white colour varies naturally between people.',
    },
    scoring: {
      kind: 'personal_baseline',
      direction: 'lower_better',
      note: 'No absolute anchor: there is no verified norm for phone-photo readings and natural redness differs between people. The score falls as redness rises above your own best recent reading (the lowest median over your last scans taken rested and without eye irritation). If only one eye is red, the reading is flagged as possible irritation instead of being treated as a trend.',
    },
    changeability: 'CHANGEABLE',
    changeabilityNote:
      'Redness from short sleep, dryness or irritation can change within days. Allergy, dry air, eye strain and contact lens wear also redden eyes. The plan lists sleep only, because it is the one lever with experimental support, and that support is mixed.',
    weight: 0.75,
    weightRationale:
      'Cut from the seed’s 1.5: the colour effect rests on two studies with edited photos, the sleep link is mixed, and yellowness is split out into E11. The freed weight moved to E04 and E06, where the evidence is stronger and the visible effect larger.',
    evidence: 'MODERATE',
    evidenceNote:
      'Two small studies that edited the colour of eye whites found that redder whites were rated less healthy and less attractive. Both used edited photos, not real eyes. The sleep link is mixed: a small study of 10 faces found redder eyes after sleep loss, while a later randomised study of 181 people reportedly found no difference in its facial measures or ratings after one sleepless night.',
    sourceIds: ['eyes_smile:russell2014', 'eyes_smile:provine2013', 'eyes_smile:sundelin2013', 'eyes_smile:holding2019'],
    drivers: ['sleep'],
    captureRequirements: ['eye_closeup'],
    refusalConditions: [
      ...COLOUR_REFUSALS,
      ...EYE_CLOSEUP_REFUSALS,
      'less than half of the eye white visible on either side of the iris',
      'eyes rubbed or washed within the last 30 minutes',
      'stinging or watering eyes reported at capture',
    ],
    medicalFlag:
      'Redness with eye pain, sensitivity to light, discharge or any change in vision, or redness in one eye that lasts more than a few days, should be seen by an eye doctor. The app measures colour only and cannot tell the cause.',
    phase: 'V2',
  },

  // ── E02 ──────────────────────────────────────────────────────────────
  {
    id: 'E02',
    category: 'eyes_smile',
    name: 'Limbal ring (dark ring around the iris)',
    measures: 'How dark and sharp the ring is around the outer edge of the coloured part of the eye (the iris).',
    howMeasured:
      'Eye close-up with a grey card in the frame and no flash. The app compares brightness across the outer tenth of the iris with the iris just inside it, then maps that to a grade you confirm against reference images: 0 = no ring visible; 1 = faint; 2 = clear; 3 = dark and distinct. A dark brown iris hides the ring, so grade 0 can mean the ring cannot be seen, not that it is absent.',
    methods: ['SEGMENTATION_PHOTO', 'SELF_GRADE_REFERENCE'],
    scale: { unit: 'grade', min: 0, max: 3, description: '0 = not visible, 3 = dark and distinct', higherIs: 'better' },
    ideal: {
      summary:
        'No defensible target. One study found a dark, distinct ring rated more attractive, but it was preliminary, and the ring is set by iris colour and age.',
      male: null,
      rationale:
        'Peshek et al. (2011) superimposed irises with and without a dark ring on the same faces and found faces with the ring rated as more attractive by men and women. Summaries of later work say many later studies reused the same face stimuli, so it is unclear how well the effect holds.',
      confidenceInIdeal: 'low',
      populationCaveat:
        'Small student samples and edited faces that were already above average in attractiveness. Light irises show the ring most clearly, so the trait is easier to see for some people than others.',
    },
    scoring: {
      kind: 'one_sided',
      points: [
        { x: 0, y: 70 },
        { x: 1, y: 80 },
        { x: 2, y: 95 },
        { x: 3, y: 100 },
      ],
    },
    changeability: 'FIXED',
    changeabilityNote:
      'Set by iris structure and fades with age. Lighting and photo angle change how visible it is, but no habit changes it.',
    weight: 0.25,
    weightRationale:
      'Cut from the seed’s 0.5 and kept small: the finding is preliminary, the trait is fixed, and the scale is deliberately shallow (the lowest grade still scores 70) so that dark irises are not marked down for something they cannot show.',
    evidence: 'WEAK',
    evidenceNote:
      'One small study with edited faces found that a dark, distinct ring raised attractiveness ratings. It has not been shown to hold in real faces, and the ring is mostly a matter of iris colour and age. Treat it as trivia with a very small weight.',
    sourceIds: ['eyes_smile:peshek2011'],
    drivers: [],
    captureRequirements: ['eye_closeup'],
    refusalConditions: [
      ...COLOUR_REFUSALS,
      ...EYE_CLOSEUP_REFUSALS,
      'upper eyelid covering more than a quarter of the iris',
      'iris too small in the close-up to show the ring edge',
    ],
    phase: 'V2',
  },

  // ── E03 ──────────────────────────────────────────────────────────────
  {
    id: 'E03',
    category: 'eyes_smile',
    name: 'Under-eye hollows (tear troughs)',
    measures:
      'How deep the groove or hollow is between the lower eyelid and the cheek. A deep groove casts a shadow that can read as tiredness. Under-eye darkness as a colour is scored in S09, not here.',
    howMeasured:
      'Self-grade against reference images on two eye close-ups, one in soft front light and one lit from the side: 0 = smooth lid-to-cheek line; 1 = a faint line; 2 = a clear groove; 3 = a deep hollow with a visible step. The soft-light grade is scored. The side-light grade is shown as context, because side light deepens any groove. Self-grading never gives high confidence.',
    methods: ['SELF_GRADE_REFERENCE'],
    scale: { unit: 'grade', min: 0, max: 3, description: '0 = smooth, 3 = deep hollow with a step', higherIs: 'worse' },
    ideal: {
      summary:
        'A smooth or faintly lined lid-to-cheek line. There is no rating study of men’s under-eye hollows, so the band is a judgment call.',
      male: { lo: 0, hi: 1 },
      rationale:
        'Aesthetic-medicine reviews and clinical grading scales describe deep hollows as adding a tired or older look. We found no study in which observers rated faces with and without hollows, so the band comes from clinical convention and the steps below grade 2 are app-chosen.',
      confidenceInIdeal: 'low',
      populationCaveat: 'Clinical grading scales were built in cosmetic clinics and not all fit every ethnic group equally well.',
    },
    scoring: {
      kind: 'one_sided',
      points: [
        { x: 0, y: 100 },
        { x: 1, y: 100 },
        { x: 2, y: 80 },
        { x: 3, y: 55 },
      ],
    },
    changeability: 'FIXED_BUT_VISIBILITY_CHANGEABLE',
    changeabilityNote:
      'Depth is set by bone structure, fat pads and age. Losing weight can make hollows look deeper, and the direction of light changes how deep they look. No habit changes the structure.',
    weight: 0.5,
    weightRationale:
      'Cut from the seed’s 1.0 because no rating study was found; kept under the WEAK cap of 1. The freed weight moved to E04 and E06.',
    evidence: 'WEAK',
    evidenceNote:
      'Clinic reviews say deep hollows make a face look tired or older, and clinicians grade them on short scales. We found no study in which observers rated faces with and without hollows, and none in men. Depth is set mostly by bone, fat and age.',
    sourceIds: ['eyes_smile:tear_trough_scales'],
    drivers: ['photo_technique'],
    captureRequirements: ['eye_closeup', 'skin_sidelight'],
    refusalConditions: [
      'light from above or below the face instead of soft front light (soft-light grade)',
      'head pitch or roll above 3°',
      'eyes squinting, eyelids lowered or not looking at the lens',
      'under-eye skin rubbed or visibly swollen within the last 30 minutes',
      'glasses frames or lens glare over the eye area',
    ],
    phase: 'V2',
  },

  // ── E04 ──────────────────────────────────────────────────────────────
  {
    id: 'E04',
    category: 'eyes_smile',
    name: 'Teeth alignment (crowding, twists, gaps, missing or chipped front teeth)',
    measures:
      'How straight and evenly spaced the visible front teeth are in a full smile: crowding, twisted teeth, overlap, gaps, and missing or chipped front teeth. The offset of the centre line is scored separately in E12.',
    howMeasured:
      'Self-grade against reference images on the full-smile photo and a teeth close-up: 0 = straight and evenly spaced; 1 = one tooth turned by a small angle or a small gap; 2 = clear crowding, overlap or several turned teeth; 3 = severe crowding, a missing or broken front tooth, or teeth clearly out of line. The app cannot measure crowding from a phone photo, because the landmark model has no tooth points. Self-grading never gives high confidence. The six upper front teeth must be visible.',
    methods: ['SELF_GRADE_REFERENCE'],
    scale: { unit: 'grade', min: 0, max: 3, description: '0 = straight and even, 3 = severe or missing front tooth', higherIs: 'worse' },
    ideal: {
      summary:
        'Straight, evenly spaced front teeth. In rating studies, lay raters mark down visibly tilted, offset, gapped or crowded front teeth, and the penalty grows with the size of the problem.',
      male: { lo: 0, hi: 1 },
      rationale:
        'Studies that edited smile photos found lay raters noticed tilted tooth-edge lines and centre-line shifts of a few millimetres (Kokich et al. 1999; Johnston et al. 1999). A 66-study review of lay raters reports thresholds of about 0 to 4 mm or degrees for several alignment features, with wide variation between studies (Parrini et al. 2016). We did not find a study that says how much crowding should cost, so the grade steps are app-chosen.',
      confidenceInIdeal: 'medium',
      populationCaveat:
        'Several studies edited a single smile photo, in one case of a young woman, and used raters from one country. Few tested men’s smiles or looked at crowding directly.',
    },
    scoring: {
      kind: 'one_sided',
      points: [
        { x: 0, y: 100 },
        { x: 1, y: 92 },
        { x: 2, y: 70 },
        { x: 3, y: 45 },
      ],
    },
    changeability: 'PROFESSIONAL_ONLY',
    changeabilityNote:
      'Only a dentist or orthodontist can move teeth. Brushing and flossing do not change alignment. The app records the grade and leaves it out of the action plan.',
    weight: 1.75,
    weightRationale:
      'The largest weight in this category: teeth are the most visible part of a smile, and alignment has the best-supported dental evidence here. Raised from the seed’s 1.5 using weight freed from E01, E03 and E07, where the evidence is weaker. Weight reflects how much the trait matters to appearance. The action plan leaves it out separately because it is professional-only.',
    evidence: 'MODERATE',
    evidenceNote:
      'Several studies show lay raters notice and mark down misaligned front teeth, and the penalty grows with the size of the problem. But most tested edited versions of one smile photo, a systematic review of the wider topic rated study quality as weak, and we found no study that sets how much crowding costs. The grade steps are the app’s own.',
    sourceIds: ['eyes_smile:kokich1999', 'eyes_smile:johnston1999', 'eyes_smile:parrini2016', 'eyes_smile:prado2015'],
    drivers: [],
    captureRequirements: ['frontal_smile', 'teeth_closeup'],
    refusalConditions: [
      ...TEETH_VISIBLE_REFUSALS,
      'fewer than the six upper front teeth visible',
      'head yaw or roll above 5° in the full-smile photo',
      'teeth too small in the frame to count individually',
    ],
    medicalFlag:
      'Teeth that have started to move, feel loose or hurt when biting should be checked by a dentist. The app cannot tell the cause.',
    phase: 'M2',
  },

  // ── E05 ──────────────────────────────────────────────────────────────
  {
    id: 'E05',
    category: 'eyes_smile',
    name: 'Teeth colour (lightness and yellowness)',
    measures:
      'How light and how yellow the front teeth look in a calibrated photo, tracked against your own best earlier reading.',
    howMeasured:
      'Teeth close-up with a grey card in the frame, no flash and even light. The app finds the two upper centre teeth and keeps the middle third of each, away from the darker gum edge and the more see-through biting edge. It reports the CIELAB lightness (L*) and yellowness (b*) after white balance against the grey card, and scores the colour distance (ΔE) from your best earlier reading. Phone cameras differ, so readings are for tracking your own trend, not for comparing with other people. A dental shade guide is the clinical standard and needs a physical guide.',
    methods: ['COLOR_CALIBRATED_PHOTO', 'SEGMENTATION_PHOTO'],
    scale: {
      unit: 'ΔE (CIELAB) from your best earlier reading',
      min: 0,
      max: null,
      description: 'Colour distance from your lightest, least yellow earlier reading; higher means darker or yellower',
      higherIs: 'worse',
    },
    ideal: {
      summary:
        'No numeric target. Lighter teeth are rated more attractive than darker ones, but the very lightest shades are not the most attractive and the preferred shade depends on skin tone.',
      male: null,
      rationale:
        'In rating experiments with edited photos, teeth edited lighter were rated best and teeth edited darker were rated worst (Newton et al. 2021). A study of 140 raters found that the brightest shade was not rated most attractive, and that very bright teeth against dark skin or dark teeth against fair skin were rated as unattractive (JADA 2009). Because the preferred shade depends on skin tone, the app scores drift from your own best reading instead of a fixed shade.',
      confidenceInIdeal: 'low',
      populationCaveat:
        'Rating studies used digitally edited photos, mostly of Caucasian faces and raters. The preferred shade changes with skin tone, so no single value fits everyone.',
    },
    scoring: {
      kind: 'personal_baseline',
      direction: 'lower_better',
      note: 'No absolute anchor: the preferred shade depends on skin tone and no verified norm exists for phone-photo readings. The score falls as the teeth drift darker or yellower than your own best earlier reading. It cannot tell naturally darker teeth from stained teeth, which is intended: it rewards keeping what you have, not reaching a shade.',
    },
    changeability: 'CHANGEABLE',
    changeabilityNote:
      'Part habit, part fixed. Surface stain from dark drinks and tobacco builds up with exposure, and habits can slow it. The tooth’s own base shade is set by genes and tends to darken with age. Changing the base shade is dentist-only work and is not part of the action plan. Smoking and vaping are tracked in X10.',
    weight: 1.5,
    weightRationale:
      'Kept at the seed’s 1.5: two rating studies agree that tooth colour affects how a smile is judged, and part of it is within reach of daily habits. It is not raised further because phone colour readings are noisy and the habit evidence is thin.',
    evidence: 'MODERATE',
    evidenceNote:
      'Rating experiments with edited photos found that lighter teeth look better than darker ones, though the lightest shades and mismatched skin tones were not preferred. The habit lever is much weaker: stain-avoidance advice rests on how stains form, not on trials. These habits slow new surface stain. They do not change the tooth’s own shade.',
    sourceIds: ['eyes_smile:newton2021', 'eyes_smile:jada2009', 'eyes_smile:nathoo1997'],
    drivers: ['oral_hygiene_habits', 'nutrition_structure'],
    captureRequirements: ['teeth_closeup'],
    refusalConditions: [
      ...COLOUR_REFUSALS,
      ...TEETH_VISIBLE_REFUSALS,
      'mouth held open for a long time before the shot (dried teeth look lighter)',
      'food or dark drink consumed in the last 30 minutes',
      'visible plaque, food or lipstick on the front teeth',
    ],
    medicalFlag:
      'A single tooth that turns grey or dark, or dark spots that appear on the biting surfaces or between teeth, should be checked by a dentist.',
    phase: 'V2',
  },

  // ── E06 ──────────────────────────────────────────────────────────────
  {
    id: 'E06',
    category: 'eyes_smile',
    name: 'Gum show at full smile',
    measures: 'How much gum shows above the upper front teeth when you smile fully.',
    howMeasured:
      'Frontal full-smile photo. You tap the gum edge above the middle of an upper centre tooth and the lower edge of the upper lip, and the app converts the vertical distance to millimetres. 0 = the lip sits at the gum edge; positive = gum visible; negative = the lip still covers part of the tooth. A held, posed grin shows more gum than a natural smile, so capture is standardised as a full smile and the largest of three readings is used. ' +
      SCALING_NOTE,
    methods: ['MANUAL_LANDMARKS', 'AUTO_FRONTAL_PHOTO'],
    scale: {
      unit: 'mm',
      min: null,
      max: null,
      description: 'Gum visible above the upper centre tooth at a full smile; negative = lip still covers tooth',
      higherIs: 'worse',
    },
    ideal: {
      summary:
        'Up to about 2 mm of gum. Lay raters in several studies accepted up to roughly 3 mm, and thresholds reported across studies run from about 1.5 to 4 mm.',
      male: { lo: null, hi: 2 },
      rationale:
        'A systematic review of lay-rater studies lists gum-exposure thresholds from 1.5 to 4 mm (Parrini et al. 2016). Secondary reports of Kokich et al. (1999) put the lay threshold at about 3 to 4 mm, with orthodontists stricter. A 2022 review of 34 studies, as summarised in search results, reported that about 3 mm was acceptable. Because studies disagree, full marks run to 2 mm and points fall gradually after 3 mm.',
      confidenceInIdeal: 'medium',
      populationCaveat:
        'Thresholds vary between rater groups and studies, many studies edited a single photo, and some found laypeople accepted far more gum when the rest of the face was balanced.',
    },
    scoring: {
      kind: 'one_sided',
      points: [
        { x: 0, y: 100 },
        { x: 2, y: 100 },
        { x: 3, y: 90 },
        { x: 4, y: 70 },
        { x: 6, y: 40 },
        { x: 8, y: 25 },
      ],
    },
    changeability: 'SURGICAL_ONLY',
    changeabilityNote:
      'Set by lip length and movement, upper-jaw height and tooth length. A smaller smile hides gum in photos but does not change the trait. Only a dentist or surgeon can change it, so the app leaves it out of the action plan.',
    weight: 0.75,
    weightRationale:
      'Raised from the seed’s 0.5: several rating studies and two reviews give lay-rater thresholds for gum show, so the evidence is among the stronger in this category. The extra weight came from E01.',
    evidence: 'MODERATE',
    evidenceNote:
      'Several rating studies and two reviews give lay-rater thresholds for gum show, but the thresholds differ by study, rater group and face, and most studies used edited photos. The scoring curve uses the middle of that range.',
    sourceIds: ['eyes_smile:kokich1999', 'eyes_smile:parrini2016', 'eyes_smile:gingival_review2022'],
    drivers: [],
    captureRequirements: ['frontal_smile', 'teeth_closeup'],
    refusalConditions: [
      ...FRONTAL_SMILE_POSE,
      'upper gum edge hidden by the lip or shadow',
      'iris not detected, so no scale is available',
      'user did not confirm the tapped gum and lip points',
    ],
    phase: 'V2',
  },

  // ── E07 ──────────────────────────────────────────────────────────────
  {
    id: 'E07',
    category: 'eyes_smile',
    name: 'Smile symmetry (mouth-corner mismatch)',
    measures:
      'How level and balanced the two sides of your smile are: the height of the mouth corners and their distance from the face centre line.',
    howMeasured:
      'Automatic: face-landmark model on the full-smile photo. Corner heights are measured perpendicular to the line through the pupils, and corner distances from the face centre line are compared left against right. The reported value is the larger of the two mismatches as a percent of the pupil distance, taken as the median of three full-smile frames. Head tilt and turn are refused, because they create mismatch that is not in the smile.',
    methods: ['AUTO_FRONTAL_PHOTO'],
    scale: { unit: '% of pupil distance', min: 0, max: null, description: 'Larger of the corner-height and corner-distance mismatches', higherIs: 'worse' },
    ideal: {
      summary:
        'Small mismatch. Natural smiles are never perfectly even, and no study gives the amount at which people notice.',
      male: null,
      rationale:
        'Reviews of lay-rater thresholds list centre-line shift, gum show, buccal corridors and tilted tooth-edge lines, but not mouth-corner height (Parrini et al. 2016). We found no study that sets how much mouth-corner mismatch raters notice, so the scoring band is an app assumption that allows for natural unevenness.',
      confidenceInIdeal: 'low',
      populationCaveat: 'No male-specific data found. Smiles are dynamic, and a single photo catches one moment of the movement.',
    },
    scoring: {
      kind: 'range',
      lo: 0,
      hi: 5,
      tau: 3,
      tauRationale:
        'App assumption, not a published threshold: 5% of pupil distance is roughly 3 mm on a typical adult, and natural smiles are more uneven than faces at rest, so the full-score band is wider than the one for resting symmetry (F05). Replace with pilot data.',
    },
    changeability: 'FIXED',
    changeabilityNote:
      'Muscle habit may shift which side lifts more, but we found no evidence that practice changes smile symmetry, so no lever is offered.',
    weight: 0.5,
    weightRationale:
      'Cut from the seed’s 1.0: no study sets a threshold for mouth-corner mismatch and a single photo catches one moment of a moving smile. The freed weight moved to E04 and E06.',
    evidence: 'WEAK',
    evidenceNote:
      'Related smile features have lay-rater thresholds, but we found none for mouth-corner mismatch. The scoring band is the app’s own assumption.',
    sourceIds: ['eyes_smile:parrini2016'],
    drivers: [],
    captureRequirements: ['frontal_smile'],
    refusalConditions: [
      ...FRONTAL_SMILE_POSE,
      'facial hair or a shadow hiding a mouth corner',
      'hair or glasses frames covering landmarks on one side',
      'uneven lighting with a strong shadow on one side of the face',
    ],
    phase: 'M2',
  },

  // ── E08 ──────────────────────────────────────────────────────────────
  {
    id: 'E08',
    category: 'eyes_smile',
    name: 'Eye engagement in a smile (Duchenne-type smile)',
    measures:
      'Whether your smile also lifts the cheeks and narrows the eyes. Observers tend to read smiles with that eye involvement as more genuine.',
    howMeasured:
      'Automatic: the face-landmark model’s expression scores for cheek raise and eye narrowing, averaged into an index from 0 to 1, computed only when the mouth-smile score is high. The index also rises with smile size, so it is read next to the mouth score and not alone. Refused when the eyes are closed in a blink or hidden.',
    methods: ['AUTO_FRONTAL_PHOTO'],
    scale: { unit: 'index', min: 0, max: 1, description: 'Cheek-raise and eye-narrowing scores averaged; higher = more eye involvement', higherIs: 'better' },
    ideal: {
      summary:
        'No numeric target. Smiles with eye involvement are rated as more genuine, but the effect is smaller in still photos and posed smiles.',
      male: null,
      rationale:
        'A meta-analysis found that Duchenne smiles are rated more positively (genuine, authentic, attractive, trustworthy), with a weaker effect for photographs than videos and for posed than natural smiles (Gunnery & Ruben 2016). A lab study found many people can produce eye-involved smiles on demand, and suggested that the eye marker may track smile size as well as feeling (Krumhuber & Manstead 2009). No norm exists, so the app compares you with your own best smile.',
      confidenceInIdeal: 'low',
      populationCaveat:
        'The meta-analysis mixed many rater groups and smile types. Expression scores from a landmark model are an estimate, not a muscle measurement.',
    },
    scoring: {
      kind: 'personal_baseline',
      direction: 'higher_better',
      note: 'No absolute anchor: no norm exists for this index, and eye involvement rises with smile size. The score compares the index at a comparable mouth-smile level with your own best smile in earlier scans.',
    },
    changeability: 'CHANGEABLE',
    changeabilityNote:
      'Practice and relaxing before the shot change how much the eyes take part. This changes how smiles look in photos. It does not change your face.',
    weight: 0.5,
    weightRationale:
      'Kept at the seed’s 0.5 and capped at WEAK: the effect is smallest for still photos and posed smiles, which is exactly what the app captures.',
    evidence: 'WEAK',
    evidenceNote:
      'A meta-analysis finds Duchenne smiles rated as more genuine, but the effect is smaller for photos and posed smiles, and one lab study found the eye marker can be produced on demand and may follow smile size. Downgraded from the seed’s moderate rating for photo use.',
    sourceIds: ['eyes_smile:gunnery2016', 'eyes_smile:krumhuber2009'],
    drivers: ['photo_technique'],
    captureRequirements: ['frontal_smile'],
    refusalConditions: [
      ...FRONTAL_SMILE_POSE,
      'eyes closed or half closed',
      'sunglasses, tinted lenses or glasses glare over the eyes',
      'mouth-smile score too low to count as a smile',
    ],
    phase: 'M2',
  },

  // ── E09 ──────────────────────────────────────────────────────────────
  {
    id: 'E09',
    category: 'eyes_smile',
    name: 'Eye-area puffiness (morning vs evening)',
    measures:
      'How swollen the lower eyelids and the skin under the eyes look, and how much of that goes away during the day.',
    howMeasured:
      'Two eye close-ups from the same distance and in the same side light, one within 30 minutes of waking and one at least 6 hours later. Self-grade each against reference images: 0 = flat lid-to-cheek line; 1 = fullness only; 2 = a clear bulge; 3 = a pronounced bag. The scored value is the average of the two grades. The app also shows the part that clears between morning and evening, because that fluid part is the only part habits can reach. A bag that looks the same at both times is structural. Self-grading never gives high confidence.',
    methods: ['SELF_GRADE_REFERENCE'],
    scale: { unit: 'grade', min: 0, max: 3, description: 'Average of morning and evening grades; 0 = flat, 3 = pronounced bag', higherIs: 'worse' },
    ideal: {
      summary:
        'Flat or only faintly full lower lids. A bag that is the same morning and evening is structural and will not change with habits.',
      male: { lo: 0, hi: 1 },
      rationale:
        'In a sleep-loss experiment, observers rated sleep-deprived faces as having more swollen eyes (Sundelin et al. 2013), but no study rated puffiness on its own. The 0 to 1 band is clinical convention, and the grade steps are app-chosen.',
      confidenceInIdeal: 'low',
      populationCaveat: 'Sleep-loss studies were small and used one night of total sleep deprivation in young adults.',
    },
    scoring: {
      kind: 'one_sided',
      points: [
        { x: 0, y: 100 },
        { x: 1, y: 100 },
        { x: 2, y: 80 },
        { x: 3, y: 55 },
      ],
    },
    changeability: 'FIXED_BUT_VISIBILITY_CHANGEABLE',
    changeabilityNote:
      'Fat pads and skin set the structural part, which fixed habits cannot change. The fluid part varies by time of day and between nights. Sleep is the only lever with any experimental support, and that support is mixed. Whether salt intake or alcohol timing changes lower-lid puffiness has not been tested in men as far as we found.',
    weight: 0.5,
    weightRationale:
      'New metric, kept at 0.5 under the WEAK cap: puffiness is visible and partly changeable, but the evidence is indirect. The weight came from the E01, E03 and E07 cuts.',
    evidence: 'WEAK',
    evidenceNote:
      'Sleep-loss studies list swollen eyes among the cues observers notice, but they rated whole faces, not puffiness alone, one used only 10 faces, and a later randomised study of 181 people reportedly found no difference in its facial measures or ratings after a sleepless night. Treat this as a tracking metric with a small weight.',
    sourceIds: ['eyes_smile:sundelin2013', 'eyes_smile:axelsson2010', 'eyes_smile:holding2019'],
    drivers: ['sleep', 'nutrition_structure'],
    captureRequirements: ['eye_closeup', 'skin_sidelight'],
    refusalConditions: [
      'morning and evening shots taken at different distances or from different light directions',
      'morning shot taken more than 30 minutes after waking',
      'evening shot taken less than 6 hours after the morning shot',
      'head pitch or roll above 3°',
      'eyes squinting, eyelids lowered or not looking at the lens',
      'under-eye skin rubbed or washed within the last 30 minutes',
    ],
    medicalFlag:
      'Eyelid swelling that is sudden, painful, on one side only, or comes with redness, fever or a change in vision, or puffiness that is always severe, should be checked by a doctor. The app cannot tell the cause.',
    phase: 'V2',
  },

  // ── E10 ──────────────────────────────────────────────────────────────
  {
    id: 'E10',
    category: 'eyes_smile',
    name: 'Brow-to-upper-lid distance',
    measures:
      'The vertical gap between the lower edge of the eyebrow and the upper lash line with the eyes open and the face relaxed. A small gap can make the eyes look heavy or hooded. Lid show is scored in F13 and brow height in F24.',
    howMeasured:
      'Automatic from brow and eyelid landmarks on the frontal neutral photo, divided by the visible iris width so it does not depend on camera distance. Raising or lowering the brows even slightly changes the reading, so expression is checked. Plucked or shaved brows change the lower edge (see H07).',
    methods: ['AUTO_FRONTAL_PHOTO'],
    scale: {
      unit: 'iris widths',
      min: null,
      max: null,
      description: 'Brow lower edge to upper lash line ÷ visible iris width',
      higherIs: 'not_applicable',
    },
    ideal: {
      summary: 'No male band exists. Tracked to help read lid show (F13) and brow height (F24), not scored.',
      male: null,
      rationale:
        'We found no study that says which brow-to-lid gap is rated best in men. The one firm link is that sleep-deprived faces were rated as having more hanging eyelids (Sundelin et al. 2013), which is a tiredness cue and not a target.',
      confidenceInIdeal: 'low',
      populationCaveat: 'No male-specific rating data found.',
    },
    scoring: { kind: 'none', reason: 'context_only' },
    changeability: 'FIXED',
    changeabilityNote:
      'Bone, skin and age set the resting gap. Expression, fatigue and brow grooming change the reading but not the structure.',
    weight: 0,
    weightRationale:
      'Context only: F13 already scores lid show and F24 tracks brow height, so scoring this would count the same region twice. It is kept to explain why an F13 reading is low (low brow versus a lid fold).',
    evidence: 'WEAK',
    evidenceNote:
      'The only supported link is that faces look tired after sleep loss, with more hanging lids. How large a brow-to-lid gap men should have has not been tested, so this is tracked and not scored.',
    sourceIds: ['eyes_smile:sundelin2013'],
    drivers: [],
    captureRequirements: ['frontal_neutral'],
    refusalConditions: [
      'head yaw or roll above 3°',
      'head pitch above 2° from level',
      'expression not neutral (brows raised, lowered or squeezed)',
      'brows or lash line hidden by hair, glasses frames or shadow',
      'eyes not fully open or not looking at the lens',
    ],
    phase: 'V2',
  },

  // ── E11 ──────────────────────────────────────────────────────────────
  {
    id: 'E11',
    category: 'eyes_smile',
    name: 'Eye-white yellowness (sclera yellowness)',
    measures:
      'How yellow the white of the eye looks. Mild yellowness is common with age and in some skin tones. A new or growing yellow tinge can be a medical sign.',
    howMeasured:
      'Same eye close-up as E01. The app reports the median b* value (the blue-to-yellow axis of the CIELAB colour scale; higher is yellower) of the eye-white pixels after white balance against the grey card. It compares each scan with your own earlier readings, because natural eye-white colour differs between people and warm room light alone can fake a yellow tinge.',
    methods: ['COLOR_CALIBRATED_PHOTO', 'SEGMENTATION_PHOTO'],
    scale: {
      unit: 'b* (CIELAB yellowness, grey-card calibrated)',
      min: null,
      max: null,
      description: 'Median yellowness of the visible eye white; higher is yellower',
      higherIs: 'worse',
    },
    ideal: {
      summary:
        'No numeric target. In rating studies, eye whites edited to look less yellow made faces look younger, healthier and more attractive. The app compares you with your own baseline and watches for change.',
      male: null,
      rationale:
        'Russell et al. (2014) reported that eye whites get darker, redder and yellower with age, and that edited faces with less yellow in the eye whites were rated younger, healthier and more attractive. That is a single study. A phone-camera study used eye-white colour to estimate bilirubin only with colour-calibration accessories (Mariakakis et al. 2017), which shows both the medical meaning and how hard accurate phone readings are.',
      confidenceInIdeal: 'low',
      populationCaveat:
        'The Russell study used photographs of white women. Natural yellowish or brownish patches on the eye white are common and harmless in many people, particularly with age or darker skin, so the app tracks change and not a fixed value.',
    },
    scoring: {
      kind: 'personal_baseline',
      direction: 'lower_better',
      note: 'No absolute anchor: natural eye-white colour varies between people and no verified norm exists for phone-photo readings. The score falls as yellowness rises above your own baseline. A clear rise that persists across scans also triggers the medical flag.',
    },
    changeability: 'FIXED',
    changeabilityNote:
      'Mostly set by age and natural pigment. No habit lever is offered. The app watches this value for change, because a persistent new yellow tinge needs a doctor, not a plan.',
    weight: 0.25,
    weightRationale:
      'Split out of the seed’s E01 (1.5). Kept small because it is a single study, mostly fixed, and hard to read from a phone photo. Its main job is to watch for a health change.',
    evidence: 'WEAK',
    evidenceNote:
      'One study with edited photos of white women found that less yellow in the eye whites made faces look younger and healthier. Natural variation is large and room light can fake a tint. This is mainly a watch for health change.',
    sourceIds: ['eyes_smile:russell2014', 'eyes_smile:mariakakis2017'],
    drivers: [],
    captureRequirements: ['eye_closeup'],
    refusalConditions: [
      ...COLOUR_REFUSALS,
      ...EYE_CLOSEUP_REFUSALS,
      'less than half of the eye white visible on either side of the iris',
      'warm or yellow room light, such as a tungsten bulb',
    ],
    medicalFlag:
      'A new yellow colour in the eye whites that rises clearly above your baseline and persists across scans, or that comes with dark urine, pale stools, itching or unusual tiredness, should be seen by a doctor soon. The app measures colour only and cannot tell the cause.',
    phase: 'V2',
  },

  // ── E12 ──────────────────────────────────────────────────────────────
  {
    id: 'E12',
    category: 'eyes_smile',
    name: 'Dental centre-line offset (teeth midline vs face midline)',
    measures:
      'How far the centre line between your two upper front teeth sits to the left or right of the centre line of your face.',
    howMeasured:
      'Frontal full-smile photo. The app draws the face centre line through the mid-brow and the base of the nose, and you tap the gap between the two upper centre teeth. The sideways distance is reported in millimetres. The face centre line itself is not perfectly straight on real faces, so the chin is not used to set it. ' +
      SCALING_NOTE,
    methods: ['MANUAL_LANDMARKS', 'AUTO_FRONTAL_PHOTO'],
    scale: { unit: 'mm', min: 0, max: null, description: 'Sideways offset of the upper centre-tooth gap from the face centre line', higherIs: 'worse' },
    ideal: {
      summary:
        'Under about 1 mm for full marks. Lay raters in one study gave lower scores as the offset grew, with some noticing 2 mm, and a review reports lay thresholds from 0 to 3 mm.',
      male: { lo: 0, hi: 1 },
      rationale:
        'In a study that moved the tooth centre line on one smile photo, raters scored the smile lower as the offset grew, and the authors estimated a 56% chance that a layperson gave a lower score at 2 mm (Johnston et al. 1999). A review of lay raters reports midline thresholds from 0 to 3 mm across studies (Parrini et al. 2016). Full marks run to 1 mm, with a gradual decline after that.',
      confidenceInIdeal: 'medium',
      populationCaveat:
        'The key study moved the tooth centre line on one photo of a young woman and used 20 young adult laypeople. Thresholds differ across studies.',
    },
    scoring: {
      kind: 'one_sided',
      points: [
        { x: 0, y: 100 },
        { x: 1, y: 100 },
        { x: 2, y: 92 },
        { x: 3, y: 75 },
        { x: 5, y: 50 },
      ],
    },
    changeability: 'PROFESSIONAL_ONLY',
    changeabilityNote:
      'Only a dentist or orthodontist can shift teeth. A head turn or tilt in the photo changes the reading, which is why capture is strict.',
    weight: 0.25,
    weightRationale:
      'New metric, kept at 0.25: the effect is real in the studies we found but small for a few millimetres, and part of the same dental region is already scored in E04.',
    evidence: 'MODERATE',
    evidenceNote:
      'A study and a review of lay raters agree that larger centre-line offsets are marked down, but thresholds range from 0 to 3 mm and the key study used one edited photo. The score curve is the app’s own, drawn inside that range.',
    sourceIds: ['eyes_smile:johnston1999', 'eyes_smile:parrini2016'],
    drivers: [],
    captureRequirements: ['frontal_smile'],
    refusalConditions: [
      'head yaw or roll above 3°',
      'head pitch above 3° from level',
      'face outside the central 50% of the frame',
      'estimated camera distance under 1.2 m',
      'gap between the upper centre teeth not visible or hidden by the lip',
      'iris not detected, so no scale is available',
      'braces, aligners or a temporary retainer in place',
    ],
    phase: 'V2',
  },

  // ── E13 ──────────────────────────────────────────────────────────────
  {
    id: 'E13',
    category: 'eyes_smile',
    name: 'Smile arc (tooth-edge curve vs lower lip)',
    measures:
      'How closely the curve of the edges of the upper front teeth follows the curve of the lower lip in a full smile. A flat tooth-edge line under a curved lip is called a flat smile arc.',
    howMeasured:
      'Self-grade against reference images on the full-smile photo: 0 = the tooth edges curve the same way as the lower lip (consonant); 1 = the edges are flat; 2 = the edges curve the opposite way (reverse). Self-grading never gives high confidence. The upper front teeth and the full lower lip line must be visible.',
    methods: ['SELF_GRADE_REFERENCE'],
    scale: { unit: 'grade', min: 0, max: 2, description: '0 = follows the lip, 1 = flat, 2 = reverse', higherIs: 'worse' },
    ideal: {
      summary:
        'Tooth edges that follow the curve of the lower lip. In one rating study, flat arcs scored lower than arcs that follow the lip.',
      male: { lo: 0, hi: 0 },
      rationale:
        'Sarver (2001) described the smile arc, and a web-based survey of orthodontists and laypeople rated smiles whose arc follows the lower lip as most attractive, with flat arcs scoring lower (Parekh et al. 2006). Both are single, mostly clinical sources, so the steps are app-chosen.',
      confidenceInIdeal: 'low',
      populationCaveat: 'The survey used digitally altered images of one male and one female smile.',
    },
    scoring: {
      kind: 'one_sided',
      points: [
        { x: 0, y: 100 },
        { x: 1, y: 80 },
        { x: 2, y: 55 },
      ],
    },
    changeability: 'PROFESSIONAL_ONLY',
    changeabilityNote:
      'Set by the position of the upper front teeth, which only a dentist or orthodontist can change. The app records the grade and leaves it out of the action plan.',
    weight: 0.25,
    weightRationale:
      'New metric, kept small and under the WEAK cap: the evidence is one survey and a clinical description, and it overlaps the same dental region as E04 and E06.',
    evidence: 'WEAK',
    evidenceNote:
      'One web survey of orthodontists and laypeople and one clinical paper support the idea that a flat smile arc looks less attractive. Both are limited, so the weight is small.',
    sourceIds: ['eyes_smile:sarver2001', 'eyes_smile:parekh2006'],
    drivers: [],
    captureRequirements: ['frontal_smile'],
    refusalConditions: [
      ...FRONTAL_SMILE_POSE,
      'lower lip line hidden or teeth edges not visible',
      'missing or broken upper front teeth that make the edge line unreadable',
      'braces, aligners or a temporary retainer in place',
    ],
    phase: 'V2',
  },

  // ── E14 ──────────────────────────────────────────────────────────────
  {
    id: 'E14',
    category: 'eyes_smile',
    name: 'Buccal corridor (dark space at the sides of the smile)',
    measures:
      'The dark gap at the sides of the mouth between the outer teeth and the corners of the lips in a full smile.',
    howMeasured:
      'Frontal full-smile photo. You tap the outer edge of the visible tooth row and the mouth corner on each side. The app reports the gap as a percent of the full smile width (corner to corner), averaged over the two sides.',
    methods: ['MANUAL_LANDMARKS', 'AUTO_FRONTAL_PHOTO'],
    scale: { unit: '% of smile width', min: 0, max: null, description: 'Dark gap at each mouth corner ÷ full smile width', higherIs: 'not_applicable' },
    ideal: {
      summary:
        'No defensible target. One study preferred a fuller smile with small gaps, but later studies found little or no effect on ratings.',
      male: null,
      rationale:
        'Moore et al. (2005) found raters preferred broader smiles with minimal dark space. Parekh et al. (2006) found no effect of corridor width on ratings, and Zange et al. (2011) reported that laypeople could not tell the gradations of corridor width unless the difference was very plain. So the effect looks small and inconsistent.',
      confidenceInIdeal: 'low',
      populationCaveat: 'Studies used digitally altered smiles of one or two faces and differed in method.',
    },
    scoring: { kind: 'none', reason: 'context_only' },
    changeability: 'PROFESSIONAL_ONLY',
    changeabilityNote:
      'Set by the width of the dental arch and the width of the smile. Only a dentist or orthodontist can change the arch. Camera distance and smile size change the reading.',
    weight: 0,
    weightRationale:
      'Tracked, not scored: studies disagree and the best-controlled ones found little effect, so scoring it would add noise to the overall score.',
    evidence: 'WEAK',
    evidenceNote:
      'Studies disagree. One found a preference for narrow dark gaps; two later ones found little or no effect on ratings. It shows up in lookmaxxing and orthodontic talk more than in the data, so it is tracked and not scored.',
    sourceIds: ['eyes_smile:moore2005', 'eyes_smile:parekh2006', 'eyes_smile:zange2011'],
    drivers: [],
    captureRequirements: ['frontal_smile'],
    refusalConditions: [
      ...FRONTAL_SMILE_POSE,
      'outer teeth hidden by the lips or by shadow',
      'user did not confirm the tapped tooth and mouth-corner points',
    ],
    phase: 'V2',
  },

  // ── E15 ──────────────────────────────────────────────────────────────
  {
    id: 'E15',
    category: 'eyes_smile',
    name: 'Gum health (redness and swelling at the gum edge)',
    measures:
      'Whether the gum edge around the visible front teeth looks pale pink and firm, or red, puffy or rolled.',
    howMeasured:
      'Self-grade against reference images on a teeth close-up with a grey card in the frame and no flash: 0 = pale pink with a thin, tight edge; 1 = a faint red edge; 2 = a red, puffy edge; 3 = deep red, swollen or visibly bleeding gums. A yes/no checklist question asks whether the gums bleed when you brush or clean between your teeth. Self-grading never gives high confidence.',
    methods: ['SELF_GRADE_REFERENCE', 'CHECKLIST'],
    scale: { unit: 'grade', min: 0, max: 3, description: '0 = pale pink and firm, 3 = deep red and swollen', higherIs: 'worse' },
    ideal: {
      summary:
        'Pale pink, firm gum edges. In one rating study, laypeople scored inflamed gums among the least attractive smile features.',
      male: { lo: 0, hi: 1 },
      rationale:
        'A study that edited smile photos found laypeople rated inflamed gums as one of the least attractive features. It tested edited images, not real gum redness, so the effect size is unknown. Gum inflammation also matters for dental health regardless of looks.',
      confidenceInIdeal: 'low',
      populationCaveat: 'The rating study used digitally altered photos; the author list and sample were not confirmed.',
    },
    scoring: {
      kind: 'one_sided',
      points: [
        { x: 0, y: 100 },
        { x: 1, y: 100 },
        { x: 2, y: 75 },
        { x: 3, y: 40 },
      ],
    },
    changeability: 'CHANGEABLE',
    changeabilityNote:
      'Gum redness from plaque build-up usually eases within days to a few weeks of consistent brushing and cleaning between teeth (general dental teaching; timing not confirmed here). Redness that does not ease needs a dentist.',
    weight: 0.25,
    weightRationale:
      'New metric, kept small and under the WEAK cap: the appearance evidence is one rating study of edited photos. Gum health matters more for health than for looks, so the weight is not raised.',
    evidence: 'WEAK',
    evidenceNote:
      'One rating study with edited smile photos found laypeople scored inflamed gums as unattractive. No study rated real gum redness. The link between plaque and gum inflammation is well established, but that concerns health, not looks.',
    sourceIds: ['eyes_smile:microesthetics', 'eyes_smile:loe1965'],
    drivers: ['oral_hygiene_habits'],
    captureRequirements: ['teeth_closeup'],
    refusalConditions: [
      ...COLOUR_REFUSALS,
      ...TEETH_VISIBLE_REFUSALS,
      'gum edge hidden by the lips or by shadow',
      'photo taken within 30 minutes of flossing or brushing',
    ],
    medicalFlag:
      'Gums that bleed on most days for more than two weeks despite careful cleaning, swollen gums, gums pulling back from the teeth, loose teeth, or a lasting bad taste or breath should be checked by a dentist. The app cannot tell the cause.',
    phase: 'V2',
  },

  // ── E16 ──────────────────────────────────────────────────────────────
  {
    id: 'E16',
    category: 'eyes_smile',
    name: 'Tooth lightness vs gum and lip contrast',
    measures:
      'How much lighter the front teeth are than the nearby gum and lip colour in the same photo. The same teeth look lighter against darker or redder surroundings and darker against lighter ones.',
    howMeasured:
      'From the same calibrated teeth close-up as E05, the app subtracts the CIELAB lightness (L*) of the gum and lip strip next to the teeth from that of the teeth. It is shown beside the E05 reading to explain why the teeth look lighter or darker from one scan to the next, for example when the gums are redder or the lip colour differs. It is not scored.',
    methods: ['COLOR_CALIBRATED_PHOTO', 'SEGMENTATION_PHOTO'],
    scale: {
      unit: 'ΔL* (teeth minus gum and lip, CIELAB)',
      min: null,
      max: null,
      description: 'Lightness of the teeth minus lightness of the nearby gum and lip strip',
      higherIs: 'not_applicable',
    },
    ideal: {
      summary: 'No target. Context for reading tooth colour (E05), not a goal.',
      male: null,
      rationale:
        'Dental colour studies report that surrounding skin, gum and lip colour changes how tooth colour differences are judged (JADA 2009; Lindsey et al. 2010), but the studies were small and none gives a contrast value to aim for.',
      confidenceInIdeal: 'low',
      populationCaveat: 'The studies used small rater groups and edited portraits of limited skin tones.',
    },
    scoring: { kind: 'none', reason: 'context_only' },
    changeability: 'FIXED',
    changeabilityNote:
      'Set by natural gum and lip colour. Gum redness from irritation changes it, which is why it is read together with E15.',
    weight: 0,
    weightRationale:
      'Context only: it explains E05 readings and adds no separate appearance effect that could be scored without counting tooth colour twice.',
    evidence: 'WEAK',
    evidenceNote:
      'Small studies and dental teaching say surrounding colours change how tooth shade looks. No study gives a contrast value that looks best, so this is shown as context and not scored.',
    sourceIds: ['eyes_smile:jada2009', 'eyes_smile:lindsey2010'],
    drivers: [],
    captureRequirements: ['teeth_closeup'],
    refusalConditions: [
      ...COLOUR_REFUSALS,
      ...TEETH_VISIBLE_REFUSALS,
      'lipstick or lip product visible on the lips',
      'gum or lip strip next to the teeth not visible on both sides',
    ],
    phase: 'V2',
  },
]

// ───────────────────────── sources ─────────────────────────

export const sources: Source[] = [
  {
    id: 'eyes_smile:russell2014',
    kind: 'peer_reviewed',
    citation:
      'Russell, R., Sweda, J. R., Porcheron, A., & Mauger, E. (2014). Sclera color changes with age and is a cue for perceiving age, health, and beauty. Psychology and Aging.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://doi.org/10.1037/a0036142',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported that eye whites in a large sample of white women were darker, redder and yellower with age, and that faces edited to have less dark, red or yellow eye whites were rated younger, healthier and more attractive. Volume and page numbers were not confirmed.',
    supports: 'Edited faces with less red or yellow in the eye whites were rated healthier and more attractive; sample was white women',
  },
  {
    id: 'eyes_smile:provine2013',
    kind: 'peer_reviewed',
    citation:
      'Provine, R. R., Cabrera, M. O., & Nave-Blodgett, J. (2013). Binocular symmetry/asymmetry of scleral redness as a cue for sadness, healthiness, and attractiveness in humans. Evolutionary Psychology, 11(4), 873–884.',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported that faces with digitally reddened eye whites were rated sadder, less healthy and less attractive than faces with untinted whites, with no separate effect of asymmetry. The abstract’s sample details were not confirmed.',
    supports: 'Faces with reddened eye whites were rated less healthy and less attractive in edited photos',
  },
  {
    id: 'eyes_smile:sundelin2013',
    kind: 'peer_reviewed',
    citation:
      'Sundelin, T., et al. (2013). Cues of fatigue: effects of sleep deprivation on facial appearance. Sleep, 36(9), 1355–1360.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://research.vu.nl/en/publications/cues-of-fatigue-effects-of-sleep-deprivation-on-facial-appearance/',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported that 40 observers rated photos of 10 people after normal sleep and after 31 hours awake, and that sleep-deprived faces were rated as having more hanging eyelids, redder and more swollen eyes, darker circles, paler skin and more wrinkles. These were ratings, not measurements. The full author list was not confirmed.',
    supports: 'In a rating study of 10 faces, sleep-deprived faces had more hanging lids, redder and more swollen eyes',
  },
  {
    id: 'eyes_smile:axelsson2010',
    kind: 'peer_reviewed',
    citation:
      'Axelsson, J., Sundelin, T., Ingre, M., Van Someren, E. J. W., Olsson, A., & Lekander, M. (2010). Beauty sleep: experimental study on the perceived health and attractiveness of sleep deprived people. BMJ, 341, c6614.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3001961/',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported 23 healthy adults photographed after a normal night and after sleep deprivation, with 65 untrained observers rating the sleep-deprived faces as less healthy, less attractive and more tired. The authors called for follow-up work.',
    supports: 'Sleep-deprived faces were rated less healthy, less attractive and more tired in a small experiment',
  },
  {
    id: 'eyes_smile:holding2019',
    kind: 'peer_reviewed',
    citation:
      'Holding, B. C., Sundelin, T., Cairns, P., Perrett, D. I., & Axelsson, J. (2019). The effect of sleep deprivation on objective and subjective measures of facial appearance. Journal of Sleep Research, 28(6), e12860.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://pubmed.ncbi.nlm.nih.gov/31006920/',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'Search summaries agreed on the design (181 participants randomised to one night of total sleep deprivation or normal sleep, then photographed) but disagreed on the results. The catalog relies on the version that reported no group difference in the facial measures it took or in observer ratings. If the result is read and differs, E01 and E09 should be revisited.',
    supports: 'A larger randomised study reportedly did not confirm that one sleepless night changes the facial measures or ratings',
  },
  {
    id: 'eyes_smile:peshek2011',
    kind: 'peer_reviewed',
    citation:
      'Peshek, D., Semmaknejad, N., Hoffman, D., & Foley, P. (2011). Preliminary evidence that the limbal ring influences facial attractiveness. Evolutionary Psychology, 9(2), 137–146.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://doi.org/10.1177/147470491100900201',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported that faces with a dark, distinct limbal ring, made by superimposing irises onto different faces, were rated more attractive than the same faces without one, by male and female observers. A later commentary, also seen only in a search summary, said many later studies reused the same stimuli.',
    supports: 'Faces edited to show a dark limbal ring were rated more attractive in a preliminary study',
  },
  {
    id: 'eyes_smile:tear_trough_scales',
    kind: 'convention',
    citation:
      'Tear-trough grading scales used in aesthetic medicine (for example the Barton grades 0–III and the Tear Trough Rating Scale). Clinical convention; no single publication is relied on.',
    verified: false,
    verificationNote:
      'UNVERIFIED and not a single record. Search summaries described several clinical grading scales that rate the lid-to-cheek groove from none to deep, and review text saying hollows add a tired look. No rating study with observers was found. The grading wording in E03 is the app’s own.',
    supports: 'Clinicians grade under-eye hollows on short scales and describe deep hollows as adding a tired or older look',
  },
  {
    id: 'eyes_smile:kokich1999',
    kind: 'peer_reviewed',
    citation:
      'Kokich, V. O., Jr., Kiyak, H. A., & Shapiro, P. A. (1999). Comparing the perception of dentists and lay people to altered dental esthetics. Journal of Esthetic Dentistry, 11, 311–324.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://pubmed.ncbi.nlm.nih.gov/10825866/',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported that smile photos were edited with eight common front-tooth problems (crown length and width, incisor angle, centre line, gum margin, tooth-edge line, gum-to-lip distance and others), and that orthodontists, general dentists and laypeople rated them. Secondary reports put the lay threshold for gum show at about 3 to 4 mm; sources differed. Crowding was not among the listed alterations.',
    supports: 'Lay raters mark down tilted tooth-edge lines, centre-line shifts and excess gum show once they reach a few millimetres',
  },
  {
    id: 'eyes_smile:johnston1999',
    kind: 'peer_reviewed',
    citation:
      'Johnston, C. D., Burden, D. J., & Stevenson, M. R. (1999). The influence of dental to facial midline discrepancies on dental attractiveness ratings. European Journal of Orthodontics, 21(5), 517–522.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://pubmed.ncbi.nlm.nih.gov/10565092',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported that one smile photo of a young woman had its tooth centre line moved against the face centre line, and 20 orthodontists and 20 young adult laypeople scored it. Scores dropped as the offset grew, orthodontists were more sensitive to small offsets, and the authors estimated a 56% chance that a layperson gave a lower score at 2 mm.',
    supports: 'Raters scored smiles lower as the tooth centre line moved off the face centre line; about 2 mm was noticed by some laypeople',
  },
  {
    id: 'eyes_smile:parrini2016',
    kind: 'peer_reviewed',
    citation:
      'Parrini, S., Rossini, G., Castroflorio, T., Fortini, A., Deregibus, A., & Debernardi, C. (2016). Laypeople’s perceptions of frontal smile esthetics: a systematic review. American Journal of Orthodontics and Dentofacial Orthopedics, 150(5), 740–750.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://doi.org/10.1016/j.ajodo.2016.06.022',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported a review of 66 studies listing lay thresholds of 0 to 2 mm for a gap between the centre teeth, 0 to 3 mm for centre-line shift, 1.5 to 4 mm for gum exposure and 0° to 4° for a tilted tooth-edge line, with too much variation for a meta-analysis and limited information about sample selection and outcome reporting.',
    supports: 'Lay thresholds for centre-line shift, gum show and tilted tooth edges are small but vary widely between studies',
  },
  {
    id: 'eyes_smile:prado2015',
    kind: 'peer_reviewed',
    citation:
      'Prado, et al. (2015). Societal perceptions of dentofacial appearances of patients with malocclusion: a systematic review. Arquivos em Odontologia.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://periodicos.ufmg.br/index.php/arquivosemodontologia/article/view/3559',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported a search of eight databases (1965 to 2015) that found 2,530 articles, of which four met the criteria, only one with a high level of evidence, and a call for better-designed studies. The first-name initials and the exact page range were not confirmed.',
    supports: 'The wider evidence on how society judges the appearance of people with malocclusion was rated weak in quality',
  },
  {
    id: 'eyes_smile:newton2021',
    kind: 'peer_reviewed',
    citation:
      'Newton, J. T., et al. (2021). Effect of tooth colour on subjective ratings of social judgements in Caucasian adults. Journal of Dentistry, 112, 103771. Title paraphrased from the abstract; not confirmed.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://doi.org/10.1016/j.jdent.2021.103771',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported 50 Caucasian adults rating 54 digitally modified photographs with darkened, natural or lightened teeth: darkened teeth got the poorest ratings, lightened teeth the best and natural teeth sat between, and lightened faces were seen as younger. Full methods were not confirmed.',
    supports: 'Teeth edited lighter were rated better and teeth edited darker were rated worse in an edited-photo experiment',
  },
  {
    id: 'eyes_smile:jada2009',
    kind: 'peer_reviewed',
    citation:
      'Assessing the influence of skin color and tooth shade value on perceived smile attractiveness. Journal of the American Dental Association, 140(6), 696–705 (2009). Authors not confirmed in this session.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://doi.org/10.14219/jada.archive.2009.0256',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported 70 dentists and 70 laypeople rating 24 versions of one edited smile photo with four skin tones and six tooth brightness values. Both groups did not rate the brightest teeth most attractive, and dark skin with very bright teeth and fair skin with dark teeth were rated as relatively unattractive. The figures come from the abstract summary and a trade write-up.',
    supports: 'The brightest tooth shade was not rated most attractive, and the preferred shade depended on skin tone',
  },
  {
    id: 'eyes_smile:lindsey2010',
    kind: 'peer_reviewed',
    citation:
      'Lindsey, D. T., et al. (2010). Study of how skin and gum colour change the judging of tooth-colour differences in facial portraits. Journal of Dental Research. Title paraphrased; authors and details not confirmed.',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported a small study (10 evaluators viewing facial portraits) in which skin and gum colour changed how sensitive people were to tooth-colour differences. The author list, title and volume were not confirmed.',
    supports: 'Surrounding skin and gum colour changes how tooth-colour differences are judged',
  },
  {
    id: 'eyes_smile:nathoo1997',
    kind: 'peer_reviewed',
    citation:
      'Nathoo, S. A. (1997). The chemistry and mechanisms of extrinsic and intrinsic discoloration. Journal of the American Dental Association, 128(Suppl), 6S–10S.',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported a review that classifies extrinsic stain by how colour-forming compounds attach to the tooth surface and describes the chemistry of discoloration. It was not shown to test any habit, rinse or drinking method, so the habit lever in E05 rests on how stains form, not on trials.',
    supports: 'Extrinsic tooth stain forms when colour-forming compounds attach to the tooth surface, which is why habits can slow new stain',
  },
  {
    id: 'eyes_smile:mariakakis2017',
    kind: 'peer_reviewed',
    citation:
      'Mariakakis, A., et al. (2017). BiliScreen: smartphone-based scleral jaundice monitoring for liver and pancreatic disorders. Proceedings of the ACM on Interactive, Mobile, Wearable and Ubiquitous Technologies, 1(2), Article 20.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://ubicomplab.cs.washington.edu/publications/biliscreen',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported a 70-person clinical study in which a phone camera estimated bilirubin from the eye white, using colour-calibration accessories to reduce the effect of room light, with the results described as an initial study that needed wider testing.',
    supports: 'Yellowing of the eye white is a recognised sign of raised bilirubin, and phone estimates needed colour calibration',
  },
  {
    id: 'eyes_smile:gunnery2016',
    kind: 'peer_reviewed',
    citation:
      'Gunnery, S. D., & Ruben, M. A. (2016). Perceptions of Duchenne and non-Duchenne smiles: a meta-analysis. Cognition and Emotion, 30(3), 501–515.',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported that Duchenne smiles were rated more positively (authentic, genuine, attractive, trustworthy), with a stronger effect for videos than photographs, for natural than posed smiles, and when the two smile types were not matched for mouth-corner pull. Effect sizes and study counts were not confirmed.',
    supports: 'Smiles with eye involvement are rated as more genuine, with a weaker effect for photographs and posed smiles',
  },
  {
    id: 'eyes_smile:krumhuber2009',
    kind: 'peer_reviewed',
    citation:
      'Krumhuber, E. G., & Manstead, A. S. R. (2009). Can Duchenne smiles be feigned? New evidence on felt and false smiles. Emotion, 9(6), 807–820.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://doi.org/10.1037/a0017844',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary of the abstract reported similar amounts of Duchenne and non-Duchenne smiles in spontaneous and posed conditions, and that raters still judged the smile types differently. A secondary write-up gave a figure of 83% of people able to produce eye-involved smiles that others mistook for real, which was not checked and is not used in the catalog.',
    supports: 'Eye-involved smiles can be produced on demand and the eye marker may follow smile intensity',
  },
  {
    id: 'eyes_smile:sarver2001',
    kind: 'peer_reviewed',
    citation:
      'Sarver, D. M. (2001). The importance of incisor positioning in the esthetic smile: the smile arc. American Journal of Orthodontics and Dentofacial Orthopedics.',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'Search results did not return the paper itself. Secondary sources described it as defining the smile arc as the relationship between the curve of the upper tooth edges and the lower lip, called consonant when parallel and flat when the tooth-edge line is flatter. Volume and pages are not given.',
    supports: 'Describes the smile arc and the consonant, flat and reverse patterns',
  },
  {
    id: 'eyes_smile:parekh2006',
    kind: 'peer_reviewed',
    citation:
      'Parekh, S. M., Fields, H. W., Beck, M., & Rosenstiel, S. (2006). Attractiveness of variations in the smile arc and buccal corridor space as judged by orthodontists and laymen. Angle Orthodontist, 76(4), 557–563. Title as recalled; not confirmed.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://angle-orthodontist.kglmeridian.com/view/journals/angl/76/4/article-p557.xml',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported a web survey in which orthodontists and laypeople rated nine digitally altered smile-arc and buccal-corridor variations of one male and one female smile. Both groups preferred arcs that follow the lower lip, flat arcs scored lower, and the summary said buccal-corridor width did not affect ratings in this study.',
    supports: 'Smile arcs that follow the lower lip were rated best; flat arcs scored lower; corridor width did not change ratings',
  },
  {
    id: 'eyes_smile:moore2005',
    kind: 'peer_reviewed',
    citation:
      'Moore, T., et al. (2005). Buccal corridors and smile esthetics. American Journal of Orthodontics and Dentofacial Orthopedics.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://iro.uiowa.edu/esploro/outputs/journalArticle/Buccal-corridors-and-smile-esthetics/9984065985102771',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported that lay judges compared digitally altered smiles with buccal corridors from 2% to 28% of smile width and judged broader smiles with minimal corridors more attractive. The author list, volume and pages were not confirmed.',
    supports: 'One study found raters preferred broader smiles with minimal dark space at the mouth corners',
  },
  {
    id: 'eyes_smile:zange2011',
    kind: 'peer_reviewed',
    citation:
      'Zange, S. E., et al. (2011). Perceptions of laypersons and orthodontists regarding the buccal corridor in long- and short-face individuals. Angle Orthodontist, 81(1), 86–90. Title and author list from memory; not confirmed.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://pubmed.ncbi.nlm.nih.gov/20936959',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported that laypeople could not tell the gradations of dark space in the buccal corridor unless it was very plain, that orthodontists noticed differences from about 15%, and that the presence of dark space had little influence on smile esthetics. The pairing of this record with the summary was inferred from the search listing.',
    supports: 'Laypeople could not distinguish buccal-corridor gradations unless the difference was very plain',
  },
  {
    id: 'eyes_smile:gingival_review2022',
    kind: 'peer_reviewed',
    citation:
      'The threshold of acceptability of excessive gingival display by laypersons: a systematic review. International Journal of Esthetic Dentistry (2022). Authors not confirmed in this session.',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported a review of 34 studies that concluded about 3 mm of gum exposure was acceptable to laypeople. Details of how studies were pooled were not confirmed.',
    supports: 'Laypeople in the reviewed studies generally accepted about 3 mm of gum show',
  },
  {
    id: 'eyes_smile:microesthetics',
    kind: 'peer_reviewed',
    citation:
      'Smile microesthetics as perceived by dental professionals and laypersons (rating study using digitally altered smile photographs). Journal, year and authors not confirmed in this session.',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported that laypeople rated pigmented or inflamed gums among the least attractive smile features in edited photographs, while dentists by specialty ranked the features differently. How inflammation was simulated was not confirmed.',
    supports: 'Laypeople scored inflamed gums as unattractive in edited smile photographs',
  },
  {
    id: 'eyes_smile:loe1965',
    kind: 'peer_reviewed',
    citation:
      'Löe, H., Theilade, E., & Jensen, S. B. (1965). Experimental gingivitis in man. Journal of Periodontology, 36, 177–187.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://doi.org/10.1902/jop.1965.36.3.177',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'Search summaries confirmed the bibliographic details and described a model in which healthy volunteers stopped oral hygiene for about three weeks and developed gum inflammation, showing the role of plaque. The time to recovery after restarting cleaning was not in the summaries, so the catalog gives it only as general dental teaching.',
    supports: 'Gum inflammation develops when plaque is allowed to build up in healthy volunteers',
  },
]
