# Catalog seed (v0 draft – to be verified and expanded into `src/catalog/data/*.ts`)

This is the starting draft, **not** the final catalog. Every range and source below came from the
planner's memory and MUST be verified (web search / open the record) before it is marked `verified: true`.
Anything that cannot be verified gets downgraded (evidence → CONVENTION/WEAK, `confidenceInIdeal: 'low'`) or dropped.
Ranges are for the **male** profile. Many face norms come mostly from white North American samples – say so.

Legend – Type: C = CHANGEABLE · F = FIXED · S = SURGICAL_ONLY · P = PROFESSIONAL_ONLY (braces, derm procedures,
whitening) · F→C = FIXED_BUT_VISIBILITY_CHANGEABLE (e.g. jawline visibility via body fat).
Method: AUTO-F/AUTO-P = automatic landmarks on frontal/profile photo (MediaPipe Face Landmarker, 478 pts + iris);
MLM = user places points by hand (profile views, MediaPipe unreliable beyond ~60° yaw); CAL = colour measured
against a grey card; TAPE; SCALE; SELF = self-grade against reference images (never HIGH confidence).
Evidence: STRONG / MOD(erate) / WEAK / ⚠PSEUDO (lookmaxxing-community claim with little or no evidence) / MYTH / CONV(ention).
Weight caps: ⚠PSEUDO ≤ 0.25, WEAK ≤ 1.0, MYTH = 0. `Wt` = % of overall male score. Category totals are fixed.

Category weight totals (male): face 22 · skin 16 · hair 14 · eyes_smile 8 · body 20 · posture 6 · grooming 9 · presence 5 · habits 0 = 100.

## A. Face structure (total 22)

| ID | Metric (what it measures) | Method | Scale | Ideal (male) · source | Type | Wt | Evidence |
|---|---|---|---|---|---|---|---|
| F01 | Facial adiposity: fat in cheeks, jaw and neck (cheek-to-jaw width ratio, face perimeter ÷ area) | AUTO-F | composite 0–100, tracked against own lean baseline | Lower until the face looks gaunt; target = value at target body fat · Coetzee 2009 | C | 5 | STRONG |
| F02 | Cervicomental angle (neck–under-jaw) | MLM profile | ° | 105–120° · Ellenbogen & Karlin 1980 | C (fat, posture) | 2.5 | MOD |
| F03 | Jaw angle (gonial angle) and jawline definition, soft tissue only | MLM profile + AUTO-F jaw edge | °; 0–3 | ~120–130°. "Lower is always better" is ⚠PSEUDO | F→C | 2 | MOD / ⚠ |
| F04 | Chin projection: chin tip vs vertical reference | MLM profile | mm (scaled by iris size) | 0 to +2 mm · Gonzalez-Ulloa | S | 1.5 | MOD |
| F05 | Symmetry: left/right landmark mismatch ÷ pupil distance | AUTO-F (yaw/roll ≤2–3°) | % of pupil distance | Lower is better; under ~2–3% not noticeable · Rhodes 2006 | F | 1.5 | MOD (small effect) |
| F06 | Facial thirds: hairline–brow : brow–nose base : nose base–chin | AUTO-F (hair pulled back) | ratio | ≈1:1:1 classical canon; Farkas 1985 found most faces deviate | F (top third reframed by haircut) | 0.75 | WEAK |
| F07 | Facial fifths: eye width vs inter-eye gap vs face width | AUTO-F | ratio | each ≈ 1/5 · canon | F | 0.25 | WEAK |
| F08 | Eye spacing: pupil distance ÷ face width | AUTO-F | % | ~46% · Pallett 2010 | F | 1 | MOD |
| F09 | Eye-to-mouth height: pupils-to-mouth ÷ hairline-to-chin | AUTO-F | % | ~36% · Pallett 2010 | F | 0.5 | MOD |
| F10 | FWHR: cheekbone width ÷ brow-to-upper-lip height | AUTO-F (pitch ≤2°) | ratio | No proven attractiveness ideal. "1.9+" is ⚠PSEUDO. Predicts perceived dominance, not attractiveness · Geniole 2015 | F | 0.25 | ⚠PSEUDO |
| F11 | Midface ratio: pupil distance ÷ pupil-to-upper-lip height | AUTO-F | ratio | The community "~1.0 ideal" has no peer-reviewed basis | F | 0.25 | ⚠PSEUDO |
| F12 | Canthal tilt: inner→outer eye-corner angle | AUTO-F | ° | Slightly positive ~+3° to +8° (verify). "Hunter eyes" hype is ⚠ | F/S | 1 | WEAK–MOD |
| F13 | Upper-eyelid show / hooding | AUTO-F + SELF | mm / 0–3 | Males: less lid show · weak data | F/S (puffiness C) | 1 | WEAK |
| F14 | Nose: nostril width ÷ inter-eye gap; nasolabial angle; nasofrontal angle | AUTO-F + MLM | ratio, ° | Width ≈ inter-eye gap; nasolabial 90–95°; nasofrontal 115–135° · rhinoplasty norms | S | 1.25 | MOD |
| F15 | Lips: upper : lower height; fullness | AUTO-F | ratio | ~1:1.6–1:2 · Popenko 2017 (studied female faces) | S/P | 1 | MOD (F) / WEAK (M) |
| F16 | Lower-third split: nose base–mouth : mouth–chin | AUTO-F | ratio | ≈1:2 · canon | F/S | 0.5 | WEAK–MOD |
| F17 | Cheekbone prominence: cheekbone width ÷ jaw width | AUTO-F | ratio | Scored vs a norm table; no validated "ideal" · Cunningham 1986 | F→C | 0.75 | MOD |
| F18 | Profile convexity: brow–nose base–chin angle | MLM profile | ° | ~165–175° · jaw-surgery norms | F/S | 0.5 | MOD |
| F19 | Lips closed at rest without chin strain | SELF + photo | 0–2 | Closed and relaxed | C (habit) | 0.25 | WEAK |
| F20 | Ear protrusion | AUTO/SELF | 0–2 | — | S (hair can cover) | 0.25 | WEAK |
| ✗ | Golden ratio / Marquardt "phi mask" | — | — | **MYTH, excluded** · Holland 2008 | — | 0 | MYTH |
| ✗ | Averageness (distance from average face) | — | — | Real evidence (Langlois 1990) but needs a population face model → deferred (V3) | F | 0 | STRONG |

(The weights above sum to 22 without the two ✗ rows. If you add metrics, take weight from existing rows so the total stays 22.)

## B. Skin (total 16)

| ID | Metric | Method | Scale | Ideal · source | Type | Wt | Evidence |
|---|---|---|---|---|---|---|---|
| S01 | Active acne: lesion count by type and zone; IGA severity | user taps lesions on zone close-ups, redness detection assists | count, IGA 0–4 | IGA 0–1; ≤5 inflamed | C | 4 | STRONG |
| S02 | Acne scarring grade | SELF + side-lit photo | 0–4 | 0 | P (procedures) | 1.5 | STRONG (impact) |
| S03 | Post-acne marks (brown/red): count and contrast | CAL + tap | count, ΔE | 0 / ΔE < ~3 | C (time, sun habits) | 1.5 | MOD |
| S04 | Tone evenness: colour variation across cheeks and forehead | CAL | ΔE spread | Lower is better · Fink 2006, Matts 2007 | C (partly) | 2.5 | STRONG |
| S05 | Healthy yellowness (carotenoids) | CAL | b* | Higher within natural range · Whitehead 2012 | C (diet) | 1 | MOD |
| S06 | Persistent redness (cheeks, nose) | CAL | a* | Lower is better; persistently high → doctor (rosacea) | C (partly) | 1 | MOD |
| S07 | Texture / roughness | CAL patch | index | Lower is better | C (partly) | 1 | WEAK (very lighting-sensitive) |
| S08 | Visible pores | CAL patch | index | Lower is better | F mostly | 0.5 | WEAK |
| S09 | Under-eye darkness vs cheek | CAL | lightness difference | Smaller is better · Sundelin 2013 | C (sleep) / F (anatomy) | 1.5 | MOD |
| S10 | Oiliness / shine at fixed time after washing | CV + blot test | %, 0–3 | Low to moderate | C (partly) | 0.5 | WEAK |
| S11 | Lines and wrinkles | CV + SELF | 0–4 | Minimum for age | prevent C / reverse P | 0.5 | STRONG (prevention) · Guyuron 2009 |
| S12 | Lip condition (chapping) | SELF | 0–3 | 0 | C | 0.25 | — |
| S13 | Body skin: back/chest acne, keratosis pilaris | SELF | 0–3 | 0 | C (partly) | 0.25 | MOD |

## C. Hair (total 14)

| ID | Metric | Method | Scale | Ideal · source | Type | Wt | Evidence |
|---|---|---|---|---|---|---|---|
| H01 | Hairline: Norwood stage, temple recession, forehead height | SELF vs references + AUTO (hair edge vs brow line) | stage, % | Norwood 1–2 (stage 2 is a normal adult hairline) · Muscarella 1996 | F/progressive; S (transplant); haircut can work around | 3 | STRONG |
| H02 | Scalp density: scalp show at crown and parting | CV segmentation | % scalp | Stable or better than baseline | F/progressive (breakage/traction C) | 2 | MOD (lighting-sensitive) |
| H03 | Hair condition: breakage, frizz, shine | SELF + close-up | 0–3 | 0–1 | C | 1 | MOD |
| H04 | Haircut suitability for face shape, hairline and density | rule checklist + SELF (V3: trusted raters) | 0–100 | Rules pass | C | 4 | MOD that hair matters; face-shape rules are stylist convention (WEAK) |
| H05 | Facial hair density / coverage | CV + SELF | %, patchiness 0–3 | Style adapts to it · Dixson & Brooks 2013 | F | 1 | MOD |
| H06 | Facial hair style and lines (neckline, cheek line, fits density) | SELF checklist | 0–100 | Rules pass | C | 1.5 | MOD |
| H07 | Brow grooming: strays, unibrow, symmetry | AUTO + SELF | 0–100 | Clean and symmetric | C | 1 | MOD |
| H08 | Brow density | AUTO + SELF | 0–3 | Fuller generally preferred | F | 0.5 | WEAK–MOD |

## D. Eyes and smile (total 8)

| ID | Metric | Method | Scale | Ideal · source | Type | Wt | Evidence |
|---|---|---|---|---|---|---|---|
| E01 | Sclera (eye whites): redness, yellowness | CAL eye close-up | colour values | Whiter is better · Russell 2014. Persistent yellow → doctor | C (sleep, eye strain) | 1.5 | MOD |
| E02 | Limbal ring | CV | 0–3 | Darker, clearer preferred · Peshek 2011 | F | 0.5 | MOD (small studies) |
| E03 | Under-eye hollows (tear troughs) | SELF + side-lit photo | 0–3 | 0–1 | F/P (fat loss can deepen) | 1 | MOD |
| E04 | Teeth alignment: crowding, midline offset | SELF + smile photo | 0–3 | 0 · Kokich 1999 | P (braces) | 1.5 | STRONG |
| E05 | Teeth colour | CAL smile close-up | change vs baseline | Brighter, less yellow | C (staining habits) / P (whitening) | 1.5 | MOD |
| E06 | Gum show at full smile | AUTO/MLM | mm | 0–2 mm (≤3 fine) · Kokich 1999 | F/S | 0.5 | MOD |
| E07 | Smile symmetry and width | AUTO | % of pupil distance | Small asymmetry | F mostly | 1 | WEAK–MOD |
| E08 | Genuine (Duchenne) smile in photos | AUTO expression | 0–1 | Eye crinkle present | C (practice) | 0.5 | MOD |

## E. Body (total 20)

| ID | Metric | Method | Scale | Ideal · source | Type | Wt | Evidence |
|---|---|---|---|---|---|---|---|
| B01 | Height | measured once, morning | cm; percentile vs chosen reference population | above average preferred (male) | **F** | 3 | STRONG |
| B02 | Body fat % | TAPE (US Navy) | % (±3–4%) | 10–15 aesthetic and sustainable · Hodgdon & Beckett 1984 | C | 5.5 | STRONG |
| B03 | V-taper: shoulder ÷ waist circumference | TAPE + pose check | ratio | higher is better, levelling ~1.6; the precise "1.618 Adonis index" is ⚠PSEUDO · Maisey 1999 | C | 4.5 | STRONG |
| B04 | Waist-to-height | TAPE | ratio | <0.50 for health · Ashwell; ~0.43–0.46 aesthetic target is a rule of thumb | C | 2 | STRONG (health) |
| B05 | Fat-free mass index (lean mass ÷ height²) | computed | kg/m² | 20–23 (natural ceiling ~25, Kouri 1995). Moderate beats extreme · Frederick & Haselton 2007 | C | 3.5 | MOD–STRONG |
| B06 | Weight trend (7-day avg, rate of change) | SCALE | %/week | lose ≤1%/wk; gain ≤0.5%/wk | C | **0** (process measure; drives safety caps) | — |
| B07 | Leg-to-body ratio | pose + TAPE | ratio | slightly above average · Sorokowski 2008 | F | 0.5 | MOD |
| B08 | Neck girth | TAPE | cm vs head width | "neck = arm = calf" is MYTH | C | 0.5 | WEAK |
| B09 | Chest fat appearance | SELF + side photo | 0–3 | 0 | C if fat / S if gland tissue | 0.5 | MOD |

## F. Posture (total 6)

| ID | Metric | Method | Scale | Ideal · source | Type | Wt | Evidence |
|---|---|---|---|---|---|---|---|
| P01 | Forward head: craniovertebral angle | MLM side photo (pose model pre-fills) | ° | ≥ ~50°; below ~48–50° counts as forward head (cut-offs vary) · Yip 2008 | C | 2.5 | MOD |
| P02 | Rounded shoulders: shoulder ahead of ear plumb line | MLM + pose | cm | roughly aligned | C | 1.5 | MOD (photo measurement WEAK) |
| P03 | Upper-back rounding (photo estimate) | MLM | 0–3 | normal curve | C | 0.5 | WEAK |
| P04 | Pelvic tilt (photo estimate) | MLM | ° | **mild forward tilt (~4–13°) is normal**; the "anterior pelvic tilt fix" hype is ⚠PSEUDO | C | 0.5 | WEAK |
| P05 | Uneven shoulder/hip height | AUTO pose | ° | < ~2°; large → doctor (scoliosis check) | C/F | 0.5 | MOD |
| P06 | Open stance in photos | AUTO pose | 0–100 | open and expansive · Vacharkulksemsuk 2016 | C | 0.5 | MOD |

## G. Grooming and style (total 9)

| ID | Metric | Method | Ideal | Type | Wt | Evidence |
|---|---|---|---|---|---|---|
| G01 | Haircut maintenance: days since cut vs cut's interval | SELF | within interval | C | 1 | CONV |
| G02 | Face/neck detail: strays, neckline, nose/ear hair | SELF checklist + photo | 100% pass | C | 1 | MOD |
| G03 | Nails | SELF checklist | 100% pass | C | 0.5 | MOD |
| G04 | Clothing fit per core item (shoulder seam, sleeve, chest, waist, trouser break) | checklist + body photo | ≥90% of worn items fit | C | 2.5 | MOD |
| G05 | Colour contrast: outfit contrast vs skin-hair-eye contrast | CAL + SELF | matched | C | 1 | WEAK. Seasonal colour analysis is ⚠PSEUDO; "red is attractive" failed replication |
| G06 | Wardrobe coverage: fitting core items per occasion | SELF inventory | full | C | 1 | CONV |
| G07 | Hygiene: breath and body-odour habits | SELF | 0 issues · Havlíček | C | 1 | STRONG |
| G08 | Shoes condition | SELF | clean | C | 0.5 | WEAK |
| G09 | Glasses frame fit (if worn) | checklist | rules pass | C | 0.25 | CONV |
| G10 | Body-hair grooming | SELF | user preference | C | 0.25 | WEAK |

## H. Presence (total 5; implemented in V3)

| ID | Metric | Method | Ideal · source | Type | Wt | Evidence |
|---|---|---|---|---|---|---|
| V01 | Voice pitch (median) | AUDIO | lower within natural range · Puts 2006 | **F** (forcing it lower is banned) | 0.5 | MOD |
| V02 | Pitch variation (monotone vs expressive) | AUDIO | moderate variation | C | 0.75 | MOD |
| V03 | Speaking rate and filler words | AUDIO + local speech-to-text | ~140–160 wpm; <2 fillers/min (convention) | C | 0.75 | MOD |
| V04 | Volume steadiness | AUDIO | steady | C | 0.25 | WEAK (mic-dependent) |
| V05 | Eye contact: % of time looking at lens in a practice video | webcam gaze + SELF | ~60–70% (convention) | C | 1 | MOD |
| V06 | Photo technique on any imported photo | AUTO quality checks | passes distance, light, angle rules · Ward 2018 | C | 1 | STRONG (optics) |
| V07 | Best side / best angle use | scans + V3 trusted-rater ratings | — · Nicholls 1999 | C | 0.75 | WEAK–MOD |

## I. Habits (weight 0; scored separately as an Adherence Index)

Habits are causes, not appearance – putting them in the score would double count.

| ID | Habit | Measure | Target | Evidence | Drives |
|---|---|---|---|---|---|
| X01 | Sleep duration | hours | 7–9 h | STRONG (Axelsson 2010; Sundelin 2013) | under-eyes, skin, sclera |
| X02 | Sleep regularity | bedtime spread | ≤30–45 min | MOD | same |
| X03 | Resistance training | sessions/week + load progression | 3–5, load progressing | STRONG | FFMI, V-taper, posture |
| X04 | Protein (from food) | g per kg per day | 1.6–2.2 | STRONG (Morton 2018) | FFMI |
| X05 | Calorie balance | kcal vs target, rate of loss | deficit ≤25%; lose 0.5–1% body weight/week | STRONG | body fat, facial fat |
| X06 | Fruit and vegetables | portions/day | ≥5 | MOD (Whitehead 2012) | skin colour |
| X07 | Hydration | urine colour 1–8 | 1–3 | WEAK for looks; "8 glasses" is MYTH | general |
| X08 | Sun habits (shade, hat, avoid peak UV) | unprotected minutes when UV ≥3 | minimise | STRONG | tone, lines, marks |
| X09 | Alcohol and evening salt | units/week | low; none the night before a scan | MOD | puffiness, redness, sleep |
| X10 | Smoking / vaping | yes/no | none | STRONG (Guyuron 2009) | skin, teeth |
| X11 | Daily steps | steps/day | ~7–10k | MOD | fat loss |
| X12 | Posture routine | sessions/week | 3+ | MOD | P01–P02 |
| X13 | Not picking at skin | slips/day | 0 | MOD | marks, scars |
| X14 | Whitelist-only skincare/hygiene routine | done AM/PM | ≥90% | depends on products | skin |
| X15 | Following the capture protocol | % of scans on-protocol | 100% | — | data quality |

## J. Natural / homemade methods (evidence-graded)

| Method | Targets | Evidence | Realistic effect · time | Risks | Status |
|---|---|---|---|---|---|
| Sleep 7–9 h with a fixed wake time | under-eyes, skin, sclera | STRONG | visibly less tired · days–2 weeks | none | IN |
| Moderate deficit + high protein from food | body fat, facial fat, jaw/neck | STRONG | lose 0.5–1%/week; face changes after ~3–5 kg · 6–20 weeks | too fast → muscle loss, hair shedding (caps enforced) | IN |
| Progressive resistance training (shoulders/back focus; neck work light only) | V-taper, FFMI, posture | STRONG | beginners ~0.5–1 kg lean mass/month in year 1 (rule of thumb) | poor form → learn technique first | IN |
| ≥5 portions fruit and veg daily | skin colour | MOD | small but noticeable · ~6 weeks | none | IN |
| Low-glycaemic-load diet | acne | MOD (Smith 2007) | modest lesion reduction · 8–12 weeks | none | IN if acne |
| Sun habits (shade, hat, avoid peak UV) | tone, marks, lines | STRONG | stops things getting worse; marks fade faster · months | none. With no sunscreen whitelisted this is the only UV lever | IN |
| Hands-off rule (no picking) | scars, marks | MOD | fewer new marks · weeks | none | IN |
| Lukewarm water, wash ≤2×/day, pat dry | redness, irritation | MOD | less irritation · 1–2 weeks | none | IN |
| Posture programme (chin tucks, deep neck flexor work, rows/face pulls, thoracic extension, wall slides) | forward head, shoulders | MOD | a few degrees · 6–12 weeks | stop if painful | IN |
| Shaving technique (warm-water prep, sharp blade, with the grain, fewer passes) | razor bumps | MOD | fewer bumps · 1–3 weeks | cuts | IN |
| Tongue scraping + brushing/flossing technique | breath | MOD | less bad breath · days | gum injury if aggressive | IN (product parts need whitelist) |
| Stain habits (straw, water rinse after coffee/tea; don't brush right after acidic food) | teeth colour | MOD | slows new staining; does NOT whiten | none | IN |
| Gentle hair handling (no tight styles, low heat, microfibre towel) | breakage, traction loss | MOD–STRONG | less breakage · 4–12 weeks | none | IN |
| Photo technique | photo score | STRONG | large change in photos · immediately | none | IN |
| Scalp massage (gentle, 4 min/day) | density | WEAK (n = 9) | possibly slightly thicker hair; will NOT stop genetic hair loss · 6 months | low | OPTIONAL, ranked low |
| Facial exercises | cheek fullness | WEAK (Alam 2018, 16 people finished) | small · 20 weeks | no jaw clenching | OPTIONAL, ranked low |
| Coconut oil on hair lengths before washing | breakage, frizz | WEAK–MOD (lab study) | less breakage; **zero growth** | clogs pores: keep off face/hairline; patch test | OPTIONAL |
| Cold water splash | puffiness | WEAK | lasts under an hour | — | photo days only |

**Excluded (myth, or no lasting effect):** mewing for adult jaw change (no adult evidence); hard/mastic gum chewing
(no evidence + jaw-joint risk); "steam opens pores / cold closes them"; cold showers for appearance; honey masks for acne
(Semprini 2016 showed no benefit); onion juice for genetic hair loss (myth + irritant); rosemary oil (one weak trial,
concentrated extract → whitelist-only); rice water / egg / beer / mayo hair masks; turmeric paste (stains, reactions);
gua sha or massage for face fat (fat isn't moved by massage); spot reduction; "8 glasses for clear skin".

**Banned (causes damage):** on skin – lemon/lime juice, apple cider vinegar, baking soda, toothpaste on spots, undiluted
essential oils, garlic or cinnamon, sugar/salt face scrubs. Teeth – charcoal, strawberry, acid or DIY peroxide whitening.
Anything in or near the eyes – cucumber, tea bags, potato, ice. DIY procedures – dermarolling, peels, extraction tools.
Tanning and sunbeds. Plus the hard bans: bone smashing, thumb-pulling, jaw-exerciser devices, mewing presented as a jaw
fix, crash diets (losing >1% body weight/week, deficit >25%, eating below basal metabolic rate), water/dehydration cuts and
sauna-suit cuts, forcing the voice lower, anything with real injury risk.

**Patch test (required for anything on skin or scalp):** pea-sized amount on inner forearm (scalp products: behind the
ear), twice a day for 7 days; any redness/itching/swelling/burning → stop and log as permanently excluded; if clear, 3 days on
a small patch of the jaw before whole face; never on broken skin. Food-level only: no capsules, extracts or concentrated oils.

**Medical-referral flags (app says "see a doctor", never treats):** severe or nodular acne; sudden hair shedding;
yellow eye whites; persistent facial redness; visibly uneven spine / large shoulder-hip asymmetry; rapid unexplained
weight change; persistently high redness (possible rosacea); sudden new lumps/skin changes.
