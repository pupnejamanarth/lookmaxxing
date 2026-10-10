# Unmoggable – build plan and methodology

A private, on-device appearance-measurement app for one user. This document is the contract the code is
built against. The metric catalog itself (ranges, weights, sources, evidence grades) lives in
`src/catalog/data/*.ts` and is browsable inside the app; `docs/catalog-seed.md` is the original draft it grew from.

## 1. Goal – what "unmoggable" means here

Every **changeable** appearance metric pushed to its realistic ceiling, measured objectively, tracked over time.
Concretely the app reports one number for it – the **Ceiling Attainment Index (CAI)**:

> CAI = Σ wᵢ·sᵢ ÷ Σ wᵢ·cᵢ over changeable metrics, where sᵢ is today's score and cᵢ the user's realistic ceiling
> for that metric (e.g. body fat at the sustainable target band; the best value seen under good habits).
> CAI 100% = every changeable metric is at its ceiling.

Fixed traits (height, bone structure, genetic hairline) are rated honestly but **excluded from the action plan**.
Surgical-only and professional-only metrics are tagged and never planned around.

## 2. Rating rules (brutal but evidence-based)

1. Every score carries a reason citing the specific measurement behind it. **No score without a reason** – the data
   layer rejects a score record that lacks its facts.
2. No butteriness: no "great start", no compliment sandwiches, no rounding up (scores are truncated), no softening.
   If something is bad the report says it is bad and exactly why. Attack the metric, not the person.
3. Every score shows a **confidence level**. If photo angle, lighting or lens makes a metric unreliable the app
   **refuses** to score it and says what to re-capture.
4. The overall score is a weighted combination; the weighting is shown so the user can see what drags it down.
5. Community pseudoscience is flagged plainly and capped at ≤ 0.25 weight; weak evidence ≤ 1.0; myths 0.
6. Tone is enforced by tests (banned softeners and insults are linted in every template).

## 3. Improvement rules

* **No chemical recommendations.** No drugs, supplements, topicals, peptides, hormones or skincare actives beyond the
  user-defined whitelist ("my current stack"). The default whitelist is **empty**; the app never suggests entries and
  never mentions a product category the user has not added. Blocked levers are not named – the affected metric just
  says its progress is capped under the current whitelist.
* **Allowed levers:** training, food-based diet structure, sleep, posture work, grooming, haircut / beard design,
  style, photo technique, sun/skin habits, oral-hygiene habits, hair handling, voice practice.
* **Banned regardless:** bone smashing, thumb-pulling / jaw devices, mewing sold as an adult jaw fix, crash diets or
  deficits > 25 %, losing > 1 % body weight / week, dehydration or sauna-suit cuts, forcing the voice lower, DIY
  needling / peels / extraction, tanning, anything near the eyes, anything with real injury risk.
* **Natural / homemade methods** carry: what it does, evidence (STRONG / WEAK / MYTH), realistic effect, time to
  results, risks. Only STRONG-evidence methods are recommended; WEAK ones are optional and ranked low; MYTHs are listed
  under "Excluded & why". Anything applied to skin or scalp requires a patch test (pea-sized amount, inner forearm –
  behind the ear for scalp – twice daily for 7 days; any reaction = permanently excluded). Food-level use only: no
  capsules, extracts or concentrated / ingested oils.
* **Ranking:** actions are ordered by impact ÷ effort; the top 3 levers are shown first.
  `priority = Σ [wᵢ × (cᵢ − sᵢ)/100 × achievableᵢ] × evidenceFactor ÷ (hours/week × difficulty)` with
  evidenceFactor STRONG 1.0 · MODERATE 0.6 · WEAK 0.25 · MYTH 0.
* **Safety caps:** fat loss ≤ 0.5–1 % body weight / week, levers switch off at the target band and never below
  8 % body fat; a pain report pauses the related levers; medical-referral flags say "see a doctor" and never treat
  (severe acne, sudden hair loss, yellow eye whites, persistent redness, uneven spine, rapid unexplained weight change).

## 4. Scoring methodology

### 4.1 Per-metric score (0–100) – rule types in `src/catalog/schema.ts`

| Rule | Used for | How |
|---|---|---|
| `range` | structural ratios and angles | 100 inside [lo, hi]; outside: `100·exp(−½(d/τ)²)`, d = distance to the nearest edge, τ ≈ 1 population SD |
| `one_sided` | acne, ΔE colour difference, scalp show | piecewise-linear lookup (e.g. IGA 0→100, 1→85, 2→55, 3→25, 4→5) |
| `personal_baseline` | facial fat, texture, under-eye, teeth colour | scored against the user's own best value plus a norm anchor |
| `checklist` | grooming, fit | % of items passed; failing a critical item caps the score |
| `percentile` | height, leg ratio | percentile in a stated reference population |
| `none` | myths, process measures, habits | not scored |

### 4.2 Confidence (every score)

`confidence = method base × photo-quality factors × repeatability`
Method base: AUTO 1.0 · colour-calibrated 0.9 · manual landmarks 0.85 · tape 0.85 · **self-report 0.6 (never HIGH)**.
Repeatability comes from the 5-frame burst spread and from the user's personal **minimum detectable change (MDC)**,
measured on calibration day.
Bands: **HIGH ≥ 0.80 · MEDIUM 0.60–0.79 · LOW 0.40–0.59 (shown with a warning, left out of the overall score) ·
REFUSED < 0.40 or any hard fail.**
Hard-fail examples: symmetry / FWHR when head yaw or roll > 3° or pitch > 4°; any colour metric without a grey card;
a "profile" with head turned < 80°; smiling in a neutral shot; camera closer than 1.2 m for proportions.

### 4.3 Reasons are templates, not prose generation

Every score record must contain: value, unit, uncertainty, ideal band, source, gap from ideal, rule used, photo + angle.
Text is assembled from fixed templates so it cannot invent anything:

```
CERVICOMENTAL ANGLE · 131° ±3° · MEDIUM (manual points, right profile, 2 placements within 2°)
Ideal 105–120° [Ellenbogen & Karlin 1980]. 11° above range → score 38.
CHANGEABLE · evidence MODERATE · weight 2.5 → costs 1.6 overall points.

FWHR · NOT SCORED
Head pitch +6.1° (limit ±4°). Pitch error exceeds any real change in this metric.
Re-capture frontal: ear canal level with lower eyelid; use the on-screen level line.
```

### 4.4 Overall scores

* **Appearance score** = Σ wᵢsᵢ ÷ Σ wᵢ over HIGH + MEDIUM metrics only. **Coverage** = scored weight ÷ total weight; below
  75 % the score is marked PROVISIONAL; below 50 % it is not given. A ± band comes from combining each metric's uncertainty.
* **Points lost** per metric = wᵢ(100 − sᵢ)/100, grouped into **FIXED / SURGICAL+PROFESSIONAL / CHANGEABLE** for the drag chart.
* **Adherence index** is separate: habits carry 0 appearance weight (they are causes, not appearance).
* The weights are **evidence-informed judgement, not a validated model.** No study turns these metrics into one
  attractiveness number. They are shown openly, version-numbered and editable.

## 5. Standardised capture protocol

Measurements are useless without it. Equipment (≈ $25–40): phone stand or tripod, 18 % grey card, soft tape measure,
bathroom scale, plain wall + window light.

| Setting | Face / skin | Body / posture |
|---|---|---|
| Distance | **1.5 m** lens-to-face | **3.0 m** |
| Lens | rear 2× / 3× if available; otherwise 1× at the same distance (distortion depends on distance, not lens) | same |
| Camera height | lens at eye level | lens at navel level |
| Light | face a large window with indirect daylight, overhead lights off (or 2 identical diffused LEDs at ±45°) | even |
| Camera | portrait mode / beauty filters off; grid on; lock focus + exposure on the face | same |
| Time | same weekday, 60–90 min after waking, before food, caffeine or training | same |
| Prep | water rinse ≥ 30 min before, no makeup (or logged), glasses off, hair back for structure shots | same fitted shorts; no pump; don't suck in |
| Expression | lips lightly closed, brows relaxed, eyes to the lens | – |
| Head | ear canal level with lower eyelid (Frankfort horizontal) – the app checks pitch | march on the spot 5 s, then stand naturally |
| Logged per scan | facial-hair state, hours slept, alcohol last night, illness, setup used | same |

Shots: frontal neutral ×5 burst (grey card at chin), frontal smile ×5, 3/4 left + right ×3, profiles left + right ×3,
hairline (hair pushed back), crown from above (monthly), natural hair front + 3/4, skin zones at ~50 cm, side-light cheeks
(monthly), eye close-up, body front / side / back, outfits (monthly), voice (V3). ~20–25 min weekly.

Automatic quality checks on every frame: landmark confidence ≥ 0.9 · head yaw/roll ≤ 3°, pitch ≤ 4° · profile angle
85–95° · iris-pixel width within ±5 % of the personal baseline (same distance as last time) · face inside the central
50 % · sharpness (Laplacian variance) · < 1 % clipped highlights · grey-card white balance ΔE < 3 · neutral expression
(blendshapes) · burst agreement.

Tape + scale: morning, relaxed breath out, 3 readings → median. Weight: ≥ 3×/week, **only the 7-day average counts**.
**Calibration day:** 3 full captures with a complete re-setup between each → personal MDC per metric; changes below it
are reported as "no detectable change". The app never celebrates noise.

## 6. Privacy architecture (browser build)

* **Nothing leaves the device.** No accounts, analytics, telemetry or third-party requests. Photos and data live in the
  browser's IndexedDB on the user's phone. The host (GitHub Pages) only serves static code files.
* **Enforced, not promised:** strict `<meta>` Content-Security-Policy (`connect-src 'self'` – the page *cannot* call
  another origin), `referrer: no-referrer`, a runtime network guard that wraps fetch / XHR / WebSocket / EventSource /
  sendBeacon, a Settings "Privacy check" listing every origin the page loaded (must read exactly one), a CI source-lint
  that fails on third-party URLs, geolocation, analytics names and microphone use outside the presence module, and a
  build-output check of `dist/`.
* **Repo hygiene:** the repository is public (GitHub Pages on the free plan) but contains code only. A guard script and
  `.gitignore` block photos, video, audio, databases and backups from ever being committed; CI fails if one appears.
* **Image import** re-draws every image through a canvas and re-encodes it, which drops EXIF / GPS / XMP by
  construction; a byte check verifies no metadata markers remain; the original is never stored. (Milestone M1.)
* **ML runs on-device** (MediaPipe WASM models bundled in the app – no fetch from Google at runtime). (Milestone M1.)
* **Backups** are encrypted files (AES-GCM-256, PBKDF2-SHA256 600 000 iterations) the user saves manually; the app
  warns against iCloud Drive / Google Photos. This is also the only way to move data between devices.
* **iPhone specifics:** Safari deletes website data after 7 days unused unless the app is installed to the Home Screen
  (onboarding gates on this) and the app requests persistent storage.
* **Exception justified:** the only network use is the browser fetching this site's own files (and, once, the
  Pages-hosted service-worker update). No user data is ever part of any request.

## 7. Data model (IndexedDB via Dexie)

Present in M0: `profile` (single row "me": height, units, time budget, scan weekday, checklists – no name / email / DOB),
`whitelist` (the user's current stack; default empty; patch-test log), `audit` (privacy-relevant events), `kv`.
Added in M1+: `scan`, `photo` (re-encoded JPEG Blobs), `landmarks`, `measurement`, `score` (reason facts NOT NULL),
`overall`, `habit_log`, `calibration`, `plan_snapshot`. Every score records the rule, weight and model versions used,
so old scans can be recalculated when rules change.

## 8. Roadmap

| Milestone | Scope |
|---|---|
| **M0** | Scaffold; privacy lockdown; catalog (all metrics, sources, evidence, natural methods, bans); onboarding; whitelist manager; encrypted backup / restore; metric browser; CI + Pages deploy |
| **M1** | Camera with live guides + auto-burst; photo import with metadata strip; grey-card tap; on-device face landmarks; frontal metrics; scoring engine, confidence + refusals, reasons, tone linter, report |
| **M2** | Full weekly scan; manual landmark editor (profiles, posture); pose model; body (tape, Navy body fat, FFMI, ratios), posture, skin MVP, hair MVP, grooming checklists; calibration day + MDC |
| **M3** | Lever library; whitelist guard; safety caps; ranker (top 3); natural-methods pages; progress charts with MDC gating; weekly lock; light habit log |
| **V2** | Advanced skin, sclera / teeth colour, gum show, aligned photo compare, style module, haircut designer, app passcode |
| **V3** | Voice, eye-contact practice, trusted-rater pairwise mode, best-angle finder, averageness model |

## 9. Risks and limitations (stated plainly)

| Risk | Mitigation |
|---|---|
| 2D photo of a 3D face (jaw angle, chin projection) is approximate | manual landmarks, labelled "soft-tissue estimate", personal MDC |
| Close-range lens distortion (a selfie at 30 cm widens the nose ~30 %) | 1.5 m rule + iris-size distance check; refuse otherwise |
| Face model bias toward the average face / lighter skin in poor light | manual override, repeatability tests, bias stated in the report |
| Lighting + white balance wreck colour metrics | grey card mandatory for colour; refuse without it |
| Day-to-day noise (water, salt, sleep) | weekly cadence, 7-day weight average, MDC filter |
| Self-report bias | reference images; confidence capped at MEDIUM |
| Weights are judgement, not science | shown openly, editable, version-numbered |
| Western-biased norms | population caveats on every ideal; fixed traits get low weight |
| Navy body-fat error ±3–4 % | used for trends; consistent technique |
| Obsessive checking / body-dysmorphia risk | 1 full scan per week, trend focus, no comparison to others, floors on extreme targets |
| Empty whitelist caps some metrics | explicit "capped" notices – the owner's call |
| Phone / cloud leaks (camera-roll sync, screenshots, backups) | onboarding checklist; the app cannot enforce this |
| Medical issues mistaken for cosmetic ones | referral flags; the app never treats |
| Supply chain (packages, models) | lockfile; models bundled with pinned hashes; no runtime fetching |
