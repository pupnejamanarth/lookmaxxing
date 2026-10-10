/**
 * Catalog schema – the single contract every metric, source, natural method and safety rule
 * must satisfy. Validated by tests/unit/catalog.test.ts. Plain data, no runtime side effects.
 *
 * Design rules baked into the validators (see superRefine below):
 *  - A metric flagged PSEUDOSCIENCE can never carry more than 0.25 weight; WEAK ≤ 1.0; MYTH = 0.
 *  - FIXED / SURGICAL_ONLY / PROFESSIONAL_ONLY metrics have NO action-plan drivers.
 *  - CHANGEABLE metrics must name at least one lever driver.
 *  - Anything that is not STRONG evidence must say so plainly in `evidenceNote`.
 *  - Every referenced source must exist, and `verified: true` requires a URL.
 */
import { z } from 'zod'

// ───────────────────────────── enums ─────────────────────────────

export const CATEGORY_IDS = [
  'face',
  'skin',
  'hair',
  'eyes_smile',
  'body',
  'posture',
  'grooming',
  'presence',
  'habits',
] as const
export const CategoryId = z.enum(CATEGORY_IDS)
export type CategoryId = z.infer<typeof CategoryId>

/** Metric id prefix per category, e.g. face → F01. */
export const CATEGORY_PREFIX: Record<CategoryId, string> = {
  face: 'F',
  skin: 'S',
  hair: 'H',
  eyes_smile: 'E',
  body: 'B',
  posture: 'P',
  grooming: 'G',
  presence: 'V',
  habits: 'X',
}

/** Exact total weight (percent of the overall appearance score, male profile) per category. */
export const CATEGORY_WEIGHT_TOTALS: Record<CategoryId, number> = {
  face: 22,
  skin: 16,
  hair: 14,
  eyes_smile: 8,
  body: 20,
  posture: 6,
  grooming: 9,
  presence: 5,
  habits: 0,
}

export const CHANGEABILITY = [
  'FIXED',
  'CHANGEABLE',
  'SURGICAL_ONLY',
  'PROFESSIONAL_ONLY',
  'FIXED_BUT_VISIBILITY_CHANGEABLE',
] as const
export const Changeability = z.enum(CHANGEABILITY)
export type Changeability = z.infer<typeof Changeability>

export const EVIDENCE = ['STRONG', 'MODERATE', 'WEAK', 'PSEUDOSCIENCE', 'MYTH', 'CONVENTION'] as const
export const Evidence = z.enum(EVIDENCE)
export type Evidence = z.infer<typeof Evidence>

export const METHODS = [
  'AUTO_FRONTAL_PHOTO',
  'AUTO_PROFILE_PHOTO',
  'MANUAL_LANDMARKS',
  'COLOR_CALIBRATED_PHOTO',
  'TAP_COUNT_ON_PHOTO',
  'POSE_MODEL_PHOTO',
  'SEGMENTATION_PHOTO',
  'TAPE_MEASURE',
  'SCALE',
  'SELF_GRADE_REFERENCE',
  'CHECKLIST',
  'COMPUTED_FROM_OTHER_METRICS',
  'AUDIO_ANALYSIS',
  'VIDEO_ANALYSIS',
  'MANUAL_INPUT',
  'HABIT_LOG',
] as const
export const Method = z.enum(METHODS)
export type Method = z.infer<typeof Method>

export const SHOT_TYPES = [
  'frontal_neutral',
  'frontal_smile',
  'three_quarter_left',
  'three_quarter_right',
  'profile_left',
  'profile_right',
  'hairline_front',
  'crown_top',
  'hair_natural',
  'skin_zones',
  'skin_sidelight',
  'eye_closeup',
  'teeth_closeup',
  'body_front',
  'body_side',
  'body_back',
  'outfit',
  'tape_entry',
  'scale_entry',
  'self_report',
  'audio_clip',
  'video_clip',
  'habit_log',
] as const
export const ShotType = z.enum(SHOT_TYPES)
export type ShotType = z.infer<typeof ShotType>

/** Action-plan lever families a changeable metric responds to (mapped to concrete levers in M3). */
export const LEVER_TAGS = [
  'fat_loss',
  'resistance_training',
  'sleep',
  'nutrition_structure',
  'posture_work',
  'grooming',
  'haircut',
  'beard_design',
  'style_fit',
  'photo_technique',
  'sun_habits',
  'skin_habits',
  'oral_hygiene_habits',
  'hair_handling',
  'voice_practice',
  'consistency',
  'whitelist_product',
] as const
export const LeverTag = z.enum(LEVER_TAGS)
export type LeverTag = z.infer<typeof LeverTag>

export const PHASES = ['M1', 'M2', 'M3', 'V2', 'V3'] as const
export const Phase = z.enum(PHASES)
export type Phase = z.infer<typeof Phase>

// ───────────────────────────── sources ─────────────────────────────

export const SOURCE_KINDS = [
  'peer_reviewed',
  'clinical_guideline',
  'textbook',
  'government_or_standards',
  'convention',
  'community_claim',
] as const

export const Source = z.strictObject({
  /** `<category>:<slug>` e.g. `face:pallett2010`. Namespaced by category so files never collide. */
  id: z.string().regex(/^[a-z_]+:[a-z0-9_]+$/),
  kind: z.enum(SOURCE_KINDS),
  /** Authors (year). Title. Journal/publisher. */
  citation: z.string().min(10),
  /** doi.org / pubmed / pmc / publisher page. Required when verified. */
  url: z.string().url().optional(),
  /**
   * TRUE only if the build agent actually opened a record for this source (abstract or full text)
   * during catalog authoring AND it supports the specific claim. Never true from memory alone.
   */
  verified: z.boolean(),
  /** What was checked and what it said – or, if unverified, exactly why it is unverified. */
  verificationNote: z.string().min(10),
  /** The claim in the catalog this source is cited for. */
  supports: z.string().min(5),
})
export type Source = z.infer<typeof Source>

// ───────────────────────────── scoring rules ─────────────────────────────

const Point = z.strictObject({ x: z.number(), y: z.number().min(0).max(100) })

export const ScoringRule = z.discriminatedUnion('kind', [
  /** 100 inside [lo, hi]; outside: 100·exp(−½(d/tau)²), d = distance to nearest edge. */
  z.strictObject({
    kind: z.literal('range'),
    lo: z.number(),
    hi: z.number(),
    tau: z.number().positive(),
    tauRationale: z.string().min(5),
  }),
  /** Piecewise-linear lookup; x strictly ascending; works for lower- or higher-is-better. */
  z.strictObject({
    kind: z.literal('one_sided'),
    points: z.array(Point).min(2),
  }),
  /** Scored against the user's own best/baseline value, with an optional absolute anchor. */
  z.strictObject({
    kind: z.literal('personal_baseline'),
    direction: z.enum(['lower_better', 'higher_better', 'target_range']),
    normAnchor: z.array(Point).optional(),
    note: z.string().min(5),
  }),
  /** Share of checklist items passed; failing any critical item caps the score. */
  z.strictObject({
    kind: z.literal('checklist'),
    criticalItemCap: z.number().min(0).max(100),
    items: z
      .array(z.strictObject({ id: z.string().min(1), label: z.string().min(3), critical: z.boolean() }))
      .min(1),
  }),
  /** Percentile within a stated reference population, mapped to a score. */
  z.strictObject({
    kind: z.literal('percentile'),
    direction: z.enum(['higher_better', 'lower_better']),
    referencePopulation: z.string().min(5),
  }),
  /** Not part of the overall appearance score. */
  z.strictObject({
    kind: z.literal('none'),
    reason: z.enum(['myth', 'process_measure', 'habit', 'deferred', 'context_only']),
  }),
])
export type ScoringRule = z.infer<typeof ScoringRule>

// ───────────────────────────── metric ─────────────────────────────

const Range = z.strictObject({ lo: z.number().nullable(), hi: z.number().nullable() })

export const Metric = z
  .strictObject({
    /** Letter prefix by category + two digits, e.g. F01, S13. Stable – never reuse or renumber. */
    id: z.string().regex(/^[A-Z]\d{2}$/),
    category: CategoryId,
    name: z.string().min(3),

    /** WHAT it measures (one or two plain sentences). */
    measures: z.string().min(15),
    /** HOW it is measured in this app (landmarks, tape, tap-count, self-grade…). */
    howMeasured: z.string().min(15),
    methods: z.array(Method).min(1),

    scale: z.strictObject({
      unit: z.string().min(1),
      min: z.number().nullable(),
      max: z.number().nullable(),
      description: z.string().min(5),
      higherIs: z.enum(['better', 'worse', 'target_range', 'not_applicable']),
    }),

    /** Male-profile ideal. `male` is the numeric target band in `scale.unit` (null ends = open). */
    ideal: z.strictObject({
      summary: z.string().min(10),
      male: Range.nullable(),
      rationale: z.string().min(15),
      /** Honest confidence that this ideal is right for THIS user. */
      confidenceInIdeal: z.enum(['high', 'medium', 'low']),
      populationCaveat: z.string().optional(),
    }),
    scoring: ScoringRule,

    changeability: Changeability,
    /** E.g. "~30% changeable via body fat; bone structure is fixed". */
    changeabilityNote: z.string().optional(),

    /** Percent of the overall male appearance score. Process/habit/myth metrics are 0. */
    weight: z.number().min(0).max(10),
    weightRationale: z.string().min(10),

    evidence: Evidence,
    /** Plain-language honesty line shown in the UI. Mandatory unless evidence is STRONG. */
    evidenceNote: z.string(),
    /** For PSEUDOSCIENCE/MYTH: the community claim, stated plainly. */
    communityClaim: z.string().optional(),
    sourceIds: z.array(z.string()),

    /** Lever families that move this metric (empty for FIXED / SURGICAL / PROFESSIONAL). */
    drivers: z.array(LeverTag),
    captureRequirements: z.array(ShotType).min(1),
    /** Conditions under which the app must REFUSE to score this metric (feeds QC + reasons). */
    refusalConditions: z.array(z.string().min(5)),
    /** If abnormal values should prompt "see a doctor" (never treated in-app). */
    medicalFlag: z.string().optional(),
    phase: Phase,

    /** Habit metrics only: the adherence target (habits carry 0 appearance weight). */
    adherence: z
      .strictObject({
        target: z.string().min(5),
        unit: z.string().min(1),
        targetLo: z.number().nullable(),
        targetHi: z.number().nullable(),
        period: z.enum(['day', 'week']),
      })
      .optional(),
  })
  .superRefine((m, ctx) => {
    const add = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: 'custom', message, path })

    if (!m.id.startsWith(CATEGORY_PREFIX[m.category])) {
      add(`id ${m.id} must start with "${CATEGORY_PREFIX[m.category]}" for category ${m.category}`, ['id'])
    }

    // Evidence ↔ weight caps (the honesty rule).
    if (m.evidence === 'PSEUDOSCIENCE' && m.weight > 0.25) add('PSEUDOSCIENCE weight must be ≤ 0.25', ['weight'])
    if (m.evidence === 'WEAK' && m.weight > 1) add('WEAK weight must be ≤ 1.0', ['weight'])
    if (m.evidence === 'MYTH' && (m.weight !== 0 || m.scoring.kind !== 'none')) {
      add('MYTH metrics must have weight 0 and scoring.kind "none"', ['evidence'])
    }
    if (m.evidence !== 'STRONG' && m.evidenceNote.trim().length < 20) {
      add('non-STRONG evidence needs a plain-language evidenceNote (≥ 20 chars)', ['evidenceNote'])
    }
    if ((m.evidence === 'PSEUDOSCIENCE' || m.evidence === 'MYTH') && !m.communityClaim) {
      add('PSEUDOSCIENCE/MYTH metrics must state the communityClaim', ['communityClaim'])
    }

    // Plan rules: fixed / surgical / professional are tagged, never planned around.
    const planned = m.changeability === 'CHANGEABLE' || m.changeability === 'FIXED_BUT_VISIBILITY_CHANGEABLE'
    if (!planned && m.drivers.length > 0) {
      add(`${m.changeability} metrics must have no drivers (they are excluded from the action plan)`, ['drivers'])
    }
    if (m.changeability === 'CHANGEABLE' && m.drivers.length === 0 && m.category !== 'habits') {
      add('CHANGEABLE metrics must list at least one lever driver', ['drivers'])
    }

    // Weight/scoring consistency.
    if (m.scoring.kind === 'none' && m.weight !== 0) add('scoring.kind "none" requires weight 0', ['weight'])
    if (m.scoring.kind !== 'none' && m.weight === 0) add('a scored metric needs weight > 0', ['weight'])
    if (m.category === 'habits' && (m.weight !== 0 || m.scoring.kind !== 'none')) {
      add('habit metrics carry no appearance weight', ['category'])
    }
    if (m.category === 'habits' && !m.adherence) add('habit metrics need an adherence target', ['adherence'])

    // Scoring-rule sanity.
    if (m.scoring.kind === 'range' && m.scoring.lo > m.scoring.hi) add('range.lo must be ≤ range.hi', ['scoring'])
    if (m.scoring.kind === 'one_sided') {
      const xs = m.scoring.points.map((p) => p.x)
      if (xs.some((x, i) => i > 0 && x <= xs[i - 1]!)) add('one_sided points must have strictly ascending x', ['scoring'])
    }
    if (m.ideal.male && m.ideal.male.lo !== null && m.ideal.male.hi !== null && m.ideal.male.lo > m.ideal.male.hi) {
      add('ideal.male.lo must be ≤ ideal.male.hi', ['ideal'])
    }

    // STRONG/MODERATE evidence must cite something.
    if ((m.evidence === 'STRONG' || m.evidence === 'MODERATE') && m.sourceIds.length === 0) {
      add('STRONG/MODERATE evidence must cite at least one source', ['sourceIds'])
    }
  })
export type Metric = z.infer<typeof Metric>

// ───────────────────────────── natural / homemade methods ─────────────────────────────

export const PRODUCT_CATEGORIES = [
  'cleanser',
  'moisturizer',
  'sunscreen',
  'topical_active',
  'shampoo',
  'conditioner',
  'hair_styling',
  'toothpaste',
  'mouthwash',
  'oral_care_other',
  'deodorant',
  'fragrance',
  'shaving',
  'natural_topical',
  'supplement',
  'medication',
  'other',
] as const
export const ProductCategory = z.enum(PRODUCT_CATEGORIES)
export type ProductCategory = z.infer<typeof ProductCategory>

export const NATURAL_STATUS = [
  'RECOMMENDED',
  'OPTIONAL_LOW_PRIORITY',
  'EXCLUDED_MYTH',
  'EXCLUDED_NO_LASTING_EFFECT',
  'BANNED_HARMFUL',
  'WHITELIST_REQUIRED',
] as const

export const NaturalMethod = z
  .strictObject({
    id: z.string().regex(/^NM\d{2}$/),
    name: z.string().min(3),
    area: z.enum(['sleep', 'nutrition', 'training', 'posture', 'skin', 'hair', 'oral', 'grooming', 'photo', 'sun', 'other']),
    whatItDoes: z.string().min(10),
    targetsMetricIds: z.array(z.string().regex(/^[A-Z]\d{2}$/)),
    evidence: z.enum(['STRONG', 'WEAK', 'MYTH']),
    evidenceNote: z.string().min(15),
    realisticEffect: z.string().min(10),
    timeToResults: z.string().min(3),
    risks: z.string().min(3),
    status: z.enum(NATURAL_STATUS),
    /** True if anything is applied to skin, scalp, teeth or hair. */
    appliedToBody: z.boolean(),
    patchTest: z.strictObject({
      required: z.boolean(),
      instructions: z.string().optional(),
    }),
    /** Food-level use only – capsules, extracts, concentrated or ingested oils are never allowed. */
    foodLevelOnly: z.boolean(),
    requiredProductCategories: z.array(ProductCategory),
    sourceIds: z.array(z.string()),
  })
  .superRefine((m, ctx) => {
    const add = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: 'custom', message, path })
    if (m.appliedToBody && !m.patchTest.required) add('anything applied to body must require a patch test', ['patchTest'])
    if (m.patchTest.required && !m.patchTest.instructions) add('patch test instructions required', ['patchTest'])
    if (m.evidence === 'MYTH' && (m.status === 'RECOMMENDED' || m.status === 'OPTIONAL_LOW_PRIORITY')) {
      add('a MYTH can never be recommended', ['status'])
    }
    if (m.status !== 'WHITELIST_REQUIRED' && m.requiredProductCategories.length > 0) {
      add('only WHITELIST_REQUIRED methods may require product categories', ['requiredProductCategories'])
    }
    if (m.status === 'WHITELIST_REQUIRED' && m.requiredProductCategories.length === 0) {
      add('WHITELIST_REQUIRED needs requiredProductCategories', ['requiredProductCategories'])
    }
    if (m.status === 'RECOMMENDED' && m.evidence !== 'STRONG') {
      add('only STRONG-evidence methods may be RECOMMENDED (WEAK is capped at OPTIONAL_LOW_PRIORITY)', ['status'])
    }
    if (m.status === 'BANNED_HARMFUL' && m.appliedToBody && m.requiredProductCategories.length > 0) {
      add('banned methods carry no product requirements', ['requiredProductCategories'])
    }
  })
export type NaturalMethod = z.infer<typeof NaturalMethod>

// ───────────────────────────── bans & referral flags ─────────────────────────────

export const BannedItem = z.strictObject({
  id: z.string().regex(/^BAN\d{2}$/),
  name: z.string().min(3),
  group: z.enum([
    'injury_risk',
    'extreme_restriction',
    'skin_damage',
    'teeth_damage',
    'eye_risk',
    'diy_procedure',
    'pseudoscience_harm',
    'voice_harm',
    'sun_damage',
  ]),
  why: z.string().min(10),
  /** Lower-case keywords/phrases the output linter must never emit as advice. */
  patterns: z.array(z.string().min(3)).min(1),
  sourceIds: z.array(z.string()),
})
export type BannedItem = z.infer<typeof BannedItem>

export const ReferralFlag = z.strictObject({
  id: z.string().regex(/^REF\d{2}$/),
  trigger: z.string().min(10),
  metricIds: z.array(z.string().regex(/^[A-Z]\d{2}$/)),
  /** Shown to the user. Says "see a doctor"; the app never diagnoses or treats. */
  message: z.string().min(15),
  urgency: z.enum(['routine', 'soon', 'urgent']),
})
export type ReferralFlag = z.infer<typeof ReferralFlag>
