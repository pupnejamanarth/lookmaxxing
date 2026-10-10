# Unmoggable

A private appearance-measurement app for one person: you. It measures the parts of your appearance that you can
actually change (body fat, skin, hair, grooming, posture and so on), scores each one honestly with a stated reason,
and tracks your progress week by week.

It is a web app that you install on your iPhone like a normal app. **Nothing you photograph or type ever leaves your
phone.** There is no account, no server that receives your data, no analytics and no cloud AI. The scoring runs on the
phone itself.

- Open it here: <https://pupnejamanarth.github.io/lookmaxxing/>
- How it works in detail (metrics, scoring rules, limits): [docs/PLAN.md](docs/PLAN.md)

---

## 1. Open it on your iPhone

Do this once. You must use **Safari** (not Chrome, not an in-app browser).

1. Open Safari and go to **https://pupnejamanarth.github.io/lookmaxxing/**
2. Tap the **Share** button (the square with an arrow pointing up).
3. Scroll down and tap **Add to Home Screen**, then **Add**.
4. Close Safari. **Open the app from the new icon on your Home Screen** and do the first-run setup there.

Why the Home Screen step matters:

- Safari deletes the stored data of any website you have not opened for 7 days. Your scans, photos and scores are
  stored in the browser, so a week without opening the app in a normal Safari tab could wipe everything. An app
  installed to the Home Screen is exempt from that rule. The app also asks the phone to keep its storage permanently.
- The Home Screen app and Safari keep **separate** storage. Use only the Home Screen app. Anything entered in a Safari
  tab before installing will not be there afterwards.
- After the first open it works offline, because the app files are saved on the phone.

New versions install themselves: the next time you open the app with a connection, it picks up the latest build. Your
data is not touched by an update.

Each browser keeps its own separate data, and there is deliberately no sync. To move data between your iPhone and a
laptop, use a backup file (section 4).

---

## 2. The privacy promise, and how it is enforced

The promise:

- No photo and no personal data ever leaves the device.
- No request to any website other than the one serving the app.
- No analytics, telemetry or crash reporting. No third-party scripts, fonts, CDNs or APIs.
- The app stores no name, email, date of birth or location.
- Test data in this repository is synthetic only. No real person's photo is used anywhere.

A promise is only worth something if the code cannot break it by accident, so it is enforced in layers:

| Layer | What it does |
|---|---|
| Content-Security-Policy (`config/csp.ts`) | Built into the page. The browser refuses any connection except to the app's own address (`connect-src 'self'`), and refuses scripts, fonts, images and frames from anywhere else. A forgotten tracker or CDN link simply fails to load. |
| No referrer | The page never tells another site where you came from. |
| Runtime network guard (`src/privacy/netGuard.ts`) | Wraps `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` and `sendBeacon` and refuses anything that is not the app's own origin. Second line of defence behind the policy above. |
| Privacy check in Settings | Lists every origin the page has loaded anything from. It must always show exactly one: the app itself. |
| Source lint (`tests/unit/source-lint.test.ts`) | Fails the build if the code contains a third-party URL, location access, analytics, or microphone use where it does not belong. |
| Build output check (`scripts/check-dist-privacy.mjs`) | After every build, verifies the policy is really in the built page, scans every built file for web addresses, and fails on any host that is not on a short reviewed list (`scripts/dist-url-allowlist.json`: a handful of harmless text strings that libraries contain, such as XML namespace names and links inside error messages). It also checks that the offline file list only names the app's own files. |
| Personal-files guard (`scripts/check-no-personal-files.mjs`) | The repository is public, so it must never hold photos, video, audio, databases or backup files. This fails the build if any appear. `.gitignore` blocks them too. |
| Photo clean-up | Every image is redrawn on a canvas and saved again, which removes location and camera metadata by construction. The original is never stored. |
| Not indexed | `robots.txt` and a `noindex` tag ask search engines to stay away. This only stops search listings; it does not hide the address. |

Be clear about what is and is not covered:

- GitHub serves the app's files, so like any website it sees ordinary request logs (your IP address and browser) when
  you open or update the app. It never receives anything you entered, because no such request exists.
- The repository is public because GitHub Pages needs that on a free plan. Only code is public. Your data lives
  only in the phone's browser storage and is never part of the repository.
- The app cannot control the rest of your phone. If iCloud Photos is syncing your camera roll, photos taken with the
  normal Camera app are synced regardless of this app. Turn that off for the scanning period, delete source photos
  after importing them, and be careful with screenshots. The first-run checklist in the app covers this.

---

## 3. One-time GitHub setup

You do this once, on the GitHub website or app. No terminal.

1. **Make the repository public.** Repository, then **Settings, General**, scroll to **Danger Zone**,
   **Change visibility**, **Make public**. (Free GitHub Pages only works for public repositories. This makes the code
   public, not your data.)
2. **Turn on Pages.** **Settings, Pages**. Under *Build and deployment*, set **Source** to **GitHub Actions**.
3. **Let it deploy.** Every push to `main` (and to the working branch `claude/optimistic-goldberg-9ajv5q`) runs the
   **Deploy to GitHub Pages** workflow. Watch it in the **Actions** tab. When it shows a green tick, the link in the
   first section is live.
4. **Only if the first deploy is blocked** by a branch rule: **Settings, Environments, github-pages,
   Deployment branches and tags**, and add the branch (for example `claude/*`, or `main`). Then open the failed run
   in the Actions tab and choose **Re-run all jobs**.

You can also start a deploy by hand: **Actions, Deploy to GitHub Pages, Run workflow**.

The deploy only goes ahead if the safety checks pass (privacy guard, type check, lint, unit tests, build, build output
privacy check). A separate **CI** workflow runs on every push and pull request and additionally runs the browser
tests.

---

## 4. Backups

Your data exists only on the phone. Lose or reset the phone, or clear the app's data, and it is gone, so make
backups.

- In the app, **Settings, Backup** creates a file ending in **`.lmxbackup`**. It contains everything: scans, photos,
  scores, settings.
- The file is **encrypted** with a passphrase you choose (AES-256-GCM, with the key derived from your passphrase using
  PBKDF2-SHA256 at 600,000 rounds). Without the passphrase it cannot be opened, by anyone, including you. **There is no
  way to recover a forgotten passphrase.**
- **Restore** in the same Settings screen reads a `.lmxbackup` file back in. This is also how you move your data from
  the iPhone to a laptop browser or to a new phone.
- The app reminds you weekly.

Where to keep the file:

- **Do not** save it in **iCloud Drive** or **Google Photos** (or any other cloud sync folder). The point of the app is
  that your data stays on your own devices. Encrypted or not, do not hand it to a cloud service.
- Do keep a copy somewhere you control: save it to **Files, On My iPhone**, and copy it to a computer or a USB drive
  you own (AirDrop to your own Mac works).
- Never put a `.lmxbackup` file or any photo in this GitHub repository. The guard script would fail the build if you
  tried.

---

## 5. What is measured, and how honest the scores are

The app measures what you can change: body fat and body shape, skin, hair, grooming, posture, and parts of the face
that respond to leanness, grooming and habits. Fixed traits (height, bone structure) are shown honestly but are kept
out of the action plan. Every metric has a stated range, source, weight and an evidence grade, and you can browse them
in the app.

What to expect:

- Scores are **brutal but evidence-based**. Every score comes with the specific measurement behind it. There is no
  score without a reason, and no rounding up or softening.
- Every score shows a **confidence level**. When the photo angle, lighting or distance makes a measurement unreliable,
  the app **refuses to score it** and tells you exactly how to re-capture, instead of guessing.
- A 2D photo of a 3D face is an **estimate**. Scores are best read as trends over weeks, and the app learns how much
  your own measurements wobble so it does not report noise as progress.
- The weighting between metrics is a judgement, not settled science. It is shown openly so you can see what drags the
  total down.
- It never treats medical problems. If something looks like a health issue it says to see a professional.

The full methodology, capture protocol, data model and a plain list of risks and limits are in
[docs/PLAN.md](docs/PLAN.md).

---

## 6. For developers

Needs Node 22.12 or newer.

```sh
npm ci               # install exactly what package-lock.json says
npm run dev          # local dev server
npm run check        # privacy guard + typecheck + lint + unit tests (run this before pushing)
npm test             # unit tests only (Vitest)
npm run test:e2e     # browser tests (Playwright; builds and serves the app first)
npm run build        # typecheck, then production build into dist/
npm run preview      # serve dist/ at http://localhost:4173/lookmaxxing/
node scripts/check-dist-privacy.mjs   # run after a build; same check CI and deploy run
node scripts/make-icons.mjs           # re-render the app icons into public/icons/
```

Notes:

- First time running the browser tests on a fresh machine: `npx playwright install chromium`. In the cloud sandbox a
  Chromium is already installed; point `CHROMIUM_PATH` at a different one if needed.
- Do not add dependencies casually. Every package is code that runs on a page holding private photos.
- The site is served from `/lookmaxxing/` (see `BASE` in `vite.config.ts`), which is why local URLs have that path.

### Folder map

```
index.html                     page shell; the build injects the Content-Security-Policy meta tag here
vite.config.ts                 build + PWA (offline, home-screen install) settings
config/csp.ts                  the one definition of the Content-Security-Policy
docs/PLAN.md                   methodology, scoring rules, privacy architecture, roadmap, limits
docs/catalog-seed.md           the original draft of the metric catalog
public/                        copied as-is into the build: icons/, robots.txt (later: bundled ML models + SHA256SUMS)
scripts/
  check-no-personal-files.mjs  guard: fails if photos, backups or databases would be committed
  check-dist-privacy.mjs       post-build check: policy present, no third-party URLs, offline list is local
  dist-url-allowlist.json      the short reviewed list of harmless URL strings the build check accepts
  make-icons.mjs               renders the app icons with Chromium
src/
  main.tsx                     app entry
  types.ts                     shared domain types
  catalog/                     the metric catalog: ranges, weights, sources, evidence grades
  privacy/                     runtime network guard and the origin audit behind the Privacy check
  store/                       on-device database (IndexedDB via Dexie)
  ...                          screens, capture, vision, metrics, scoring and planning folders arrive with later
                               milestones (see the roadmap in docs/PLAN.md)
tests/
  unit/                        Vitest tests (synthetic data only)
  e2e/                         Playwright tests
  fixtures/                    synthetic test fixtures; the only place besides public/icons/ where image files may live
.github/workflows/
  ci.yml                       every push and pull request: all checks plus browser tests
  deploy.yml                   publishes to GitHub Pages from main and the working branch
```

Stack: Vite, React, TypeScript (strict), Dexie (IndexedDB), zod, Vitest, Playwright.
