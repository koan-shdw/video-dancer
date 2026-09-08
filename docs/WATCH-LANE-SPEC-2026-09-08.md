# The WATCH lane — Gemini Flash sees takes (spec, 2026-09-08)

Director's call 2026-09-08: "def gemini flash so we can also wire into the score composer too."
Source: the August cohort call — he wired Gemini Flash into Night Shift so Claude hands
it a clip and gets back what happens in it ($1.75 spent so far, $50 lasts months). Ours is
blind to takes today: the Co-Director reads images only; Score composes from clip TEXT.

Status: DRAFT for approval. No code until GO. One shared lane (bible ch. 12 law: one copy),
two readers.

## 1. What exists (verified 2026-09-08)

- No Google key anywhere in the app. Settings → API card is a stack of supplier rows (fal,
  Higgsfield, ModelArk, Astria, Anthropic…) — a new row copies that grammar.
- Score compose (`src/main/scoreCompose.ts`): one TEXT digest per shot via `runSubCalls`
  (cheap tier), then one synthesis pass. A shot's take video is never looked at.
- Co-Director: `show_on_screen` puts a take on the Room's screen for the USER; he himself
  never sees it. The API engine ships images as base64 blocks; the bridge engine Reads image
  files. Neither can take video.

## 2. The lane — `src/main/watch.ts`

`watchVideo(file, question, opts): Promise<{ ok, text?, error?, tokens? }>`
- Google AI Studio Generative Language API, model `gemini-2.5-flash` (his "whatever their
  latest Flash"). Key = `Settings.googleKey`.
- Files ≤ 20 MB ride inline (base64 in the request — a 15s 720p take is ~5–15 MB); bigger
  files go through the Files API (upload → poll ACTIVE → reference by URI → delete after).
- One question in, one answer out. Default question when none is given: *"Describe exactly
  what happens, second by second: subjects, motion, camera, cuts, lighting, and the sound.
  Then name anything that looks wrong — jitter, warped limbs, identity drift, a frozen
  frame, a bad cut."*
- Transport hardening = the sub-call shape (retries on 429/5xx, 90s watchdog, abort).
- Cost line: Gemini bills per token; a 15s clip ≈ 4k–8k input tokens. The result carries the
  token count so the callers can show it (the Queue/usage grammar). Nothing runs without the
  key; the row in Settings says "not set".

### 2b. The fallback — no Google key → frames → Claude (director: "if no gemini then we'll use claude")

- `watchVideo` with no `googleKey` pulls 4–12 stills off the take (one per second-ish, centred
  in their slots, ffmpeg) and hands them to Claude — the Anthropic key on the API engine, or a
  bridge one-shot that Reads the frame files on the bridge engine. The model = the
  Co-Director's own. The result is marked `via: 'frames'` and the prompt tells him he is
  seeing stills: no motion, no sound, say so, invent neither.
- Nothing set at all (no Google, no Anthropic, no bridge) → an honest error naming Settings.
- Temp frames are deleted after the call.

### 2c. The GEM chip (director 2026-09-08: "he has the API showing the credits in gemini for the
watch, we want that in there — there's a fal one already, so watch that grammar")

- Google exposes no balance for AI Studio keys, so the chip is his "$1.75" counter: every
  Gemini watch lands in the project's spend ledger as kind `watch` (label "watch · KATA T2" or
  "watch · <shot> (compose)"), cost = tokens × Gemini 2.5 Flash list price ($0.30 / M tokens —
  an ESTIMATE, constant in watch.ts). Top bar shows `GEM ≈$0.02` beside `FAL $…` whenever a
  Google key is set; click opens aistudio.google.com/usage. Refreshes after every exchange.
  BUILT 2026-09-08, UNTESTED.

## 3. Reader 1 — the Co-Director: `watch_take`

- New READ-ONLY tool (both engines): `watch_take { clip_id, take?: number, question? }` →
  the watch text. No go-gate (it's a read). Default take = keeper.
- Guide line (statute-era wording): *"You cannot see video yourself. Before you judge a
  take — 'how's the render', 'did it drift', 'is the cut clean' — call watch_take and quote
  what it saw. Never guess a render from its prompt."*
- The Room: a watched take's answer lands in the conversation like any tool result; the
  usage line counts its tokens.

## 4. Reader 2 — Score compose

- Per-shot digest: when the key is set AND the shot has a take, the digest prompt is fed the
  WATCH text of that take (motion, tempo, mood, cuts, sound) instead of — not alongside —
  the recipe text. No key / no take → today's text digest, unchanged.
- The synthesis pass is untouched; it just gets better digests.
- Cost: N watches per compose (N ≤ COMPOSE_CLIP_CAP = 20). The compose card's cost face
  shows the watch spend estimate before the press (the Clip Gen price grammar).

## 5. Settings

- API card gains a supplier row **Google AI (Gemini)**: key field + "test key" (one cheap
  `models.list` call) + the ● / ○ status chip, exactly like Higgsfield's row.
- `Settings.googleKey`.

## 6. Acceptance

1. Key row saves, test key passes/fails honestly.
2. Co-Director: "how's the latest render of KATA?" → he calls watch_take → his answer quotes
   motion/cuts/sound that are actually in the video (director checks against the take).
3. Score compose on a clip with takes → digests mention what's on screen, not just the
   recipe; without a key the old path runs unchanged.
4. A > 20 MB take goes through the Files API and cleans up after itself.
5. Token counts show on the usage line / cost face.

## 7. Settled (director, 2026-09-08 — "how is it done?" → Flash, on ask)

1. Model: `gemini-2.5-flash`.
2. On ask only — the Co-Director watches when he needs to; nothing runs on its own.
3. Cutroom later rides on this — noted, not in scope. Build GO given.
