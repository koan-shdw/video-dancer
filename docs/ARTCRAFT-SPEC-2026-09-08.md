# ARTCRAFT — one key, API lane + Bridge row

Date: 2026-09-08 · Status: SPEC FOR REVIEW — no code until approved. Written while other
sessions hold the app; build waits until they wrap (his order 2026-09-08).
Owner brief (his words): "lets scope this into it too · app.getartcraft.com/pricing · same
questions" — same shape as VENICE-SPEC-2026-09-08.md: direct-key provider + Bridge key row +
VIA rows. Copy the Venice sibling, change the nouns.

Decisions carried from the Venice round (2026-09-08), assumed to hold here unless he says
otherwise (§9): Seedance 2 + 2.5 only · bitrate high always · keep the fast twin as a visible
VIA row. Co-Director lane: NOT possible — Artcraft's API serves no text models.

---

## 1. Artcraft facts (read 2026-09-08 — github.com/storytold/artcraft at HEAD, `_docs/omni_api/artcraft_omni_api.md`, app.getartcraft.com/pricing)

- Artcraft = Storyteller.ai's open-source Tauri desktop app. Its backend is
  `https://api.storyteller.ai` (their docs: "not a typo"). Full API reference:
  storyteller-docs.netlify.app.
- Plans (20% off yearly): Basic $10 → 1,000 credits/mo · Pro $35 → 3,750 · Max $60 → 6,600.
  **100 credits = $1** (their cost code: "credits = cents"). One wallet: subscription credits
  are what the API spends. Credit kinds: free / monthly / banked, summed.
- **Omni API** = the API-key surface. Key `artcraft_api_` + 40 chars (53 total), sent as
  `Authorization: Bearer …`, cookies ignored. Made at app.getartcraft.com → Account →
  Settings → API Keys. **Gated: "your account must have API keys enabled from our staff —
  contact the Artcraft team."** Nothing lights until he has a key.
- Endpoints (all key-authed):
  - `POST /v1/omni_api/generate/video` → `{inference_job_token, all_job_tokens}`.
  - `GET /v1/omni_api/job_status/job/{token}` · `GET …/job_status/batch?tokens=…` →
    `state.status.status` ∈ pending | started | attempt_failed (keep polling) |
    complete_success | complete_failure | dead | cancelled_by_user | cancelled_by_system
    (terminal); `state.status.progress_percentage` 0–100 (REAL progress — bible 12.5);
    result at `state.maybe_result.media_links.cdn_url` (.mp4).
  - `POST /v1/omni_api/upload/image | video | audio` — multipart, field `file`, limit
    512 MiB → `{media_file_token}`. Local files go up here, no hosting needed.
  - Request body: `model, prompt, negative_prompt, idempotency_token (fresh UUID, REQUIRED),
    duration_seconds (int), resolution, aspect_ratio, bitrate ('normal'|'high'), quality
    ('high'|'medium'|'low'), generate_audio (be explicit), video_batch_count,
    start_frame_image_media_token, end_frame_image_media_token,
    reference_image_media_tokens[], reference_video_media_tokens[],
    reference_audio_media_tokens[]` (each has a `_url` twin — mutually exclusive; we use
    tokens), `reference_character_tokens[]` (their Characters, `@Name` in prompt — not ours).
  - Enum words (snake_case): resolution `four_eighty_p | seven_twenty_p | ten_eighty_p |
    four_k`; aspect `auto | square | wide_sixteen_by_nine | tall_nine_by_sixteen |
    wide_four_by_three | tall_three_by_four | wide_twenty_one_by_nine | …`.
  - Errors: 400 bad field/type (mp4-only video refs, jpeg/png/gif/webp images), 401 bad key
    or banned, 402 out of credit.
- Models (CommonVideoModel): `seedance_2p0`, `seedance_2p0_fast`, `seedance_2p5` (+ 2.0
  "ultra/bp/mini" internals we ignore), `kling_3p0_pro/standard`, `kling_2p6_pro`, `veo3…`,
  `sora_2/_pro`, `minimax_h3…`, `flux_3`, `happy_horse_1p0`, grok video.
  `GET /v1/omni_gen/models/video` returns per-model caps (refs max, keyframes, t2v…) — its
  auth (key vs web session) is OPEN; probe tries it.
- Seedance 2.0 caps (their own multi-function def): duration 4–15, 480p/720p/1080p (+4k in the
  omni cost code), aspect 16:9 9:16 1:1 4:3 3:4, refs images/videos/audio (counts not stated
  → fal's 9/3/3 assumed until the models endpoint says otherwise). 2.5: duration 4–30,
  480/720/1080, bills reference-video input seconds too.
- **Cost, from their cost code (dated 2026-09-08, `artcraft_router/…/seedance_2p0/cost.rs`,
  `seedance_2p5/cost.rs`), ¢/s = credits/s:**
  2.0 → 480p 7.77 · 720p 18.5 · 1080p 46.6; with a video ref 8.81 · 22.05 · 51.1 · 4k 113.8.
  2.5 → 480p 11.77 · 720p 26.71 · 1080p 45.86 (rounded up per clip; input video seconds add).
  Only provider besides Venice with an honest $/s — it goes in `pricePerSec`.
- Seed: none. Person/face policy: none found in the docs or code. Cancel: no omni cancel
  endpoint documented — OPEN. Job lifetime server-side — OPEN.
- Balance over the key: `/v1/credits/session` is web-session-only in the handler → **no
  proven key balance read.** OPEN; probe tries it with the key anyway.
- MCP: server has `/v1/mcp/session/*` token plumbing but NO MCP server (no tools/list
  anywhere in the repo). Not a Bridge login door. Their app also does BYO fal keys — the
  reverse direction, irrelevant to us.

## 2. Settings (copy the Venice/Astria sibling)

- `Settings.artcraftKey?: string` — comment: Artcraft Omni API key (app.getartcraft.com →
  Account → Settings → API Keys; enabled per account by their team) — Seedance 2/2.5 on plan
  credits.
- `SECRET_KEYS` gains `'artcraftKey'`.
- SettingsModal · "api suppliers": row after Venice —
  `supplierHead('Artcraft — Seedance 2/2.5 on plan credits', …)` ·
  `field('Artcraft API key', 'API keys are switched on per account by their team · one key also feeds the Bridge row', …, 'paste Artcraft key', 6)` ·
  `testRow(… vd().artcraftValidate …, 'authenticated no-op against api.storyteller.ai — checks the key, never spends credits', 'https://app.getartcraft.com/', 'opens Artcraft — API keys live under Account → Settings → API Keys')`.
  Counter `n/6 connected`. `initial`/`want` + App.tsx `keysSet` gain `artcraft`.
- IPC `artcraft:validate` / `artcraftValidate` (preload + env.d.ts). Validate =
  `GET /v1/omni_api/job_status/batch` with no tokens — key-authed, returns an empty list,
  spends nothing (handler read 2026-09-08). 401 → "key rejected — check the Artcraft API key
  (and that their team enabled API access on your account)".

## 3. Registry (shared/models.ts)

`provider` union gains `'artcraft'`; `EngineId` gains `'seedance2artcraft' |
'seedance2artcraftfast' | 'seedance25artcraft'`.

```
seedance2artcraft: {
  id: 'seedance2artcraft', label: 'Seedance 2 (Artcraft)', provider: 'artcraft',
  modes: ['ref2v', 'i2v'], endFrame: true,
  maxRefImages: 9, maxRefVideos: 3, maxRefAudios: 3, characterRefs: 0,   // fal counts until their models endpoint says otherwise
  durations: ['4'..'15'], resolutions: ['480p','720p','1080p','4k'],
  aspectRatios: ['auto','16:9','9:16','1:1','4:3','3:4','21:9'],
  audioToggle: true, seed: false,
  endpoints: { t2v: 'seedance_2p0', i2v: 'seedance_2p0', ref2v: 'seedance_2p0' },
  pricePerSec: { '480p': 0.078, '720p': 0.185, '1080p': 0.466, '4k': 1.138 },   // their cost.rs 2026-09-08; video refs cost ~+15% (queue estimate notes it)
  notes: 'Seedance 2 via Artcraft: needs an Artcraft key (Settings; their team enables API access) · no seed · refs upload to your Artcraft account · bills plan credits at 100/$.'
}
seedance2artcraftfast: same, label 'Seedance 2 (Artcraft fast)', resolutions ['480p','720p'],
  endpoints seedance_2p0_fast, pricePerSec OPEN (their fast cost table not read — blank
  until the probe quotes it), notes "faster, lower tier — the plain Artcraft row is the
  quality pick".
seedance25artcraft: label 'Seedance 2.5 (Artcraft)', durations ['4'..'30'],
  resolutions ['480p','720p','1080p'], refs 30/10/10 (2.5 family, same caveat),
  endpoints seedance_2p5, pricePerSec { '480p': 0.118, '720p': 0.267, '1080p': 0.459 }.
```

Prompt ref grammar: Artcraft has NO positional tag syntax for our refs (their `@Name` is their
Characters feature). New `refTagPrompt: 'none'` — compile strips `@imageN/@videoN/@audioN`
tags to plain words ("image 1" → the ref description stays in the prose). Whether their
Seedance honours slot ORDER is OPEN (probe gate 5).

## 4. Adapter — `src/main/providers/artcraft.ts` (bible 12.11, ModelArk sibling)

- `runArtcraftRender(opts)`: opts = RenderRequest + `artcraftKey`, `artcraftModel`
  (endpoints[mode]; zero-ref ref2v = t2v, house rule), `outDir`, `onProgress`, `onRequestId`.
- Uploads first: every local ref → `POST /v1/omni_api/upload/{image|video|audio}` (multipart
  `file`) → media token. Cache token per (path, size, mtime) like fal.storage's cache — re-rolls
  don't re-upload. Videos must be mp4 (else 400) — our window-cut refs already are.
- Body: `model, prompt, negative_prompt, idempotency_token: randomUUID(), duration_seconds:
  int, resolution: <enum word>, aspect_ratio: <enum word> ('auto' stays 'auto'),
  bitrate: 'high', quality: 'high'` (highest-quality law), `generate_audio: opts.generateAudio`
  (explicit — their docs warn defaults differ), `video_batch_count: 1`, keyframe/ref tokens by
  mode. `endUserId` has no field — not sent.
- Submit → `inference_job_token` → `onRequestId(token, model)` → poll single-job status every
  3s, 5-failure tolerance, 45-min deadline; `progress_percentage` drives the queue pct;
  `complete_success` → `cdn_url` → `downloadTo`. Terminal failures → their words +
  `maybe_failure_category`. 402 → "out of Artcraft credit — top up on getartcraft.com".
- `cancelArtcraftJob` = stops our wait (no remote cancel documented; add if the probe finds
  one). `fetchArtcraftResult(token, key, outDir)` → done | running | gone (provider tag
  `'artcraft'`, index.ts recovery branches). `validateArtcraftKey` = §2.
- Error grammar: `error (status) @ artcraft/<where>: detail — hint :: sent fields: …`.
- index.ts dispatch: `provider === 'artcraft'` key guard + run branch beside Venice.

## 5. VIA (lib/engineOptions.ts)

- seedance2: `{ id: 'seedance2artcraft', via: 'Artcraft' }` then
  `{ id: 'seedance2artcraftfast', via: 'Artcraft (fast)' }`, after the Venice rows. Quality
  row first (engineForFamily lands on it).
- seedance25: `{ id: 'seedance25artcraft', via: 'Artcraft' }` after Venice.

## 6. BRIDGE row (key row — Venice grammar, second key-row service)

- `BridgeServiceId` gains `'artcraft'`; services.ts entry `{ id:'artcraft', label:'Artcraft',
  mcpUrl:'', site:'https://app.getartcraft.com/', kind:'video', creditUnit:'credits',
  auth:'key' }`.
- Row: logo `assets/bridge/artcraft.png`, SHORT `ARTCRAFT`. `loggedIn` = key saved; `set
  key` / `settings` buttons open Settings (Venice grammar). Balance: OPEN — until a key-authed
  credit read is proven the row shows `n/a` with tooltip "Artcraft doesn't expose balance to
  API keys yet"; the pool bar skips it (unknown ≠ empty; router still tries it last).
  If the probe proves `/v1/credits/session` answers a key: `balance = sum_total_credits`,
  `balanceTotal = monthly_credits` (plan allowance → meter fill).
- Router: `FAMILY_LANES.seedance2bridge.artcraft = 'seedance2artcraft'` (quality, never fast),
  `seedance25bridge.artcraft = 'seedance25artcraft'`; `bridgeReady('artcraft')` = key present;
  index.ts ready list gains it; router dispatch `svc === 'artcraft'` → `runArtcraftRender`.
  402 matches CREDIT_SMELL → falls through to the next account once, row says so.
- Since seconds math has a real rate here, the ledger's `EST_CREDITS_PER_SEC` gets a
  per-service override: Artcraft 720p = 18.5 credits/s (measured basis beats the peg guess).

## 7. Probe gates (`scripts/probe-artcraft.mjs`, spends his credits, announced first)

0. **His account has API keys enabled** (staff gate) — nothing runs before this.
1. Key + empty batch status = 200 (validate).
2. `GET /v1/omni_gen/models/video` with the key — if it answers, ref counts/caps for
   seedance_2p0/_fast/2p5 are read off it and stamped into §3 (replaces the fal assumptions).
3. Marker-string t2v 5s 720p lands; charged credits vs 93 expected (their test table).
4. i2v start + end frame via upload tokens lands.
5. ref2v with 3 object images: slot ORDER honoured or not (sets the `refTagPrompt: 'none'`
   note honestly).
6. Video ref + audio ref ride and steer; 2.5 input-seconds billing observed.
7. Balance read with the key: `/v1/credits/session` answers or 401s → §6 resolved.
8. Crash recovery + job lifetime; cancel endpoint hunt (list_session_jobs / job delete).
Fail a gate → that lane greys with the reason.

## 8. Build order (after the other sessions wrap, each stage on GO)

1. Settings key + validate + registry (3 engines) + `refTagPrompt: 'none'` + VIA + adapter.
2. Probe gates 0–8.
3. Bridge key row + router lane + per-service rate override.
4. Docs: README suppliers table, What's New, bible 12.11 reference list.

## 9. QUESTIONS for him

1. Seedance 2 + 2.5 only — confirm (assumed from the Venice ruling).
2. Bitrate high + quality high always — confirm.
3. Keep `Artcraft (fast)` as a VIA row — confirm.
4. Ask their team to enable API keys on his account now, or after spec approval?
5. Co-Director via Artcraft: not possible (no text models) — noted, no action.
