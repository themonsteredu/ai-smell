# 마음의 향기 타로 — notes for Claude sessions

Classroom web app for Korean students (초3–중3): emotion color → topic → draw 3 tarot cards → reading + up to 3 AI follow-up questions → scent recommendation (then an offline blind smell test).
The owner (학원 원장님) is not a developer. Write owner-facing text in plain Korean, student-facing copy in short 해요체.

## Stack (no build step — keep it that way)
- Static files served by Vercel project `ai-smell`, deployed from GitHub. `api/*.js` = Vercel serverless functions (CommonJS).
- `index.html` — app shell: CSS + the inline app script. Load order: `content.js` → `safety.js` → `prompts.js` → inline script.
- `content.js` — **all lesson content**: cards (`ko`, `img`, `up`, `down`, `scent`, `hidden`), topics, colors, roles, `COLOR_MEANING`, moods/scents, `COVER_TITLE`, image paths. UMD: `window.CONTENT` in the browser, `module.exports` for `api/*.js` (`require('../content.js')`) and tests.
- `safety.js` — child-safety check, shared by app and API. `Safety.check(text)` → `{cat:'self_harm'|'sexual'|'abuse'|'bullying'|'danger'}` or `null` (normalizes: NFC, lowercase, strips spaces/punctuation/zero-width, collapses 3+ repeats; a `SCRUB` list blanks benign look-alikes such as 과자 살래 / 수학 대회 / 때려치우다 first). Also `redact()` (phone/email/6+ digit runs), `HELP` / `HELP_TEXT` (help-card copy + 1388/109/117/112), `MARKER` `[도움필요]`, `hasMarker()`. **No regex lookbehind** (older iPad Safari can't parse it; a test enforces this).
- `prompts.js` — the only place for AI prompts: `SAFETY_BLOCK` (always first), `QA_SYSTEM`, `firstTurn(ctx, q)`, `buildMessages(ctx, history, q)`, `ASK_LIMIT`, `HISTORY_MAX`, `QA_MAX_TOKENS`. `ctx = {topic, color, cards:[{ko, rev}], reading?}`; card meanings are looked up in content.js. Used by index.html (`window.Prompts`) and api/ask.js (`require('../prompts.js')`).
- `api/ask.js` — optional server path for follow-up questions. Works only if `ANTHROPIC_API_KEY` is set in Vercel (today it is NOT → returns `NO_KEY`). The main AI path is the teacher's device key (Settings, stored in localStorage) calling `api.anthropic.com` directly — owner's explicit choice, do not remove.
  Body: `{topic, color, cards:[{ko,rev}]×3, question, history:[{role:'user'|'assistant', content}]}` (history = earlier AI-answered Q/A only, alternating, ≤6, user ≤300 / assistant ≤1500 chars). Order: 405 → same-origin (403) → 8KB cap (413) → safety (`SAFETY` + help text, no upstream call) → strict validation (400) → `LIMIT` → `NO_KEY` → upstream with a 15s timeout. Reasons: `OK NO_KEY LIMIT RATE BUDGET TIMEOUT SAFETY API_ERROR`. Never trust client reading/meaning text: the first turn is rebuilt from content.js.
- Models: only `claude-haiku-4-5` (default) and `claude-sonnet-5-5`. `normModel()` in index.html maps any saved legacy value to one of them.
- `vercel.json` — function config, security headers (CSP needs `'unsafe-inline'` for the inline script and `onclick` attributes; `connect-src` includes `https://api.anthropic.com` for the device-key path), 1-week cache for `/cards/*` and `/fonts/*`.
- `.vercelignore` — `tests/`, `*.md`, `*.zip`, `.github/` are not deployed. Never ignore `content.js` / `safety.js` / `prompts.js` (the API bundles them).

## Tests
- `node --test tests/` — unit tests: `content.test.js`, `safety.test.js` (≥25 must-fire, ≥15 must-not-fire phrases — add a case whenever a rule changes), `prompts.test.js`, `api-ask.test.js` (stubbed `fetch`, fake req/res). `tests/index.js` loads every `tests/*.test.js` (Node 22 treats a bare `tests/` as a module path, so this entry file is required). New test files only need the `.test.js` suffix.
- `node tests/smoke.cjs --base http://localhost:8091/` — Playwright walk-through (cover → scent at 390×844 and 1366×768, fails on any page/console error or a hidden-card image) plus one safety walk per size (crisis note/question → help card with no network call, long-press 선생님 확인, server SAFETY/RATE, redraw keeps the question count, key not echoed, AI off). Serve the repo first: `npx http-server . -p 8091 -s -c-1`. Also works against a Vercel preview URL.

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
- Every user-controlled string that reaches `innerHTML` goes through `esc()`; AI and student text goes in with `textContent` (the note textarea is filled with `.value`).
- Safety first: `Safety.check` runs on the note when pressing 카드 펼치기 (`next()` at step 1) and on every chat question **before** the question-limit check and before any network call. A hit (or an AI reply with `[도움필요]`, or server reason `SAFETY`) calls `raiseFlag(cat, from)`: sets `state.flag={cat,from}`, logs only a timestamp to localStorage `maum_tarot_flags` (`{log:[ms…], seen:ms}`), and `render()` shows `helpScreen()` instead of any step. While `state.flag` is set, `next/prev/restart/redraw/start/ask` do nothing and the menu hides 처음 화면. A 1.5 s long-press on `#teach` (`holdBtn`) → `teacherOk()` (marks the log seen) → `endFlag(false)` resume (clears a flagged note) or `endFlag(true)` restart. `body.flagged` (red crest) = flag active or unseen log entries; explained only in 도움말.
- Privacy: the note is never echoed (makeReading only checks whether it exists), never sent to the AI, never stored. Questions are `Safety.redact`ed before they are shown and sent. The chat shows a fixed notice under the divider and source tags on bubbles (`src`: `ai` AI 답변 / `local` 준비된 답변 / `info` 안내).
- AI calls: `callClaude(key, model, {system, messages, max_tokens})` always gets messages explicitly (연결 확인 sends one `안녕` with max_tokens 10); the model is always `normModel()`-ed. `cfg.aiOff` (Settings → AI 기능 끄기) hides the chat and skips every AI call. `chatHistory` holds only AI-answered `{role,content}` pairs; local answers are not added. `askCount` is per student: `clearDraw()` keeps it, only `restart()` resets it. A failed AI path shows `AI_DOWN` once (NO_KEY stays silent).

## Recommendations for the owner (not done — owner decisions)
- Make the GitHub repo **private** (Vercel deploys from private repos). Note `files (3).zip` was removed from the tree but still exists in git history.
- Turn on branch protection for `main` (changes only through PRs).
- Add GitHub Actions CI that runs `node --test tests/` and the smoke test on every PR.
- Show the deployed version in the menu via a tiny `api/version.js` (`VERCEL_GIT_COMMIT_SHA`, `VERCEL_ENV`).
- If `ANTHROPIC_API_KEY` is ever added in Vercel, scope it to Production only so previews cost nothing.
