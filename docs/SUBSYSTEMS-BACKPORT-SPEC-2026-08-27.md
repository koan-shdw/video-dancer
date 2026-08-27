# SUBSYSTEMS BACKPORT — sprite-dancer → vi-dancer (2026-08-27)

STATUS: SPEC — approved scope from the bible ch. 12 change log ("all pending back-port to
vi-dancer"). No code lands before the user GOes this document.

Source of truth: `C:\Claude\koan-design\12-SUBSYSTEMS.md` (12.1–12.6, 12.9) + the
sprite-dancer reference copies named per item. Every "vi-dancer today" claim below was
verified against the working tree on 2026-08-27, file:line cited. Port rule: copy the
sibling, change only nouns (`spritedancer`→`vidancer`, `sd-`→`vd-`, `SD_`→`VD_`,
`vmodels:*`→`models:*`, panel→card).

---

## Audit — how sprite-dancer fixed each, and where vi-dancer stands

| # | Item (bible §) | sprite-dancer approach (reference copy) | vi-dancer today | Verdict |
|---|---|---|---|---|
| 1 | Chunk-swap fetch bug (12.3) | `streamBodyToFile()` — explicit `body.getReader()` loop, each chunk written + drained in order (`app/src/main/runtime.ts:25`); corrupt archives kept as `.bad`; landed size+sha logged before extract | `Readable.fromWeb + pipe()` with a data listener at SIX sites (list below); corrupt zips deleted (`runtime.ts:78`); no landed log | **MISSING — port** |
| 2 | Silent-death render loop (12.5) | poll tick checks `w.ps.exitCode` and fails the job with the reason; every poll fetch carries `AbortSignal.timeout`; engine stdout → main.log; `spawnServer` logs server exits (`ltxLocal.ts:513-519`, `runtime.ts:379`) | none of the four: bare `fetch` in the loop (`ltxLocal.ts:470`), no exit check, `ensureLtxWorker()` called with no onLine (`ltxLocal.ts:433`), spawnServer silent on close | **MISSING — port** |
| 3 | Real progress bar (12.5/12.6) | `stepProgress()` parses the engine's own tqdm line from `/internal/logs/raw` → `sampling step 5/8 · 52s/step`, pct 0.05–0.92; `Job.pct` beats the time guess beats indeterminate (`ltxLocal.ts:490-511`, `QueuePanel.tsx:19`) | `rendering… Ns` clock text only (`ltxLocal.ts:473,491`); `render:progress` carries a bare string; Queue bar = etaSec guess or indeterminate | **MISSING — port** |
| 4 | Download honesty pack (12.1/12.2) | `lastErrors` map in MAIN (survives restart); rows report `filesDone/filesTotal/bytesLeft`; `⟳ resume · 3/5 done · N GB left` button; wizard resume line; failure toast in App; clicked row carries a chained failure; landed/failed lines in main.log (`ltxStore.ts:36,61`, `ModelsPanel.tsx:217-227`, `App.tsx:206-218`, `index.ts:853-859`) | transport + sha/byte gates already identical (modelStore.ts is the same Chromium DownloadItem downloader); but NO lastErrors, no resume fields/button, no toast, chain catch swallows the story (`index.ts:1324-1326`), no log lines | **PARTLY THERE — port the honesty layer** |
| 5 | Size dropdown (12.9) | one entry per installed size in THE engine dropdown (`engineOptions.ts` + `ltxReady.ts`), `'ltx25\|<sizeId>'` values, pin frozen into the recipe, missing pin visible + ladder fallback announced, `● renders` chip on the card | single `LTX 2.5 (local)` entry (`RenderPanel.tsx:1636`); `pickInstalledVariant()` takes no argument — the silent ladder pick (`ltxLocal.ts:319`) | **MISSING — port** |
| 6 | Wizard 16 GB recommendation (user measurement, sprite-dancer testing 2026-08-27) | not yet fixed there either — same table | same wrong table: `gb >= 16 → Q5` (`modelWizard.tsx:28`) + an unreachable duplicate `gb >= 12` Q3 branch (`modelWizard.tsx:30`) | **FIX per measurement** |
| 7 | Engine-confirmed model line (user call 2026-08-27) | render returns `sizeId` + `engineFile` read from the EXECUTED graph ComfyUI echoes back; recipe records both; take model line: `model: … · seed N` + `file: … (engine-confirmed)` (`ltxLocal.ts:536-544`, `index.ts:670-672`, `MovesetPanel.tsx:19-24`) | `renderLtxClip` returns `{file,durationSec,seed}` only; `Take.localVariant` (types.ts:134) exists but NOTHING writes or reads it | **MISSING — port** |

The measurement behind #6 (user, sprite-dancer live testing on the 16 GB card): int8
renders ~40× faster than Q5 GGUF — ~5s/step vs ~200s/step; GGUF dequant is the drag. So
"Q5 for 16 GB" is wrong on speed AND quality (int8 is the higher tier).

The six racy fetch-to-disk sites (item 1, enumerated):
1. `src/main/runtime.ts:113-128` — uv.zip
2. `src/main/ltxLocal.ts:133-150` — `fetchZip` (ComfyUI / GGUF loader / MSR zips)
3. `src/main/audioLocal.ts:137-149` — ACE-Step source zip
4. `src/main/audioLocal.ts:518-525` — ACE score result audio save
5. `src/main/fal.ts:57-73` — `downloadTo` (every provider result; uses `pipeline` but same fromWeb + data-listener shape)
6. `src/main/playground.ts:67-93` — playground zip (same `pipeline` shape)

NOT touched: `src/main/modelStore.ts` weights transport — already Chromium
`DownloadItem` (the law's preferred wire), already sha256+exact-bytes gated.

---

## 1 · Ordered reader loop (12.3)

**`src/main/runtime.ts`**
- Add `export async function streamBodyToFile(body, dest, onBytes?)` — sprite-dancer
  `runtime.ts:25-44` verbatim.
- uv.zip block: replace the fromWeb/pipe promise with `streamBodyToFile(res.body,
  `${zip}.part`, (g) => …)` keeping the 0–70 pct mapping and incomplete-size check.
- After `rename(part, zip)`: hash the zip (sha256 stream read) and
  `console.log('[runtime] uv.zip landed: N bytes sha256=…')` BEFORE extract
  (sprite `runtime.ts:151-160`).
- `extractZip` catch: keep the corrupt zip as `${zip}.bad` (`rm` old `.bad` first, rename,
  fall back to delete), `console.error('[runtime] corrupt archive kept for autopsy: …')`,
  still `rm` the half-extracted dest (sprite `runtime.ts:103-111`).

**`src/main/ltxLocal.ts`** — `fetchZip`: body → `runtime.streamBodyToFile`, MB note via
`onBytes` (sprite `ltxLocal.ts:128-140`).

**`src/main/audioLocal.ts`** — both sites → `runtime.streamBodyToFile`; site 3 keeps its
MB note, site 4 writes straight to `outPath` as today (no .part today; add `.part`+rename
while here — same discipline, two lines).

**`src/main/fal.ts`** — `downloadTo`: replace fromWeb/pipeline with
`runtime.streamBodyToFile(res.body, `${outPath}.part`, (g) => (got = g))`; keep the
empty-file and content-length checks and the `.part` cleanup on error.

**`src/main/playground.ts`** — `download`: same swap; keep the pct callback (via onBytes)
and the exact-`p.bytes` check.

## 2 · Render-loop hardening (12.5 + the 12.4 logging)

**`src/main/ltxLocal.ts` — `renderLtxClip`:**
- `ensureLtxWorker((line) => console.log(`[ltx-engine] ${line}`))` — engine output
  reaches main.log (sprite `ltxLocal.ts:453`).
- Poll loop, each tick BEFORE the history fetch:
  `if (w.ps.exitCode !== null) throw new Error('the LTX engine died mid-render (exit N) —
  usually a GPU driver reset or out-of-memory; try again, or a smaller size if it repeats')`
  (sprite `ltxLocal.ts:517-518`).
- History fetch gets `{ signal: AbortSignal.timeout(10_000) }`.
- Add `stepProgress()` — sprite `ltxLocal.ts:490-511` verbatim: fetch
  `/internal/logs/raw` with `AbortSignal.timeout(3000)`, entries newer than `t0 - 10s`
  only (a stale 8/8 from the LAST render must not count), regex
  `(\d+)/(\d+) \[[^\]]*?([\d.]+)s/it\]`; returns
  `loading the model… Ns` (no pct) → `sampling step d/t · Xs/step · Ns`
  (pct `0.05 + d/t*0.87`) → `decoding frames… Ns` (pct 0.95).
- The two `rendering… Ns` fallbacks call `stepProgress()` instead.
- `onProgress` signature: `(m: string, pct?: number) => void` (pct 0–1, real only).

**`src/main/runtime.ts` — `spawnServer`:** after the stdout/stderr hooks:
`ps.on('close', (code) => console.error(`[runtime] ${engine} server exited (${code})`))`
(sprite `runtime.ts:379`).

**Failure lines to main.log** (12.2/12.4 — a UI-only error vanishes behind a restart):
- `runtime.ts` `ensureRuntime` catch: `console.error('[runtime] install failed: …')`.
- `ltxLocal.ts` `installLtxEngine` catch: `console.error('[ltx] engine install failed: …')`.

## 3 · Real progress in the Queue (12.6)

- **`src/main/index.ts`** render:run local branch: `onProgress: (m, pct) =>
  safeSend(e.sender, 'render:progress', { msg: m, pct })`. The channel payload becomes
  `{ msg: string; pct?: number }`; every other sender wraps its string (`{ msg: m }`).
- **`src/preload/index.ts` + `env.d.ts`**: `onRenderProgress(cb: (p: { msg: string;
  pct?: number }) => void)`.
- **`src/renderer/src/App.tsx`**: `setRunningJobMsg(p.msg, p.pct)`.
- **`src/renderer/src/store.ts`**: Job gains `pct?: number` (0–1, real engine progress
  only — never written by the clock); `setRunningJobMsg(msg, pct?)` stores both.
- **`src/renderer/src/panels/Queue.tsx`** bar precedence (bible 12.6): real `j.pct`
  beats the `etaSec` estimate beats the indeterminate bar. With `pct` present the bar
  width is `pct*100`% (no 92% park — the engine's 0.95 cap plays that role); status line
  unchanged (msg already carries the step text). The "learns from this first run" note
  hides while a real pct is live.
- renderStats/etaSec learning stays exactly as is (still feeds fal rows and the estimate).

## 4 · Download honesty pack (12.1/12.2)

**`src/main/modelStore.ts`:**
- `export const lastErrors = new Map<string, string>()` (sprite `ltxStore.ts:36`).
- `LocalModelRow` gains `filesDone?`, `filesTotal?`, `bytesLeft?`, `error?`.
- `list()`: partial multi-file rows report `filesDone/filesTotal` + `bytesLeft` summed
  from the registry's byte pins for missing files; attach `lastErrors` (sprite
  `ltxStore.ts:52-63`).
- `download()`: on success `lastErrors.delete(id)` +
  `console.log('[models] landed <file> (N bytes)')` per file; in the catch,
  `canceled` clears / anything else sets `lastErrors` +
  `console.error('[models] download <id> failed: …')` (sprite `ltxStore.ts:234-251`).
- `deleteModel()`: `lastErrors.delete(id)` — a deliberate delete resets the story.

**`src/main/index.ts`** `models:download` catch (the clicked row carries the chain's
story — sprite `index.ts:851-861`): on non-`canceled` failure `lastErrors.set(id, msg)` +
`e.sender.send('models:done', { id, ok: false, error: msg })` so a size click that died
in the chained engine/essentials step lands on the row the user clicked. Success path
clears `lastErrors` for the clicked id.

**`src/renderer/src/panels/ModelsCard.tsx`:**
- `RowState` gains the three resume fields; `refresh()` copies them AND row errors from
  the list answer (errors now survive card close + app restart, not just live events).
- Not-downloaded state with `filesDone > 0` renders the resume button:
  `⟳ resume · {filesDone}/{filesTotal} done{ · N GB left}` with the "landed files are
  kept and skipped" title (sprite `ModelsPanel.tsx:217-227`).

**`src/renderer/src/lib/modelWizard.tsx`** download fact line: partial rows say
`resumes — N GB left of ~X GB (n/m files already on disk)` (sprite
`modelWizard.tsx:66-71`).

**`src/renderer/src/App.tsx`**: on `onModelsDone` failure (not canceled), toast
`<label> download failed — open Models to resume` (kind error), identical toasts within
3s collapse (sprite `App.tsx:205-218`). vi-dancer's existing Toast is the same shape.

## 5 · Installed sizes IN the engine dropdown (12.9)

His law, verbatim in the bible: versions sit next to each other in the dropdown the user
already knows, labels off the Models card rows, only what's on disk; nothing installed →
one `LTX 2.5 (local)` entry whose pick opens the card; a deleted pick stays visible as
`(… · not installed)`; the take freezes what actually ran; the card marks `● renders`.

vi-dancer difference from sprite: the engine lives PER CLIP (`PromptData.engine`) — there
is no defaults/override pair, so the one Clip Gen dropdown is the whole surface.
`VEDIT_ENGINES` (VideoEditor) is untouched — LTX has no v2v.

- **`src/shared/localModels.ts`**: export `LTX_DISTILLED_IDS` (the five distilled row
  ids, ladder order) — sprite keeps this beside the registry.
- **NEW `src/renderer/src/lib/ltxReady.ts`** — sprite verbatim: shared readiness cache
  `{ renderReady, fullOnly, sizes: {id,label}[] }`, refreshed on boot + every
  `models:done`; `ltxGateReason()`. Replaces RenderPanel's private `ltxSt` shape (the
  render gate reads the same module).
- **NEW `src/renderer/src/lib/engineOptions.ts`** — sprite verbatim:
  `engineOptions()` (fal engines by id, then one entry per installed size,
  `'ltx25|<sizeId>'`), `encodeEngine` / `decodeEngine`, `engineLabelFor`,
  `missingPinOption`, `ltxOptLabel` ("quality (int8)" → `LTX 2.5 (quality int8)`).
- **`src/shared/types.ts`**: `PromptData.ltxSize?: string` (the pinned size row id;
  absent = best installed) + `Take.ltxFile?: string` (item 7). `Take.localVariant`
  (already in the schema, v18) finally gets written.
- **`src/renderer/src/panels/RenderPanel.tsx`**: the model `<select>` renders
  `engineOptions()` + `missingPinOption(engine, ltxSize)`; value =
  `encodeEngine(engine, ltxSize)`; onChange decodes → `setEngine` + set/clear the
  clip's `ltxSize`; the bare `ltx25` pick with nothing installed keeps today's behavior
  (selection kept, wizard fires). `ltxSize` rides `buildPromptData()` → saved per clip,
  frozen into the take snapshot like every other field.
- **`src/main/index.ts`** render:run local branch: pass `sizeId: req.ltxSize`
  (`RenderIpcRequest` gains `ltxSize?`; RenderPanel sends it).
- **`src/main/ltxLocal.ts`**: `pickInstalledVariant(preferred?)` — pinned installed size
  wins; pinned MISSING size = ladder pick + `requestedMissing`, announced first thing in
  the queue row (`the pinned size is not installed — rendering with <label> instead`);
  variant carries `row` (sprite `ltxLocal.ts:306-346`). `LtxRenderArgs.sizeId?`.
- **`src/renderer/src/panels/ModelsCard.tsx`**: `● renders` chip on the size row that
  renders next (per-clip world: the best-installed ladder pick; title says
  "renders next — best installed (auto); pick a size in Clip Gen's model dropdown").
- Take tile footer (`RenderPanel.tsx:1525`): local takes show the full size label via
  `engineLabelFor` instead of the bare `LTX 2.5 (local)`.

## 6 · Wizard recommendation table (his measurement)

**`src/renderer/src/lib/modelWizard.tsx` — `recommendLtxVariant`:**
- `gb >= 16` now recommends `ltx-2.5-quality` — why-line:
  `int8 measured ~40× faster than Q5 on a 16GB card (GGUF dequant is the drag)`.
- `gb >= 12` also recommends `ltx-2.5-quality` (user call 2026-08-27: "rec int8 it works
  great") — recommends, never restricts; the GGUF sizes stay downloadable for the cards
  int8 truly can't serve.
- Delete the unreachable duplicate `gb >= 12` Q3 branch (dead code).
- 24 GB branch unchanged; `< 12` keeps Q2 minimum.

sprite-dancer carries the SAME wrong table (`modelWizard.tsx:27`) — owes itself this fix;
bible 12.1 gets a change-log line when either lands.

## 7 · Engine-confirmed model line

- **`src/main/ltxLocal.ts`** `renderLtxClip` completion: read the transformer file from
  the EXECUTED graph the history entry echoes (`entry.prompt[2].unet.inputs.unet_name`) —
  never from our request; return `{ …, sizeId: variant.row, engineFile }` (sprite
  `ltxLocal.ts:530-544`).
- **`src/main/index.ts`** local branch: after render, the take records
  `localVariant = r.sizeId` (the size the engine ACTUALLY ran — written back, never just
  the request) and `ltxFile = r.engineFile`.
- **`src/renderer/src/panels/RenderPanel.tsx`** take tile: footer label per item 5; the
  tile `title` (hover) gains the sprite takeModelLine grammar —
  `model: LTX 2.5 (quality int8) · seed N` + newline `file: <transformer> (engine-confirmed)`
  when present.

---

## 8 · Full (dev bf16) as an explicit dropdown pick — ADDED 2026-08-27, second GO

The recipe went from unproven to PROVEN the same day: user rendered dev bf16 in
sprite-dancer live ("worked great"; bible ch. 12 change log: ~4 s/step at 334 W on the
16 GB 5080, landed clean, engine-confirmed). Bible: "vi-dancer inherits both." Ported
sprite-dancer's implementation verbatim:

- **`src/main/ltxLocal.ts`**: `DEV_STEPS 20 / DEV_CFG 4 / DEV_NEG` (the official Full
  workflow's negative, verbatim); `LtxVariant.dev?`; `pickInstalledVariant('ltx-2.5-full')`
  returns the dev variant ONLY by explicit pin (never the ladder; missing → ladder +
  requestedMissing). `buildGraph` dev wiring: neg = DEV_NEG, CFG 4 both channels, sampler
  `euler`, sigmas = `LTXVScheduler {steps 20, max_shift 2.05, base_shift 0.95, stretch,
  terminal 0.1, latent: vlat}` (distilled path byte-identical to before). Recipe source:
  Lightricks' official LTX-2.0 Full workflow — no official 2.5 dev workflow exists;
  sprite-dancer proved it on 2.5.
- **`src/renderer/src/lib/ltxReady.ts`**: `devReady` (full on disk).
- **`src/renderer/src/lib/engineOptions.ts`**: `LTX 2.5 (full dev bf16)` entry appended
  after the distilled sizes when devReady; engineLabelFor + missingPinOption know the dev
  id. ("· experimental" dropped same day on his call — the recipe proved itself live;
  sprite-dancer still carries the word, his answer pending.)
- NOT ported: sprite's user-negative field (`GraphParams.negative`) — vi-dancer's Clip Gen
  has no negative input; its grammar decides that, not this port.
- **Known seam, kept for parity (both apps)**: with ONLY full installed, the dropdown
  shows the dev entry but the run gate still refuses with the old "unproven" reason —
  sprite-dancer's reference copy behaves identically today. Fix belongs in the reference
  first, then ports.

## 9 · Warm-switch engine restart + negative field — ADDED 2026-08-27, third GO

**Warm-switch fix (his find, sprite-dancer field failure):** rendering size A then size B
on the still-warm ComfyUI worker stacks both models' weights in host RAM until a weight
read fails (`CLIPTextEncode: HostBuffer.read_file_slice failed`). Port of sprite-dancer's
`loadedVariantRow` (the MiniMax shape, come home): module marker for the size the warm
worker holds; dead worker resets it; a different pick announces
`switching model size — restarting the engine for <label>…` and `runtime.killEngine`s
first; marker set only after `/prompt` accepts the graph. Same size stays warm.

**Negative field (his spec: "direct under prompt, small and greyed when not bf16"):**
one small input directly under the prompt textarea in Clip Gen. Live only when the model
pick is `LTX 2.5 (full dev bf16)`; greyed with the reason otherwise, value kept
(store-everything). Rides `PromptData.negative` → clip autosave → take snapshot →
`RenderArgs.negative` → `renderLtxClip` → appended after the baked negative line
(sprite-dancer's exact wire: `[DEV_NEG|NEG, user].join(', ')` — CFG 1 makes it inert on
distilled; wire-honest either way).

## OPEN — his call, not in this port

1. Existing plan-of-record gates unchanged (GGUF clean-file retest, ladder from measured
   renders, LoRA shelf, encoder-update review).
2. The full-only run-gate seam above — fix in sprite-dancer (reference), then port.

## Verification

- `npm run typecheck` clean; app boots.
- Item 1: a fresh runtime install on this machine (delete runtime dir, reinstall) — uv.zip
  lands, extracts, `[runtime] uv.zip landed:` line in main.log.
- Items 2/3: one local LTX render — queue row walks `loading the model…` →
  `sampling step d/8 · Xs/step` with a bar that moves per step → take lands; main.log
  carries `[ltx-engine]` lines.
- Item 4: cancel a size download mid-flight (row says canceled, no error); kill the
  network mid-download (row goes red, toast fires, restart the app — row still red,
  button says `⟳ resume · n/m done`).
- Items 5/7: with two sizes installed the dropdown shows both adjacent; pin the smaller,
  render, take hover shows the pinned size + engine-confirmed file; delete the pinned
  size — the entry shows `(… · not installed)` and the next render announces the ladder
  fallback in the queue row.
- Engine-death test (2) is not fakeable on demand — the exit-code path rides the sprite
  copy verbatim; marked ported-not-live-proven until a real driver reset hits.
