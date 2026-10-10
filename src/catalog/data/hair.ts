/**
 * Hair catalog (category `hair`, ids H01–H15, weight total EXACTLY 14).
 *
 * Authoring notes (read before editing):
 *  - Every source here is verified:false. The authoring session had a working web SEARCH but no working page
 *    FETCH: the fetch tool failed with a DNS error (ENOTFOUND) on every host tried, and a direct request through
 *    the sandbox proxy was refused (HTTP 403) for PubMed, its API and Crossref. No record, abstract or paper was
 *    opened. Search digests were used only to cross-check bibliographic details and to avoid wrong claims, and
 *    each verificationNote says what the digest reported. A URL is given only where it appeared in a search result.
 *  - Numeric bands and scoring points are app-chosen grades and tolerances, not measured effect sizes. Each says so.
 *  - Weight changes against the v0 draft (still sums to 14): H04 4.0→3.0, H05 1.0→0, H08 0.5→0, H06 1.5→1.0,
 *    H01 3.0→3.25, H02 2.0→2.75, H09 new 1.0, H10 new 1.0. H03 1 and H07 1 unchanged. The H01/H02 raise rests only on the
 *    consistent self-reported burden of visible hair loss (13-study review), not on prevalence or on budget freed elsewhere;
 *    no photo-based rating study of thinning was found.
 *  - No search found a peer-reviewed test of face-shape→haircut rules, so H04 is graded CONVENTION and says so.
 *  - Genetic hair loss is not reversible with food or habits. H01 and H02 therefore carry no action-plan drivers.
 */
import type { Metric, Source } from '../schema'

// ───────────────────────── shared text ─────────────────────────

const NOFETCH =
  'UNVERIFIED. No record was opened: the page-fetch tool failed with a DNS error (ENOTFOUND) on every host tried (journals.sagepub.com, pubmed.ncbi.nlm.nih.gov, pmc.ncbi.nlm.nih.gov, doi.org), and a direct request through the sandbox proxy was refused (HTTP 403) for PubMed, its API and Crossref.'

const SCALP_PHOTO_LIGHT =
  'Scalp and hair photos depend on the light: a bright overhead light or flash makes the scalp and hair look different from one scan to the next, so scans are only compared when the lighting setup matches.'

const HAIR_PREP = [
  'hair wet or damp',
  'hair product, spray, powder or fibres in the hair',
  'hat, cap, headband or hair tie in the photo',
]

const FRONTAL_POSE = [
  'head yaw or roll above 3°',
  'head pitch above 2° from level',
  'estimated camera distance under 1.2 m',
]

const NEUTRAL_BROWS = ['expression not neutral (brows raised or squeezed)']

const HAIR_LOSS_DOCTOR =
  'Hair coming out in clumps, round or oval bald patches, a sudden drop in thickness over weeks, or a scalp that is red, scaly, painful, burning or scarred: see a doctor. Do not wait for the next scan.'

// ───────────────────────── metrics ─────────────────────────

export const metrics: Metric[] = [
  // ── H01 ──────────────────────────────────────────────────────────────
  {
    id: 'H01',
    category: 'hair',
    name: 'Hairline recession (Norwood stage)',
    measures:
      'How far the hairline has moved back at the temples and the top of the forehead, graded on the Norwood scale (stage 1 = no recession, stage 7 = most advanced loss). It is the standard clinical staging of male-pattern hair loss.',
    howMeasured:
      'Self-grade against reference drawings of each Norwood stage, using the front hairline photo with the hair swept back off the forehead. The app also measures the distance from the hair edge to the brow line with the face-landmark model, so change between scans is tracked even when the stage does not change. The app does not assign the stage itself: the drawings are a coarse guide, and two people can grade the same hairline one stage apart. Refused when the hairline edge is hidden or filled in, because a covered edge gives a wrong stage.',
    methods: ['SELF_GRADE_REFERENCE', 'AUTO_FRONTAL_PHOTO'],
    scale: {
      unit: 'Norwood stage',
      min: 1,
      max: 7,
      description:
        'Stage 1 = no recession; stage 7 = most advanced loss. Vertex-first variants are graded at their closest numbered stage.',
      higherIs: 'worse',
    },
    ideal: {
      summary:
        'Stage 1 or 2. Clinic sources describe stage 2, a small recession at the temples, as a normal adult hairline. Stages 3 to 7 mean clear hair loss.',
      male: { lo: 1, hi: 2 },
      rationale:
        'The staging is a clinical classification, not a beauty scale. The score points are app-chosen: full marks for stages 1 and 2, then a loss of about 16 points per stage that flattens at the end, with a floor of 32 because a fully receded hairline worn short or shaved is not a zero (a shaved head was rated more dominant but older and less attractive in one study). They are not measured effect sizes. Norwood’s original paper was not opened, so the “stage 2 is normal” wording comes from secondary sources.',
      confidenceInIdeal: 'medium',
      populationCaveat:
        'Norwood’s staging and incidence figures came from 1,000 white adult men in the United States in the 1970s. Patterns and rates differ in other groups, and the rating studies of thinning hair used young, mostly Western raters.',
    },
    scoring: {
      kind: 'one_sided',
      points: [
        { x: 1, y: 100 },
        { x: 2, y: 100 },
        { x: 3, y: 82 },
        { x: 4, y: 66 },
        { x: 5, y: 52 },
        { x: 6, y: 40 },
        { x: 7, y: 32 },
      ],
    },
    changeability: 'SURGICAL_ONLY',
    changeabilityNote:
      'Male-pattern hair loss is genetic and progressive. Nothing in food, sleep, training or scalp care is established to bring a receded hairline back or to stop it. A haircut changes how much the recession shows (scored in H04) but not the hairline itself. Hair transplant surgery is the only non-medical way to restore a hairline and is outside this app’s plan. Medical treatments exist and are a decision for a doctor.',
    weight: 3.25,
    weightRationale:
      'Largest hair weight, 3.25 against the draft’s 3.0. The weight rests only on the evidence: self-report studies and a systematic review consistently find that hair loss is a significant psychological burden for men. It is not justified by how common hair loss is, nor by weight freed from other metrics. The effect of visible hair loss on how others rate appearance is weakly supported (one text-description experiment, no photo-based study found), which is why the weight is not higher.',
    evidence: 'MODERATE',
    evidenceNote:
      'MODERATE applies only to the men’s own reported distress and body image (Cash 1992 and a 13-study review measure the man’s own feelings, not how others rate him). For the effect on how others see him the evidence is WEAK: the thinning result in Mannes (2013) came from a text-description experiment (profiles reading “thinning brown hair”, “thick brown hair” or “shaved head”), not from photos or real hairlines. No photo-based rating study of thinning was found, and the 1996 beard-and-baldness study is reported inconsistently, so the size of the effect on attractiveness is uncertain.',
    sourceIds: [
      'hair:norwood1975',
      'hair:ellis2002',
      'hair:pirastu2017',
      'hair:mannes2013',
      'hair:muscarella1996',
      'hair:cash1992',
      'hair:aukerman2023',
    ],
    drivers: [],
    captureRequirements: ['hairline_front', 'frontal_neutral'],
    refusalConditions: [
      ...FRONTAL_POSE,
      ...NEUTRAL_BROWS,
      ...HAIR_PREP,
      'hairline edge hidden by hair combed forward or sideways',
      'hair not swept back off the forehead',
      'either temple hidden by hair, a hat or a shadow',
    ],
    medicalFlag:
      'A hairline that moves back noticeably over weeks to a few months, or a hairline or scalp that is red, scaly, painful, burning or scarred: see a doctor. Pattern loss is slow; fast change is not typical of it.',
    phase: 'M2',
  },

  // ── H02 ──────────────────────────────────────────────────────────────
  {
    id: 'H02',
    category: 'hair',
    name: 'Scalp show at the crown and parting (density)',
    measures:
      'How much scalp can be seen through the hair at the crown (top-back of the head) and along the parting. It reflects hair density, strand thickness and hair-to-scalp colour contrast together.',
    howMeasured:
      'Self-grade 0–3 against reference images for the crown and the parting, assisted by an automatic estimate of the share of scalp pixels in the top-down crown photo. The photo estimate is lighting-dependent: bright overhead light, wet hair, or dark hair on a pale scalp makes the scalp show more, and a shadow hides it. So the automatic estimate is used only to track change between scans taken in the same setup, and the score comes from the grade. Refused when the crown is not visible or the light is not comparable. ' +
      SCALP_PHOTO_LIGHT,
    methods: ['SEGMENTATION_PHOTO', 'SELF_GRADE_REFERENCE'],
    scale: {
      unit: 'grade',
      min: 0,
      max: 3,
      description:
        'Scalp show at the crown and parting: 0 = none, 1 = slight when parted, 2 = clearly visible, 3 = extensive',
      higherIs: 'worse',
    },
    ideal: {
      summary:
        'Grade 0 or 1: the scalp does not show through at normal conversation distance. No absolute density norm exists for a phone photo, so the grade is the reference.',
      male: { lo: 0, hi: 1 },
      rationale:
        'Visible thinning is what raters and men themselves react to. The grade steps are app-defined, and the points (100, 85, 60, 35) are chosen so that slight thinning costs little and clear scalp show costs more. They are not measured effect sizes.',
      confidenceInIdeal: 'low',
      populationCaveat:
        'The same density shows differently depending on hair colour against scalp colour and on strand thickness (see H12 and H13). Rating studies of thinning hair used Western, mostly young raters.',
    },
    scoring: {
      kind: 'one_sided',
      points: [
        { x: 0, y: 100 },
        { x: 1, y: 85 },
        { x: 2, y: 60 },
        { x: 3, y: 35 },
      ],
    },
    changeability: 'FIXED',
    changeabilityNote:
      'Pattern thinning is genetic and progressive, and no food, sleep, training or scalp habit is established to reverse it. Two non-genetic causes exist and are handled elsewhere: breakage and tight styling (H03), and temporary shedding after crash dieting or illness (H15).',
    weight: 2.75,
    weightRationale:
      'Raised from the draft’s 2.0 to 2.75. The weight rests on the same evidence as H01: the self-reported burden of visible thinning, not on weight freed elsewhere. Held below H01 because the photo estimate depends on lighting and the score rests on a self-assessed grade, and because no photo-based rating study of thinning was found.',
    evidence: 'MODERATE',
    evidenceNote:
      'MODERATE only for the self-reported psychological burden of visible thinning. For how others rate thin hair the evidence is WEAK: the one rating result (Mannes 2013) came from text-only profiles, not photos. The photo measurement is lighting-dependent, so the app scores a grade and uses the percentage only to track change.',
    sourceIds: ['hair:mannes2013', 'hair:cash1992', 'hair:aukerman2023', 'hair:ellis2002', 'hair:pirastu2017'],
    drivers: [],
    captureRequirements: ['crown_top', 'hair_natural'],
    refusalConditions: [
      ...HAIR_PREP,
      'crown not visible (no top-down view)',
      'bright direct overhead light or flash glare on the scalp',
      'lighting setup differs from the previous scans (for change tracking)',
      'haircut changed since the baseline scan (for change tracking)',
    ],
    medicalFlag: HAIR_LOSS_DOCTOR,
    phase: 'M2',
  },

  // ── H03 ──────────────────────────────────────────────────────────────
  {
    id: 'H03',
    category: 'hair',
    name: 'Hair condition (breakage, frizz, dullness)',
    measures:
      'How damaged the hair shaft looks: snapped or split ends, frizz, and a rough or dull surface. It reflects how the hair has been handled, not the hair root.',
    howMeasured:
      'Self-grade 0–3 against reference images, using a close-up of the hair lengths in daylight. The app also asks about heat tools, tight styles and towel-rubbing to explain the grade. Grading is against hair of the same texture (H11), because curly and coily hair shows frizz and shine differently from straight hair. Refused when flash glare or product makes the surface look glossy or stiff.',
    methods: ['SELF_GRADE_REFERENCE', 'CHECKLIST'],
    scale: {
      unit: 'grade',
      min: 0,
      max: 3,
      description: 'Visible damage: 0 = none, 1 = minor, 2 = clear breakage or frizz, 3 = severe',
      higherIs: 'worse',
    },
    ideal: {
      summary: 'Grade 0 or 1: ends are mostly intact, frizz is low for the hair’s texture, and the surface is even.',
      male: { lo: 0, hi: 1 },
      rationale:
        'Damaged-looking hair is a conventional sign of neglect. Hair quality has been studied as a health cue mainly in women’s hair, and no study of men’s hair condition was found. The band and the points (100, 90, 65, 40) are app-chosen.',
      confidenceInIdeal: 'low',
    },
    scoring: {
      kind: 'one_sided',
      points: [
        { x: 0, y: 100 },
        { x: 1, y: 90 },
        { x: 2, y: 65 },
        { x: 3, y: 40 },
      ],
    },
    changeability: 'CHANGEABLE',
    changeabilityNote:
      'Damaged lengths do not repair. They grow out or are cut off over weeks to months. What the user controls is new damage: heat, rough drying and tight styles.',
    weight: 1,
    weightRationale:
      'At the 1.0 cap for WEAK evidence, unchanged from the draft. Held there because breakage is the part of hair appearance that habits do change, and tight styles and breakage are the non-genetic causes of thinning.',
    evidence: 'WEAK',
    evidenceNote:
      'Damage from heat, rough handling and tight styles is described in dermatology reviews, but no study found measures how much hair condition changes how attractive a man looks. The weight is small for that reason.',
    sourceIds: ['hair:gavazzoni2015', 'hair:billero2018'],
    drivers: ['hair_handling', 'haircut', 'grooming'],
    captureRequirements: ['hair_natural'],
    refusalConditions: [
      'hair wet or damp',
      'hair product making the hair stiff or glossy',
      'flash or strong glare on the hair',
      'close-up out of focus',
    ],
    phase: 'M2',
  },

  // ── H04 ──────────────────────────────────────────────────────────────
  {
    id: 'H04',
    category: 'hair',
    name: 'Haircut suitability (cut, hairline and face-shape fit)',
    measures:
      'Whether the current cut and styling work with the user’s own hairline, hair density, texture and face outline. It is a checklist of cut rules, not a beauty rating.',
    howMeasured:
      'Checklist the user answers from the front, side and top photos with example images for each item. The app pre-fills items it can compute (hair clear of the brows, left-right balance of the outline) and the user confirms. The face-shape class is approximate: it comes from the frontal photo outline, which lens distortion, hair or beard over the outline, head pose and jaw shadow can all change. The face_balance item is therefore confirmed by the user only and is never passed automatically. Ratings by trusted people are planned for V3. Refused when the hair is wet, flattened by a hat, or not in its normal daily style, or when the face outline is hidden.',
    methods: ['CHECKLIST', 'AUTO_FRONTAL_PHOTO'],
    scale: {
      unit: '%',
      min: 0,
      max: 100,
      description: 'Share of checklist items passed; failing a critical item caps the score',
      higherIs: 'better',
    },
    ideal: {
      summary:
        'All checklist items pass. Each item is a barber or stylist rule, not a tested attractiveness result.',
      male: null,
      rationale:
        'No study found tests whether matching a cut to face shape changes ratings. What is supported is the premise: hair changes how a face is read (recognition drops when the hair changes) and the state of the hair changes ratings. The checklist therefore lists the universal items first (eyes and brows clear, clean outline, no cover-up of thinning) and treats the face-shape item as convention.',
      confidenceInIdeal: 'low',
      populationCaveat:
        'Stylist rules differ by hair texture, culture and fashion period. The studies behind the premise used Western raters.',
    },
    scoring: {
      kind: 'checklist',
      criticalItemCap: 60,
      items: [
        { id: 'eyes_clear', label: 'Hair does not fall over the eyes or brows', critical: true },
        {
          id: 'no_cover_up',
          label:
            'The style does not rely on long strands combed across a thinning area (pass automatically if there is no thinning)',
          critical: true,
        },
        {
          id: 'clean_outline',
          label: 'Sides, back and neckline are cut cleanly, with no shaggy or uneven edges',
          critical: false,
        },
        {
          id: 'length_for_density',
          label: 'Length on top suits the current density: thin areas are not left long enough to lie flat and show scalp',
          critical: false,
        },
        {
          id: 'face_balance',
          label:
            'User-confirmed only, never auto-passed. The outline balances the face shape (stylist convention, approximate class): added height for a round or wide face, less height for a long face',
          critical: false,
        },
        {
          id: 'works_with_texture',
          label: 'The style works with the natural texture instead of needing heavy daily forcing to lie flat',
          critical: false,
        },
        {
          id: 'deliberate_finish',
          label: 'Hair is dry and styled to a deliberate shape: not matted, flattened or greasy-looking',
          critical: false,
        },
      ],
    },
    changeability: 'CHANGEABLE',
    changeabilityNote:
      'The cut and styling are fully controllable. The hairline, density and texture the cut has to work with are not (H01, H02, H11).',
    weight: 3,
    weightRationale:
      'Second-largest hair weight, cut from the draft’s 4.0 to 3.0 because the face-shape rules are convention and untested. Only one of seven items (face_balance) is a face-shape rule; the others (eyes clear, clean outline, no cover-up, length for density, deliberate finish) are universal grooming items. The weight stays moderate because the haircut is the main non-medical lever on how hair reads, but the support is the recognition study of Toseeb (2012), not an attractiveness study, and the item rules are untested convention.',
    evidence: 'CONVENTION',
    evidenceNote:
      'The rules are stylist and barber convention. No study found tests whether matching a cut to face shape changes ratings, although it is well supported that hair changes how a face is read.',
    sourceIds: ['hair:toseeb2012', 'hair:mannes2013', 'hair:nutt2025', 'hair:barberrules'],
    drivers: ['haircut', 'hair_handling', 'grooming'],
    captureRequirements: ['frontal_neutral', 'profile_left', 'crown_top', 'hair_natural'],
    refusalConditions: [
      'hair wet or damp',
      'hair flattened by a hat, cap or headband',
      'hair not in its normal daily style',
      'cut grown out past its normal interval (maintenance is scored in G01)',
      'head yaw or roll above 3° on the frontal photo',
      'face outline hidden by hair or beard (face-shape class not usable)',
      'estimated camera distance under 1.2 m (wide-angle distortion changes the outline)',
    ],
    phase: 'M2',
  },

  // ── H05 ──────────────────────────────────────────────────────────────
  {
    id: 'H05',
    category: 'hair',
    name: 'Facial hair density and coverage',
    measures:
      'How much of the beard area (cheeks, chin, upper lip, jawline, neck) grows hair, and how even the growth is. It tells the app which styles are realistic. It is not scored.',
    howMeasured:
      'The user lets the face grow for the same number of days each time (the app suggests 7, because shorter growth hides gaps). The user grades coverage 0–3 for each zone against reference images, and the app estimates the share of each zone covered by hair from the photo. Refused when the face was shaved or trimmed too recently, when the growth is dyed or filled in, or when shadows hide the jawline.',
    methods: ['SELF_GRADE_REFERENCE', 'SEGMENTATION_PHOTO'],
    scale: {
      unit: '% of zone covered',
      min: 0,
      max: 100,
      description: 'Share of each beard zone with visible hair after the standard growth period',
      higherIs: 'not_applicable',
    },
    ideal: {
      summary:
        'No ideal. Clean-shaven, stubble and beard looks were all rated well in different studies; what the app needs is the coverage pattern so H06 can pick a style that fits.',
      male: null,
      rationale:
        'The studies found compare grooming states of the same men (shaved, stubble, beard). None tested how dense a man’s growth is, and preferences shift with how common each look is among the faces people see.',
      confidenceInIdeal: 'low',
      populationCaveat:
        'Beard growth differs between men and between ancestry groups. The rating studies used small sets of photographed men and Western raters.',
    },
    scoring: { kind: 'none', reason: 'context_only' },
    changeability: 'FIXED',
    changeabilityNote:
      'Beard growth follows genetics and hormone sensitivity. No food, training or grooming habit changes it. Style and lines on top of it are controllable (H06).',
    weight: 0,
    weightRationale:
      'Context only. The draft gave this 1.0, but no study found tests whether denser facial hair is rated higher. The freed 1.0 was reallocated to H01, H02, H09 and H10.',
    evidence: 'WEAK',
    evidenceNote:
      'Studies compare shaved, stubble and beard states. None tested whether denser growth is rated higher, so density is treated as a fact that shapes the style choice, not as a score.',
    sourceIds: ['hair:dixson2013', 'hair:janif2014'],
    drivers: [],
    captureRequirements: ['frontal_neutral', 'three_quarter_left', 'three_quarter_right'],
    refusalConditions: [
      'face shaved or trimmed in the last 5 days',
      'facial hair coloured, filled in or darkened with product',
      'head yaw or roll above 3° on the frontal photo',
      'jawline or neck hidden by shadow or a collar',
    ],
    medicalFlag:
      'Sudden round bald patches in the beard, or beard loss together with itching, scaling or redness: see a doctor.',
    phase: 'M2',
  },

  // ── H06 ──────────────────────────────────────────────────────────────
  {
    id: 'H06',
    category: 'hair',
    name: 'Facial hair style and lines',
    measures:
      'Whether the facial hair in the photo looks deliberate and kept: even length, defined cheek line and neckline, and a style that fits the user’s own coverage. For a clean-shaven user it covers how cleanly the face is shaved.',
    howMeasured:
      'Checklist answered from the frontal and three-quarter photos with example images for each item. The app pre-fills the style-fit item from the coverage grade in H05. It scores upkeep and fit, not one particular style, because no style wins across studies. Refused when the jawline or neck cannot be seen.',
    methods: ['CHECKLIST'],
    scale: {
      unit: '%',
      min: 0,
      max: 100,
      description: 'Share of checklist items passed; failing a critical item caps the score',
      higherIs: 'better',
    },
    ideal: {
      summary:
        'All checklist items pass. The line rules are barber convention. The studies show that the amount of facial hair a man wears changes how he is rated, but not which lines are best.',
      male: null,
      rationale:
        'Rating studies of the same men at four to five grooming levels found light or heavy stubble rated most attractive by women raters, and full beards rated highest for masculinity and for parenting ability. A later study found that preferences shift with how common beards are. No single style wins, so the checklist scores upkeep and fit.',
      confidenceInIdeal: 'low',
      populationCaveat:
        'The studies used photos or computer-made faces of 10 to 36 men and Western raters, mostly women. Preferences differ by rater, place and fashion.',
    },
    scoring: {
      kind: 'checklist',
      criticalItemCap: 70,
      items: [
        {
          id: 'fit_to_coverage',
          label: 'The style fits the user’s own coverage: patchy areas are not left on show (kept short or shaved)',
          critical: true,
        },
        { id: 'even_length', label: 'Length is even across the beard or stubble (any fade is deliberate)', critical: false },
        { id: 'cheek_line', label: 'Cheek line is clean and matches on both sides', critical: false },
        {
          id: 'neckline',
          label: 'Neckline is defined and sits above the Adam’s apple, with no loose growth down the throat',
          critical: false,
        },
        { id: 'moustache_clear', label: 'Moustache hair is trimmed clear of the lip edge', critical: false },
        {
          id: 'shave_clean',
          label: 'If clean-shaven: no missed patches or stubble islands',
          critical: false,
        },
      ],
    },
    changeability: 'CHANGEABLE',
    changeabilityNote:
      'Style, length and lines are fully controllable. The growth pattern under them is not (H05).',
    weight: 1,
    weightRationale:
      'Cut from the draft’s 1.5 to 1.0 because the evidence is convention. Facial hair upkeep is visible and changeable, and rating studies show facial hair state moves ratings. The studies are small, so the metric is graded as convention and its items are upkeep rules, not a claimed ideal.',
    evidence: 'CONVENTION',
    evidenceNote:
      'Small rating studies show that the level of facial hair changes how men are rated, but they disagree about which level is best and do not test line rules. The checklist items are barber convention.',
    sourceIds: ['hair:dixson2013', 'hair:neave2008', 'hair:janif2014', 'hair:barberrules'],
    drivers: ['beard_design', 'grooming'],
    captureRequirements: ['frontal_neutral', 'three_quarter_left', 'three_quarter_right'],
    refusalConditions: [
      'head yaw or roll above 3° on the frontal photo',
      'jawline or neck hidden by shadow or a collar',
      'facial hair filled in or darkened with product',
      'photo more than 2 days after the last trim (lines are not comparable)',
    ],
    phase: 'M2',
  },

  // ── H07 ──────────────────────────────────────────────────────────────
  {
    id: 'H07',
    category: 'hair',
    name: 'Brow grooming (strays, gaps, symmetry)',
    measures:
      'How tidy and balanced the eyebrows are: stray hairs outside the brow shape, gaps made by over-trimming, and the left-right match in height and shape. Brow fullness itself is H08.',
    howMeasured:
      'The face-landmark model measures the left-right difference in brow height on the frontal neutral photo, and the user confirms the stray-hair and gap items from a close-up. The symmetry item is pre-filled as a pass when the difference is under 3% of the pupil distance; that tolerance is app-chosen, not a tested visibility limit. Refused unless the expression is neutral, because raising or squeezing the brows moves them.',
    methods: ['AUTO_FRONTAL_PHOTO', 'CHECKLIST'],
    scale: {
      unit: '%',
      min: 0,
      max: 100,
      description: 'Share of checklist items passed; failing a critical item caps the score',
      higherIs: 'better',
    },
    ideal: {
      summary:
        'Clean and symmetric with natural-looking edges. This is grooming convention, not a tested attractiveness result.',
      male: null,
      rationale:
        'Eyebrows matter for how a face is read: removing them hurt recognition of familiar faces more than removing the eyes did. No study found tests whether tidy or symmetric brows change how attractive a man looks.',
      confidenceInIdeal: 'low',
      populationCaveat: 'Norms for brow shape and for the area between the brows differ across cultures.',
    },
    scoring: {
      kind: 'checklist',
      criticalItemCap: 75,
      items: [
        {
          id: 'not_overgroomed',
          label: 'Brows are not over-thinned: no gaps or bare patches from trimming, waxing or plucking',
          critical: true,
        },
        { id: 'no_strays', label: 'No stray hairs outside the main brow shape', critical: false },
        {
          id: 'between_brows',
          label: 'The area between the brows is tidy (cleared, or kept short and even)',
          critical: false,
        },
        { id: 'symmetry', label: 'Left and right brows match in height and shape', critical: false },
        {
          id: 'long_hairs',
          label: 'Long brow hairs are trimmed so none hangs over the lid or points out of line',
          critical: false,
        },
      ],
    },
    changeability: 'CHANGEABLE',
    changeabilityNote:
      'Strays and long hairs are fixed in minutes. Removed hairs may not grow back fully, so trimming is the cautious step when unsure.',
    weight: 1,
    weightRationale:
      'At the 1.0 cap for WEAK evidence, unchanged from the draft. Brows are quick to change and visible at conversation distance, but no rating study of men’s brow grooming was found.',
    evidence: 'WEAK',
    evidenceNote:
      'Brows matter for recognising a face, but no study found tests whether tidy or symmetric brows change how attractive a man looks. Treat this as upkeep.',
    sourceIds: ['hair:sadr2003'],
    drivers: ['grooming'],
    captureRequirements: ['frontal_neutral', 'eye_closeup'],
    refusalConditions: [
      ...NEUTRAL_BROWS,
      'head yaw or roll above 3°',
      'hair, glasses frame or a shadow covering the brows',
      'brows filled in with pencil or powder',
    ],
    phase: 'M2',
  },

  // ── H08 ──────────────────────────────────────────────────────────────
  {
    id: 'H08',
    category: 'hair',
    name: 'Brow density and fullness',
    measures:
      'How full and continuous the brow hair is, from sparse with gaps to dense. It is context for H07 and is not scored.',
    howMeasured:
      'Self-grade 0–3 against reference images on the frontal photo, assisted by an estimate of the share of the brow outline filled with hair. Refused when the brows are filled in with product, covered, or the expression is not neutral.',
    methods: ['SELF_GRADE_REFERENCE', 'AUTO_FRONTAL_PHOTO'],
    scale: {
      unit: 'grade',
      min: 0,
      max: 3,
      description: 'Brow fullness: 0 = sparse with gaps, 3 = dense and continuous',
      higherIs: 'not_applicable',
    },
    ideal: {
      summary:
        'No evidence-based ideal for men. One rating study tested brow thickness as one of five face features, but the direction for male faces could not be confirmed here, so no band is set.',
      male: null,
      rationale:
        'The study found (a conjoint ranking of 922 participants) reports small to moderate effects of brow thickness, but the search digest available stated the direction for male faces unclearly. Until it is confirmed, brow fullness only tells H07 how much shaping to suggest.',
      confidenceInIdeal: 'low',
      populationCaveat: 'One study, with Western participants; the direction for men is unconfirmed.',
    },
    scoring: { kind: 'none', reason: 'context_only' },
    changeability: 'FIXED',
    changeabilityNote: 'Brow fullness is mostly genetic. Growing out trimmed or plucked brows is a grooming matter covered in H07.',
    weight: 0,
    weightRationale:
      'Context only. The draft gave this 0.5, but the direction of the effect for men could not be confirmed, so there is no defensible scoring rule. The freed 0.5 was reallocated to H01, H02, H09 and H10.',
    evidence: 'WEAK',
    evidenceNote:
      'One rating study included brow thickness, but its direction for men could not be confirmed from the material available. Brow fullness is recorded for context, not scored.',
    sourceIds: ['hair:mogilski2018'],
    drivers: [],
    captureRequirements: ['frontal_neutral', 'eye_closeup'],
    refusalConditions: [
      ...NEUTRAL_BROWS,
      'brows filled in with pencil or powder',
      'hair, glasses frame or a shadow covering the brows',
    ],
    medicalFlag:
      'Brow hair that thins over weeks (especially the outer ends), or bare round patches in the brows: see a doctor.',
    phase: 'M2',
  },

  // ── H09 ──────────────────────────────────────────────────────────────
  {
    id: 'H09',
    category: 'hair',
    name: 'Scalp flaking (dandruff visibility)',
    measures:
      'How visible loose white or yellowish flakes are on the scalp, in the parting and on dark clothing at normal conversation distance.',
    howMeasured:
      'Self-grade 0–3 against reference images from a close-up of the parting and a photo of dark shoulders. The app asks how many days since the last wash and keeps that the same each time, because flaking changes with the wash cycle. The user also reports itch and redness. Refused when dry shampoo, powder or fibres are in the hair, because they look like flakes.',
    methods: ['SELF_GRADE_REFERENCE', 'CHECKLIST'],
    scale: {
      unit: 'grade',
      min: 0,
      max: 3,
      description:
        '0 = none seen; 1 = a few flakes only on close inspection; 2 = flakes visible on the scalp or collar at conversation distance; 3 = heavy scale or thick crusts',
      higherIs: 'worse',
    },
    ideal: {
      summary: 'Grade 0 or 1: flakes are only seen on close inspection.',
      male: { lo: 0, hi: 1 },
      rationale:
        'Dandruff is common, with estimates up to about half of adults, so a little flaking is normal. The app scores visibility at conversation distance, which is a grooming convention. The points (100, 85, 50, 20) are app-chosen, and no rating study found measures the effect of flaking on attractiveness.',
      confidenceInIdeal: 'low',
      populationCaveat:
        'Reported dandruff rates differ by ancestry and between studies, so a given grade means different things in different groups.',
    },
    scoring: {
      kind: 'one_sided',
      points: [
        { x: 0, y: 100 },
        { x: 1, y: 85 },
        { x: 2, y: 50 },
        { x: 3, y: 20 },
      ],
    },
    changeability: 'CHANGEABLE',
    changeabilityNote:
      'Flaking comes and goes. A steady wash routine and gentle scalp handling can reduce it. If it persists, a doctor or pharmacist can say whether it is dandruff or another skin condition. This app does not recommend products or ingredients; a product the user already owns is the only product lever it considers.',
    weight: 1,
    weightRationale:
      'New metric, at the 1.0 cap for WEAK evidence. It is a visible, changeable grooming item; no rating study measures its effect, so the weight stays at the cap.',
    evidence: 'WEAK',
    evidenceNote:
      'Dandruff is very common, and reviews describe it as the mild end of a scalp skin condition. No rating study found measures how visible flakes change attractiveness, so the weight is small and rests on grooming convention.',
    sourceIds: ['hair:borda2015'],
    drivers: ['hair_handling', 'whitelist_product'],
    captureRequirements: ['crown_top', 'hair_natural', 'self_report'],
    refusalConditions: [
      'dry shampoo, powder or hair fibres in the hair',
      'days since last wash differ from the previous scans',
      'flash or bright glare on the scalp',
      'dark-shoulder photo taken on a patterned or light top',
    ],
    medicalFlag:
      'Flaking with red, inflamed, oozing or painful patches, thick crusts, patches spreading to the face, ears or chest, or flaking together with hair loss: see a doctor.',
    phase: 'M2',
  },

  // ── H10 ──────────────────────────────────────────────────────────────
  {
    id: 'H10',
    category: 'hair',
    name: 'Grey hair (share of head hair that is grey)',
    measures:
      'The share of head hair that has lost its colour (grey or white), estimated across the top, sides and temples. Greying is normal ageing and starts at different ages in different people.',
    howMeasured:
      'Self-estimate in steps (none, under 10%, 10–25%, 25–50%, over 50%) against reference images, from the front, side and top photos in even light. The step midpoint is used as the value. A colour-calibrated photo measurement could replace the estimate in V2. Refused when the hair is coloured, wet or in coloured light, because those hide or change the grey share.',
    methods: ['SELF_GRADE_REFERENCE', 'COLOR_CALIBRATED_PHOTO'],
    scale: {
      unit: '% grey',
      min: 0,
      max: 100,
      description: 'Estimated share of visible head hair that is grey or white',
      higherIs: 'worse',
    },
    ideal: {
      summary:
        'No ideal: greying is normal ageing. For the score, less grey is treated as slightly better because the one experiment found links grey hair to looking older and a modest drop in attractiveness ratings.',
      male: null,
      rationale:
        'The score runs from 100 at no grey hair to 70 at fully grey, in a straight line. The slope is deliberately gentle and app-chosen: one experiment reports a modest effect and no study gives a size per percentage point. A 55-year-old with grey hair is normal for that age, and the app does not call it a flaw.',
      confidenceInIdeal: 'low',
      populationCaveat:
        'Onset age and speed vary by ancestry: a worldwide survey (seen only as a search digest) found less grey hair in people of Asian and African descent than in people of European descent at the same age. The one experiment used 120 raters.',
    },
    scoring: {
      kind: 'one_sided',
      points: [
        { x: 0, y: 100 },
        { x: 100, y: 70 },
      ],
    },
    changeability: 'FIXED',
    changeabilityNote:
      'Greying is driven mainly by age and genes. No food, sleep or training habit is established to reverse it. A haircut changes how much grey shows at the sides (H04).',
    weight: 1,
    weightRationale:
      'New metric at the 1.0 cap for WEAK evidence (one experiment that manipulated grey hair on the same faces, so the direction is clear and the size is modest).',
    evidence: 'WEAK',
    evidenceNote:
      'One 2025 experiment found grey hair made faces look older and somewhat less attractive, and lowered trust ratings in male faces only. Earlier work was mostly questionnaires, and one experiment does not settle the effect.',
    sourceIds: ['hair:nutt2025', 'hair:panhard2012'],
    drivers: [],
    captureRequirements: ['hair_natural', 'hairline_front'],
    refusalConditions: [
      'hair coloured, toned or tinted',
      ...HAIR_PREP.slice(0, 1),
      'warm or coloured light on the hair',
      'strong backlight making hair look lighter',
    ],
    phase: 'M2',
  },

  // ── H11 ──────────────────────────────────────────────────────────────
  {
    id: 'H11',
    category: 'hair',
    name: 'Hair texture (straight, wavy, curly, coily)',
    measures:
      'The natural curl pattern of the user’s hair. It decides which cuts, lengths and styling methods work (H04) and how frizz and shine should be read (H03).',
    howMeasured:
      'The user picks the pattern from labelled reference images, with the hair washed and left to air-dry. The pick is stored once and asked again only if the user says the texture changed. There is no automatic measurement, because curl-type charts are informal. Refused when the pick is made on hair that was straightened, permed or heat-styled flat.',
    methods: ['SELF_GRADE_REFERENCE'],
    scale: {
      unit: 'type',
      min: 1,
      max: 4,
      description: '1 = straight, 2 = wavy, 3 = curly, 4 = coily',
      higherIs: 'not_applicable',
    },
    ideal: {
      summary: 'No ideal. Every texture can look well kept; the app uses the texture to choose which haircut rules apply.',
      male: null,
      rationale: 'Texture is an inherited trait and the app does not rank textures.',
      confidenceInIdeal: 'medium',
    },
    scoring: { kind: 'none', reason: 'context_only' },
    changeability: 'FIXED',
    changeabilityNote:
      'Texture is inherited and stays. Heat and chemical straightening change it temporarily or permanently, and this app gives no advice on either.',
    weight: 0,
    weightRationale: 'New metric. Context only: it adjusts the rules in H03 and H04 and carries no score of its own.',
    evidence: 'CONVENTION',
    evidenceNote:
      'Curl-type charts are informal grooming conventions, not validated scales. They are used only to choose between cut rules.',
    sourceIds: [],
    drivers: [],
    captureRequirements: ['hair_natural', 'self_report'],
    refusalConditions: [
      'pick made on hair straightened, permed or heat-styled flat',
      'hair wet or product-laden when the reference photo is taken',
    ],
    phase: 'M2',
  },

  // ── H12 ──────────────────────────────────────────────────────────────
  {
    id: 'H12',
    category: 'hair',
    name: 'Hair strand thickness (fine, medium, coarse)',
    measures:
      'How wide a single hair strand is. Fine strands cover the scalp less and lie flatter than the same number of coarse strands.',
    howMeasured:
      'Rough self-check: roll one strand between finger and thumb beside a piece of ordinary sewing thread, and report finer than, similar to, or coarser than the thread. The app does not measure strand width from a phone photo, because a phone photo cannot resolve a hair at the precision needed. The result only helps read scalp show (H02) and pick cut rules (H04).',
    methods: ['SELF_GRADE_REFERENCE'],
    scale: {
      unit: 'grade',
      min: 0,
      max: 2,
      description: '0 = fine, 1 = medium, 2 = coarse',
      higherIs: 'not_applicable',
    },
    ideal: {
      summary:
        'No ideal. Strand width varies by person and ancestry; the app uses it to interpret scalp show and to pick cut rules.',
      male: null,
      rationale:
        'Strand width varies between people and between ancestry groups. No rating study ranks strand widths, and no numeric range is given here because none was sourced.',
      confidenceInIdeal: 'low',
      populationCaveat: 'Strand width differs between ancestry groups, so the fine, medium and coarse labels are relative to the person’s own hair.',
    },
    scoring: { kind: 'none', reason: 'context_only' },
    changeability: 'FIXED',
    changeabilityNote: 'Strand width is genetic. Hair does not get thicker through food, sleep or styling.',
    weight: 0,
    weightRationale:
      'New metric. Context only: strand width changes how density looks but has no score of its own.',
    evidence: 'CONVENTION',
    evidenceNote:
      'The thread comparison is a hairdresser rule of thumb, not a validated test. It is used only to put a rough label on the hair.',
    sourceIds: [],
    drivers: [],
    captureRequirements: ['self_report', 'hair_natural'],
    refusalConditions: [
      'strand tested from hair that is wet or has product on it',
      'strand pulled from a treated or coloured section',
    ],
    phase: 'M2',
  },

  // ── H13 ──────────────────────────────────────────────────────────────
  {
    id: 'H13',
    category: 'hair',
    name: 'Hair-to-scalp and hair-to-skin colour contrast',
    measures:
      'How different the hair colour is from the skin colour of the scalp and forehead, as a lightness difference. High contrast, such as dark hair on pale skin, makes thin areas and the parting show more; low contrast hides them.',
    howMeasured:
      'Colour-calibrated photo with a grey card in frame: the app compares the lightness (L*) of hair pixels with the lightness of scalp skin at the parting and of forehead skin, all from the same lit photo. Refused without a grey card, in coloured light, or when the hair is coloured, wet or covered with powder, because those change the measured colours. It is not seasonal colour typing.',
    methods: ['COLOR_CALIBRATED_PHOTO'],
    scale: {
      unit: 'ΔL*',
      min: 0,
      max: 100,
      description: 'Lightness difference between hair and scalp or forehead skin',
      higherIs: 'not_applicable',
    },
    ideal: {
      summary: 'No ideal. The value adjusts advice on cut length and photo lighting; it is not scored.',
      male: null,
      rationale:
        'Hair-loss clinic web pages say that higher contrast makes thinning more visible, which is physically sensible, but no peer-reviewed measurement was found. The value is used to interpret H02, not to rank colourings.',
      confidenceInIdeal: 'low',
    },
    scoring: { kind: 'none', reason: 'context_only' },
    changeability: 'FIXED',
    changeabilityNote:
      'Hair and skin colour are inherited. A shorter cut reduces how much contrast shows on the scalp, which is a haircut decision (H04).',
    weight: 0,
    weightRationale:
      'New metric. Context only: it helps read scalp show and plan the haircut and carries no score of its own.',
    evidence: 'WEAK',
    evidenceNote:
      'The idea that high contrast makes thin hair show more comes from clinic web pages, not from a peer-reviewed measurement. It is used only as context.',
    sourceIds: ['hair:clinicpages'],
    drivers: [],
    captureRequirements: ['crown_top', 'frontal_neutral'],
    refusalConditions: [
      'no grey card in frame',
      'coloured or mixed-colour light on the scene',
      'hair coloured, wet or covered with powder',
      'strong backlight or flash glare on the scalp',
    ],
    phase: 'V2',
  },

  // ── H14 ──────────────────────────────────────────────────────────────
  {
    id: 'H14',
    category: 'hair',
    name: 'Hairline shape and symmetry',
    measures:
      'The outline of the front hairline: whether the two temples sit at similar heights, whether there is a widow’s peak, and whether the edge is straight, rounded or irregular.',
    howMeasured:
      'Front hairline photo with the hair swept back: the face-landmark model marks the hair edge at both temples and the centre. The app reports the left-right height difference as a percentage of the pupil distance and labels the shape. The edge is measurable only when it is visible. Refused for the same reasons as H01.',
    methods: ['AUTO_FRONTAL_PHOTO', 'SELF_GRADE_REFERENCE'],
    scale: {
      unit: '% of pupil distance',
      min: 0,
      max: 30,
      description: 'Left-right difference in hairline height at the temples',
      higherIs: 'not_applicable',
    },
    ideal: {
      summary: 'No ideal. Hairline shape varies widely among men, and no study found tests it.',
      male: null,
      rationale:
        'No rating study of hairline shape or hairline asymmetry on its own was found. The values only tell the haircut checklist (H04) whether, for example, a hard side parting would show an uneven hairline.',
      confidenceInIdeal: 'low',
    },
    scoring: { kind: 'none', reason: 'context_only' },
    changeability: 'FIXED',
    changeabilityNote:
      'Hairline shape is inherited and changes with hair loss. A haircut changes how much of it shows.',
    weight: 0,
    weightRationale:
      'New metric. Context only: no evidence supports scoring hairline shape, and recession is already scored in H01.',
    evidence: 'WEAK',
    evidenceNote:
      'No study found tests hairline shape or hairline asymmetry on its own. It is recorded as context for the haircut checklist.',
    sourceIds: [],
    drivers: [],
    captureRequirements: ['hairline_front', 'frontal_neutral'],
    refusalConditions: [
      ...FRONTAL_POSE,
      ...NEUTRAL_BROWS,
      ...HAIR_PREP,
      'hairline edge hidden by hair combed forward or sideways',
    ],
    medicalFlag:
      'A hairline that changes quickly over weeks, or a hairline with redness, scarring or pain: see a doctor.',
    phase: 'V2',
  },

  // ── H15 ──────────────────────────────────────────────────────────────
  {
    id: 'H15',
    category: 'hair',
    name: 'Hair-loss trend (change in scalp show and shedding)',
    measures:
      'Whether the hair is getting thinner faster than expected, judged from the change in scalp show and hairline distance between scans in the same setup, plus the user’s report of shedding. It is a safety and tracking measure, not a score.',
    howMeasured:
      'Compares each valid crown and hairline scan with the user’s first valid scan and the previous three, using the H02 scalp-show estimate and the H01 hair-edge-to-brow distance. The user also reports shedding (more than usual, same, less) and whether it is patchy or all over. A flag is raised on sustained worsening or a sudden step, never on one scan. Because light changes the photo estimate, a flag is only raised when the lighting matches the baseline scans. ' +
      SCALP_PHOTO_LIGHT,
    methods: ['COMPUTED_FROM_OTHER_METRICS', 'MANUAL_INPUT'],
    scale: {
      unit: 'flag level',
      min: 0,
      max: 2,
      description: '0 = stable, 1 = worsening over several scans, 2 = sudden step or patchy loss reported',
      higherIs: 'worse',
    },
    ideal: {
      summary:
        'Stable. Slow drift is expected in men with pattern loss; a sudden change over weeks is not typical of it and should be checked.',
      male: null,
      rationale:
        'Pattern loss is gradual. Shedding that starts a few months after fast weight loss, illness or a major stress is a recognised pattern (telogen effluvium) and is generally described as temporary once the trigger is gone. Sudden round bald patches are a different condition that a doctor should assess.',
      confidenceInIdeal: 'medium',
    },
    scoring: { kind: 'none', reason: 'process_measure' },
    changeability: 'PROFESSIONAL_ONLY',
    changeabilityNote:
      'Finding the cause belongs to a doctor. The part the user controls is avoiding crash dieting, and the app’s weight-loss pace limits (B06) exist partly for that reason.',
    weight: 0,
    weightRationale:
      'Process and safety measure with no appearance weight: it raises a referral flag and context for H02 and does not score.',
    evidence: 'WEAK',
    evidenceNote:
      'WEAK for the measurement: detecting a trend from phone photos is untested, and the scale mixes scalp-show drift, hairline distance and self-reported shedding. Only the referral guidance is better supported (MODERATE): a review lists calorie restriction and starvation among triggers of temporary shedding, and doctors treat sudden patchy loss as needing assessment. The flag is driven by the user’s shedding report, not by photo percentages, which are context only.',
    sourceIds: ['hair:asghar2020', 'hair:ellis2002', 'hair:clinicalrule'],
    drivers: [],
    captureRequirements: ['crown_top', 'hairline_front', 'self_report'],
    refusalConditions: [
      'fewer than two valid earlier scans (a baseline is needed first)',
      'lighting setup differs from the baseline scans',
      'hair length changed by a haircut since the baseline scan',
      'hair wet, or with product, powder or fibres in it',
    ],
    medicalFlag:
      'Large amounts of hair on the pillow, in the shower or on a comb for more than two to three weeks, round bald patches, or hair loss with a red, painful, burning or scarred scalp: see a doctor soon. Shedding that begins a few months after fast weight loss, illness or a major stress is also worth mentioning to a doctor.',
    phase: 'M2',
  },
]

// ───────────────────────── sources ─────────────────────────

export const sources: Source[] = [
  {
    id: 'hair:norwood1975',
    kind: 'peer_reviewed',
    citation:
      'Norwood, O. T. (1975). Male pattern baldness: classification and incidence. Southern Medical Journal, 68(11), 1359–1365.',
    // privacy-lint-allow(external-url): citation link shown as text, never fetched by the app
    url: 'https://pubmed.ncbi.nlm.nih.gov/1188424/',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A web-search digest of the PubMed listing reported: a classification of male pattern baldness, vol. 68 no. 11, pp. 1359–65, with incidence by age reported from 1,000 white adult men. The full text is behind the journal’s paywall. That stage 2 counts as a normal adult hairline comes from clinic web pages and was not seen in Norwood’s paper.',
    supports: 'The Norwood staging of male-pattern hair loss and the white-male sample behind its incidence figures',
  },
  {
    id: 'hair:ellis2002',
    kind: 'peer_reviewed',
    citation:
      'Ellis, J. A., Sinclair, R., & Harrap, S. B. (2002). Androgenetic alopecia: pathogenesis and potential for therapy. Expert Reviews in Molecular Medicine, 4(22), 1–11.',
    // privacy-lint-allow(external-url): citation link shown as text, never fetched by the app
    url: 'https://pubmed.ncbi.nlm.nih.gov/14585162/',
    verified: false,
    verificationNote:
      NOFETCH +
      ' Only the PubMed title was seen, plus a search digest saying the review describes genetic predisposition combined with androgen sensitivity, progressive shrinking of follicles, and up to 50% of white men affected by age 50. The author list, journal and page range in this citation are from memory and were not confirmed.',
    supports: 'Pattern hair loss is genetic, androgen-dependent and progressive; roughly half of white men are affected by age 50',
  },
  {
    id: 'hair:pirastu2017',
    kind: 'peer_reviewed',
    citation:
      'Pirastu, N., et al. (2017). GWAS for male-pattern baldness identifies 71 susceptibility loci explaining 38% of the risk. Nature Communications, 8, 1584.',
    // privacy-lint-allow(external-url): citation link shown as text, never fetched by the app
    url: 'https://www.doi.org/10.1038/S41467-017-01490-8',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A search digest reported more than 70,000 men, 71 independently replicated loci, and about 38% of the risk explained. The same digest corrected a mix-up with Heilmann-Heimbach et al. (2017), which reports 63 loci. Neither paper was opened.',
    supports: 'Male-pattern baldness has a strong, many-gene genetic basis, so it is not set by habits',
  },
  {
    id: 'hair:mannes2013',
    kind: 'peer_reviewed',
    citation:
      'Mannes, A. E. (2013; published online 2012). Shorn scalps and perceptions of male dominance. Social Psychological and Personality Science, 4(2), 198–205.',
    // privacy-lint-allow(external-url): citation link shown as text, never fetched by the app
    url: 'https://journals.sagepub.com/doi/10.1177/1948550612449490',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A search digest of the abstract and press coverage reported three experiments: shaved heads were rated more dominant; digitally removing hair made men look more dominant, taller and stronger; men with thinning hair scored lowest on every trait except norm violation, but per the coverage that thinning result came from study 3, which used text-only profiles (“thinning brown hair” vs “thick brown hair” vs “shaved head”), not photos or real hairlines. Press coverage (not the abstract) said shaved men were rated older and less attractive. The page and volume numbers are from memory.',
    supports: 'In a text-description experiment (not photos), profiles of men with thinning hair were rated lowest on most traits; shaved-head and hair-removal results came from photo experiments and read as more dominant, and press coverage says older',
  },
  {
    id: 'hair:muscarella1996',
    kind: 'peer_reviewed',
    citation:
      'Muscarella, F., & Cunningham, M. R. (1996). The evolutionary significance and social perception of male pattern baldness and facial hair. Ethology and Sociobiology, 17(2), 99–117.',
    verified: false,
    verificationNote:
      NOFETCH +
      ' The bibliographic details were seen in a faculty publication list in search results. Accounts of the findings conflict: press coverage says baldness lowered attractiveness a little and raised perceived dominance, while one article says bald men were rated 10% more attractive in a second part of the study. The paper was not opened, so the catalog does not rely on it for the size or direction of an attractiveness effect.',
    supports: 'Hair loss and facial hair change how men are perceived (dominance, maturity, possibly attractiveness); reported results conflict',
  },
  {
    id: 'hair:cash1992',
    kind: 'peer_reviewed',
    citation:
      'Cash, T. F. (1992). The psychological effects of androgenetic alopecia in men. Journal of the American Academy of Dermatology, 26(6), 926–931.',
    // privacy-lint-allow(external-url): citation link shown as text, never fetched by the app
    url: 'https://pubmed.ncbi.nlm.nih.gov/1607410/',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A search digest of the PubMed record reported 63 men with modest balding, 40 with extensive balding and 42 non-balding controls; balding men reported more preoccupation, distress and lower body-image satisfaction, strongest with more extensive and earlier loss. The study measures the man’s own distress, not other people’s ratings.',
    supports: 'Men with hair loss report worse body image and distress, strongest with extensive or early loss',
  },
  {
    id: 'hair:aukerman2023',
    kind: 'peer_reviewed',
    citation:
      'Aukerman, E. L., & Jafferany, M. (2023). The psychological consequences of androgenetic alopecia: a systematic review. Journal of Cosmetic Dermatology, 22(1), 89–95.',
    // privacy-lint-allow(external-url): citation link shown as text, never fetched by the app
    url: 'https://pubmed.ncbi.nlm.nih.gov/35403805/',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A search digest reported a systematic review of 13 studies from 1992 to 2021 concluding that androgenetic alopecia is a significant psychosocial stressor (online April 2022, print January 2023). The page range is from memory.',
    supports: 'Androgenetic alopecia is a significant psychosocial stressor across studies',
  },
  {
    id: 'hair:toseeb2012',
    kind: 'peer_reviewed',
    citation:
      'Toseeb, U., Keeble, D. R. T., & Bryant, E. J. (2012). The significance of hair for face recognition. PLoS ONE, 7(3), e34144.',
    // privacy-lint-allow(external-url): citation link shown as text, never fetched by the app
    url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3312903/',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A search digest reported that recognition was the same with and without hair when the hair stayed the same, and dropped substantially when the hair changed between learning and test, which the authors read as holistic face processing.',
    supports: 'Hair is processed as part of the face, so changing the hair changes how a face is read',
  },
  {
    id: 'hair:nutt2025',
    kind: 'peer_reviewed',
    citation:
      'Nutt, Thorstenson, & Yorzinski (2025). Gray hair influences perceived age and social perceptions. Frontiers in Psychology, 16, 1541836.',
    // privacy-lint-allow(external-url): citation link shown as text, never fetched by the app
    url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12094188/',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A search digest reported 120 raters judging the same faces with and without added grey hair: grey hair made faces look older and somewhat less attractive for male and female faces, lowered trust ratings in male faces only, and did not change perceived status or aggression. Author initials and exact volume details were not confirmed.',
    supports: 'Grey hair makes a face look older and modestly less attractive in one experiment',
  },
  {
    id: 'hair:panhard2012',
    kind: 'peer_reviewed',
    citation:
      'Panhard, S., Lozano, I., & Loussouarn, G. (2012). Greying of the human hair: a worldwide survey, revisiting the “50” rule of thumb. British Journal of Dermatology, 167(4), 865–873.',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A search digest reported that the “50% grey by age 50” rule overstates greying (about 6–23% of people reached that level at 50), that men had more grey hair than women, and that people of Asian and African descent had less grey hair than people of European descent at the same ages. Sample sizes were reported inconsistently across digests, so no count is quoted.',
    supports: 'Greying onset and amount vary widely by age and ancestry; the “50 by 50” rule overstates it',
  },
  {
    id: 'hair:dixson2013',
    kind: 'peer_reviewed',
    citation:
      'Dixson, B. J., & Brooks, R. C. (2013). The role of facial hair in women’s perceptions of men’s attractiveness, health, masculinity and parenting abilities. Evolution and Human Behavior, 34(3), 236–241.',
    verified: false,
    verificationNote:
      NOFETCH +
      ' Secondary coverage (not the paper) reported 10 men photographed clean-shaven, with five-day and ten-day stubble and with a full beard, rated by 351 women and 177 men: women rated heavy stubble most attractive, full beards were rated highest for parenting ability and health, and masculinity rose with the amount of facial hair. One summary quoted the abstract as saying an intermediate beard length is deemed most attractive.',
    supports: 'The amount of facial hair changes ratings of attractiveness, health and masculinity; no single level wins on every rating',
  },
  {
    id: 'hair:neave2008',
    kind: 'peer_reviewed',
    citation:
      'Neave, N., & Shields, K. (2008). The effects of facial hair manipulation on female perceptions of attractiveness, masculinity, and dominance in male faces. Personality and Individual Differences, 45(5), 373–377.',
    // privacy-lint-allow(external-url): citation link shown as text, never fetched by the app
    url: 'https://researchportal.northumbria.ac.uk/en/publications/the-effects-of-facial-hair-manipulation-on-female-perceptions-of-/',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A search digest of the repository abstract reported 15 computer-made faces (three templates at five facial-hair levels) rated by 60 women: light stubble was rated most attractive, full beards most masculine, aggressive, mature and older. The digest noted that secondary write-ups disagree on which level was rated most dominant.',
    supports: 'Light stubble was rated most attractive and full beards most masculine in a small rating study',
  },
  {
    id: 'hair:janif2014',
    kind: 'peer_reviewed',
    citation:
      'Janif, Z. J., Brooks, R. C., & Dixson, B. J. (2014). Negative frequency-dependent preferences and variation in male facial hair. Biology Letters, 10(4), 20130958.',
    // privacy-lint-allow(external-url): citation link shown as text, never fetched by the app
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4013690',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A search digest reported photos of 36 men at several beard levels: heavy stubble and full beards were rated more attractive when beards were uncommon in the faces viewed, and clean-shaven faces showed the reverse pattern.',
    supports: 'Facial hair preferences shift with how common each look is, so no single style is universally best',
  },
  {
    id: 'hair:sadr2003',
    kind: 'peer_reviewed',
    citation:
      'Sadr, J., Jarudi, I., & Sinha, P. (2003). The role of eyebrows in face recognition. Perception, 32(3), 285–293.',
    // privacy-lint-allow(external-url): citation link shown as text, never fetched by the app
    url: 'https://journals.sagepub.com/doi/10.1068/p5027',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A search digest reported that removing the eyebrows from familiar faces hurt recognition more than removing the eyes did. The paper is about recognition, not attractiveness or grooming.',
    supports: 'Eyebrows matter for how a face is read; says nothing about whether grooming changes attractiveness',
  },
  {
    id: 'hair:mogilski2018',
    kind: 'peer_reviewed',
    citation:
      'Mogilski, J. K., & Welling, L. L. M. (2018). The relative contribution of jawbone and cheekbone prominence, eyebrow thickness, eye size, and face length to evaluations of facial masculinity and attractiveness: a conjoint data-driven approach. Frontiers in Psychology, 9, 2428.',
    // privacy-lint-allow(external-url): citation link shown as text, never fetched by the app
    url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6290027/',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A search digest reported a conjoint ranking task with 922 participants in which eyebrow thickness and jawbone prominence were relatively more influential for attractiveness than cheekbone prominence and eye size, with small to moderate effects. The digest’s statement of the direction for male faces was unclear and contradictory, so no direction is used.',
    supports: 'Brow thickness is one of several features that affect face ratings, with small to moderate effects; direction for men unconfirmed',
  },
  {
    id: 'hair:borda2015',
    kind: 'peer_reviewed',
    citation:
      'Borda, L. J., & Wikramanayake, T. C. (2015). Seborrheic dermatitis and dandruff: a comprehensive review. Journal of Clinical and Investigative Dermatology, 3(2).',
    // privacy-lint-allow(external-url): citation link shown as text, never fetched by the app
    url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4852869/',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A search digest reported that the review treats dandruff and seborrheic dermatitis as one condition on a spectrum, limited to the scalp in dandruff, with several contributing factors (skin oil, yeast on the skin surface and individual susceptibility). A separate digest quoted an estimate of about 50% of adults having dandruff but did not say which listed page carried it; it may be this review.',
    supports: 'Dandruff is common and is the mild end of a scalp skin condition with several contributing factors',
  },
  {
    id: 'hair:asghar2020',
    kind: 'peer_reviewed',
    citation:
      'Asghar, F., et al. (2020). Telogen effluvium: a review of the literature. Cureus, 12(5), e8320.',
    // privacy-lint-allow(external-url): citation link shown as text, never fetched by the app
    url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7320655/',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A search digest reported that the review lists severe protein, fatty-acid and zinc deficiency, chronic starvation and calorie restriction among triggers of temporary shedding, with shedding about two to four months after a fatty-acid deficiency begins, and calls the iron link controversial. Author list and article number are from memory.',
    supports: 'Calorie restriction and starvation are recognised triggers of temporary hair shedding',
  },
  {
    id: 'hair:billero2018',
    kind: 'peer_reviewed',
    citation:
      'Billero, V., & Miteva, M. (2018). Traction alopecia: the root of the problem. Clinical, Cosmetic and Investigational Dermatology, 11, 149–159.',
    // privacy-lint-allow(external-url): citation link shown as text, never fetched by the app
    url: 'https://www.doi.org/10.2147/CCID.S137296',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A search digest of the abstract reported that traction alopecia affects about one-third of women of African descent who wear traumatic styles for a long time, that risk rises with the amount and duration of pulling, and that tight buns, ponytails, weaves and tight braids are the highest-risk styles. The evidence is mostly from women’s hairstyles.',
    supports: 'Tight styles and prolonged pulling can cause hair loss; the evidence is mostly from women’s hairstyles',
  },
  {
    id: 'hair:gavazzoni2015',
    kind: 'peer_reviewed',
    citation:
      'Gavazzoni Dias, M. F. R. (2015). Hair cosmetics: an overview. International Journal of Trichology, 7(1), 2–15.',
    // privacy-lint-allow(external-url): citation link shown as text, never fetched by the app
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4387693',
    verified: false,
    verificationNote:
      NOFETCH +
      ' A search digest confirmed that the review exists and covers shampoos, conditioners, straightening products and hair colourants. The damage claims (breakage, frizz, traction from misuse) were seen only in a digest of a 2021 paper by the same author, so this source is cited for the general point only.',
    supports: 'Hair products and grooming practices can damage the hair fibre when misused',
  },
  {
    id: 'hair:barberrules',
    kind: 'convention',
    citation:
      'Barber and hairstylist convention: face-shape-to-haircut rules, cuts that work around a receding hairline or thin crown, and cheek-line, neckline and moustache-line rules. No single published source; the rules are repeated across trade and consumer styling guides.',
    verified: false,
    verificationNote:
      'Not a citable study. A web search for a peer-reviewed test of hairstyles matched to face shape found none: the closest results were studies of hair length and hair colour on women’s faces and a machine-learning paper on face shape and eye and eyebrow geometry in East Asian female faces. The rules are therefore graded as convention.',
    supports: 'Haircut and beard-line checklist rules (face-shape balance, outline, cheek line, neckline)',
  },
  {
    id: 'hair:clinicalrule',
    kind: 'convention',
    citation:
      'Clinical rule of thumb in dermatology: sudden patchy hair loss, sudden heavy shedding, or hair loss with a red, painful or scarred scalp should be assessed by a doctor.',
    verified: false,
    verificationNote:
      'Not a citable study. A search for American Academy of Dermatology guidance returned only clinic and hospital web pages that gave the same advice (sudden round patches can be alopecia areata or another condition and merit assessment); no AAD page was reached. Kept as a convention so the referral flag is not presented as researched.',
    supports: 'Referral flag wording for sudden patchy loss, rapid shedding and an inflamed or scarred scalp',
  },
  {
    id: 'hair:clinicpages',
    kind: 'community_claim',
    citation:
      'Hair-loss clinic and product web pages (several), for example Charles Medical Group, “Is scalp visibility a sign of balding”. Not peer-reviewed.',
    verified: false,
    verificationNote:
      'Seen only as a search digest, not opened. The digest said these pages describe dark hair on a pale scalp as showing more scalp, that lighting and wet hair affect how much scalp shows, and that scalp visibility alone does not prove hair loss. They are commercial pages and no peer-reviewed measurement was found.',
    supports: 'Higher hair-to-scalp contrast and lighting make thin areas show more (clinic pages, not measured)',
  },
]
