# 마음의 향기 타로 — notes for Claude sessions

Classroom web app for Korean students (초3–중3): emotion color → topic → draw 3 tarot cards → reading + up to 3 AI follow-up questions → scent recommendation (then an offline blind smell test).
The owner (학원 원장님) is not a developer. Write owner-facing text in plain Korean, student-facing copy in short 해요체.

## Stack (no build step — keep it that way)
- Static files served by Vercel project `ai-smell`, deployed from GitHub. `api/*.js` = Vercel serverless functions (CommonJS).
- `index.html` — app shell: CSS + the inline app script. Load order: `content.js` → (`safety.js` → `prompts.js` when added) → inline script.
- `content.js` — **all lesson content**: cards (`ko`, `img`, `up`, `down`, `scent`, `hidden`), topics, colors, roles, `COLOR_MEANING`, moods/scents, `COVER_TITLE`, image paths. UMD: `window.CONTENT` in the browser, `module.exports` for `api/*.js` (`require('../content.js')`) and tests.
- `api/ask.js` — optional server path for follow-up questions. Works only if `ANTHROPIC_API_KEY` is set in Vercel (today it is NOT → returns `NO_KEY`). The main AI path is the teacher's device key (Settings, stored in localStorage) calling `api.anthropic.com` directly — owner's explicit choice, do not remove.
- Models: only `claude-haiku-4-5` (default) and `claude-sonnet-5-5`. `normModel()` in index.html maps any saved legacy value to one of them.
- `vercel.json` — function config, security headers (CSP needs `'unsafe-inline'` for the inline script and `onclick` attributes; `connect-src` includes `https://api.anthropic.com` for the device-key path), 1-week cache for `/cards/*` and `/fonts/*`.
- `.vercelignore` — `tests/`, `*.md`, `*.zip`, `.github/` are not deployed. Never ignore `content.js` / `safety.js` / `prompts.js` (the API bundles them).

## Tests
- `node --test tests/` — unit tests. `tests/index.js` loads every `tests/*.test.js` (Node 22 treats a bare `tests/` as a module path, so this entry file is required). New test files only need the `.test.js` suffix.
- `node tests/smoke.cjs --base http://localhost:8091/` — Playwright walk-through (cover → scent at 390×844 and 1366×768, fails on any page/console error or a hidden-card image). Serve the repo first: `npx http-server . -p 8091 -s -c-1`. Also works against a Vercel preview URL.

## Release process (반영 절차)
1. Work on a branch; never commit straight to `main`.
2. Push the branch → Vercel builds a **Preview URL**. Run the smoke test against it.
3. Send the owner the preview URL. Merge to `main` (= live site) **only when the owner says “반영”**.

## Hidden cards
연인(06) · 악마(15) · 별(17) · 태양(19) · 심판(20) · 세계(21) have `hidden: true` in `content.js` because the art shows nudity. `deckPool()` excludes them and every draw path uses it.
To re-enable one: upload clothed art under a **new filename** (e.g. `cards/06-v2.jpg` — `/cards` is cached for a week, so overwriting in place keeps old art on devices), point `img` at it, delete `hidden: true`, remove it from the hidden list in `tests/content.test.js`, run the tests.

## Invariants — do not break
- Privacy: a reload or 처음부터/처음 화면 must never bring back the previous student. No sessionStorage/history state restore; never store student-written text in localStorage.
- `clearDraw()` bumps `gen` and cancels timers. Draw-step animations use `later(fn, ms)` (dropped if `gen` changed; also cancelled when leaving step 2). Any async work (AI calls) must capture `gen` first and drop its result if `gen` changed.
- Navigation (`next/prev/restart/redraw/start/drawBack/toReading`) is debounced by `navOk()` (450 ms) so double taps can't skip steps.
- Every user-controlled string that reaches `innerHTML` goes through `esc()`; AI and student text goes in with `textContent`.

## Recommendations for the owner (not done — owner decisions)
- Make the GitHub repo **private** (Vercel deploys from private repos). Note `files (3).zip` was removed from the tree but still exists in git history.
- Turn on branch protection for `main` (changes only through PRs).
- Add GitHub Actions CI that runs `node --test tests/` and the smoke test on every PR.
- Show the deployed version in the menu via a tiny `api/version.js` (`VERCEL_GIT_COMMIT_SHA`, `VERCEL_ENV`).
- If `ANTHROPIC_API_KEY` is ever added in Vercel, scope it to Production only so previews cost nothing.
