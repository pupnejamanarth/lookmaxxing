import type { Metric, Source } from '../schema'

/**
 * SKIN catalog slice (id prefix S), male reference profile. Category weight total: 16.
 *
 * AUTHORING NOTE (read before trusting any source below):
 * The environment that produced this file could not open any record. WebFetch failed with a DNS error
 * on every host and direct access to PubMed and publisher sites was blocked, so only web-search summaries
 * were available. Therefore EVERY source here has verified: false. Evidence grades and confidenceInIdeal
 * were lowered where the claim rests on a single summary. A later pass with working web access should open
 * each record and flip verified only where the record supports the specific claim.
 *
 * Colour metrics (S03 to S06, S09, S16, S18) use CIELAB values: L* is lightness, a* is the green-to-red axis,
 * b* is the blue-to-yellow axis, and ΔE is the overall colour difference between two colours.
 */

const NOT_OPENED =
  'Record NOT opened: in the authoring environment WebFetch failed on every host (DNS error) and direct access to PubMed and publisher sites was blocked, so only web-search summaries were available. '

/** Refusal conditions shared by every metric that reads colour from a calibrated photo. */
const COLOUR_REFUSALS: string[] = [
  'no grey card visible in the frame',
  'grey card shadowed, tilted away from the lens, or lit differently from the face',
  'blown-out highlights (pixels at maximum brightness) over more than 2% of the measured patch',
  'mixed light sources (for example window plus indoor lamp) or a colour cast that remains after grey-card correction',
  'makeup, any tinted skin product, bronzer or self-tanner on the measured skin',
  'flushed skin: within 60 minutes of exercise, a hot shower or sauna, or after alcohol the same day',
  'face washed, scrubbed or shaved within the last 30 minutes',
  'camera beauty filter, skin smoothing, HDR or portrait mode active',
  'camera distance outside the protocol range for the shot (zone close-up about 25 to 40 cm, full frontal 1.2 to 2 m) or lens more than 10° off square to the patch',
  'more than half of the measured patch covered by hair, beard shadow or a glasses frame',
]

/** Extra condition for pigment metrics, where a fresh tan or sunburn changes the reading. */
const FRESH_SUN = 'sunburn or fresh tan on the measured skin within the last 3 weeks'

/** Refusal conditions shared by the texture-type metrics (fine surface detail, very light sensitive). */
const TEXTURE_REFUSALS: string[] = [
  'lighting direction or distance differs from the baseline scan set-up',
  'camera beauty filter, skin smoothing, HDR or portrait mode active',
  'close-up not sharp at pixel level (focus check fails)',
  'image is a screenshot or a re-compressed copy instead of the original camera file',
  'blown-out highlights over more than 2% of the patch',
  'makeup or any skin product applied within the last 2 hours (hides or fills surface detail)',
  'face washed or shaved within the last 30 minutes',
  'beard stubble or hair covering more than half of the patch',
]

export const metrics: Metric[] = [
  // ───────────────────────── S01 active acne ─────────────────────────
  {
    id: 'S01',
    category: 'skin',
    name: 'Active acne (spots on the face)',
    measures:
      'How much acne is on the face right now: inflamed spots (red bumps, pus-filled spots, deep lumps) and non-inflamed spots (blackheads and whitehead bumps), summarised as a 0–4 severity grade.',
    howMeasured:
      'The user taps each spot on close-ups of forehead, both cheeks, nose, chin and jaw. Redness detection suggests candidates and the user confirms or removes them, because detection under-counts on darker skin and over-counts on flushed skin. The app converts counts by type and zone into a 0–4 grade. The conversion is the app’s own, modelled on the five-step investigator grading used in acne trials. It is a self-check, not a diagnosis.',
    methods: ['TAP_COUNT_ON_PHOTO', 'SELF_GRADE_REFERENCE'],
    scale: {
      unit: 'grade (0–4)',
      min: 0,
      max: 4,
      description: '0 clear, 1 almost clear, 2 mild, 3 moderate, 4 severe; built from counts of inflamed and non-inflamed spots',
      higherIs: 'worse',
    },
    ideal: {
      summary:
        'Clear or almost clear (grade 0–1): no inflamed spots or at most one small one, and only rare non-inflamed spots.',
      male: { lo: 0, hi: 1 },
      rationale:
        'Grade 0–1 is the success threshold in acne treatment trials. In a photo-rating survey, faces with clear skin were judged more favourably on every positive trait than faces with acne. The band is a clinical convention, not a measured attractiveness cut-off.',
      confidenceInIdeal: 'medium',
      populationCaveat:
        'The rating survey we cite used photos of teenagers, so it may not transfer to adult men. Redness is harder to see in photos of darker skin, so counts can come out too low.',
    },
    scoring: {
      kind: 'range',
      lo: 0,
      hi: 1,
      tau: 1.25,
      tauRationale:
        'The target band is grade 0–1. One grade step is one clinical severity band, so tau 1.25 gives about 73 at grade 2 (mild), 28 at grade 3 and 6 at grade 4. This is an editorial choice: no study maps acne grade to attractiveness.',
    },
    changeability: 'CHANGEABLE',
    changeabilityNote:
      'Mostly driven by hormones, oil-gland activity and genetics, which habits do not change. Habits can lower severity modestly and prevent marks and scars. Moderate to severe acne needs a doctor; the app never treats it.',
    weight: 4.75,
    weightRationale:
      'Largest skin weight: acne is the most visible skin problem in rating studies and has the best-documented social cost. Raised from the seed’s 4.0 using weight freed from weaker-evidence skin metrics (colour, texture, pores, under-eye). Not higher because the habit levers available in the app are modest.',
    evidence: 'MODERATE',
    evidenceNote:
      'Acne clearly changes how faces are judged: the rating studies we found all point the same way, though they are surveys and the one we cite used teenage photos. The habit levers here have modest, mixed support. The only diet trial we cite had 43 young men over 12 weeks and could not separate diet from weight loss. Washing twice a day was no worse than other frequencies in one 6-week trial of men. Large effects come from medical treatment, which the app does not give.',
    sourceIds: ['skin:ritvo2011', 'skin:fda2018acne', 'skin:reynolds2024', 'skin:smith2007', 'skin:choi2006'],
    drivers: ['skin_habits', 'nutrition_structure'],
    captureRequirements: ['skin_zones', 'frontal_neutral'],
    refusalConditions: [
      'makeup, concealer or any tinted skin product on the face',
      'zone photo blurred or out of focus at lesion scale',
      'mixed light sources or a strong colour cast in the zone photo',
      'blown-out highlights over more than 5% of a zone',
      'flushed skin: within 60 minutes of exercise, a hot shower or sauna, or after alcohol the same day (temporary redness inflates detected spots)',
      'face scrubbed, shaved or washed within the last 30 minutes',
      'more than half of a zone covered by hair or beard (zone not scored; grade flagged incomplete)',
    ],
    medicalFlag:
      'Deep, painful lumps (nodules or cysts), acne that leaves scars or dark marks, acne spreading over the back and chest, grade 3–4 acne, or acne that has not improved after 12 weeks of the habits listed: see a doctor or dermatologist. Acne that starts suddenly and severely in an adult, or that is hurting mood or confidence, also needs a doctor. The app never treats acne.',
    phase: 'M2',
  },

  // ───────────────────────── S02 acne scarring ─────────────────────────
  {
    id: 'S02',
    category: 'skin',
    name: 'Acne scarring grade',
    measures:
      'Lasting pits, dents or raised marks left by past acne, graded 0–4 by how visible they are at normal talking distance. Flat colour marks without a dent are scored in S03, not here.',
    howMeasured:
      'The user takes side-lit close-ups of each cheek and compares them with reference images to pick a grade: 0 none, 1 visible only in side light or up close, 2 visible at talking distance but shallow, 3 deep or many, 4 widespread deep or raised scars. The grading idea is modelled on the visibility-based four-grade system of Goodman and Baron. Self-grading is rough, and a dermatologist grade overrides it.',
    methods: ['SELF_GRADE_REFERENCE'],
    scale: {
      unit: 'grade (0–4)',
      min: 0,
      max: 4,
      description: '0 none, 1 faint, 2 moderate, 3 marked, 4 severe; flat colour-only marks are excluded',
      higherIs: 'worse',
    },
    ideal: {
      summary: 'No visible scars (grade 0), or scars visible only in side light or up close (grade 1).',
      male: { lo: 0, hi: 1 },
      rationale:
        'In the grading system this scale borrows from, the visible problem is scarring that cannot be disguised at social distance. No study gives an attractiveness threshold, so the band is a clinical-visibility convention.',
      confidenceInIdeal: 'medium',
      populationCaveat:
        'Scar studies come mainly from people attending dermatology clinics, so rates in the general population are likely lower.',
    },
    scoring: {
      kind: 'range',
      lo: 0,
      hi: 1,
      tau: 1.25,
      tauRationale:
        'Same fall-off as S01 so the two acne metrics read on one scale: about 73 at grade 2, 28 at grade 3 and 6 at grade 4. Editorial choice; scars are permanent and visible, but no study ties grade to attractiveness.',
    },
    changeability: 'PROFESSIONAL_ONLY',
    changeabilityNote:
      'Established scars do not respond to habits. Treatment is done by dermatologists and is outside this app. The part within your control is preventing new scars: do not pick or squeeze spots, and get persistent acne seen early (S01).',
    weight: 1.5,
    weightRationale:
      'Unchanged from the seed. Scars are permanent and visible, so they matter, but habits cannot reverse them, so they stay well below active acne.',
    evidence: 'MODERATE',
    evidenceNote:
      'Scarring is common among people treated for acne and is linked to acne severity, relapsing acne and delay before effective treatment; in one risk study, picking and squeezing were also linked to scarring. We found no study that isolates how scars change attractiveness ratings, and grading your own photos is unreliable. Treat the grade as a rough record.',
    sourceIds: ['skin:layton1994', 'skin:tan2017jdd', 'skin:tan2017jeadv', 'skin:goodman2006'],
    drivers: [],
    captureRequirements: ['skin_sidelight', 'skin_zones'],
    refusalConditions: [
      'light not coming from one side at roughly 45 to 60° (flat or front light hides scars)',
      'makeup, concealer or any tinted skin product on the cheeks',
      'close-up blurred or out of focus',
      'camera beauty filter, skin smoothing, HDR or portrait mode active (smoothing erases scars)',
      'cheek more than half covered by beard (scars under a beard are not graded)',
    ],
    medicalFlag:
      'Deep pits, raised or thick scars, or scars that keep forming while acne is active: see a dermatologist. Scar treatment is professional-only and the app does not advise on it.',
    phase: 'M2',
  },

  // ───────────────────────── S03 post-acne marks ─────────────────────────
  {
    id: 'S03',
    category: 'skin',
    name: 'Post-acne marks (flat brown or red-pink marks)',
    measures:
      'Flat brown or red-pink marks left where spots healed, counted by how many stand out clearly from the skin around them. Pits and dents are scored in S02.',
    howMeasured:
      'On grey-card-calibrated close-ups the user taps each mark. The app converts a patch on the mark and a patch 5 mm away to CIELAB colour and computes ΔE, the overall colour difference between the two. A mark counts as visible when ΔE is 3 or more. Brown marks show mainly as lower lightness (L*), red-pink marks as higher redness (a*). Scabs and open spots are excluded.',
    methods: ['COLOR_CALIBRATED_PHOTO', 'TAP_COUNT_ON_PHOTO'],
    scale: {
      unit: 'visible marks (count with ΔE ≥ 3)',
      min: 0,
      max: null,
      description: 'Number of marks whose colour differs from nearby skin by ΔE 3 or more',
      higherIs: 'worse',
    },
    ideal: {
      summary: 'No marks that stand out: zero marks at or above ΔE 3.',
      male: null,
      rationale:
        'A colour difference of about 2–3 ΔE is roughly the smallest that people notice between two flat colour patches, which is where the visibility cut-off of 3 comes from; it was not tested on faces. No study gives a normal or attractive number of marks, so no numeric band is set.',
      confidenceInIdeal: 'low',
      populationCaveat:
        'Post-inflammatory brown marks are more frequent in darker skin tones, and red-pink marks are harder to detect in them. The visibility cut-off was not tested across skin tones.',
    },
    scoring: {
      kind: 'range',
      lo: 0,
      hi: 2,
      tau: 6,
      tauRationale:
        'Editorial, not data-derived: 0–2 faint marks are treated as ordinary adult skin because no published norm exists. At tau 6, 10 visible marks scores about 41 and 14 marks about 14.',
    },
    changeability: 'CHANGEABLE',
    changeabilityNote:
      'Marks usually fade over weeks to months without treatment, and sun exposure can darken brown marks. New marks are prevented by not picking and by getting persistent acne seen early (S01). Sun protection means shade, a hat and avoiding peak UV; a UV-protection product the user already owns can be whitelisted, and the app does not recommend products.',
    weight: 1.0,
    weightRationale:
      'Cut from the seed’s 1.5 and capped for WEAK evidence. These marks also overlap with S04 (tone evenness), so a higher weight would count the same colour irregularity twice. The freed weight went to S01.',
    evidence: 'WEAK',
    evidenceNote:
      'No study isolates how post-acne marks change attractiveness. The support is indirect: studies of even skin colour (S04) and clinical reviews of how these marks form and fade. The ΔE 3 cut-off is a colour-science rule of thumb, not a measured limit for faces.',
    sourceIds: ['skin:davis2010', 'skin:mahy1994', 'skin:fink2012'],
    drivers: ['skin_habits', 'sun_habits', 'whitelist_product'],
    captureRequirements: ['skin_zones'],
    refusalConditions: [
      ...COLOUR_REFUSALS,
      FRESH_SUN,
      'scab, open spot or fresh picking wound inside the measured patch',
    ],
    medicalFlag:
      'A dark or changing patch that is new, growing, itchy or bleeding is not an acne mark: see a doctor (see S17).',
    phase: 'V2',
  },

  // ───────────────────────── S04 tone evenness ─────────────────────────
  {
    id: 'S04',
    category: 'skin',
    name: 'Skin tone evenness',
    measures:
      'How uniform skin colour is across the cheeks and forehead: patchiness from uneven brown pigment (melanin) and uneven red (blood).',
    howMeasured:
      'From a grey-card-calibrated frontal photo. The app masks eyes, brows, lips, hair, visible spots and shadows, converts cheek and forehead patches to CIELAB colour, divides each patch into small sub-patches and reports the average ΔE (colour difference) between each sub-patch and its patch average. Lower is more even.',
    methods: ['COLOR_CALIBRATED_PHOTO'],
    scale: {
      unit: 'ΔE spread (CIELAB)',
      min: 0,
      max: null,
      description: 'Average colour difference between small sub-patches and their patch average; lower means more even',
      higherIs: 'worse',
    },
    ideal: {
      summary:
        'No numeric target exists. More even colour was linked to skin that looks younger, healthier and more attractive, so the aim is lower than your own starting value.',
      male: null,
      rationale:
        'In rating studies, cheek skin with a more even spread of melanin and blood colour was judged younger, healthier and more attractive, including in one study of men. No study gives a ΔE value that separates even from uneven, and the number depends on camera, light and skin tone, so no band is set.',
      confidenceInIdeal: 'low',
      populationCaveat:
        'The study on men used cheek images of 160 white British men rated by 308 people, and a key earlier study on women was reported as industry-funded. We found no comparable data for darker skin tones.',
    },
    scoring: {
      kind: 'personal_baseline',
      direction: 'lower_better',
      note: 'No defensible absolute band exists, so the score tracks change against the user’s own first four on-protocol scans (median ΔE spread). Until four scans exist, show the raw value and no score. The UI must say the score reflects change, not how even the skin is in absolute terms.',
    },
    changeability: 'CHANGEABLE',
    changeabilityNote:
      'Partly. Sun habits and not picking limit new uneven patches and let existing ones fade over months. The underlying pigment pattern and how visible blood vessels are come from genetics and do not change.',
    weight: 2.5,
    weightRationale:
      'Kept at the seed value. It is the only skin-colour factor with a rating study on men’s faces and it captures overall blotchiness that no other skin metric covers. Not raised: one male study, white participants only, and a calibrated photo is required.',
    evidence: 'MODERATE',
    evidenceNote:
      'Several rating studies, including one on men, link even skin colour with looking younger, healthier and more attractive. Most come from the same research network, one reported industry funding, and they rate cheek photos, not whole-face attractiveness. How much this changes how people treat you in real life is unknown.',
    sourceIds: ['skin:fink2001', 'skin:matts2007', 'skin:fink2012', 'skin:samson2010', 'skin:nkengne2008', 'skin:croninangle'],
    drivers: ['sun_habits', 'skin_habits'],
    captureRequirements: ['skin_zones', 'frontal_neutral'],
    refusalConditions: [...COLOUR_REFUSALS, FRESH_SUN],
    phase: 'V2',
  },

  // ───────────────────────── S05 carotenoid yellowness ─────────────────────────
  {
    id: 'S05',
    category: 'skin',
    name: 'Skin yellowness (carotenoid colour)',
    measures:
      'Golden-yellow warmth of facial skin, measured as b* (the blue-to-yellow axis in CIELAB colour) on both cheeks. Part of it comes from carotenoid pigments that fruit and vegetables supply.',
    howMeasured:
      'From a grey-card-calibrated frontal photo: mean b* of masked cheek patches. Only change against the user’s own baseline is interpreted. A rise in b* together with a fall in lightness (L*) is treated as tanning and is not rewarded.',
    methods: ['COLOR_CALIBRATED_PHOTO'],
    scale: {
      unit: 'b* (CIELAB, cheek)',
      min: null,
      max: null,
      description: 'Blue-to-yellow colour value of the cheek; typical values differ by skin tone and camera',
      higherIs: 'target_range',
    },
    ideal: {
      summary:
        'No absolute target. Within one person, a small rise in yellowness after eating more fruit and vegetables was rated healthier and more attractive in one study.',
      male: null,
      rationale:
        'That study followed 35 people for six weeks: skin colour changes tracked daily fruit and vegetable portions and matched the light absorption of carotenoids, not melanin. Judges rated skin healthier after about 3 extra portions a day. Yellow skin also comes from tanning and from illness, so higher is not always better.',
      confidenceInIdeal: 'low',
      populationCaveat: 'The sample was mostly white, so the size of the effect in darker skin is unknown.',
    },
    scoring: {
      kind: 'personal_baseline',
      direction: 'higher_better',
      note: 'Scored as change from the user’s own four-scan baseline, with a ceiling so that very high yellowness cannot score better than a moderate rise. A rise that comes with a fall in L* (tanning) is not rewarded, and a b* far above baseline together with yellow eye whites (E01) triggers the medical flag instead of a score.',
    },
    changeability: 'CHANGEABLE',
    changeabilityNote: 'Slow: in the cited study colour followed fruit and vegetable intake over six weeks.',
    weight: 0.5,
    weightRationale:
      'Cut from the seed’s 1.0: one small study, mostly white participants, small effect. The freed weight went to S01.',
    evidence: 'WEAK',
    evidenceNote:
      'One small six-week study (35 people, mostly white) and a few related rating studies from the same research group. The effect is small and the work does not show it changes how others treat you. Do not chase a tan or a yellow tint.',
    sourceIds: ['skin:whitehead2012', 'skin:stephen2009'],
    drivers: ['nutrition_structure'],
    captureRequirements: ['skin_zones', 'frontal_neutral'],
    refusalConditions: [...COLOUR_REFUSALS, FRESH_SUN],
    medicalFlag:
      'Yellow skin together with yellow eye whites (see E01) needs a doctor visit. Do not try to raise this value.',
    phase: 'V2',
  },

  // ───────────────────────── S06 persistent redness ─────────────────────────
  {
    id: 'S06',
    category: 'skin',
    name: 'Persistent facial redness',
    measures:
      'Redness of the central face (cheeks, nose, chin) when the skin is calm, to separate everyday colour from redness that does not go away.',
    howMeasured:
      'Grey-card-calibrated frontal photo taken at rest. The app reports the mean a* (the green-to-red axis in CIELAB colour) of masked cheek and nose patches and compares it with the user’s own calm baseline. Spots and visible acne are masked out.',
    methods: ['COLOR_CALIBRATED_PHOTO'],
    scale: {
      unit: 'a* (CIELAB, cheek and nose)',
      min: null,
      max: null,
      description: 'Green-to-red colour value of the central face at rest; higher means redder',
      higherIs: 'worse',
    },
    ideal: {
      summary:
        'No absolute target. The aim is a calm baseline that stays stable: some redness reads as healthy, redness that persists is the concern.',
      male: null,
      rationale:
        'In a lab study, people adjusting face photos to look healthy added redness from oxygenated blood, so moderate redness reads as healthy. Persistent redness in the middle of the face is also a main sign of rosacea, which a review links to more embarrassment, social anxiety and lower quality of life. Both are true, so no numeric band is defensible.',
      confidenceInIdeal: 'low',
      populationCaveat:
        'Redness is harder to see and measure in darker skin, and the perception studies we found used mostly lighter-skinned faces.',
    },
    scoring: {
      kind: 'personal_baseline',
      direction: 'lower_better',
      note: 'No defensible absolute band, and some redness looks healthy, so only rises above the user’s own calm baseline (median of the first four rested scans) cost points. Values below baseline are not rewarded.',
    },
    changeability: 'CHANGEABLE',
    changeabilityNote:
      'Partly. Triggers such as heat, sun, alcohol and rough washing change how red skin looks from day to day. Redness caused by a skin condition does not respond to habits.',
    weight: 0.75,
    weightRationale:
      'Cut from the seed’s 1.0 and kept under the WEAK cap: the evidence cuts both ways. The freed weight went to S01.',
    evidence: 'WEAK',
    evidenceNote:
      'Evidence points both ways: moderate redness looks healthy in lab studies, while persistent redness is a sign of a skin condition with a documented emotional cost. No study says what level looks best, so this is scored against your own calm baseline. A high or rising reading is a reason to see a doctor, not to chase a number.',
    sourceIds: ['skin:stephen2009', 'skin:gallo2018', 'skin:moustafa2014'],
    drivers: ['skin_habits', 'sun_habits'],
    captureRequirements: ['skin_zones', 'frontal_neutral'],
    refusalConditions: [
      ...COLOUR_REFUSALS,
      FRESH_SUN,
      'photo taken within 15 minutes of coming in from cold, wind or heat',
      'skin irritated from shaving, scrubbing or sun in the last 24 hours',
    ],
    medicalFlag:
      'Redness in the middle of the face that does not fade, has lasted more than about 3 months, or comes with flushing, burning or stinging, small visible blood vessels, or pimple-like bumps without blackheads can be rosacea or another skin condition: see a doctor. The app does not diagnose or treat.',
    phase: 'V2',
  },

  // ───────────────────────── S07 texture ─────────────────────────
  {
    id: 'S07',
    category: 'skin',
    name: 'Skin texture (roughness)',
    measures:
      'How rough or smooth the skin surface looks on the cheeks at fine scale (small bumps, scaling, fine irregularity), apart from pores and lines.',
    howMeasured:
      'Computed from a cheek patch of a close-up photo taken in the same lighting set-up every time: fine-scale brightness variation after the broad shading is removed, scaled to 0–100 (higher is rougher). The number moves with light direction, distance, focus, compression and phone image processing, so it is compared only between scans that match the protocol.',
    methods: ['COLOR_CALIBRATED_PHOTO'],
    scale: {
      unit: 'roughness index (0–100)',
      min: 0,
      max: 100,
      description: 'Fine-scale brightness variation in a cheek patch; higher is rougher',
      higherIs: 'worse',
    },
    ideal: {
      summary:
        'No numeric target. Smoother is better, but the index is too sensitive to lighting for an absolute band.',
      male: null,
      rationale:
        'In rating studies, smoother and more even facial skin was judged more attractive, mostly for women’s faces and under controlled lab lighting. A phone-photo roughness index has not been checked against those measures, and a small change in light angle can move it more than real skin change does.',
      confidenceInIdeal: 'low',
      populationCaveat: 'The rating studies we found used mostly female faces and lab-controlled lighting.',
    },
    scoring: {
      kind: 'personal_baseline',
      direction: 'lower_better',
      note: 'Compared only with the user’s own scans taken with matching light direction and distance. Show a score only when at least four matching scans exist, and display it as low-confidence.',
    },
    changeability: 'CHANGEABLE',
    changeabilityNote:
      'Slow and small. Sun habits and not picking limit new roughness. Skin type and age set most of it.',
    weight: 0.75,
    weightRationale:
      'Cut from the seed’s 1.0. Texture is the most lighting-sensitive measure in the skin category, so a higher weight would make the overall score depend on the lamp. The freed weight went to S01.',
    evidence: 'WEAK',
    evidenceNote:
      'Texture matters to how skin is judged in lab rating studies, but a number measured from a phone photo has not been shown to track it. Light angle alone can move the reading more than real change. Treated as a weak, low-confidence signal.',
    sourceIds: ['skin:fink2001', 'skin:samson2010'],
    drivers: ['skin_habits', 'sun_habits'],
    captureRequirements: ['skin_zones'],
    refusalConditions: [...TEXTURE_REFUSALS],
    phase: 'V2',
  },

  // ───────────────────────── S08 pores ─────────────────────────
  {
    id: 'S08',
    category: 'skin',
    name: 'Visible pores',
    measures: 'How many large, easy-to-see pore openings are on the nose and inner cheeks.',
    howMeasured:
      'Close-up photo of the nose and inner-cheek patch in the same lighting set-up each time. The app detects dark, round pore openings above a size threshold and reports pores per square centimetre. Only large pores are detected, because small ones fall below the phone camera’s resolution.',
    methods: ['COLOR_CALIBRATED_PHOTO'],
    scale: {
      unit: 'conspicuous pores per cm²',
      min: 0,
      max: null,
      description: 'Count of large visible pore openings per square centimetre of the nose and inner-cheek patch',
      higherIs: 'worse',
    },
    ideal: {
      summary: 'No numeric target; fewer conspicuous pores is better, but the count cannot be changed by this app.',
      male: null,
      rationale:
        'In one study of 60 adults, larger pores went with higher oil output, sex and age. No study gives a pore count that looks better or worse, so no band is set.',
      confidenceInIdeal: 'low',
      populationCaveat: 'The one study we cite had 60 adults, and the app’s phone-based count detects only large pores.',
    },
    scoring: {
      kind: 'personal_baseline',
      direction: 'lower_better',
      note: 'No absolute band exists. Compared only with the user’s own scans taken with matching light and distance; display as low-confidence and never imply the user can shrink pores.',
    },
    changeability: 'FIXED',
    changeabilityNote:
      'Set mainly by oil output, age and genetics. We found no evidence that steam, cold water or scrubbing change pore size.',
    weight: 0.25,
    weightRationale:
      'Cut from the seed’s 0.5 to the minimum useful weight: weak evidence, a noisy measurement, and nothing the user can change. The freed weight went to S01.',
    evidence: 'WEAK',
    evidenceNote:
      'We found no study showing that visible pores change attractiveness ratings. In the one study we cite, pore size followed oil output, sex and age, and nothing in this app can change it. Included at a very low weight because people ask about it.',
    sourceIds: ['skin:roh2006'],
    drivers: [],
    captureRequirements: ['skin_zones'],
    refusalConditions: [...TEXTURE_REFUSALS, 'nose or cheek surface more than 15° off square to the lens'],
    phase: 'V2',
  },

  // ───────────────────────── S09 under-eye darkness ─────────────────────────
  {
    id: 'S09',
    category: 'skin',
    name: 'Under-eye darkness',
    measures: 'How much darker the skin under the eyes is than the cheek just below it.',
    howMeasured:
      'Grey-card-calibrated frontal photo, eyes open and relaxed, lit from the front at eye level. The app compares CIELAB lightness (L*) of a lower-lid patch with a cheek patch about 15 mm lower and reports the difference. Shadow from eye bags and from overhead light also darkens this area, so the protocol uses soft front light and a level head.',
    methods: ['COLOR_CALIBRATED_PHOTO'],
    scale: {
      unit: 'ΔL* (cheek minus under-eye, CIELAB)',
      min: null,
      max: null,
      description: 'Lightness of the cheek patch minus lightness of the under-eye patch; higher means darker under-eyes',
      higherIs: 'worse',
    },
    ideal: {
      summary: 'No numeric target. Smaller is better, but most under-eye darkness is inherited or structural.',
      male: null,
      rationale:
        'In one early study, raters saw more dark circles on sleep-deprived faces, but a later randomised study of 181 people found no measurable change in under-eye darkness after a night without sleep. A review lists genetics, extra pigment, thin skin that shows blood vessels, puffiness and shadow from the eye-bag shape as the main causes. No value separates normal from a problem.',
      confidenceInIdeal: 'low',
      populationCaveat:
        'The sleep studies were short experiments with one night of total sleep loss in adults, not long-term sleep habits.',
    },
    scoring: {
      kind: 'personal_baseline',
      direction: 'lower_better',
      note: 'Scored against the user’s own baseline only. The reading mixes pigment, blood-vessel colour and shadow, so show it as low-confidence and never imply that sleep alone will change it.',
    },
    changeability: 'FIXED_BUT_VISIBILITY_CHANGEABLE',
    changeabilityNote:
      'Mostly genetic or structural. Sleep changes how tired and healthy faces are rated (small differences in one 23-person study), but a randomised study found no measurable change in under-eye darkness after one sleepless night.',
    weight: 0.75,
    weightRationale:
      'Cut from the seed’s 1.5 and kept under the WEAK cap: a later randomised study did not confirm the sleep link and most darkness is structural. The freed weight went to S01.',
    evidence: 'WEAK',
    evidenceNote:
      'The evidence conflicts. One small rating study found dark circles after sleep loss; a larger randomised study that measured the skin found no change. Most under-eye darkness is inherited or structural. Treat sleep as a general health lever, not a fix for this measure.',
    sourceIds: ['skin:sundelin2013', 'skin:holding2019', 'skin:axelsson2010', 'skin:sarkar2016'],
    drivers: ['sleep'],
    captureRequirements: ['frontal_neutral', 'eye_closeup'],
    refusalConditions: [
      ...COLOUR_REFUSALS,
      'light from above or below the face instead of soft front light',
      'head pitch or roll above 3°',
      'eyes squinting, eyelids lowered or not looking at the lens',
      'under-eye skin rubbed or visibly puffy within the last 30 minutes',
    ],
    phase: 'V2',
  },

  // ───────────────────────── S10 oiliness / shine ─────────────────────────
  {
    id: 'S10',
    category: 'skin',
    name: 'Oiliness and shine',
    measures: 'How shiny the forehead and nose look at a fixed time after washing, a sign of surface oil.',
    howMeasured:
      'Grey-card-calibrated frontal photo taken 3 hours after washing, in the same soft light each time. The app reports the share of the forehead-and-nose patch covered by glare (very bright, low-colour pixels). Optional: press blotting paper on the nose and self-grade the oil mark 0–3.',
    methods: ['COLOR_CALIBRATED_PHOTO', 'SELF_GRADE_REFERENCE'],
    scale: {
      unit: '% of forehead and nose patch with glare',
      min: 0,
      max: 100,
      description: 'Share of the patch covered by glare; higher means shinier',
      higherIs: 'worse',
    },
    ideal: {
      summary:
        'No numeric target. Less glare at the fixed time is better, but some shine from normal oil and sweat is expected.',
      male: null,
      rationale:
        'We found no study that sets a shine level that looks better or worse. Oil output matters mainly through acne and pore size (S01, S08). Glare also depends on the angle of the light and the camera.',
      confidenceInIdeal: 'low',
    },
    scoring: {
      kind: 'personal_baseline',
      direction: 'lower_better',
      note: 'No absolute band. Scored against the user’s own typical level at the same hour after washing; no extra credit below the user’s usual low level. Display as low-confidence.',
    },
    changeability: 'FIXED',
    changeabilityNote:
      'Oil output is set mainly by hormones, age and genetics. We found no habit-based lever with good evidence for lowering it.',
    weight: 0.25,
    weightRationale:
      'Cut from the seed’s 0.5 to the minimum useful weight: no study ties shine to attractiveness and the reading depends on light as much as on skin. The freed weight went to S01.',
    evidence: 'WEAK',
    evidenceNote:
      'We found no study showing that shine itself changes attractiveness ratings. The reading depends on the room light and camera as much as on the skin. Included at a very low weight because of its link to acne and pores.',
    sourceIds: ['skin:roh2006'],
    drivers: [],
    captureRequirements: ['skin_zones', 'frontal_neutral'],
    refusalConditions: [
      ...COLOUR_REFUSALS,
      'photo not taken 3 hours (plus or minus 15 minutes) after washing',
      'face wiped or blotted within the last 15 minutes',
      'light direction differs from the baseline scan set-up',
    ],
    phase: 'V2',
  },

  // ───────────────────────── S11 lines and wrinkles ─────────────────────────
  {
    id: 'S11',
    category: 'skin',
    name: 'Lines and wrinkles',
    measures:
      'Visible lines on the forehead, between the brows and at the outer eye corners (crow’s feet) when the face is relaxed, graded 0–4.',
    howMeasured:
      'The user compares relaxed-face close-ups of forehead, brow gap and eye corners with reference images and picks a grade; a line-density estimate from the photo is shown beside it as a check. Lines that appear only when smiling or frowning are logged separately and not graded.',
    methods: ['SELF_GRADE_REFERENCE', 'AUTO_FRONTAL_PHOTO'],
    scale: {
      unit: 'grade (0–4)',
      min: 0,
      max: 4,
      description: '0 none at rest, 1 faint, 2 clear, 3 deep, 4 deep and widespread',
      higherIs: 'worse',
    },
    ideal: {
      summary:
        'No numeric target. Fewer lines at rest than is typical for your age is the aim; lines mostly follow age, sun and smoking.',
      male: null,
      rationale:
        'In rating studies, wrinkles and uneven skin colour were main skin cues for how old a face looks, and a study of identical twins linked more sun exposure and longer smoking with an older, more wrinkled look. We found no age-by-age grade norms for men that we could check, so no band is set.',
      confidenceInIdeal: 'low',
      populationCaveat:
        'The perceived-age study used women’s faces, and the twin study was observational, so it shows association, not proof of cause.',
    },
    scoring: {
      kind: 'personal_baseline',
      direction: 'lower_better',
      note: 'Compared with the user’s own baseline. Lines increase slowly with age, so the score tracks whether lines are increasing faster than the user’s own early trend. There is no absolute age norm.',
    },
    changeability: 'CHANGEABLE',
    changeabilityNote:
      'Prevention only: limiting UV exposure slows new lines, and smoking is tracked as a habit in X10. Lines already formed need professional treatment, which the app does not advise on. A UV-protection product the user already owns can be whitelisted; the app does not recommend products.',
    weight: 0.75,
    weightRationale:
      'Raised from the seed’s 0.5: wrinkles are a main skin cue for perceived age, and sun exposure is controllable. Kept low because lines are usually mild in men in their 20s and 30s and the attractiveness effect in men is not well studied.',
    evidence: 'MODERATE',
    evidenceNote:
      'Wrinkles clearly shape perceived age, and sun and smoking are linked to more of them. But the key studies are observational (twins, sun-seeking versus sun-avoiding groups) or rated women’s faces, and we found no study of how lines change attractiveness in men.',
    sourceIds: ['skin:nkengne2008', 'skin:guyuron2009', 'skin:flament2013'],
    drivers: ['sun_habits', 'whitelist_product'],
    captureRequirements: ['frontal_neutral', 'skin_zones'],
    refusalConditions: [
      'expression not neutral: brows raised or furrowed, eyes squinting, mouth tense',
      'head pitch or roll above 3°',
      'overhead or strong side light that casts shadows inside lines',
      'camera beauty filter, skin smoothing, HDR or portrait mode active',
      'close-up blurred or out of focus',
    ],
    phase: 'M2',
  },

  // ───────────────────────── S12 lips ─────────────────────────
  {
    id: 'S12',
    category: 'skin',
    name: 'Lip condition (chapping)',
    measures: 'Dryness, cracking and peeling of the lips, graded 0–3.',
    howMeasured:
      'Self-grade from a relaxed, mouth-closed frontal photo and a lip close-up against reference images: 0 smooth, 1 dry or lightly flaking, 2 peeling or cracked, 3 split, sore or bleeding.',
    methods: ['SELF_GRADE_REFERENCE'],
    scale: {
      unit: 'grade (0–3)',
      min: 0,
      max: 3,
      description: '0 smooth, 1 dry, 2 peeling or cracked, 3 split or sore',
      higherIs: 'worse',
    },
    ideal: {
      summary: 'Smooth lips with no peeling or cracks (grade 0).',
      male: { lo: 0, hi: 0 },
      rationale:
        'This is common-sense grooming, not a researched attractiveness factor. We found no study on chapped lips and attractiveness.',
      confidenceInIdeal: 'low',
    },
    scoring: {
      kind: 'range',
      lo: 0,
      hi: 0,
      tau: 1.5,
      tauRationale:
        'Editorial: grade 1 scores about 80, grade 2 about 41 and grade 3 about 14. No study gives a fall-off, and the weight is minimal.',
    },
    changeability: 'CHANGEABLE',
    changeabilityNote:
      'Mainly by stopping lip licking, biting and peeling. Cold weather and dry indoor air also matter.',
    weight: 0.25,
    weightRationale: 'Unchanged from the seed: a visible grooming detail with no research behind it, so it stays at the minimum weight.',
    evidence: 'WEAK',
    evidenceNote:
      'We found no study linking chapped lips to attractiveness or health ratings. It is included at the minimum weight as a visible grooming detail.',
    sourceIds: [],
    drivers: ['skin_habits'],
    captureRequirements: ['frontal_neutral'],
    refusalConditions: [
      'lipstick, tinted lip product or gloss visible on the lips',
      'mouth open, pursed or smiling',
      'lips wet from licking or drinking within the last 5 minutes',
    ],
    medicalFlag:
      'A crack at the mouth corner, or a sore or crusted patch on the lip, that has not healed within about 2 weeks: see a doctor.',
    phase: 'M2',
  },

  // ───────────────────────── S13 body skin ─────────────────────────
  {
    id: 'S13',
    category: 'skin',
    name: 'Body skin (back and chest acne, rough arm bumps)',
    measures:
      'Acne spots on the back, chest and shoulders, and rough, bumpy patches on the upper arms and thighs (keratosis pilaris), graded 0–3.',
    howMeasured:
      'The user photographs the bare back, chest and upper arms in even light, compares them with reference images and picks one grade for the worse of the two problems: 0 clear, 1 few spots or faint roughness, 2 many spots or clear roughness, 3 widespread or inflamed.',
    methods: ['SELF_GRADE_REFERENCE', 'TAP_COUNT_ON_PHOTO'],
    scale: {
      unit: 'grade (0–3)',
      min: 0,
      max: 3,
      description: '0 clear, 1 few spots or faint roughness, 2 many spots or clear roughness, 3 widespread or inflamed',
      higherIs: 'worse',
    },
    ideal: {
      summary: 'Clear or nearly clear (grade 0–1).',
      male: { lo: 0, hi: 1 },
      rationale:
        'Keratosis pilaris is a common, harmless condition (an estimated half or more of adolescents in one review), and back and chest acne is common among people with facial acne. Neither has an attractiveness norm, so clear or nearly clear is a plain-sense aim, not a researched cut-off.',
      confidenceInIdeal: 'low',
    },
    scoring: {
      kind: 'range',
      lo: 0,
      hi: 1,
      tau: 1.5,
      tauRationale:
        'Editorial: grade 2 scores about 80 and grade 3 about 41. No study gives a fall-off, and the weight is minimal.',
    },
    changeability: 'CHANGEABLE',
    changeabilityNote:
      'Partly. Back and chest acne responds slowly to habits such as not picking. Keratosis pilaris is inherited and habits do not clear it.',
    weight: 0.25,
    weightRationale:
      'Unchanged from the seed. Body skin is seen in fewer situations than facial skin and there is no attractiveness research on it, so it stays at the minimum weight.',
    evidence: 'WEAK',
    evidenceNote:
      'Keratosis pilaris and back or chest acne are common and documented, and truncal acne is linked to lower quality of life in surveys. We found no study of how body skin changes attractiveness ratings. Included at the minimum weight.',
    sourceIds: ['skin:hwang2008', 'skin:truncalacne'],
    drivers: ['skin_habits'],
    captureRequirements: ['body_back', 'body_front'],
    refusalConditions: [
      'body photo not in even light (strong shadows across the back or chest)',
      'flushed skin: within 60 minutes of exercise or a hot shower',
      'self-tanner, body makeup or body hair covering more than half of the graded area',
      'photo blurred or out of focus',
    ],
    medicalFlag:
      'Painful deep lumps on the back or chest, or a rash that spreads, weeps or itches severely: see a doctor.',
    phase: 'M2',
  },

  // ───────────────────────── S14 dryness / flaking (new) ─────────────────────────
  {
    id: 'S14',
    category: 'skin',
    name: 'Dryness and flaking',
    measures:
      'Dry patches, rough scaling or visible flakes on the face (cheeks, sides of the nose, brows, beard line), graded 0–3.',
    howMeasured:
      'Self-grade from side-lit close-ups of the cheeks, nose sides and brows against reference images: 0 smooth, 1 dry feel or faint rough patches, 2 visible scaling, 3 flaking that is cracked, red or itchy. Photos are taken before anything is applied to the skin that day.',
    methods: ['SELF_GRADE_REFERENCE'],
    scale: {
      unit: 'grade (0–3)',
      min: 0,
      max: 3,
      description: '0 smooth, 1 dry or faintly rough, 2 visible scaling, 3 cracked, red or itchy flaking',
      higherIs: 'worse',
    },
    ideal: {
      summary: 'No visible dryness or flaking (grade 0).',
      male: { lo: 0, hi: 0 },
      rationale:
        'A smooth, even surface is part of what rating studies call healthy-looking skin (see S07). We found no study with a dryness threshold, so grade 0 is a plain-sense aim.',
      confidenceInIdeal: 'low',
    },
    scoring: {
      kind: 'range',
      lo: 0,
      hi: 0,
      tau: 1.5,
      tauRationale:
        'Editorial: grade 1 scores about 80, grade 2 about 41 and grade 3 about 14. No study gives a fall-off, and the weight is small.',
    },
    changeability: 'CHANGEABLE',
    changeabilityNote:
      'Cold, dry air lowers skin barrier function in a review, and hot water is a suspected contributor with limited evidence. The habit levers are lukewarm water, shorter showers, patting dry and not scrubbing. Dryness caused by a skin condition does not respond to habits.',
    weight: 0.5,
    weightRationale:
      'New metric. Visible flaking is a common, controllable problem that none of the other skin metrics capture, but it has no attractiveness research behind it, so it stays small.',
    evidence: 'WEAK',
    evidenceNote:
      'Dry skin and its triggers (cold, low humidity) are described in dermatology reviews, but we found no study of how flaking changes attractiveness ratings, and the habit advice has limited trial support. Included at a low weight.',
    sourceIds: ['skin:augustin2019', 'skin:engebretsen2016'],
    drivers: ['skin_habits'],
    captureRequirements: ['skin_zones', 'skin_sidelight'],
    refusalConditions: [
      'any skin product applied within the last 2 hours (hides flaking)',
      'face washed, scrubbed or shaved within the last 30 minutes',
      'makeup or any tinted skin product on the face',
      'light not coming from the side, or photo blurred',
      'beard stubble covering more than half of the graded patch',
    ],
    medicalFlag:
      'Flaking with redness or itching around the nose, brows or hairline that keeps coming back, or dry patches that crack, ooze or spread: see a doctor. These can be eczema or seborrhoeic dermatitis.',
    phase: 'M2',
  },

  // ───────────────────────── S15 razor bumps (new) ─────────────────────────
  {
    id: 'S15',
    category: 'skin',
    name: 'Razor bumps and shaving irritation',
    measures:
      'Small red or dark bumps and ingrown hairs on the beard area and neck, caused by shaved hairs curling back into the skin (pseudofolliculitis barbae), plus visible shaving irritation such as redness and nicks.',
    howMeasured:
      'The user takes close-ups of the cheeks, jaw and neck at the same fixed interval after their usual shave each week and taps each bump. Irritation redness is self-graded 0–3 on the same photos. The bump count is the score input; the redness grade is shown beside it. Not scored for users who do not shave.',
    methods: ['TAP_COUNT_ON_PHOTO', 'SELF_GRADE_REFERENCE'],
    scale: {
      unit: 'bumps (count) on beard area and neck',
      min: 0,
      max: null,
      description: 'Count of razor bumps and ingrown-hair bumps in the shaved area; higher is worse',
      higherIs: 'worse',
    },
    ideal: {
      summary: 'No numeric target; zero bumps is the aim. A few bumps after shaving are common.',
      male: null,
      rationale:
        'Razor bumps are a known result of close shaving, especially of curly hair. No study gives a normal bump count, so no band is set.',
      confidenceInIdeal: 'low',
      populationCaveat: 'Risk is higher with tightly curled hair. The metric applies only to men who shave the area.',
    },
    scoring: {
      kind: 'range',
      lo: 0,
      hi: 3,
      tau: 8,
      tauRationale:
        'Editorial, not data-derived: 0–3 bumps are treated as ordinary shaving noise because no published norm exists. At tau 8, 11 bumps scores about 61 and 19 bumps about 14.',
    },
    changeability: 'CHANGEABLE',
    changeabilityNote:
      'Mostly changeable through shaving technique or by not shaving the area; growing the hair out removes the cause. Do not pick at ingrown hairs.',
    weight: 0.75,
    weightRationale:
      'New metric, active only for users who shave. For men who are prone, razor bumps are visible and controllable. Kept under the WEAK cap because the evidence is thin and many men are not affected. Weight comes from freed WEAK-evidence skin metrics.',
    evidence: 'WEAK',
    evidenceNote:
      'The cause (close shaving of curly hair) is well described, but we found no trials rating how razor bumps change attractiveness, and the shaving-technique advice rests on dermatologist guidance and a review rather than strong trials.',
    sourceIds: ['skin:nussbaum2019', 'skin:aadrazor2022'],
    drivers: ['grooming', 'skin_habits', 'beard_design'],
    captureRequirements: ['skin_zones'],
    refusalConditions: [
      'user does not shave the area (beard grown out or never shaved): metric not scored',
      'photo not taken at the user’s usual interval after shaving',
      'scan taken within 2 hours of shaving (temporary redness, bumps not yet formed)',
      'close-up blurred or stubble hiding the skin surface',
    ],
    medicalFlag:
      'Bumps that are painful, filled with pus, spreading, or leaving dark or raised scars: see a doctor.',
    phase: 'M2',
  },

  // ───────────────────────── S16 sun-related pigment (new) ─────────────────────────
  {
    id: 'S16',
    category: 'skin',
    name: 'Sun spots and uneven sun-related pigment',
    measures:
      'Flat brown spots on the face and neck from past sun exposure (sun spots, also called solar lentigines) and patchy tan lines, counted separately from post-acne marks (S03). Freckles are flagged because they are mostly inherited.',
    howMeasured:
      'On grey-card-calibrated close-ups of the cheeks, forehead, temples and neck the user taps each flat brown spot. The app keeps those with ΔE (overall colour difference) of 3 or more against the skin around them and reports the count. Tan lines from clothing are logged but not counted.',
    methods: ['COLOR_CALIBRATED_PHOTO', 'TAP_COUNT_ON_PHOTO'],
    scale: {
      unit: 'visible brown spots (count with ΔE ≥ 3)',
      min: 0,
      max: null,
      description: 'Number of flat brown spots whose colour differs from nearby skin by ΔE 3 or more',
      higherIs: 'worse',
    },
    ideal: {
      summary: 'No numeric target. Fewer and fainter sun spots is the aim; existing spots rarely fade on their own.',
      male: null,
      rationale:
        'Sun spots are strongly linked to sun exposure, unlike freckles, and uneven pigment is a main cue for how old skin looks. No study gives a normal count for men of a given age.',
      confidenceInIdeal: 'low',
      populationCaveat:
        'Spot counts rise with age and with skin that burns easily, so comparing people is not meaningful. Only change within one person is interpreted.',
    },
    scoring: {
      kind: 'personal_baseline',
      direction: 'lower_better',
      note: 'New spots and darkening cost points; a stable count is neutral. Existing spots are not penalised a second time here when they already lower S04, and a drop caused by a fading tan is not counted as improvement.',
    },
    changeability: 'CHANGEABLE',
    changeabilityNote:
      'Prevention only. Shade, a hat and avoiding peak UV limit new and darker spots. Existing spots do not fade with habits; removing them is professional-only and outside this app. A UV-protection product the user already owns can be whitelisted; the app does not recommend products.',
    weight: 0.5,
    weightRationale:
      'New metric, kept small: it partly overlaps with S04 (tone evenness) and existing spots cannot be changed by habits. Weight comes from freed WEAK-evidence skin metrics.',
    evidence: 'WEAK',
    evidenceNote:
      'The link between sun exposure and sun spots is well described in dermatology, but we found no study of how sun spots change attractiveness. The appearance case rests on indirect evidence from perceived-age and even-colour studies.',
    sourceIds: ['skin:bastiaens2004', 'skin:flament2013', 'skin:nkengne2008'],
    drivers: ['sun_habits', 'whitelist_product'],
    captureRequirements: ['skin_zones'],
    refusalConditions: [...COLOUR_REFUSALS, FRESH_SUN],
    medicalFlag:
      'A brown spot that is new, changing, itchy, bleeding, or has uneven colour or edges is not a sun spot until a doctor says so: see a doctor (see S17).',
    phase: 'V2',
  },

  // ───────────────────────── S17 mole / spot safety check (new, weight 0) ─────────────────────────
  {
    id: 'S17',
    category: 'skin',
    name: 'New or changing moles and spots (safety check)',
    measures:
      'Whether any mole or skin spot is new, changing, itching or bleeding. A safety check that prompts a doctor visit; it is not an appearance score.',
    howMeasured:
      'Each month the app shows a short checklist of the ABCDE questions for each mole the user chooses to track: Asymmetry, Border, Colour, Diameter (about 6 mm or larger) and Evolving (any change). The user answers yes or no and each yes adds one flag. Optional reference photos let the user compare over time. The app never gives a risk estimate or a diagnosis.',
    methods: ['CHECKLIST', 'MANUAL_INPUT'],
    scale: {
      unit: 'ABCDE flags (0–5)',
      min: 0,
      max: 5,
      description: 'Number of ABCDE warning signs answered yes for the most concerning spot',
      higherIs: 'worse',
    },
    ideal: {
      summary: 'No flags (0).',
      male: { lo: 0, hi: 0 },
      rationale:
        'The ABCDE rule is the standard public checklist for noticing moles worth showing to a doctor. It misses some skin cancers and flags many harmless moles, so a 0 does not prove a spot is safe.',
      confidenceInIdeal: 'medium',
    },
    scoring: { kind: 'none', reason: 'context_only' },
    changeability: 'PROFESSIONAL_ONLY',
    changeabilityNote: 'Only a doctor can assess a spot.',
    weight: 0,
    weightRationale:
      'Safety check, not an appearance factor. Putting it in the score could reward ignoring a warning sign.',
    evidence: 'CONVENTION',
    evidenceNote:
      'The ABCDE rule is a widely used clinical rule of thumb for noticing moles worth showing a doctor. It has limits: it can miss some melanomas and flag harmless moles. It prompts a visit; it never diagnoses.',
    sourceIds: ['skin:tsao2015'],
    drivers: [],
    captureRequirements: ['self_report', 'skin_zones'],
    refusalConditions: [
      'any request for an automatic cancer risk label, probability or "safe" verdict on a spot',
      'spot photo used for tracking only; never classified by image analysis',
    ],
    medicalFlag:
      'Any mole or spot that is new, changing in size, shape or colour, itchy, bleeding, crusting or not healing: see a doctor or dermatologist promptly. The app cannot tell harmless spots from cancer.',
    phase: 'M2',
  },

  // ───────────────────────── S18 skin colour baseline (new, weight 0) ─────────────────────────
  {
    id: 'S18',
    category: 'skin',
    name: 'Skin colour baseline (context only)',
    measures:
      'The user’s natural skin lightness and undertone, measured only so the colour metrics S03 to S06, S09 and S16 can be read fairly. It is never scored, and no skin tone is treated as better than another.',
    howMeasured:
      'Grey-card-calibrated photo of an area not usually in the sun (inner upper arm) and of the cheek. The app computes CIELAB lightness (L*) and the individual typology angle (ITA°), a standard way to place skin on a light-to-dark scale. Measured once and re-checked yearly.',
    methods: ['COLOR_CALIBRATED_PHOTO'],
    scale: {
      unit: 'ITA° (degrees)',
      min: null,
      max: null,
      description: 'Individual typology angle from CIELAB L* and b*; higher values mean lighter skin; used for calibration only',
      higherIs: 'not_applicable',
    },
    ideal: {
      summary: 'No ideal. Every natural skin tone is valid; the value is context for other metrics only.',
      male: null,
      rationale:
        'Skin colour is inherited and varies widely. Scoring it would reward or punish ancestry, not anything a person can change. The value is used to flag when colour detection is less reliable, for example redness in darker skin.',
      confidenceInIdeal: 'high',
    },
    scoring: { kind: 'none', reason: 'context_only' },
    changeability: 'FIXED',
    changeabilityNote: 'The natural baseline is inherited. Tanning is not a lever and is not encouraged.',
    weight: 0,
    weightRationale: 'Context only: it must never change the appearance score.',
    evidence: 'CONVENTION',
    evidenceNote:
      'ITA° is a standard research convention for describing skin colour from CIELAB values. It is used here only to calibrate other metrics and to warn when detection is less reliable.',
    sourceIds: ['skin:delbino2018'],
    drivers: [],
    captureRequirements: ['skin_zones'],
    refusalConditions: [...COLOUR_REFUSALS, 'measured area tanned or sunburned within the last 3 weeks'],
    phase: 'V2',
  },
]

export const sources: Source[] = [
  {
    id: 'skin:ritvo2011',
    kind: 'peer_reviewed',
    citation:
      'Ritvo, E., Del Rosso, J. Q., Stillman, M. A., & La Riche, C. (2011). Psychosocial judgements and perceptions of adolescents with acne vulgaris: A blinded, controlled comparison of adult and peer evaluations. BioPsychoSocial Medicine, 5, 11.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3171294/',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary of the abstract and figure captions reported two online surveys (n = 1,002 and 1,006) in which teens and adults rated photos of teenagers with acne or clear skin; clear-skinned teens were rated higher on every favourable trait and lower on every unfavourable trait by both groups. Sample details and statistics are unchecked.',
    supports: 'Faces with acne were judged less favourably than clear-skinned faces in a photo-rating survey of teenagers',
  },
  {
    id: 'skin:fda2018acne',
    kind: 'government_or_standards',
    citation:
      'U.S. Food and Drug Administration (2018). Acne Vulgaris: Establishing Effectiveness of Drugs Intended for Treatment. Guidance for Industry.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://www.hhs.gov/guidance/sites/default/files/hhs-guidance-documents/FDA/Acne-Vulgaris---Establishing-Effectiveness-of-Drugs-Intended-for-Treatment.pdf',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'Search summaries said the May 2018 final guidance recommends a 5-point investigator global assessment with success defined as clear (0) or almost clear (1) plus at least a 2-grade improvement, and a trial protocol defined clear as no lesions and almost clear as rare non-inflamed lesions with at most one small inflamed lesion. The URL is the HHS-hosted copy surfaced by the search; its text was not read.',
    supports: 'Investigator-grade 0–1 (clear or almost clear) as the clinical success threshold for facial acne',
  },
  {
    id: 'skin:reynolds2024',
    kind: 'clinical_guideline',
    citation:
      'Reynolds, R. V., et al. (2024). Guidelines of care for the management of acne vulgaris. Journal of the American Academy of Dermatology, 90(5).',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://doi.org/10.1016/j.jaad.2023.12.017',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'Search confirmed the citation (JAAD, May 2024, volume 90 issue 5, DOI 10.1016/j.jaad.2023.12.017) and that the guideline reviews topical, systemic, hormonal, procedural, complementary and dietary interventions. The search did NOT surface what it says about diet or referral, so this catalog makes no claim about the guideline’s diet recommendation. First-author initials are from memory.',
    supports: 'Moderate-to-severe acne is managed by clinicians; the standard clinical guideline for acne care',
  },
  {
    id: 'skin:smith2007',
    kind: 'peer_reviewed',
    citation:
      'Smith, R. N., et al. (2007). A low-glycemic-load diet improves symptoms in acne vulgaris patients: a randomized controlled trial. American Journal of Clinical Nutrition, 86(1), 107–115.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://pubmed.ncbi.nlm.nih.gov/17616769/',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported 43 male acne patients aged 15–25 randomised to a low-glycaemic-load or control diet for 12 weeks; lesion counts fell more in the low-glycaemic-load group (−23.5 versus −12.0, P = 0.03) with greater weight loss, and the authors said the acne benefit could not be separated from weight loss.',
    supports: 'A low-glycaemic-load diet lowered lesion counts in a small 12-week trial of young men, confounded with weight loss',
  },
  {
    id: 'skin:choi2006',
    kind: 'peer_reviewed',
    citation:
      'Choi, J. M., Lew, V. K., & Kimball, A. B. (2006). A single-blinded, randomized, controlled clinical trial evaluating the effect of face washing on acne vulgaris. Pediatric Dermatology, 23(5), 421–427.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://pubmed.ncbi.nlm.nih.gov/17014635/',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported that, after a 2-week run-in, men with mild to moderate acne were randomised to wash once, twice or four times a day for 6 weeks; there were no significant differences between groups, the authors saw slight support for twice-daily washing and said excessive washing may not be as culpable as thought.',
    supports: 'Washing the face twice a day was no worse than other frequencies for acne in one 6-week trial',
  },
  {
    id: 'skin:layton1994',
    kind: 'peer_reviewed',
    citation:
      'Layton, A. M., Henderson, C. A., & Cunliffe, W. J. (1994). A clinical evaluation of acne scarring and its incidence. Clinical and Experimental Dermatology, 19(4), 303–308.',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'No abstract was found; the details come only from later papers that cite it (reported as 95% of 185 clinic patients with some scarring, with scarring correlating with severity and delayed treatment). Treat those figures as second-hand. No URL is given because none was surfaced for the original.',
    supports: 'Scarring is common among people attending clinics for acne and is linked to severity and delayed treatment',
  },
  {
    id: 'skin:tan2017jdd',
    kind: 'peer_reviewed',
    citation:
      'Tan, J., Kang, S., & Leyden, J. (2017). Prevalence and risk factors of acne scarring among patients consulting dermatologists in the USA. Journal of Drugs in Dermatology, 16(2), 97–102.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://pubmed.ncbi.nlm.nih.gov/28300850/',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported 1,972 patients seen by dermatologists, 43% with acne scarring, 69% of those with only mild or moderate acne at the visit; risk factors named were acne severity, time to first effective treatment, relapsing acne and male sex.',
    supports: 'Scarring is common, occurs even with mild-to-moderate acne, and is linked to severity, relapse and treatment delay',
  },
  {
    id: 'skin:tan2017jeadv',
    kind: 'peer_reviewed',
    citation:
      'Tan, J., et al. (2017). Development of an atrophic acne scar risk assessment tool. Journal of the European Academy of Dermatology and Venereology, 31(9), 1547–1554.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://research.usfq.edu.ec/en/publications/development-of-an-atrophic-acne-scar-risk-assessment-tool/',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'Found only through a news summary (odds ratio about 1.70, 95% CI 1.27–2.29, for picking and squeezing, alongside acne severity and family history) and an institutional record whose title matches. The author list, exact title and numbers need checking against the journal record.',
    supports: 'Picking and squeezing spots was associated with higher odds of acne scarring in a risk-factor study',
  },
  {
    id: 'skin:goodman2006',
    kind: 'peer_reviewed',
    citation:
      'Goodman, G. J., & Baron, J. A. (2006). Postacne scarring: a qualitative global scarring grading system. Dermatologic Surgery, 32(12), 1458–1466.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://research.monash.edu/en/publications/postacne-scarring-a-qualitative-global-scarring-grading-system/',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary described a four-grade qualitative system (macular, mild, moderate, severe) based on lesion type and on whether scarring can be disguised at social distance, with the authors acknowledging subjectivity. This catalog’s 0–4 scale is only modelled on that idea, with its own definitions.',
    supports: 'Visibility-based, four-grade way of describing acne scarring that the S02 scale is modelled on',
  },
  {
    id: 'skin:davis2010',
    kind: 'peer_reviewed',
    citation:
      'Davis, E. C., & Callender, V. D. (2010). Postinflammatory hyperpigmentation: a review of the epidemiology, clinical features, and treatment options in skin of color. Journal of Clinical and Aesthetic Dermatology, 3(7), 20–31.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://pubmed.ncbi.nlm.nih.gov/20725554/',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary of the abstract said post-inflammatory hyperpigmentation is an acquired excess of pigment after inflammation or injury, occurs in all skin types, is more frequent in skin of colour, and that first-line management includes photoprotection. The full text, including how long marks last and how sun affects them, was not read.',
    supports: 'Post-inflammatory marks follow skin inflammation, are more frequent in darker skin, and photoprotection is part of management',
  },
  {
    id: 'skin:mahy1994',
    kind: 'peer_reviewed',
    citation:
      'Mahy, M., Van Eycken, L., & Oosterlinck, A. (1994). Evaluation of uniform color spaces developed after the adoption of CIELAB and CIELUV. Color Research and Application, 19(2), 105–121.',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'The citation is known only from a patent document and software documentation that attribute a just-noticeable CIELAB difference of ΔE 2.3 to this paper; the paper itself was not found. The 2.3 value applies to flat colour patches in controlled viewing, not to faces. No URL is given because none was surfaced for the original.',
    supports: 'A colour difference of about 2–3 ΔE is near the smallest difference people notice between flat colour patches',
  },
  {
    id: 'skin:fink2001',
    kind: 'peer_reviewed',
    citation:
      'Fink, B., Grammer, K., & Thornhill, R. (2001). Human (Homo sapiens) facial attractiveness in relation to skin texture and color. Journal of Comparative Psychology, 115(1), 92–99.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://psych.uni-goettingen.de/de/biopers/publications_department/finketal2001',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary of the abstract (PubMed ID 11334223 reported) said attractiveness ratings of female faces related positively to skin homogeneity measured with computer-extracted texture and colour features. Only female faces are covered; the abstract was not opened.',
    supports: 'More homogeneous skin texture and colour was linked to higher attractiveness ratings of faces (female faces)',
  },
  {
    id: 'skin:matts2007',
    kind: 'peer_reviewed',
    citation:
      'Matts, P. J., Fink, B., Grammer, K., & Burquest, M. (2007). Color homogeneity and visual perception of age, health, and attractiveness of female facial skin. Journal of the American Academy of Dermatology, 57(6), 977–984.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://psych.uni-goettingen.de/de/biopers/publications_department/mattsetal2007',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported cheek images of 170 females aged 11–76; colour homogeneity correlated positively with perceived attractiveness, health and youth (all r > 0.40) and negatively with perceived age (r = −0.45). The summary said the study was supported by Procter & Gamble with two P&G-employed authors, which is a possible conflict of interest.',
    supports: 'More even skin colour was rated younger, healthier and more attractive (female faces; industry-funded)',
  },
  {
    id: 'skin:fink2012',
    kind: 'peer_reviewed',
    citation:
      'Fink, B., Matts, P. J., D’Emiliano, D., Bunse, L., Weege, B., & Röder, S. (2012). Colour homogeneity and visual perception of age, health and attractiveness of male facial skin. Journal of the European Academy of Dermatology and Venereology, 26(12), 1486–1492.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://psych.uni-goettingen.de/de/biopers/publications_department/finketal2012c',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported cheek images of 160 Caucasian British men aged 10–70 rated blind by 308 people; more even melanin and haemoglobin distributions were linked to younger perceived age and higher perceived health and attractiveness, with haemoglobin evenness more tied to health and attractiveness. Authors include one with a cosmetics-industry affiliation; funding was not checked.',
    supports: 'More even melanin and blood colour on the cheeks was rated younger, healthier and more attractive in men (white British sample)',
  },
  {
    id: 'skin:samson2010',
    kind: 'peer_reviewed',
    citation:
      'Samson, N., Fink, B., & Matts, P. J. (2010). Visible skin condition and perception of human facial appearance. International Journal of Cosmetic Science, 32(3), 167–184.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://www.psych.uni-goettingen.de/de/biopers/publications_department/samsonetal2010a',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary of the abstract described a review of how skin pigmentation and surface texture shape judgments of attractiveness and health, mainly through age and health cues, mostly in women. The text was not read.',
    supports: 'Review: skin colour and surface texture both affect perceived health and attractiveness',
  },
  {
    id: 'skin:nkengne2008',
    kind: 'peer_reviewed',
    citation:
      'Nkengne, A., Bertin, C., Stamatas, G. N., et al. (2008). Influence of facial skin attributes on the perceived age of Caucasian women. Journal of the European Academy of Dermatology and Venereology, 22(8), 982–991.',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'Second-hand search summary only: 48 graders rated photos of 173 women on 23 skin attributes, and the appearance of the eye area and the uniformity of skin colour were key attributes for perceived age. The paper itself was not retrieved, and the only link surfaced was a different-language database page, so no URL is given.',
    supports: 'Wrinkles and colour uniformity were key skin cues for how old a face looks (women’s faces)',
  },
  {
    id: 'skin:croninangle',
    kind: 'peer_reviewed',
    citation:
      'Cronin et al. (year not confirmed). Effect of camera distance and angle on color of diverse skin tone. Journal not confirmed from the search result.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10247498',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary said that, measuring a colour standard across skin tones, camera distance and angle changed CIELAB values (angle affected chromaticity, distance affected lightness, errors above 1 ΔE; raw files varied less than JPEG). The year, journal and full author list were not confirmed.',
    supports: 'Camera distance and angle change measured skin colour, which is why the capture protocol fixes both',
  },
  {
    id: 'skin:whitehead2012',
    kind: 'peer_reviewed',
    citation:
      'Whitehead, R. D., Re, D., Xiao, D., Ozakinci, G., & Perrett, D. I. (2012). You are what you eat: Within-subject increases in fruit and vegetable consumption confer beneficial skin-color changes. PLoS ONE, 7(3), e32988.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://doi.org/10.1371/journal.pone.0032988',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported 35 people measured at baseline, 3 and 6 weeks; changes in skin redness and yellowness tracked changes in fruit and vegetable intake and matched carotenoid absorption, not melanin; judges rated skin healthier and more attractive after about 2.9 and 3.3 extra portions a day; the sample was mostly Caucasian.',
    supports: 'Eating more fruit and vegetables raised skin yellowness and redness, which judges rated healthier and more attractive (small, mostly white sample)',
  },
  {
    id: 'skin:stephen2009',
    kind: 'peer_reviewed',
    citation:
      'Stephen, I. D., Coetzee, V., Law Smith, M., & Perrett, D. I. (2009). Skin blood perfusion and oxygenation colour affect perceived human health. PLoS ONE, 4(4), e5083.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://doi.org/10.1371/journal.pone.0005083',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported that participants adjusted colour-calibrated face photos along oxygenated and deoxygenated blood colour axes to look healthy, and mainly added oxygenated-blood redness above baseline. No independent replication was found in the search.',
    supports: 'Moderately redder, better-oxygenated skin was chosen as healthier-looking in a lab study',
  },
  {
    id: 'skin:gallo2018',
    kind: 'clinical_guideline',
    citation:
      'Gallo, R. L., Granstein, R. D., Kang, S., Mannis, M., Steinhoff, M., Tan, J., & Thiboutot, D. (2018). Standard classification and pathophysiology of rosacea: the 2017 update by the National Rosacea Society Expert Committee. Journal of the American Academy of Dermatology, 78(1), 148–155.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://pure.psu.edu/en/publications/standard-classification-and-pathophysiology-of-rosacea-the-2017-u/',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'Search confirmed the citation and that the update classifies rosacea by phenotype rather than subtype. A separate search summary said the diagnostic phenotype is persistent (or fixed) centrofacial erythema, with sources differing on the wording; the exact criteria were not read.',
    supports: 'Persistent redness in the middle of the face is a main feature that doctors use to recognise rosacea',
  },
  {
    id: 'skin:moustafa2014',
    kind: 'peer_reviewed',
    citation:
      'Moustafa, F., Lewallen, R. S., & Feldman, S. R. (2014). The psychological impact of rosacea and the influence of current management options. Journal of the American Academy of Dermatology, 71(5), 973–980.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://pubmed.ncbi.nlm.nih.gov/24993600/',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported a literature review of 17 studies concluding that people with rosacea show more embarrassment, social anxiety and depression and lower quality of life than the general population, and noted that the studies used different quality-of-life instruments.',
    supports: 'Rosacea carries a documented emotional and quality-of-life cost',
  },
  {
    id: 'skin:roh2006',
    kind: 'peer_reviewed',
    citation:
      'Roh, M., Han, M., Kim, D., & Chung, K. (2006). Sebum output as a factor contributing to the size of facial pores. British Journal of Dermatology, 155(5), 890–894.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://pubmed.ncbi.nlm.nih.gov/17034515/',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported 60 volunteers (30 men, 30 women) with dermoscopic pore images and Sebumeter readings; pore size was significantly associated with sebum output, sex and age, most strongly with sebum, and acne severity was not significantly associated with pore size.',
    supports: 'Pore size follows oil output, sex and age; oil output and pore size are not habit-controlled',
  },
  {
    id: 'skin:sundelin2013',
    kind: 'peer_reviewed',
    citation:
      'Sundelin, T., Lekander, M., Kecklund, G., Van Someren, E. J. W., Olsson, A., & Axelsson, J. (2013). Cues of fatigue: effects of sleep deprivation on facial appearance. Sleep, 36(9), 1355–1360.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://research.vu.nl/en/publications/cues-of-fatigue-effects-of-sleep-deprivation-on-facial-appearance/',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported that 40 observers rated photos of 10 people taken after normal sleep and after 31 hours awake; sleep-deprived faces were rated as having more dark circles, more hanging eyelids, redder and more swollen eyes, paler skin and more wrinkles. These were ratings, not skin measurements. The author list is from memory.',
    supports: 'Observers rated sleep-deprived faces as having more dark circles (a rating study of 10 faces)',
  },
  {
    id: 'skin:holding2019',
    kind: 'peer_reviewed',
    citation:
      'Holding, B. C., Sundelin, T., Cairns, P., Perrett, D. I., & Axelsson, J. (2019). The effect of sleep deprivation on objective and subjective measures of facial appearance. Journal of Sleep Research, 28(6), e12860.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://pubmed.ncbi.nlm.nih.gov/31006920/',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary of the PubMed record reported 181 participants randomised to one night of total sleep deprivation or normal sleep; no difference in objective facial variables including periorbital darkness and no difference in rater scores, although lower yellowness, less eye openness, downturned mouth corners and periorbital darkness predicted higher fatigue ratings across individuals.',
    supports: 'A randomised study found no measurable change in under-eye darkness after one night without sleep',
  },
  {
    id: 'skin:axelsson2010',
    kind: 'peer_reviewed',
    citation:
      'Axelsson, J., Sundelin, T., Ingre, M., Van Someren, E. J. W., Olsson, A., & Lekander, M. (2010). Beauty sleep: experimental study on the perceived health and attractiveness of sleep deprived people. BMJ, 341, c6614.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3001961/',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported 23 adults photographed after a normal night and after sleep deprivation; 65 untrained observers rated sleep-deprived faces lower on health (63 versus 68) and attractiveness (38 versus 40) and higher on tiredness (53 versus 44) on 0–100 scales. The sample is small and the attractiveness difference is small. The author list is from memory.',
    supports: 'Sleep-deprived faces were rated lower on health and attractiveness by small margins, and higher on tiredness',
  },
  {
    id: 'skin:sarkar2016',
    kind: 'peer_reviewed',
    citation:
      'Sarkar, R., et al. (2016). Periorbital hyperpigmentation: a comprehensive review. Journal of Clinical and Aesthetic Dermatology, 9(1), 49–55.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4756872/',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary of the abstract listed genetics, excess pigment, post-inflammatory change after atopic or allergic dermatitis, periorbital oedema, increased vascularity, shadowing from skin laxity and tear trough as causes, and said little scientific data exists on pathogenesis. Only the abstract-level list was seen.',
    supports: 'Under-eye darkness has many causes, mostly inherited or structural',
  },
  {
    id: 'skin:guyuron2009',
    kind: 'peer_reviewed',
    citation:
      'Guyuron, B., et al. (2009). Factors contributing to the facial aging of identical twins. Plastic and Reconstructive Surgery, 123(4), 1321–1331.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://stafforini.com/works/guyuron-2009-factors-contributing-facial/',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported 186 pairs of identical twins; longer smoking and more sun exposure were associated with an older appearance and more wrinkles and patchy discolouration. The study is observational. The URL is a bibliography page, not the journal; volume and pages are from memory.',
    supports: 'Sun exposure and smoking were associated with older, more wrinkled facial appearance in twins (observational)',
  },
  {
    id: 'skin:flament2013',
    kind: 'peer_reviewed',
    citation:
      'Flament, F., Bazin, R., Laquieze, S., Rubert, V., Simonpietri, E., & Piot, B. (2013). Effect of the sun on visible clinical signs of aging in Caucasian skin. Clinical, Cosmetic and Investigational Dermatology, 6, 221–232.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3790843/',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported 298 Caucasian women aged 30–78 split into sun-seekers (157) and sun-avoiders (141). Second-hand coverage said sun-seekers had more wrinkles, especially after 50, and that pigmentation arises mainly from photoageing. The authors are from L’Oréal, a cosmetics company. The results section was not read.',
    supports: 'Sun-seeking women showed more wrinkles and sun-related pigmentation than sun-avoiding women (industry-affiliated, women only)',
  },
  {
    id: 'skin:hwang2008',
    kind: 'peer_reviewed',
    citation:
      'Hwang, S., & Schwartz, R. A. (2008). Keratosis pilaris: a common follicular hyperkeratosis. Cutis, 82(3), 177–180.',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search of a reprint excerpt said keratosis pilaris is a common inherited follicular condition with adolescent prevalence postulated at least 50%. Full text was not opened. No URL is given because none clearly matching the original was surfaced.',
    supports: 'Keratosis pilaris is a common, inherited condition, especially in adolescents',
  },
  {
    id: 'skin:truncalacne',
    kind: 'peer_reviewed',
    citation:
      'Prevalence and Demographics of Truncal Involvement Among Acne Patients: Survey Data and a Review of the Literature. Journal of Clinical and Aesthetic Dermatology (authors and year not confirmed from the search result).',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://jcadonline.com/prevalence-and-demographics-acne-patients/',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'Search results for this article and related reviews and surveys reported truncal involvement in roughly half or more of people with facial acne and a quality-of-life burden that rises with truncal severity. The authors and year of this specific article were not confirmed.',
    supports: 'Back and chest acne is common among people with facial acne and adds to the quality-of-life burden',
  },
  {
    id: 'skin:augustin2019',
    kind: 'clinical_guideline',
    citation:
      'Augustin, M., et al. (2019). Diagnosis and treatment of xerosis cutis – a position paper. Journal der Deutschen Dermatologischen Gesellschaft, 17(Suppl 7), 3–33.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://pubmed.ncbi.nlm.nih.gov/31738016/',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary of the abstract described a symptom-based approach to preventing, diagnosing and treating dry skin (xerosis cutis), with trigger factors to be avoided and comorbidities treated. The search did not retrieve the paper’s text on washing or hot water.',
    supports: 'Dry skin (xerosis cutis) is a recognised condition diagnosed on clinical grounds, with avoidable trigger factors',
  },
  {
    id: 'skin:engebretsen2016',
    kind: 'peer_reviewed',
    citation:
      'Engebretsen, K. A., et al. (2016). The effect of environmental humidity and temperature on skin barrier function and dermatitis. Journal of the European Academy of Dermatology and Venereology.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://pubmed.ncbi.nlm.nih.gov/26449379/',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary reported a 2016 review concluding that low humidity and low temperature decrease skin barrier function and raise susceptibility to mechanical stress. The first-author name is from memory; the volume and pages were not confirmed.',
    supports: 'Cold, dry air lowers skin barrier function',
  },
  {
    id: 'skin:nussbaum2019',
    kind: 'peer_reviewed',
    citation:
      'Nussbaum, D., & Friedman, A. (2019). Pseudofolliculitis barbae: a review of current treatment options. Journal of Drugs in Dermatology.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://jddonline.com/articles/dermatology/S1545961619P0246X',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary said the review describes razor bumps as the result of genetic and environmental factors, where curly hair and shaving habits combine, and that the most effective management combines changes in shaving behaviour with other therapies. Volume and pages were not confirmed.',
    supports: 'Razor bumps arise from curly hair combined with shaving habits, and behaviour change is part of management',
  },
  {
    id: 'skin:aadrazor2022',
    kind: 'convention',
    citation:
      'American Academy of Dermatology (2022). How to prevent razor bumps. News release with advice from a board-certified dermatologist.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://aad.org/news/how-to-prevent-razor-bumps',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search summary of the October 2022 news release reported the advice: stopping shaving removes the cause, shave with the grain, soften the hair first. The release text was cut off in the search result. This is professional-society public advice, not a trial.',
    supports: 'Shaving technique and growing the hair out as practical levers against razor bumps (dermatologist guidance)',
  },
  {
    id: 'skin:bastiaens2004',
    kind: 'peer_reviewed',
    citation:
      'Bastiaens, M., Hoefnagels, J., Westendorp, R., Vermeer, B. J., & Bouwes Bavinck, J. N. (2004). Solar lentigines are strongly related to sun exposure in contrast to ephelides. Pigment Cell Research, 17(3), 225–229.',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'Search confirmed the citation (Pigment Cell Research 2004, volume 17, pages 225–229) and the title wording. The abstract was not retrieved, so the strength of the sun-exposure link is unchecked. No URL is given because none was surfaced for the original.',
    supports: 'Sun spots (solar lentigines) are related to sun exposure, unlike freckles',
  },
  {
    id: 'skin:tsao2015',
    kind: 'peer_reviewed',
    citation:
      'Tsao, H., et al. (2015). Early detection of melanoma: reviewing the ABCDEs. Journal of the American Academy of Dermatology.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://pubmed.ncbi.nlm.nih.gov/25698455/',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'Search confirmed the title; summaries described it as an academy task-force review of the ABCDE criteria and their limitations. The author list and volume are from memory.',
    supports: 'The ABCDE rule is the standard public checklist for noticing suspicious moles, with known limits',
  },
  {
    id: 'skin:delbino2018',
    kind: 'peer_reviewed',
    citation:
      'Del Bino, S., Duval, C., & Bernerd, F. (2018). Clinical and biological characterization of skin pigmentation diversity and its consequences on UV impact. International Journal of Molecular Sciences.',
    // privacy-lint-allow: citation link shown as text, never fetched by the app
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6163216',
    verified: false,
    verificationNote:
      NOT_OPENED +
      'A search described a review by Del Bino, Duval and Bernerd on skin pigmentation diversity and sun response that uses the individual typology angle (ITA) computed from CIELAB values. The exact title is from memory and the PMC link was only seen in the search result.',
    supports: 'ITA° from CIELAB values is a standard research way to describe skin colour from light to dark',
  },
]
