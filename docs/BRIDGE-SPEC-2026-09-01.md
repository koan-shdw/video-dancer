# BRIDGE — MCP provider logins, pooled credit, one render pipe

Date: 2026-09-01 · Status: SPEC FOR REVIEW — no code until approved
Owner brief (his words): people OAuth into the app with their provider accounts; the app
uses the credit across all the accounts; a new window called BRIDGE shows every provider
logo with a credit bar + seconds left at 480/720/1080 and an aggregate bar ("the only
aggregate that matters"); at render you pick a specific provider OR BRIDGE, which quietly
picks the account; Clip Gen info + refs pass through to the models; each provider's
language and system gets researched and handled properly.

Decisions already made in chat 2026-08-31 → 09-01:
- Providers v1: **Higgsfield, Magnific, Artlist, Runway, Pika, ElevenLabs** (his picks).
- Total shown in **render-seconds** (his pick), per rung 480/720/1080.
- Drain order = my call: **cheapest-first** (route to the account where this clip costs the
  fewest pool-seconds; tie → most credit left). Flagged, overrule anytime.
- Window = my call: **dockview panel** (it shows live credit, it's a card like Queue).
  Flagged, overrule anytime.
- Logins area = **rows**, not tiles (his correction to the first draft).
- Login opens the provider's own site in the system browser; app stays logged in after.
- ElevenLabs column counts **TTS minutes**, not video seconds; stays out of video totals
  (my call, flagged).
- Live render **glows** its provider row in BRIDGE; the Queue bar **names the account**
  BRIDGE picked.
- fal stays on the direct API wire (MCP adds nothing there — same key, same billing).
- Replicate stays dead (stripped on user order 2026-08-31 — bible 12.11 change log).

His answers 2026-09-01 (spec §8 closed):
- **v1 models = Seedance 2 + Seedance 2.5 ONLY.** Everything else waits.
- **Magnific upscaler PARKED** — upscaling is a later phase.
- **Probe credit spend approved** (a few short clips per provider).
- **BRIDGE = a normal vi-dancer panel** like every other — drag/dock/float, nothing
  special. (Asking was my mistake; the brief already said it.)
- He is creating the six accounts; probes wait on his logins.

---

## 1. What BRIDGE is

One window + one backend router that turns "I'm logged in to N creative services" into
"my app can spend all of it." Each render still spends exactly one account's credit —
credit never moves between accounts; BRIDGE just routes each job to an account that can
run the picked model and has credit. Aggregate = sum of what's reachable, in seconds.

Why MCP and not their APIs: all six run an **official hosted MCP endpoint that
authenticates with the user's normal account (OAuth) and bills the user's plan credits.**
Their raw APIs either need a separate paid API tier (Higgsfield API = Creator plan; our
registry already carries the corpse: `seedance2hf` HIDDEN because the platform API serves
no Seedance while the consumer platform does) or separate pay-per-use billing (Runway
dev API, Freepik API). The MCP lane is the only lane where a normal subscription pays.

## 2. The BRIDGE panel

Dockview panel, id `bridge`, title BRIDGE. Canon chrome (bible 00-03): mono, house
control sizes, fixed-height slots, furniture never moves.

Agreed layout (ASCII approved in chat):

```
┌─ BRIDGE ────────────────────────────────────────────────────────────────────┐
│  HIGGS      MAGNIFIC   ARTLIST    RUNWAY     PIKA       11LABS  │  TOTAL    │
│  ████░░     ██░░░░     █████░     █░░░░░     ███░░░     ████░░  │  ███████░░│
│  480  212s  480   88s  480  340s  480   41s  480  150s  tts     │  480  831s│
│  720  106s  720   44s  720  170s  720   20s  720   75s  38min   │  720  415s│
│  1080  53s  1080  22s  1080  85s  1080  10s  1080  37s          │  1080 207s│
│  ─────────────────────────────────────────────────────────────────────────  │
│   [logo]  Higgsfield      ● logged in · alex@…              logout          │
│   [logo]  Magnific        ● logged in · alex@…              logout          │
│   [logo]  Artlist         ○ not connected                   LOGIN           │
│   [logo]  Runway          ● logged in · alex@…              logout          │
│   [logo]  Pika            ○ not connected                   LOGIN           │
│   [logo]  ElevenLabs      ● logged in · alex@…              logout          │
└─────────────────────────────────────────────────────────────────────────────┘
```

Top strip — one column per provider: logo, credit bar (fraction of that account's own
plan allowance; 0 length when logged out, greyed), under it three lines `480 · 720 ·
1080` seconds. ElevenLabs column shows `tts · NNmin`. Right of a separator: the TOTAL
column, wider bar, same three second-lines summed over logged-in video providers.
Tooltip on the TOTAL bar, on hover: **"the only aggregate that matters"** (verbatim,
his inside joke — never "improve" it).

Seconds math: `seconds(provider, rung) = creditsLeft / creditRate(provider, model*, rung)`
where `model*` is that provider's cheapest offered video model at that rung — the bar
answers "how much CAN I still render", so it uses the cheapest honest rate. Rate table
per provider lives in the registry with a dated source comment (same law as
`pricePerSec`). Until a provider's rate table is filled + probe-proven, its seconds
lines show `—` and the bar shows raw credits with the unit named (cost honesty — never
a made-up number).

Rows — one per provider: logo (drawn house icon, shared set), name, status dot +
account email when logged in, `LOGIN` / `logout` on the right. LOGIN fires the OAuth
flow (§4). No key fields anywhere on this panel — keys stay in Settings, BRIDGE is
logins only.

Glow: while a render is in flight through BRIDGE or a specific MCP provider, that
provider's row and top-strip column carry a slight glow (canon accent, subtle — same
family as the Queue's active treatment). Ends when the job lands or fails.

Empty state (law 9): never a blank panel — logged-out-everything shows the rows with
LOGIN buttons and the top strip greyed with reason text "log in to see credit".

## 3. Backend

### 3.1 Bridge client core (one, shared)

- MCP TypeScript SDK (`@modelcontextprotocol/sdk`) Client over **streamable HTTP**
  transport in Electron **main** — one persistent client per logged-in provider,
  lazy-connected, reconnect on drop.
- OAuth: the SDK's OAuth client support — PKCE + dynamic client registration where the
  server offers it. Flow: LOGIN → `shell.openExternal(authUrl)` (their own site in the
  user's real browser, per his brief) → loopback `http://127.0.0.1:<port>/callback`
  listener catches the redirect → token exchange in main. Refresh tokens persisted via
  Electron `safeStorage` (encrypted at rest); fall back to settings file only if
  safeStorage is unavailable, flagged in the UI. "Stays logged in" = refresh on expiry,
  silent.
- OPEN (probe, per provider): whether their OAuth server accepts dynamic client
  registration + a loopback redirect from a desktop app, or only allowlists known web
  clients (Claude, ChatGPT, Cursor). Any provider that refuses DCR goes on the panel
  greyed with the reason until a registered client id exists ("kept, not sent" honesty
  grammar).
- Tool discovery: on connect, `tools/list` is fetched and cached per provider; the
  adapter validates the tools it needs exist before its engines light up. A provider
  changing its MCP tools must degrade to greyed-with-reason, never to a crash.

### 3.2 Adapters — bible 12.11, unchanged contract

One file per provider under `src/main/providers/mcp/` (higgsfieldMcp.ts, magnificMcp.ts,
artlistMcp.ts, runwayMcp.ts, pikaMcp.ts, elevenlabsMcp.ts). Each speaks the existing
contract so pipeline, Queue, cancel, recovery never change:

- `run<X>Render(opts: RenderRequest) → RenderOutput` — map our fields (compiled prompt,
  duration, resolution, aspect, seed where supported, refs) onto THAT provider's tool
  args; submit; poll (their async job tools) every 3s, 5-failure tolerance, 45-min
  deadline.
- `onRequestId` the moment the provider accepts → pending entry with provider tag
  (crash recovery).
- `cancel<X>Job` best-effort; `fetch<X>Result` → done | running | gone.
- `validate<X>` = an authenticated no-op (balance read where it exists) — never spends.
- Error grammar: `error (status) @ <provider>/<tool>: detail — hint :: sent fields: …`.
- Refs: local files go up through THAT provider's own upload mechanism (Magnific's
  upload trio; Pika's upload util; Higgsfield history/upload — see §5). A provider with
  no way to carry a ref renders the ref box greyed with the reason. Never silently drop
  a ref (stable-board law).
- Balance: `get<X>Balance() → {credits, unit}` where the provider has a tool for it
  (Magnific `account_balance` is PROVEN to exist by their docs; others OPEN — where
  none exists the column shows `n/a` with a tooltip reason, and BRIDGE routing treats
  that account as "unknown, try-and-fall-through").

### 3.3 The router (BRIDGE pick)

- BRIDGE picks the **account only, never the model** (locked in chat).
- Eligible = logged-in providers whose registry entry serves the picked model at the
  picked duration/resolution AND whose known balance covers the estimate (unknown
  balance = eligible last).
- Order: cheapest pool-seconds for this clip first; tie → most credit left. On a
  mid-flight failure that smells like "out of credit", fall through to the next
  eligible account ONCE, and say so in the Queue row ("HIGGS declined · retrying on
  RUNWAY"). Any other failure = normal fail, no silent retries.
- The chosen account is written into the take's metadata (take hover shows model +
  account, same grammar as the size/seed hover) and named in the Queue progress bar:
  `BRIDGE→RUNWAY · Kling 3 · rendering 43%`.

### 3.4 Registry + Clip Gen grammar

- Existing grammar kept (copy the sibling): one dropdown row per (model, provider) —
  `Kling 3 (Runway)`, `Kling 3 (Higgsfield)` — plus one `Kling 3 (BRIDGE)` row when 2+
  logged-in accounts serve that model. Rows for logged-out providers stay visible but
  greyed with reason "not logged in — BRIDGE panel" (stable board).
- Each entry carries caps exactly like today (durations, resolutions, refs, seed,
  aspect); `provider: 'mcp'` + `service: 'runway'` routes dispatch; BRIDGE rows carry
  `service: 'bridge'` + the eligible service list.
- `pricePerSec` stays EMPTY on credit-billed entries (cost honesty — same ruling as
  seedance2hf); the Queue estimate line shows pool-seconds instead: `~7s of pool`.
- v1 model scope (his ruling 2026-09-01): **Seedance 2 + Seedance 2.5 only.** Known
  carriers: Higgsfield (2.0 + 2.5), Artlist (2.0 + 2.5), Runway (2.0). Magnific and
  Pika: whether their catalogs list Seedance is read off their model-list tools at
  probe — no Seedance there = no video engine there in v1 (they stay login rows whose
  credit shows, engines dark with reason). All other models wait; the registry grammar
  is ready for them the day he names more.

### 3.5 The interpreter (approved 2026-09-01 — his ruling on the day's field lesson)

THE PROBLEM, field-proven on the first live render: MCP servers talk like chatbots. Higgsfield
answered a render request with a QUESTION ("this prompt looks like preset 3D RENDER — ask the
user") instead of a job. Each provider has its own such moments (preset offers, unlim_choice,
free-text notices), they vary per provider, and they change over time. Hard-coded answers rot.

THE MECHANISM: a live Claude sub-call that steps in ONLY when the deterministic adapter does not
understand a reply. The happy path never involves an LLM — renders stay deterministic.

- Trigger: submit/poll/balance reply with no job id, no known notice shape, an unknown terminal
  status, or an explicit interactive question. Known shapes (preset_recommendation decline) stay
  hard-coded fast paths; the interpreter is the net UNDER them.
- The call: one sub-call on the app's existing Claude lanes (anthropicKey or the Claude Code
  bridge engine — same picker as the Co-Director, never a cheap tier). Input: the provider's raw
  reply, the exact params we sent, the captured schema of the tool involved, and the standing
  laws. Output (structured, validated): either ONE follow-up tool call to make, or a plain-words
  failure for the queue row.
- LAWS the interpreter cannot break: never change the prompt, the model, duration/resolution, or
  the spend lane (use_unlim stays false, count stays 1); never call a tool absent from the
  captured tools/list; max 2 interpreter rounds per render, then fail honestly with the server's
  own words.
- No Claude configured → today's behavior: fail with the server's words in the queue row.
- Every round is visible: queue row notes "Claude answered a <provider> question", full exchange
  to main.log.
- Cost: pennies, and only on the weird moments.

## 4. Per-provider facts (researched 2026-09-01 — sources at bottom)

**Higgsfield** — `https://mcp.higgsfield.ai/mcp`. OAuth account sign-in, "no API keys";
bills platform plan credits. Models on the MCP page: Nano Banana Pro, Google Omni Flash,
Seedance 2.5/2.0, Seedream 5.0 Lite, Kling 3, GPT Image 2, Soul 2.0 (page also claims
30+ incl. Veo, Sora, Hailuo, Wan). Videos ≤15s, images ≤4K. Refs: text, reference
images, or any past generation from history. "Agent automatically selects the best
model **or you can specify one**" — our probe must prove hard model pinning. Tool
names/schemas NOT published — discover via `tools/list` (their CLI repo on GitHub is a
secondary source). Balance tool: OPEN. NOTE: this is the door the dead `seedance2hf`
key-API entry never got — consumer-platform models on account auth.

**Magnific** (magnific.com, the Freepik platform) — `https://mcp.magnific.com`,
streamable HTTP. OAuth 2.0, browser sign-in, session kept. Bills the same credit
balance as the in-app product. Richest published tool surface of the six:
`account_balance` (credit balance — the only PROVEN balance tool in the set),
`video_generate`, `video_models_list/show`, `images_generate`, `images_upscale` (the
Magnific upscaler), `images_remove_background`, upload trio
`creations_request_upload/upload/finalize_upload` (our ref lane), `creations_*`
history, `custom_references_create/list` (persistent character/style refs),
`audio_tts`, `models3d_generate`. Video model ids: via `video_models_list` at probe.

**Artlist** — `https://mcp.artlist.io/mcp`. OAuth (sign in to Artlist account); free
account connects, generations use subscription credits. Generates images, video, music,
voiceovers. Models on the page: Nano Banana (Pro), Seedance 2.5/2.0, Kling 3.0,
Veo 3.1, Sora, Google Omni Flash, GPT Image 2, Lyria (music), ElevenLabs (voice).
Clients: Claude, ChatGPT, VS Code. Tool names/schemas NOT published — `tools/list` at
probe. Balance tool: OPEN. Their stock catalog (music/SFX/footage) via MCP: not
advertised — treat as absent.

**Runway** — hosted MCP, connect via runway.com/mcp. Sign in with Runway account, "no
separate API key — generations tied to your existing Runway plan." Models: Gen-4.5,
Gen-4 Turbo, Seedance 2.0, Kling 3.0, Veo 3.1, GPT Image 2, Nano Banana Pro, Aleph
(edit). Their open-source `runway-api-mcp-server` (API-key flavor, dev.runwayml.com
billing — NOT our lane, but likely the same tool shapes) shows the language:
`runway_listModels`, `runway_generateVideo`, `runway_generateImage`,
`runway_upscaleVideo`, `runway_editVideo`, `runway_generateAudio`, `runway_getTask`,
`runway_cancelTask` (real remote cancel!), `runway_getOrg` (candidate balance read).
Refs: **URLs or past generations only — no local-file upload documented.** Our ref
lane may need their upload API or a hosted-URL story — OPEN, probe decides; until
then refs grey with reason on Runway engines.

**Pika** — `https://mcp.pika.me/api/mcp`. OAuth browser redirect, token cached;
**developer keys (`dk_*`) exist as a headless fallback** — the one provider with an
official non-OAuth lane if desktop OAuth fights us. Bills Pika account balance; free
credits on signup. 58 tools / 10 families (their manifest `tools-manifest.json` is
published): generation (video, image, lipsync, music, speech, keyframes, reference
video), scene composition, editing utilities, identity/persona, persistent
character/element refs + voice cloning, upload util, async ops. Balance tool: OPEN.

**ElevenLabs** — `https://api.elevenlabs.io/v1/mcp`. OAuth, workspace-scoped, "no API
keys, revocable anytime." Their MCP page today leads with **agent management**;
creative generation ("voice, music, image & video, 50+ models") is advertised on the
same connector — how much of the creative surface is live over MCP is OPEN, probe
decides. For us v1 scope = **TTS only** (Voice card lane, where ElevenLabs is
currently hidden for want of a key field — OAuth removes that reason). Bills
subscription credits (characters). Column shows TTS minutes.

## 5. Refs + Clip Gen info, per provider (the hard part, named honestly)

Our side is uniform: the compiled prompt (shared/compile.ts output — the SAME bytes the
wire sends today), duration, resolution, aspect, seed-if-supported, and local ref files.
Their side is six different languages. The adapter translates; the probe proves; the UI
greys what a lane can't carry, with the reason, per engine:

| lane | Higgsfield | Magnific | Artlist | Runway | Pika | 11L |
|---|---|---|---|---|---|---|
| prompt | tool arg | tool arg | tool arg | tool arg | tool arg | text |
| image refs | history/upload OPEN | upload trio ✓ | OPEN | URL-only ⚠ | upload util ✓ | n/a |
| video refs | OPEN | OPEN | OPEN | edit lane OPEN | ref-video tool ✓ | n/a |
| audio refs | OPEN | OPEN | OPEN | OPEN | OPEN | n/a |
| seed | OPEN | OPEN | OPEN | OPEN (repo schema per-model) | OPEN | n/a |
| model pin | claimed ✓ probe | via model ids ✓ | OPEN | listModels ids ✓ | OPEN | n/a |
| balance | OPEN | `account_balance` ✓ | OPEN | getOrg? OPEN | OPEN | OPEN |

(✓ = documented; OPEN = undocumented, probe decides; ⚠ = documented limitation.)

## 6. Probe gates — nothing lights up on trust

Per provider, `scripts/probe-mcp.mjs <provider>` (probe-ltx.mjs sibling) must pass,
results stamped into this spec as PROVEN lines with dates:

1. **Connect + OAuth from a desktop client** (DCR or registered id; token refresh works).
2. **tools/list** captured verbatim into `docs/mcp-tools/<provider>.json` (their
   language, on disk, dated — the "research each provider's system" artifact).
3. **Prompt lands whole** — a marker-string render comes back reflecting our exact
   compiled prompt, no rewriting/truncation.
4. **Model pins hard** — ask for model X, output metadata proves X ran (no auto-pick).
5. **Refs bind** — a known face/object ref demonstrably steers the output.
6. **File lands** — finished bytes stream-downloaded to disk through `downloadTo`.
7. **Balance reads** (or documented-absent → `n/a` column).
8. **Cancel + crash recovery** — cancel a queued job; collect a finished job after a
   process restart.

Fail any check → that engine/lane stays dark with the reason on it. Probe spends real
credits — each probe run is announced with an estimate first, on his GO.

## 7. Order of build (after spec approval, each stage gated)

1. Bridge client core, proven against Magnific first — OAuth + `tools/list` +
   `account_balance` cost nothing and Magnific documents the most surface.
2. First VIDEO proof on a known Seedance carrier (Higgsfield or Artlist, whichever
   account is live first): the 8 gates end-to-end on a real Seedance clip. Then the
   BRIDGE panel with its first live columns.
3. Remaining adapters (Runway, the other of Higgsfield/Artlist, Pika, Magnific video
   if its catalog lists Seedance), probe each, columns light as they pass.
4. ElevenLabs TTS lane into the Voice card grammar (unhide, OAuth instead of key).
5. Router (BRIDGE rows) once ≥2 Seedance carriers are probe-proven.
6. Rate tables + seconds math from measured probe renders (never from marketing pages).

## 8. QUESTIONS — ALL ANSWERED 2026-09-01 (see the decisions block up top)

1. v1 model scope → **Seedance 2 + 2.5 only.**
2. Magnific upscaler → **PARKED**, upscaling is a later phase.
3. Probe budget → **approved.**
4. Panel → **normal panel, like any other window in vi-dancer.** Default dock spot =
   my call at build: opens as its own tab in the Queue group.

## Sources (read 2026-09-01)

higgsfield.ai/mcp · docs.magnific.com/modelcontextprotocol · artlist.io/mcp ·
runway.com/news/mcp (runwayml.com redirect) · github.com/runwayml/runway-api-mcp-server ·
github.com/Pika-Labs/Pika-Plugins · elevenlabs.io/mcp ·
elevenlabs.io/docs/eleven-agents/operate/hosted-mcp · bible 12.11 (adapter contract) ·
src/main/fal.ts (RenderRequest) · src/shared/models.ts (registry grammar, seedance2hf
corpse) · src/main/providers/higgsfield.ts (key-API adapter, superseded lane)
