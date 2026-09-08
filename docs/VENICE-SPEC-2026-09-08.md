# VENICE — one key, API lane + Bridge row

Date: 2026-09-08 · Status: SPEC FOR REVIEW — no code until approved
Owner brief (his words): "look into adding venice ai into video dancer as both api and bridge" ·
"so its just another API addition like the others?" → yes · "spec it out lets add it dont
forget adding it to settings, and VIA" · VIA = "a sub drag down that lets us choose the
bridge or api".

Decisions in chat 2026-09-08:
- Venice = a direct-key provider, same shape as fal / ModelArk / Astria (bible 12.11).
- It ALSO gets a BRIDGE row, as a key row not a login row: Pro plan credit spends through the
  API key, so the pooled-credit picture is honest without OAuth.
- VIA gains `Venice` under Seedance 2 and Seedance 2.5.
- His answers 2026-09-08 (§9 closed): **Seedance 2 + 2.5 only** · **Co-Director gets a
  Venice option** in Settings for people who'd rather not pay Anthropic direct (he bridges
  his own Claude) · **bitrate high always** · **keep the 2.0 fast twins** (= a visible
  `Venice (fast)` VIA row, never a silent default).
- The Venice chat agent (venice.ai/chat/agent) has no API or MCP door — not usable from the
  app. Out of scope.

---

## 1. Venice facts (read 2026-09-08 — docs.venice.ai, venice.ai/pricing, github veniceai/venice-mcp-server)

- Base `https://api.venice.ai/api/v1`, `Authorization: Bearer <key>`. Key from
  venice.ai/settings/api. OpenAI-compatible for chat; own endpoints for video.
- Billing: universal credits, 100 credits = $1. Pro $18/mo = 100 credits/mo + API access;
  credits top up pay-as-you-go and never expire. DIEM staking = a daily allowance (OPEN, not
  needed here). Rough Seedance cost: ~80 credits per 5s clip.
- Video: `POST /video/queue` → `{queue_id}` · `GET /video/retrieve?queue_id=` → status
  PENDING | PROCESSING | COMPLETED | … · `POST /video/quote` → `{quote}` in USD, spends
  nothing, same fields as queue. Every video model is "variable" price — the quote is the only
  honest number.
- Queue body: `model, prompt (≤20k), negative_prompt, duration ('4s'..'30s' | 'auto' | '-1'),
  resolution ('480p'..'4k'), aspect_ratio (16:9 … 'adaptive'|'auto'), image_url,
  end_image_url, video_url, audio_url, reference_image_urls[], reference_video_urls[],
  reference_audio_urls[], audio (bool, default true), bitrate_mode ('standard'|'high'),
  omni_reference_task_type (2.5: auto|reference|edit|extend)`. **Media = http URL or data URL.
  No upload endpoint.** 413 = payload too large (limit OPEN, probe finds it).
- Seedance ids (guide docs.venice.ai/guides/media/seedance-2-0):
  2.0 `seedance-2-0-{text,image,reference}-to-video-basic` (+ `-fast-` twins, 480/720 only);
  2.5 `seedance-2-5-{text,image,reference}-to-video-basic`.
  2.0: 4–15s, 480p/720p/1080p/4k, refs ≤9 img · ≤3 vid (2–15s, ≤15s total) · ≤3 aud.
  2.5: 4–30s, 480p/720p/1080p, refs ≤30 img · ≤10 vid (2–30s, ≤30s total) · ≤10 aud.
  Ref grammar in the prompt: `<Image 1>`, `<Video 1>`, `<Audio 1>` (angle brackets, capital,
  space before the number) — NOT fal's `@image1`.
- **Policy: "Person-bearing media is not supported on the public Seedance API."** Face refs
  and dancer footage will bounce (422). Same class of limit as ModelArk's no-real-faces.
- Seed: not in the queue body. `seed: false` until probed.
- Balance: `GET /api_keys/rate_limits` → `balances.USD`, `balances.DIEM`, `apiTier`,
  `accessPermitted`. Authenticated, spends nothing = the validate call AND the Bridge balance.
- Cancel: no cancel endpoint documented — OPEN. Job lifetime server-side — OPEN.
- Other video on the same key (his call later, §9): LTX 2.5 Pro, Kling 3/O3, Veo 3.1, Wan 3.0,
  Runway Gen-4.5, Topaz video upscale, Kling motion control. Text: Claude Opus 5 / Fable 5 /
  Sonnet 5 via their anonymizing proxy. Audio: TTS, STT, music, MMAudio.
- Venice's own MCP server is API-key (stdio or self-hosted HTTP), no OAuth → adds nothing over
  the direct API. Not used.

## 2. Settings (copy the Astria sibling exactly)

- `Settings.veniceKey?: string` (shared/types.ts, next to astriaKey, comment: Venice API key
  (venice.ai/settings/api) — Seedance 2/2.5 on Pro credits or top-ups).
- `SECRET_KEYS` gains `'veniceKey'` (main/index.ts:361) — encrypted at rest like the rest.
- SettingsModal · card 1 "api suppliers": one more `supplierRow` after Astria:
  - `supplierHead('Venice — Seedance 2/2.5 on Pro credits', !!veniceKey.trim())`
  - `field('Venice API key', 'refs must not contain people (their public-API policy) · one key also feeds the Bridge row', …, 'paste Venice key', 6)`
  - `testRow(… vd().veniceValidate …, 'authenticated no-op against api.venice.ai — reads your balance, never spends', 'https://venice.ai/settings/api', 'opens venice.ai — API keys live under Settings → API')`
  - `connectedCount` counts five; label reads `n/5 connected`.
  - `initial`/`want` maps + App.tsx `keysSet` gain `venice`.
- IPC: `venice:validate` (main) · `veniceValidate` (preload + env.d.ts) — same signature as
  `astriaValidate`. Validate = `GET /api_keys/rate_limits`; 401/403 → "key rejected — check
  the Venice API key"; ok → `{ok:true}` (balance rides to the Bridge row, §6).

## 3. Registry (shared/models.ts) — two engines

`ModelDescriptor.provider` union gains `'venice'`. `EngineId` gains `'seedance2venice' |
'seedance25venice'`.

```
seedance2venice: {
  id: 'seedance2venice', label: 'Seedance 2 (Venice)', provider: 'venice',
  modes: ['ref2v', 'i2v'], endFrame: true,
  maxRefImages: 9, maxRefVideos: 3, maxRefAudios: 3, characterRefs: 0,
  durations: ['4'..'15'],                       // no 'auto' — Venice 'auto' is for edits only
  resolutions: ['480p','720p','1080p','4k'],
  aspectRatios: ['auto','16:9','9:16','1:1','4:3','3:4','21:9'],   // 'auto' → 'adaptive' needs refs; no refs → 16:9
  audioToggle: true, seed: false,
  endpoints: { t2v: 'seedance-2-0-text-to-video-basic', i2v: 'seedance-2-0-image-to-video-basic', ref2v: 'seedance-2-0-reference-to-video-basic' },
  pricePerSec: {},                              // variable — the quote call fills the queue estimate live (§4)
  refTagPrompt: 'AngleN',                       // NEW style: @image1 → <Image 1> (§4)
  notes: 'Seedance 2 via Venice: needs a Venice key (Settings) · refs must NOT contain people (their public-API policy) · no seed · cost = live quote before submit.'
}
seedance25venice: same shape — durations '4'..'30', resolutions 480/720/1080, refs 30/10/10,
  endpoints seedance-2-5-*, label 'Seedance 2.5 (Venice)'.
seedance2venicefast: same shape as seedance2venice — label 'Seedance 2 (Venice fast)',
  resolutions ['480p','720p'] only, endpoints seedance-2-0-fast-*-basic, notes say "faster,
  lower tier — the plain Venice row is the quality pick". 2.5 has no fast twin.
```

`EngineId` therefore gains three ids: `seedance2venice | seedance25venice | seedance2venicefast`.

`refTagPrompt: 'AngleN'` — shared/compile.ts's rewriter gains a third grammar: `@imageN` →
`<Image N>`, `@videoN` → `<Video N>`, `@audioN` → `<Audio N>`. Same positional binding as
fal (refs are sent in slot order). Nothing else in compile changes.

## 4. Adapter — `src/main/providers/venice.ts` (bible 12.11 contract, ModelArk = the sibling)

- `runVeniceRender(opts: VeniceRenderOpts)` where opts = RenderRequest + `veniceKey`,
  `veniceModel` (from `endpoints[mode]`, t2v when ref2v has zero refs — house zero-ref rule),
  `outDir`, `onProgress`, `onRequestId`.
- Body: `model, prompt, duration: '<n>s', resolution, aspect_ratio ('auto' → 'adaptive' when
  any ref/image is present, else '16:9'), audio: generateAudio, bitrate_mode: 'high'`
  (highest-quality default law; no price effect per their guide). i2v: `image_url` +
  `end_image_url` as data URLs. ref2v: `reference_image_urls / reference_video_urls /
  reference_audio_urls` as data URLs, slot order = prompt tag order. `negative_prompt` when the
  request carries one.
- **Quote first**: `POST /video/quote` with the same fields (+ `reference_video_total_duration`
  when videos ride) → queue row shows `$0.80 quoted` before submit. Quote failure = submit
  anyway, row says `no quote`. (Only provider where the estimate is the provider's own number.)
- Submit → `queue_id` → `onRequestId(queue_id, model)` → poll `/video/retrieve` every 3s,
  5-failure tolerance, 45-min deadline. COMPLETED → the video (URL or bytes — field name
  captured on the first probe) → `downloadTo` into `renders/`. 402 → "out of Venice credit —
  top up on venice.ai"; 422 → their text verbatim (persons policy will surface here); 409
  `needs_consent` → fail with their policy text (no silent consent).
- `cancelVeniceJob` = stops OUR wait (no remote cancel documented; add it if the probe finds
  one). `fetchVeniceResult(queue_id, key, outDir)` → done | running | gone (crash recovery,
  provider tag `'venice'` on the pending entry; index.ts:203 + :221 branches). `validateVeniceKey`
  = §2.
- Error grammar: `error (status) @ venice/<where>: detail — hint :: sent fields: …`.
- index.ts dispatch: `provider === 'venice'` key guard ("No Venice key saved — paste your Venice
  API key in Settings first (venice.ai → Settings → API).") + the run branch, exactly where
  Astria sits.

## 5. VIA (lib/engineOptions.ts)

FAMILIES gains one member per family, placed with the other API lanes, before the Bridge rows:
- seedance2: `{ id: 'seedance2venice', via: 'Venice' }` then
  `{ id: 'seedance2venicefast', via: 'Venice (fast)' }`, after Astria. Quality row first —
  `engineForFamily` lands on it; fast is a deliberate pick (highest-quality default law).
- seedance25: `{ id: 'seedance25venice', via: 'Venice' }` after ModelArk.
Bridge (auto) rows already exist; §6 makes Venice eligible under them. Nothing else in the
MODEL · VIA grammar moves; a clip still pins one EngineId.

## 6. BRIDGE row (key row, not a login row)

- `BridgeServiceId` gains `'venice'`. `services.ts` entry:
  `{ id:'venice', label:'Venice', mcpUrl:'', site:'https://venice.ai/settings/api', kind:'video',
  creditUnit:'credits', auth:'key' }` — new optional field `auth?: 'oauth' | 'key'` (absent =
  oauth, today's six untouched).
- `BridgeRow` gains `auth?: 'key'`. Bridge manager: for a key service, `loggedIn` = a Venice
  key is saved; `refreshService` reads `/api_keys/rate_limits` → `balance = USD × 100`
  (credits, same peg the panel's pool math already assumes: 1 USD = 100 credits), `balanceTotal`
  absent (high-water mark rule applies), `toolCount` absent. No McpClient, no OAuth.
- Panel row: logo `assets/bridge/venice.png` (their mark), SHORT `VENICE`. Right-hand control:
  key set → `logout` becomes `settings` (opens Settings, key row); key absent → `set key`
  (opens Settings) instead of `login`. Status text: `● key set · 1,240 credits`. Everything
  else (segment in the pool bar, ledger line, glow on render) = same as the OAuth rows.
- Router (`bridgeAuto.ts`): `FAMILY_LANES.seedance2bridge.venice = 'seedance2venice'` (the
  quality engine — the router never picks the fast tier on its own),
  `seedance25bridge.venice = 'seedance25venice'`; `bridgeReady('venice')` = key present;
  index.ts:2039 ready list gains `'venice'`. Dispatch inside the router: `svc === 'venice'` →
  `runVeniceRender`. Refs filter already excludes lanes with `maxRefImages: 0` — Venice carries
  refs, so it stays eligible; the persons policy is a 422 at render, which is NOT a credit
  smell → honest fail, no fall-through (spec §3.3 law).
- Settings ↔ Bridge: saving/clearing the key fires the bridge `changed` notify so the row
  flips without a restart.

## 6b. Co-Director — third engine: `venice`

- `Settings.codirEngine` union becomes `'api' | 'bridge' | 'venice'`. New
  `codirVeniceModel?: string` (default `claude-sonnet-5`, same default logic as the api lane).
- SettingsModal · CO-DIRECTOR card: the engine control grows one option — today's api/bridge
  switch becomes a three-way pick (house Dropdown, width = longest option: `Anthropic API ·
  Claude Code bridge · Venice API`). Status glyph gains `● venice`. Venice picked → a model
  dropdown listing `claude-sonnet-5 · claude-opus-5 · claude-fable-5` with Venice's prices
  ($3/$15 · $6/$30 · $12/$60 per MTok, read 2026-09-08 docs.venice.ai/models/overview) and the
  line "uses the Venice key above — routed through their anonymizing proxy". No Venice key →
  the option stays selectable, status reads `○ needs the Venice key`.
- Backend: `codirSend` opts.engine gains `'venice'`; every `s.codirEngine === 'bridge' ?
  … : …` site in index.ts (1602, 1644, 1760, 1805, 1808) becomes a three-way resolve —
  `resolveVeniceModel(s.codirVeniceModel)` for the model, `s.veniceKey` for the key.
- Wire: `POST https://api.venice.ai/api/v1/chat/completions` (OpenAI format). codir.ts today
  builds Anthropic Messages bodies (system, content blocks, tool_use/tool_result, cache
  control). New `src/main/codirVenice.ts` = the translator: system → first `system` message;
  image blocks → `image_url` data URLs; our tool definitions → `tools[{type:'function'}]`;
  `tool_use` ↔ `tool_calls`, `tool_result` ↔ role `tool` messages; stream deltas mapped to the
  same progress channel; usage mapped to CoDirUsage (cache fields 0 — Venice reports none).
  The tool loop, RLM mode, COMPACT, sub-calls (`subcall.ts`) and guides all sit ABOVE the
  wire and do not change. Prompt caching does not exist on this lane — the cost line says so.
- Gates the Venice lane must pass before it lights: a full exchange with ≥2 tool rounds lands
  the same project delta the api lane produces on the same brief; a ref image is seen
  (vision); COMPACT runs. Fail → option greys with the reason.
- BridgePanel's "any Claude lane set" check (BridgePanel.tsx:72) and ScoreCard compose-ready
  (ScoreCard.tsx:60) count `codirEngine === 'venice' && veniceKey` as a lane; the interpreter
  (BRIDGE-SPEC §3.5) uses the same picker.

## 7. Probe gates (`scripts/probe-venice.mjs`, probe-ltx sibling — spends his credits, announced first)

1. Key + `/api_keys/rate_limits` reads a balance.
2. Quote for a 5s 720p 2.0 t2v matches the ~80-credit claim (±).
3. Marker-string t2v lands whole; retrieve payload shape captured verbatim into
   `docs/venice/retrieve.json` (the file/URL field name).
4. i2v with data-URL start + end frame lands.
5. ref2v with 2 object images (no people) + `<Image 1>` grammar demonstrably steers.
6. Data-URL size ceiling: one 20MB video ref — 413 or not (sets `maxRefVideos` honestly).
7. Person-bearing ref → confirm the 422 text (so the queue row hint is their words).
8. Crash recovery: kill mid-render, reopen, take collected. Job lifetime noted.
Fail a gate → that lane greys with the reason; nothing lights on trust.

## 8. Build order (each stage gated on GO)

1. Settings key + validate + registry (3 engines) + VIA + adapter (t2v/i2v/ref2v) — one PR.
2. Probe gates 1–8.
3. Bridge key row + router lane.
4. Co-Director Venice lane (translator + Settings three-way) + its gates.
5. Docs: README suppliers table, What's New, bible 12.11 reference list (+ 12.12 note: first
   key-row service; Co-Director section: third engine).

## 9. QUESTIONS — ALL ANSWERED 2026-09-08 (see the decisions block up top)

1. Extra Venice video models → **Seedance 2 + 2.5 only.**
2. Co-Director via Venice → **yes**, a Settings option for people who'd rather not pay
   Anthropic direct; he keeps bridging his own Claude.
3. `bitrate_mode: 'high'` always → **yes.**
4. 2.0 fast twins → **keep**, as the visible `Venice (fast)` VIA row.
