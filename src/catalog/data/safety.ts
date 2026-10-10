import type { BannedItem, NaturalMethod, ReferralFlag, Source } from '../schema'

const NOT_OPENED =
  'Not verified: in this fix pass the publisher/PubMed/DOI hosts could not be resolved from the sandbox and the web-search budget was spent, so no record was opened by the editor. Existence and bibliographic details were cross-checked by a reviewer search only where stated below; the supported claim was not read in the source.'
const SEEN_IN_SEARCH =
  'Reviewer search results confirmed this record exists and matches the supports text, but the editor could not open the abstract or full text, so it stays unverified until opened.'

const PATCH =
  'Pea-sized amount on the inner forearm (scalp products: behind the ear), twice a day for 7 days. Any redness, itching, swelling or burning: stop, never use it again, and log it as permanently excluded. If clear, use 3 days on a small patch of the jaw before the whole face. Never on broken skin.'

type NMInput = Omit<NaturalMethod, 'appliedToBody' | 'patchTest' | 'foodLevelOnly' | 'requiredProductCategories' | 'sourceIds'> &
  Partial<Pick<NaturalMethod, 'appliedToBody' | 'foodLevelOnly' | 'requiredProductCategories' | 'sourceIds'>>

const nm = (m: NMInput): NaturalMethod => {
  const applied = m.appliedToBody ?? false
  return {
    ...m,
    appliedToBody: applied,
    patchTest: applied ? { required: true, instructions: PATCH } : { required: false },
    foodLevelOnly: m.foodLevelOnly ?? false,
    requiredProductCategories: m.requiredProductCategories ?? [],
    sourceIds: m.sourceIds ?? [],
  }
}

export const naturalMethods: NaturalMethod[] = [
  // ---------------- IN: strong evidence ----------------
  nm({
    id: 'NM01', name: 'Sleep 7-9 hours with a fixed wake time', area: 'sleep',
    whatItDoes: 'Regular, sufficient sleep. In small experiments, faces photographed after acute sleep loss were rated as more tired and less healthy and attractive.',
    targetsMetricIds: ['S09', 'E01', 'S04', 'X01', 'X02'], evidence: 'WEAK',
    evidenceNote: 'The looks evidence is limited. Sundelin 2013 had 40 observers rate photos of 10 people after 31 hours awake; Axelsson 2010 photographed a small group after one night of about 5 hours of sleep (exact sample sizes not confirmed). These tested acute deprivation, not a habit of 7-9 hours with a fixed wake time. A replication (Holding et al., St Andrews, 181 participants, as reported by a reviewer, not opened) found objective facial measures did not differ between sleep-deprived and rested groups, although some cues predicted tiredness ratings. Sleep is worth protecting on general health grounds, which this app does not cite a source for; the looks effect is rated WEAK. Unverified.',
    realisticEffect: 'Less tired-looking eyes and skin after a run of good nights. It does not change bone structure or permanent dark circles caused by anatomy.',
    timeToResults: 'Days to 2 weeks', risks: 'None at normal sleep durations. Persistent insomnia or loud snoring with daytime sleepiness: see a doctor.',
    status: 'OPTIONAL_LOW_PRIORITY', sourceIds: ['safety:axelsson2010', 'safety:sundelin2013', 'safety:holding_replication'],
  }),
  nm({
    id: 'NM02', name: 'Moderate calorie deficit with high protein from food', area: 'nutrition',
    whatItDoes: 'Eating about 10-25% below maintenance with 1.6-2.2 g protein per kg body weight per day from ordinary food, losing 0.5-1% of body weight per week.',
    targetsMetricIds: ['F01', 'F02', 'B02', 'B04', 'B06', 'X04', 'X05'], evidence: 'STRONG',
    evidenceNote: 'Fat loss from a sustained calorie deficit is basic energy balance; no single source was opened for it here. Morton 2018 supports only the 1.6 g/kg plateau and about 2.2 g/kg upper bound, and it studied protein supplementation in resistance-training trials, mostly not in a calorie deficit. Muscle preservation during a deficit is supported by the Helms 2014 review (not opened). Where fat leaves the face is partly genetic. Unverified.',
    realisticEffect: 'Leaner waist; the face and neck often look slimmer after several kg lost (the 3-5 kg figure is a rule of thumb, not a finding). You cannot choose to lose face fat only.',
    timeToResults: '6-20 weeks', risks: 'Going faster than 1% of body weight per week risks muscle loss and hair shedding; the app caps the deficit. Not for people with a history of eating disorders: see a doctor.',
    status: 'RECOMMENDED', foodLevelOnly: true, sourceIds: ['safety:morton2018', 'safety:helms2014', 'safety:convention_rate'],
  }),
  nm({
    id: 'NM03', name: 'Progressive resistance training (shoulders and back focus)', area: 'training',
    whatItDoes: 'Lifting with gradually increasing load, 3-5 sessions a week, emphasising shoulders and upper back. Neck work light only.',
    targetsMetricIds: ['B03', 'B05', 'P02', 'P03', 'X03'], evidence: 'STRONG',
    evidenceNote: 'Resistance training building muscle in untrained people is mainstream sports-science consensus (see the ACSM progression-model review, not opened here). The "0.5-1 kg lean mass per month in year one" figure is a rule of thumb, not a precise promise. Unverified.',
    realisticEffect: 'Wider-looking shoulders relative to waist, better posture muscles. Gains slow sharply after year one. Bone width cannot change.',
    timeToResults: '8-12 weeks for visible change', risks: 'Injury from poor form or ego lifting. Learn technique first; stop if a joint hurts.',
    status: 'RECOMMENDED', sourceIds: ['safety:ratamess2009', 'safety:convention_lean_gain'],
  }),
  nm({
    id: 'NM04', name: 'Sun habits: shade, hat, avoid peak UV', area: 'sun',
    whatItDoes: 'Limiting unprotected midday sun exposure with shade, hats and clothing. UV is the main driver of premature wrinkles, uneven tone and dark marks.',
    targetsMetricIds: ['S03', 'S04', 'S11', 'X08'], evidence: 'STRONG',
    evidenceNote: 'The cited study (Flament 2013) is cross-sectional: 298 Caucasian women aged 30-78 (157 sun-seeking, 141 sun-phobic), with industry-affiliated authors. It cannot be generalised to men or darker skin without caution, and it shows association, not a trial of avoidance. UV as the main cause of photoageing is also supported by IARC (not opened). Avoidance stops damage accumulating; it does not erase existing damage. Unverified.',
    realisticEffect: 'Existing marks fade faster and new ones stop forming. Lines already formed do not disappear.',
    timeToResults: 'Months; the benefit is mostly prevention', risks: 'None. With no sunscreen on the whitelist, this is the only UV lever the app gives.',
    status: 'RECOMMENDED', sourceIds: ['safety:flament2013', 'safety:iarc_uv'],
  }),
  nm({
    id: 'NM05', name: 'Photo technique (light, distance, angle, relaxed face)', area: 'photo',
    whatItDoes: 'Soft window light from the front, camera at eye level and 1.5 m or more away, neutral head pose, relaxed expression, clean lens.',
    targetsMetricIds: ['V06', 'V07', 'E08'], evidence: 'STRONG',
    evidenceNote: 'Close-range phone lenses measurably distort the nose and face; people also differ in how attractive they look across photos of themselves. This changes photos, not your face.',
    realisticEffect: 'Large change in how you look in photos, immediately. No change in real-life appearance.',
    timeToResults: 'Immediately', risks: 'None.', status: 'RECOMMENDED', sourceIds: ['safety:convention_photo'],
  }),
  // ---------------- IN, but evidence only WEAK/limited -> OPTIONAL ----------------
  nm({
    id: 'NM06', name: 'At least 5 portions of fruit and vegetables daily', area: 'nutrition',
    whatItDoes: 'Eating more carotenoid-rich fruit and vegetables, which slightly raises the yellow-orange component of skin colour.',
    targetsMetricIds: ['S05', 'X06'], evidence: 'WEAK',
    evidenceNote: 'A 35-person, mostly Caucasian study (Whitehead 2012) found skin yellowness and redness tracked fruit and vegetable intake over 6 weeks; a rater experiment suggested about 3 extra portions a day looked healthier. Not tested in darker skin. It shows a change, not that 5 portions is the right number. Unverified.',
    realisticEffect: 'Small but noticeable colour change in the study. Good for general health regardless.',
    timeToResults: 'About 6 weeks', risks: 'None at food level.', status: 'OPTIONAL_LOW_PRIORITY', foodLevelOnly: true, sourceIds: ['safety:whitehead2012'],
  }),
  nm({
    id: 'NM07', name: 'Low-glycaemic-load diet if you have acne', area: 'nutrition',
    whatItDoes: 'Choosing slowly digested carbohydrates (whole grains, legumes, vegetables) over sugary and refined foods.',
    targetsMetricIds: ['S01'], evidence: 'WEAK',
    evidenceNote: 'One small 12-week trial in young men (Smith 2007) found fewer lesions; later reviews call the evidence limited. It will not replace medical treatment for moderate or severe acne. Unverified in this catalog build.',
    realisticEffect: 'Modest lesion reduction for some people.', timeToResults: '8-12 weeks', risks: 'None at food level.',
    status: 'OPTIONAL_LOW_PRIORITY', foodLevelOnly: true, sourceIds: ['safety:smith2007'],
  }),
  nm({
    id: 'NM08', name: 'Hands-off rule: no picking or squeezing skin', area: 'skin',
    whatItDoes: 'Not picking spots, scabs or marks. Picking causes inflammation, dark marks and scars.',
    targetsMetricIds: ['S02', 'S03', 'X13'], evidence: 'WEAK',
    evidenceNote: 'Widely taught in dermatology as sound practice, but we did not find controlled trials to cite. Mechanism is plausible, direct evidence is thin.',
    realisticEffect: 'Fewer new marks and scars.', timeToResults: 'Weeks', risks: 'None.',
    status: 'OPTIONAL_LOW_PRIORITY', sourceIds: ['safety:convention_derm'],
  }),
  nm({
    id: 'NM09', name: 'Lukewarm water, wash twice a day at most, pat dry', area: 'skin',
    whatItDoes: 'Avoiding hot water and over-washing, which strip the skin barrier and worsen irritation.',
    targetsMetricIds: ['S06', 'S10'], evidence: 'WEAK',
    evidenceNote: 'Standard dermatology advice for irritated skin; based on mechanism and guidelines more than head-to-head trials.',
    realisticEffect: 'Less irritation and redness.', timeToResults: '1-2 weeks', risks: 'None.',
    status: 'OPTIONAL_LOW_PRIORITY', sourceIds: ['safety:convention_derm'],
  }),
  nm({
    id: 'NM10', name: 'Posture programme (chin tucks, rows, face pulls, thoracic extension, wall slides)', area: 'posture',
    whatItDoes: 'Strengthening upper-back and deep neck muscles and mobilising the upper spine.',
    targetsMetricIds: ['P01', 'P02', 'P03', 'X12'], evidence: 'WEAK',
    evidenceNote: 'We did not open any trial for this. Physiotherapy practice (a convention, not a trial) holds that exercise can shift head and shoulder position by a few degrees, and the link from posture to attractiveness is unproven.',
    realisticEffect: 'A few degrees of improvement.', timeToResults: '6-12 weeks', risks: 'Stop if painful. Pain, numbness or tingling: see a doctor.',
    status: 'OPTIONAL_LOW_PRIORITY', sourceIds: ['safety:convention_posture'],
  }),
  nm({
    id: 'NM11', name: 'Shaving technique (warm-water prep, sharp blade, with the grain, few passes)', area: 'grooming',
    whatItDoes: 'Reducing razor bumps and cuts by softening hair first, shaving in the direction of growth and using fewer passes.',
    targetsMetricIds: ['G02', 'H05'], evidence: 'WEAK',
    evidenceNote: 'Recommended in dermatology guidance for ingrown-hair bumps; trials are few.',
    realisticEffect: 'Fewer bumps and nicks.', timeToResults: '1-3 weeks', risks: 'Cuts. Persistent painful bumps or scarring: see a doctor.',
    status: 'OPTIONAL_LOW_PRIORITY', appliedToBody: true, sourceIds: ['safety:convention_derm'],
  }),
  nm({
    id: 'NM12', name: 'Tongue scraping plus brushing and flossing technique', area: 'oral',
    whatItDoes: 'Cleaning the tongue surface and brushing and flossing thoroughly to reduce odour-causing bacteria.',
    targetsMetricIds: ['G07'], evidence: 'WEAK',
    evidenceNote: 'Reviews find tongue cleaning gives a small reduction in bad-breath compounds. Effects are modest.',
    realisticEffect: 'Less bad breath for some people.', timeToResults: 'Days', risks: 'Gum or tongue injury if aggressive.',
    status: 'OPTIONAL_LOW_PRIORITY', appliedToBody: true, sourceIds: ['safety:convention_oral'],
  }),
  nm({
    id: 'NM13', name: 'Stain habits: drink coffee and tea through a straw, rinse with water afterwards', area: 'oral',
    whatItDoes: 'Reducing contact time of staining drinks with teeth and waiting before brushing after acidic food.',
    targetsMetricIds: ['E05'], evidence: 'WEAK',
    evidenceNote: 'Mechanism is sound, direct trials are limited. It slows new staining; it does NOT whiten teeth.',
    realisticEffect: 'Slower new staining. No whitening.', timeToResults: 'Ongoing', risks: 'None.',
    status: 'OPTIONAL_LOW_PRIORITY', appliedToBody: true, sourceIds: ['safety:convention_oral'],
  }),
  nm({
    id: 'NM14', name: 'Gentle hair handling (no tight styles, low heat, microfibre towel)', area: 'hair',
    whatItDoes: 'Avoiding tension and heat that cause breakage and traction hair loss.',
    targetsMetricIds: ['H02', 'H03'], evidence: 'WEAK',
    evidenceNote: 'Traction alopecia from tight styles is well described; benefit of towel and heat habits rests on mechanism. It cannot stop genetic hair loss.',
    realisticEffect: 'Less breakage and less traction loss.', timeToResults: '4-12 weeks', risks: 'None.',
    status: 'OPTIONAL_LOW_PRIORITY', appliedToBody: true, sourceIds: ['safety:convention_derm'],
  }),
  nm({
    id: 'NM15', name: 'Scalp massage (gentle, about 4 minutes a day)', area: 'hair',
    whatItDoes: 'Standardised daily scalp massage, studied for hair thickness.',
    targetsMetricIds: ['H02'], evidence: 'WEAK',
    evidenceNote: 'One small Japanese study (Koyama 2016): nine non-balding men, a scalp massage device made by the funder, 4 minutes a day for 24 weeks, no control group. It measured hair shaft thickness (about 0.085 to 0.092 mm), not density. It has not been tested in men with hair loss and will not stop genetic hair loss. Unverified.',
    realisticEffect: 'Possibly very slightly thicker individual hairs in non-balding men. Not regrowth, not more hairs.', timeToResults: 'About 6 months', risks: 'Low; stop if the scalp is irritated.',
    status: 'OPTIONAL_LOW_PRIORITY', appliedToBody: true, sourceIds: ['safety:koyama2016'],
  }),
  nm({
    id: 'NM16', name: 'Facial exercises for cheek fullness', area: 'other',
    whatItDoes: 'A set programme of facial muscle exercises, studied for cheek fullness in women over 40.',
    targetsMetricIds: ['F01', 'F17'], evidence: 'WEAK',
    evidenceNote: 'One small pilot (Alam 2018, JAMA Dermatology): women aged 40-65, 27 enrolled and 16 finished 20 weeks; blinded raters scored cheek fullness and apparent age fell slightly (reported as about 51 to 49). No male data, no control group, not randomised. These numbers come from a reviewer and the editor could not open the paper. Unverified.',
    realisticEffect: 'Small, if any, and not shown in men.', timeToResults: '20 weeks', risks: 'Do not clench the jaw.',
    status: 'OPTIONAL_LOW_PRIORITY', sourceIds: ['safety:alam2018'],
  }),
  nm({
    id: 'NM17', name: 'Coconut oil on hair lengths before washing', area: 'hair',
    whatItDoes: 'Coating hair strands before washing to reduce protein loss and breakage, shown in lab studies.',
    targetsMetricIds: ['H03'], evidence: 'WEAK',
    evidenceNote: 'Lab work on hair fibres (Rele 2003) found less protein loss. It does nothing for growth. It can clog pores, so keep it off the face and hairline. Unverified.',
    realisticEffect: 'Less breakage of lengths. Zero growth effect.', timeToResults: 'A few washes', risks: 'Clogs pores on skin; allergic reaction possible.',
    status: 'OPTIONAL_LOW_PRIORITY', appliedToBody: true, sourceIds: ['safety:rele2003'],
  }),
  nm({
    id: 'NM18', name: 'Cold water splash for puffiness', area: 'skin',
    whatItDoes: 'Splashing the face with cool water on photo days.',
    targetsMetricIds: ['S09'], evidence: 'WEAK',
    evidenceNote: 'Based on short-lived blood-vessel narrowing; no trials found. Effect lasts under an hour.',
    realisticEffect: 'Brief reduction in puffiness, under an hour.', timeToResults: 'Minutes', risks: 'None. Water only; nothing near the eyes except a splash.',
    status: 'OPTIONAL_LOW_PRIORITY', appliedToBody: true, sourceIds: ['safety:convention_derm'],
  }),
  // ---------------- EXCLUDED myths / no lasting effect ----------------
  nm({
    id: 'NM19', name: 'Mewing (tongue posture) for adult jaw change', area: 'other',
    whatItDoes: 'Resting the tongue on the palate to reshape the jaw and face.',
    targetsMetricIds: ['F03', 'F04', 'F18'], evidence: 'MYTH',
    evidenceNote: 'No adult evidence that tongue posture changes bone structure. Orthodontic research on growing children does not extend to adults.',
    realisticEffect: 'No measurable jaw change in adults.', timeToResults: 'None expected', risks: 'Jaw-joint strain if forced.',
    status: 'EXCLUDED_MYTH', sourceIds: ['safety:convention_mewing'],
  }),
  nm({
    id: 'NM20', name: 'Hard or resin gum chewed for hours for jaw size', area: 'other',
    whatItDoes: 'Chewing very hard gum for hours a day to enlarge the jaw muscles.',
    targetsMetricIds: ['F03'], evidence: 'WEAK',
    evidenceNote: 'Heavy chewing could plausibly enlarge the masseter, so this is not called a myth. We did not open evidence on chewing and masseter size, nor on jaw-joint (TMD) risk, so both are unverified. Chewing for hours is a common reported cause of jaw pain. Ordinary food-grade resin gum chewed briefly is not what this entry is about.',
    realisticEffect: 'Possibly some jaw muscle growth; unproven for looks and may cause jaw pain.', timeToResults: 'Unknown', risks: 'Jaw-joint pain, muscle overuse, headaches.',
    status: 'EXCLUDED_NO_LASTING_EFFECT', sourceIds: [],
  }),
  nm({
    id: 'NM21', name: 'Steam to open pores, cold to close them', area: 'skin',
    whatItDoes: 'Claims that heat opens and cold closes pores.',
    targetsMetricIds: ['S08'], evidence: 'MYTH',
    evidenceNote: 'Pores have no muscles to open or close. Pore size is mostly genetic and oil-related.',
    realisticEffect: 'None lasting.', timeToResults: 'None', risks: 'Hot steam irritates skin.',
    status: 'EXCLUDED_MYTH', sourceIds: ['safety:convention_derm'],
  }),
  nm({
    id: 'NM22', name: 'Cold showers for appearance', area: 'skin',
    whatItDoes: 'Claims cold showers improve skin, hair or fat loss.',
    targetsMetricIds: ['S04', 'H03'], evidence: 'MYTH',
    evidenceNote: 'No evidence of lasting appearance benefits.', realisticEffect: 'None lasting.', timeToResults: 'None',
    risks: 'Discomfort; shock risk for people with heart conditions.', status: 'EXCLUDED_NO_LASTING_EFFECT', sourceIds: [],
  }),
  nm({
    id: 'NM23', name: 'Honey masks for acne', area: 'skin',
    whatItDoes: 'Applying honey to spots.', targetsMetricIds: ['S01'], evidence: 'MYTH',
    evidenceNote: 'One 136-person trial of a medical-grade kanuka honey product added to soap (Semprini 2016, ages 16-40) found no clear benefit at 12 weeks; the confidence interval was wide, so it is unproven rather than disproven. Homemade honey has no trial evidence. Unverified.',
    realisticEffect: 'No demonstrated benefit; unproven.', timeToResults: 'None', risks: 'Allergic reactions.',
    status: 'EXCLUDED_MYTH', appliedToBody: true, sourceIds: ['safety:semprini2016'],
  }),
  nm({
    id: 'NM24', name: 'Onion juice for hair loss', area: 'hair',
    whatItDoes: 'Rubbing onion juice on the scalp to regrow hair.', targetsMetricIds: ['H01', 'H02'], evidence: 'MYTH',
    evidenceNote: 'No reliable evidence for genetic hair loss; it is a skin irritant and smells.',
    realisticEffect: 'None for genetic hair loss.', timeToResults: 'None', risks: 'Scalp irritation, allergy.',
    status: 'EXCLUDED_MYTH', appliedToBody: true, sourceIds: [],
  }),
  nm({
    id: 'NM25', name: 'Rosemary oil on the scalp', area: 'hair',
    whatItDoes: 'Using concentrated rosemary oil for hair growth.', targetsMetricIds: ['H02'], evidence: 'WEAK',
    evidenceNote: 'One weak trial exists. It uses a concentrated extract, which this app does not allow without a whitelist entry.',
    realisticEffect: 'Unproven; no reliable effect size.', timeToResults: 'Unknown', risks: 'Irritation; concentrated oils are not allowed.',
    status: 'WHITELIST_REQUIRED', appliedToBody: true, requiredProductCategories: ['natural_topical'], sourceIds: [],
  }),
  nm({
    id: 'NM26', name: 'Rice water, egg, beer or mayonnaise hair masks', area: 'hair',
    whatItDoes: 'Kitchen hair masks for growth or shine.', targetsMetricIds: ['H03'], evidence: 'MYTH',
    evidenceNote: 'No good evidence; at best a temporary coating effect.', realisticEffect: 'No lasting effect.', timeToResults: 'None',
    risks: 'Scalp irritation, food allergy.', status: 'EXCLUDED_NO_LASTING_EFFECT', appliedToBody: true, sourceIds: [],
  }),
  nm({
    id: 'NM27', name: 'Turmeric paste on skin', area: 'skin',
    whatItDoes: 'Applying turmeric for glow or acne.', targetsMetricIds: ['S04'], evidence: 'MYTH',
    evidenceNote: 'No good evidence; it stains skin yellow and can cause allergic reactions.', realisticEffect: 'Stains skin and nails yellow.', timeToResults: 'None',
    risks: 'Skin staining, contact allergy.', status: 'EXCLUDED_MYTH', appliedToBody: true, sourceIds: [],
  }),
  nm({
    id: 'NM28', name: 'Gua sha or face massage to remove face fat', area: 'skin',
    whatItDoes: 'Scraping or massaging to reshape or slim the face.', targetsMetricIds: ['F01'], evidence: 'MYTH',
    evidenceNote: 'We found no trial showing that massage or scraping removes face fat. Any slimming effect is a temporary fluid shift.', realisticEffect: 'Temporary puffiness change under a few hours.',
    timeToResults: 'Minutes, then gone', risks: 'Bruising, irritation.', status: 'EXCLUDED_NO_LASTING_EFFECT', appliedToBody: true, sourceIds: [],
  }),
  nm({
    id: 'NM29', name: 'Spot reduction (fat loss from one body area)', area: 'training',
    whatItDoes: 'Exercising one area to burn fat there.', targetsMetricIds: ['B02', 'F01'], evidence: 'MYTH',
    evidenceNote: 'An abdominal-exercise trial (Vispute 2011, not opened) found no local fat loss; fat is lost across the body.', realisticEffect: 'None locally.', timeToResults: 'None',
    risks: 'Wasted effort.', status: 'EXCLUDED_MYTH', sourceIds: ['safety:vispute2011'],
  }),
  nm({
    id: 'NM30', name: '"8 glasses of water a day" for clear skin', area: 'nutrition',
    whatItDoes: 'Drinking a fixed amount of water to improve skin.', targetsMetricIds: ['S04', 'X07'], evidence: 'MYTH',
    evidenceNote: 'A review (Valtin 2002, not opened) found no evidence for the fixed 8-glass target, and we found nothing showing extra water in people already hydrated clears skin. Drink to thirst; urine colour is a practical check.',
    realisticEffect: 'None beyond normal hydration.', timeToResults: 'None', risks: 'Excessive water intake is unsafe.',
    status: 'EXCLUDED_MYTH', foodLevelOnly: true, sourceIds: ['safety:valtin2002'],
  }),
  nm({
    id: 'NM31', name: 'Oil pulling for teeth whitening', area: 'oral',
    whatItDoes: 'Swishing oil in the mouth for 10-20 minutes.', targetsMetricIds: ['E05', 'G07'], evidence: 'WEAK',
    evidenceNote: 'We did not open any trial. Some small trials are reported to show slight plaque reduction; we found none showing lasting tooth whitening.', realisticEffect: 'No whitening.', timeToResults: 'None for colour',
    risks: 'Lipid pneumonia if inhaled; jaw fatigue.', status: 'EXCLUDED_NO_LASTING_EFFECT', appliedToBody: true, sourceIds: [],
  }),
  nm({
    id: 'NM32', name: 'Dry brushing for skin or cellulite', area: 'skin',
    whatItDoes: 'Brushing dry skin to smooth, detox or firm.', targetsMetricIds: ['S07'], evidence: 'MYTH',
    evidenceNote: 'No evidence of lasting smoothing or detox. Brushing can irritate skin.', realisticEffect: 'Brief rosy skin from irritation.', timeToResults: 'None',
    risks: 'Skin irritation.', status: 'EXCLUDED_NO_LASTING_EFFECT', appliedToBody: true, sourceIds: [],
  }),
  nm({
    id: 'NM33', name: 'Face taping or sleep tape for wrinkles', area: 'skin',
    whatItDoes: 'Taping the skin overnight to smooth lines.', targetsMetricIds: ['S11'], evidence: 'MYTH',
    evidenceNote: 'No evidence of lasting wrinkle reduction; adhesive can irritate skin.', realisticEffect: 'None lasting.', timeToResults: 'None',
    risks: 'Contact dermatitis.', status: 'EXCLUDED_NO_LASTING_EFFECT', appliedToBody: true, sourceIds: [],
  }),
  nm({
    id: 'NM34', name: 'Jade roller for depuffing', area: 'skin',
    whatItDoes: 'Rolling a cool stone over the face.', targetsMetricIds: ['S09'], evidence: 'WEAK',
    evidenceNote: 'Any depuffing is a short fluid shift lasting under an hour. No lasting change.', realisticEffect: 'Temporary only.', timeToResults: 'Minutes',
    risks: 'Irritation; keep away from the eyes.', status: 'EXCLUDED_NO_LASTING_EFFECT', appliedToBody: true, sourceIds: [],
  }),
  nm({
    id: 'NM35', name: 'Neck-training for a thicker neck (heavy loading)', area: 'training',
    whatItDoes: 'Heavy neck loading for neck girth.', targetsMetricIds: ['B08'], evidence: 'WEAK',
    evidenceNote: 'Heavy neck loading has a real size effect, since neck muscles respond to training, but injury risk is high, so it is excluded for safety, not for lack of effect. Light neck work only: bodyweight-level resistance such as chin tucks and gentle isometrics, with a coach for anything loaded. We did not open a source.', realisticEffect: 'Real girth change, at high injury risk.',
    timeToResults: 'Months', risks: 'Neck injury, nerve and disc problems.', status: 'BANNED_HARMFUL', sourceIds: [],
  }),
  // ---------------- banned-harm mirror entries ----------------
  nm({
    id: 'NM36', name: 'Lemon or lime juice on skin', area: 'skin', whatItDoes: 'Citrus juice used to lighten marks or dry spots.',
    targetsMetricIds: ['S03'], evidence: 'MYTH', evidenceNote: 'Acidic and photosensitising: can burn skin and darken marks in sun.',
    realisticEffect: 'Burns and stains instead.', timeToResults: 'None', risks: 'Chemical burns, photo-sensitivity.', status: 'BANNED_HARMFUL', appliedToBody: true, sourceIds: [],
  }),
  nm({
    id: 'NM37', name: 'Apple cider vinegar on skin', area: 'skin', whatItDoes: 'Vinegar used as toner or spot treatment.',
    targetsMetricIds: ['S01'], evidence: 'MYTH', evidenceNote: 'Published case reports of vinegar burns exist (not opened here); we found no benefit shown.', realisticEffect: 'Skin burns instead of benefit.', timeToResults: 'None',
    risks: 'Chemical burns.', status: 'BANNED_HARMFUL', appliedToBody: true, sourceIds: [],
  }),
  nm({
    id: 'NM38', name: 'Baking soda on skin', area: 'skin', whatItDoes: 'Paste used as scrub or spot treatment.',
    targetsMetricIds: ['S08'], evidence: 'MYTH', evidenceNote: 'Alkaline (about pH 8) and disrupts the skin\'s acid barrier, which can cause dryness and irritation.', realisticEffect: 'Dry, irritated skin instead of benefit.', timeToResults: 'None',
    risks: 'Barrier damage.', status: 'BANNED_HARMFUL', appliedToBody: true, sourceIds: [],
  }),
  nm({
    id: 'NM39', name: 'Toothpaste on spots', area: 'skin', whatItDoes: 'Dabbing toothpaste on pimples.',
    targetsMetricIds: ['S01'], evidence: 'MYTH', evidenceNote: 'Not designed for skin; irritates and can cause contact dermatitis.', realisticEffect: 'Irritated skin instead of benefit.',
    timeToResults: 'None', risks: 'Contact dermatitis, dark marks.', status: 'BANNED_HARMFUL', appliedToBody: true, sourceIds: [],
  }),
  nm({
    id: 'NM40', name: 'Undiluted essential oils, garlic or cinnamon on skin', area: 'skin', whatItDoes: 'Strong plant oils or spices applied directly.',
    targetsMetricIds: ['S01', 'S03'], evidence: 'MYTH', evidenceNote: 'Common causes of contact allergy and burns.', realisticEffect: 'Burns and rashes.',
    timeToResults: 'None', risks: 'Chemical burns, allergy.', status: 'BANNED_HARMFUL', appliedToBody: true, sourceIds: [],
  }),
  nm({
    id: 'NM41', name: 'Sugar or salt face scrubs', area: 'skin', whatItDoes: 'Gritty scrubs for smoothing.',
    targetsMetricIds: ['S07'], evidence: 'MYTH', evidenceNote: 'Sharp crystals cause micro-tears.', realisticEffect: 'Irritated skin instead of benefit.', timeToResults: 'None',
    risks: 'Micro-tears, redness.', status: 'BANNED_HARMFUL', appliedToBody: true, sourceIds: [],
  }),
  nm({
    id: 'NM42', name: 'Charcoal, strawberry, acid or DIY peroxide teeth whitening', area: 'oral', whatItDoes: 'Home remedies for whiter teeth.',
    targetsMetricIds: ['E05'], evidence: 'MYTH', evidenceNote: 'Abrasion and acid wear enamel; DIY peroxide burns gums.', realisticEffect: 'Enamel wear instead of whitening.',
    timeToResults: 'None', risks: 'Enamel erosion, gum burns, sensitivity.', status: 'BANNED_HARMFUL', appliedToBody: true, sourceIds: [],
  }),
  nm({
    id: 'NM43', name: 'Cucumber, tea bags, potato or ice on the eyes', area: 'skin', whatItDoes: 'Placing items on the eyes for dark circles.',
    targetsMetricIds: ['S09', 'E01'], evidence: 'MYTH', evidenceNote: 'Only a brief cooling effect; risks contamination and eye injury.', realisticEffect: 'Under an hour at best.',
    timeToResults: 'Minutes', risks: 'Eye infection, frostbite from ice.', status: 'BANNED_HARMFUL', appliedToBody: true, sourceIds: [],
  }),
  nm({
    id: 'NM44', name: 'DIY dermarolling, peels or extraction tools', area: 'skin', whatItDoes: 'Needle rollers, acid peels or metal extractors at home.',
    targetsMetricIds: ['S02', 'S08'], evidence: 'MYTH', evidenceNote: 'Home versions risk infection and scarring; procedures belong with a professional.', realisticEffect: 'Higher risk of scarring.',
    timeToResults: 'None', risks: 'Infection, scarring.', status: 'BANNED_HARMFUL', appliedToBody: true, sourceIds: [],
  }),
  nm({
    id: 'NM45', name: 'Tanning and sunbeds', area: 'sun', whatItDoes: 'Deliberate UV exposure for colour.',
    targetsMetricIds: ['S04', 'S11'], evidence: 'MYTH', evidenceNote: 'IARC classifies UV-emitting tanning devices as carcinogenic to humans (monograph not opened here); UV also drives skin ageing.', realisticEffect: 'Skin damage and ageing.',
    timeToResults: 'None', risks: 'Skin cancer, premature ageing.', status: 'BANNED_HARMFUL', appliedToBody: true, sourceIds: ['safety:iarc_uv'],
  }),
]

const ban = (id: string, name: string, group: BannedItem['group'], why: string, patterns: string[], sourceIds: string[] = []): BannedItem => ({
  id, name, group, why, patterns, sourceIds,
})

export const banned: BannedItem[] = [
  ban('BAN01', 'Bone smashing', 'injury_risk', 'Hitting facial bones causes fractures, nerve damage and scarring. It does not build bone.', ['bone smash', 'bonesmash']),
  ban('BAN02', 'Thumb pulling and jaw-exerciser devices', 'injury_risk', 'Forces on the jaw and palate risk joint damage and tooth movement with no proven benefit.', ['thumb pull', 'thumbpull', 'jaw exerciser', 'jawline exerciser', 'jaw trainer']),
  ban('BAN03', 'Mewing sold as an adult jaw fix', 'pseudoscience_harm', 'No adult evidence it changes bone; forced posture can strain the jaw joint.', ['mewing', 'mew ']),
  ban('BAN04', 'Crash diets and eating below basal needs', 'extreme_restriction', 'Deficits above 25%, eating below basal metabolic rate, or losing more than 1% of body weight per week cost muscle and hair.', ['crash diet', 'starvation', 'below basal', 'lose 2 kg a week', 'very low calorie']),
  ban('BAN05', 'Dehydration and sauna-suit weight cuts', 'extreme_restriction', 'Water cuts are dangerous and the weight returns within hours.', ['dehydrat', 'sauna suit', 'water cut', 'sweat suit']),
  ban('BAN06', 'Forcing the voice lower', 'voice_harm', 'Pushing pitch down strains the vocal folds and can cause hoarseness or damage.', ['force your voice', 'forcing the voice', 'lower your voice artificially', 'vocal fry to sound deeper']),
  ban('BAN07', 'DIY dermarolling, needling, peels and extraction tools', 'diy_procedure', 'Home skin-piercing and acid procedures risk infection, scarring and burns.', ['dermaroll', 'derma roll', 'microneedl', 'diy peel', 'home peel', 'extraction tool', 'blackhead extractor']),
  ban('BAN08', 'Tanning and sunbeds', 'sun_damage', 'UV exposure raises skin cancer risk and speeds ageing.', ['sunbed', 'tanning bed', 'tanning', 'sun lamp', 'baby oil tan']),
  ban('BAN09', 'Lemon or lime juice on skin', 'skin_damage', 'Acidic, can burn skin and cause lasting dark marks in sun.', ['lemon juice', 'lime juice', 'lemon on']),
  ban('BAN10', 'Apple cider vinegar on skin', 'skin_damage', 'Causes chemical burns; no proven benefit.', ['apple cider vinegar', 'vinegar toner']),
  ban('BAN11', 'Baking soda on skin', 'skin_damage', 'Alkaline (about pH 8) and disrupts the skin\'s acid barrier, which can cause dryness and irritation.', ['baking soda', 'bicarbonate']),
  ban('BAN12', 'Toothpaste on spots', 'skin_damage', 'Not made for skin; irritates and can leave marks.', ['toothpaste on spot', 'toothpaste on pimple', 'toothpaste on acne', 'toothpaste on zit']),
  ban('BAN13', 'Undiluted essential oils', 'skin_damage', 'Common cause of burns and contact allergy.', ['undiluted essential oil', 'essential oil', 'neat oil on skin']),
  ban('BAN14', 'Garlic or cinnamon on skin', 'skin_damage', 'Burns and allergic reactions.', ['garlic on', 'cinnamon on', 'garlic mask', 'cinnamon mask']),
  ban('BAN15', 'Sugar or salt face scrubs', 'skin_damage', 'Sharp crystals cause micro-tears in facial skin.', ['sugar scrub', 'salt scrub']),
  ban('BAN16', 'Activated charcoal teeth whitening', 'teeth_damage', 'Abrasive; wears enamel, no proven whitening.', ['charcoal']),
  ban('BAN17', 'Strawberry or acid teeth whitening', 'teeth_damage', 'Acid softens enamel; no whitening effect.', ['strawberry', 'lemon on teeth', 'acid whitening']),
  ban('BAN18', 'DIY peroxide teeth whitening', 'teeth_damage', 'Unregulated peroxide burns gums and damages teeth.', ['diy peroxide', 'hydrogen peroxide rinse', 'peroxide whitening']),
  ban('BAN19', 'Cucumber, tea bags, potato or ice on or near the eyes', 'eye_risk', 'Risk of infection, irritation or cold injury, and only a brief effect.', ['cucumber', 'tea bag', 'potato slice', 'ice on eyes', 'ice cube on']),
  ban('BAN20', 'Self-injection or implants for face shaping', 'diy_procedure', 'Needs a licensed professional; home attempts risk blindness, infection and tissue death.', ['diy filler', 'self inject', 'home filler']),
  ban('BAN21', 'Hard or resin gum chewed for hours for jaw size', 'injury_risk', 'Chewing for hours can overload the jaw joint and cause pain, with no proven look benefit.', ['hard gum', 'falim', 'chew for hours']),
  ban('BAN22', 'Ingested capsules, extracts and concentrated or ingested oils', 'skin_damage', 'The app only advises food-level amounts. Capsules, extracts and concentrated or swallowed oils carry dose and interaction risks it cannot assess.', ['capsule', 'extract', 'swallow oil', 'drink oil', 'ingest essential oil', 'take oil daily']),
  ban('BAN23', 'Diuretics, laxatives, purging and fat burners for weight', 'extreme_restriction', 'These cause dehydration, electrolyte problems and gut or heart harm, and they do not remove body fat.', ['diuretic', 'laxative', 'purging', 'purge', 'fat burner', 'appetite suppressant', 'water pill']),
  ban('BAN24', 'Anabolic steroids, SARMs and growth hormone', 'injury_risk', 'Unprescribed hormones and hormone-like drugs carry serious heart, liver, hormone and fertility risks.', ['steroid', 'sarm', 'growth hormone', 'hgh', 'anabolic']),
  ban('BAN25', 'Skin bleaching creams and DIY hair removal chemicals', 'skin_damage', 'Lightening creams and depilatories on the face can burn, scar or permanently change skin colour.', ['skin bleaching', 'skin lightening cream', 'bleaching cream', 'depilatory', 'hair removal cream']),
  ban('BAN26', 'Picking or popping spots with tools', 'diy_procedure', 'Pins, needles and squeezing tools drive infection, dark marks and scars.', ['pop pimples', 'popping spots', 'pin to pop', 'squeeze blackheads with']),
]

export const referralFlags: ReferralFlag[] = [
  { id: 'REF01', trigger: 'Severe, nodular or cystic acne, or acne that leaves scars', metricIds: ['S01', 'S02'], message: 'This looks like acne that needs medical care. Please see a doctor or dermatologist. The app will not give treatment advice for it.', urgency: 'soon' },
  { id: 'REF02', trigger: 'Sudden, rapid or patchy hair loss', metricIds: ['H01', 'H02'], message: 'Sudden or patchy hair loss can have medical causes. Please see a doctor.', urgency: 'soon' },
  { id: 'REF03', trigger: 'Yellow colour in the whites of the eyes', metricIds: ['E01'], message: 'Yellow eye whites can signal a health problem. Please see a doctor soon.', urgency: 'urgent' },
  { id: 'REF04', trigger: 'Persistent facial redness lasting weeks', metricIds: ['S06'], message: 'Redness that does not settle can have a medical cause. Please see a doctor.', urgency: 'routine' },
  { id: 'REF05', trigger: 'Visibly uneven spine or large shoulder or hip height difference', metricIds: ['P05', 'P03'], message: 'A large asymmetry is worth a medical check. Please see a doctor.', urgency: 'routine' },
  { id: 'REF06', trigger: 'Rapid unexplained weight change', metricIds: ['B06', 'B02'], message: 'Weight changing quickly without trying can have medical causes. Please see a doctor.', urgency: 'soon' },
  { id: 'REF07', trigger: 'New or changing mole, or a new lump or sore that does not heal', metricIds: ['S04', 'S11'], message: 'New or changing skin spots should be checked. Please see a doctor.', urgency: 'soon' },
  { id: 'REF08', trigger: 'Persistent jaw pain, clicking with pain, or locking', metricIds: ['F03'], message: 'Ongoing jaw pain should be checked. Please see a doctor or dentist.', urgency: 'routine' },
  { id: 'REF09', trigger: 'Persistent bad breath despite good hygiene', metricIds: ['G07'], message: 'Bad breath that stays despite good oral hygiene can have a dental or medical cause. Please see a dentist or doctor.', urgency: 'routine' },
  { id: 'REF10', trigger: 'Persistent red, painful or swollen eyes', metricIds: ['E01'], message: 'Red, painful or swollen eyes need a medical check. Please see a doctor.', urgency: 'soon' },
  { id: 'REF11', trigger: 'Persistent breast or chest lump or tenderness', metricIds: ['B09'], message: 'A lump or ongoing tenderness should be checked. Please see a doctor.', urgency: 'soon' },
  { id: 'REF12', trigger: 'Persistent lip cracks or sores that do not heal', metricIds: ['S12'], message: 'Sores that do not heal in two weeks should be checked. Please see a doctor.', urgency: 'routine' },
  { id: 'REF13', trigger: 'Body acne or rash that is spreading, painful or weeping', metricIds: ['S13'], message: 'A spreading or painful rash should be checked. Please see a doctor.', urgency: 'soon' },
  { id: 'REF14', trigger: 'Signs of disordered eating, such as rigid restriction or distress about food', metricIds: ['X05', 'B02'], message: 'If food or weight feels out of control or distressing, please talk to a doctor. The app will not push a deficit.', urgency: 'soon' },
  { id: 'REF15', trigger: 'Sudden one-sided face droop, arm weakness, speech trouble or sudden facial swelling', metricIds: ['F05'], message: 'These can be signs of a medical emergency. Seek emergency care now and call your local emergency number. Do not wait or use the app.', urgency: 'urgent' },
  { id: 'REF16', trigger: 'Hoarseness or voice change lasting more than 3 weeks', metricIds: ['V01', 'V02'], message: 'A voice change that lasts more than 3 weeks should be checked. Please see a doctor.', urgency: 'soon' },
  { id: 'REF17', trigger: 'New, one-sided or worsening eye bulging, or swelling around the eyes', metricIds: ['E01'], message: 'Changes in how the eyes sit or look should be checked. Please see a doctor soon.', urgency: 'soon' },
  { id: 'REF18', trigger: 'Dark, thick, velvety skin patches in folds such as the neck or armpits', metricIds: ['S04'], message: 'Skin darkening in folds can have a medical cause. Please see a doctor.', urgency: 'routine' },
]

const src = (id: string, kind: Source['kind'], citation: string, supports: string, url?: string, note = NOT_OPENED): Source => ({
  id, kind, citation, ...(url ? { url } : {}), verified: false, verificationNote: note, supports,
})

export const sources: Source[] = [
  src('safety:axelsson2010', 'peer_reviewed', 'Axelsson, J., et al. (2010). Beauty sleep: experimental study on the perceived health and attractiveness of sleep deprived people. BMJ 341:c6614.', 'Sleep-restricted faces rated less healthy and attractive (acute deprivation, small sample)', 'https://doi.org/10.1136/bmj.c6614'), // privacy-lint-allow(external-url): citation link shown as text, never fetched by the app
  src('safety:sundelin2013', 'peer_reviewed', 'Sundelin, T., et al. (2013). Cues of fatigue: effects of sleep deprivation on facial appearance. Sleep 36(9):1355-1360.', '31 hours awake changes facial cues of tiredness (acute deprivation)', 'https://doi.org/10.5665/sleep.2964', SEEN_IN_SEARCH), // privacy-lint-allow(external-url): citation link shown as text, never fetched by the app
  src('safety:morton2018', 'peer_reviewed', 'Morton, R. W., et al. (2018). A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength. Br J Sports Med 52(6):376-384.', 'Protein supplementation in resistance-training trials: benefit plateaus near 1.6 g/kg/day, upper CI near 2.2. Not a calorie-deficit study', 'https://doi.org/10.1136/bjsports-2017-097608'), // privacy-lint-allow(external-url): citation link shown as text, never fetched by the app
  src('safety:smith2007', 'peer_reviewed', 'Smith, R. N., et al. (2007). A low-glycemic-load diet improves symptoms in acne vulgaris patients: a randomized controlled trial. Am J Clin Nutr 86(1):107-115.', 'Low-glycaemic-load diet modestly reduced acne lesions', 'https://doi.org/10.1093/ajcn/86.1.107', SEEN_IN_SEARCH), // privacy-lint-allow(external-url): citation link shown as text, never fetched by the app
  src('safety:semprini2016', 'peer_reviewed', 'Semprini, A., et al. (2016). Randomised controlled trial of topical kanuka honey for the treatment of acne. BMJ Open 6:e009448.', 'Medical-grade kanuka honey added to soap: no clear benefit at 12 weeks, wide confidence interval (inconclusive)', 'https://doi.org/10.1136/bmjopen-2015-009448', SEEN_IN_SEARCH), // privacy-lint-allow(external-url): citation link shown as text, never fetched by the app
  src('safety:koyama2016', 'peer_reviewed', 'Koyama, T., et al. (2016). Standardized scalp massage results in increased hair thickness by inducing stretching forces to dermal papilla cells in the subcutaneous tissue. Eplasty 16:e8.', 'Small study of scalp massage and hair thickness in nine non-balding men; thickness not density', undefined, SEEN_IN_SEARCH),
  src('safety:alam2018', 'peer_reviewed', 'Alam, M., et al. (2018). Association of Facial Exercise With the Appearance of Aging. JAMA Dermatol, published online 3 January 2018 (print volume and pages not confirmed).', 'Small non-randomised pilot of facial exercise in women, no control group, no male data'),
  src('safety:rele2003', 'peer_reviewed', 'Rele, A. S., & Mohile, R. B. (2003). Effect of mineral oil, sunflower oil, and coconut oil on prevention of hair damage. J Cosmet Sci 54(2):175-192.', 'Coconut oil reduced protein loss in hair fibres in lab tests', undefined, SEEN_IN_SEARCH),
  src('safety:whitehead2012', 'peer_reviewed', 'Whitehead, R. D., et al. (2012). You are what you eat: within-subject increases in fruit and vegetable consumption confer beneficial skin-color changes. PLoS ONE 7(3):e32988.', 'Skin colour tracked fruit and vegetable intake in 35 mostly Caucasian people over 6 weeks', 'https://doi.org/10.1371/journal.pone.0032988', SEEN_IN_SEARCH), // privacy-lint-allow(external-url): citation link shown as text, never fetched by the app
  src('safety:flament2013', 'peer_reviewed', 'Flament, F., et al. (2013). Effect of the sun on visible clinical signs of aging in Caucasian skin. Clin Cosmet Investig Dermatol 6:221-232.', 'Cross-sectional comparison of sun-seeking and sun-phobic Caucasian women; association only, industry-affiliated authors', undefined, SEEN_IN_SEARCH),
  src('safety:holding_replication', 'peer_reviewed', 'Holding, B. C., et al. Replication of sleep-deprivation and facial-appearance cues, University of St Andrews / Karolinska group (181 participants as reported by a reviewer). Full citation not confirmed.', 'Objective facial measures did not differ between sleep-deprived and rested groups; some cues predicted fatigue ratings', undefined, 'Reported by a reviewer; the editor could not locate or open the record, so the citation details are unconfirmed.'),
  src('safety:helms2014', 'peer_reviewed', 'Helms, E. R., et al. (2014). Evidence-based recommendations for natural bodybuilding contest preparation: nutrition and supplementation. J Int Soc Sports Nutr 11:20.', 'Higher protein helps preserve lean mass in a calorie deficit'),
  src('safety:ratamess2009', 'clinical_guideline', 'Ratamess, N. A., et al. (2009). American College of Sports Medicine position stand: progression models in resistance training for healthy adults. Med Sci Sports Exerc 41(3):687-708.', 'Resistance training progressively builds muscle in healthy adults'),
  src('safety:vispute2011', 'peer_reviewed', 'Vispute, S. S., et al. (2011). The effect of abdominal exercise on abdominal fat. J Strength Cond Res 25(9):2559-2564.', 'Training one area did not reduce fat locally'),
  src('safety:valtin2002', 'peer_reviewed', 'Valtin, H. (2002). "Drink at least eight glasses of water a day." Really? Is there scientific evidence for "8 x 8"? Am J Physiol Regul Integr Comp Physiol 283(5):R993-R1004.', 'No evidence for a fixed 8-glass daily water target'),
  src('safety:iarc_uv', 'government_or_standards', 'IARC Monographs on the Evaluation of Carcinogenic Risks to Humans, Volume 100D: Radiation (2012). Solar and ultraviolet radiation and UV-emitting tanning devices are Group 1 carcinogens.', 'UV and tanning devices cause skin cancer; UV drives photoageing'),
  src('safety:convention_rate', 'convention', 'Common sports-nutrition guidance: lose 0.5-1% of body weight per week to limit muscle loss.', 'Rate-of-loss cap', undefined, 'Rule of thumb; no single source opened.'),
  src('safety:convention_lean_gain', 'convention', 'Coaching rule of thumb: beginners may gain roughly 0.5-1 kg lean mass per month in year one.', 'Lean mass gain estimate', undefined, 'Rule of thumb; no single source opened.'),
  src('safety:convention_photo', 'convention', 'Photographic practice: longer lens distance and soft light reduce facial distortion.', 'Photo technique', undefined, 'Photographic convention; not opened.'),
  src('safety:convention_derm', 'convention', 'General dermatology advice on gentle washing, avoiding picking, and shaving technique.', 'Skin and shaving habits', undefined, 'Clinical rule of thumb; no single record opened.'),
  src('safety:convention_posture', 'convention', 'Physiotherapy practice for forward-head and rounded-shoulder strengthening.', 'Posture exercises', undefined, 'Clinical convention; not opened.'),
  src('safety:convention_oral', 'convention', 'Dental hygiene guidance on tongue cleaning and staining habits.', 'Oral habits', undefined, 'Clinical convention; not opened.'),
  src('safety:convention_mewing', 'convention', 'Orthodontic position: tongue posture is not shown to change adult skeletal structure.', 'Mewing and hard gum exclusions', undefined, 'Professional position; not opened.'),
]
