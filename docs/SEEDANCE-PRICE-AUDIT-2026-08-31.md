# Seedance API price audit — 2026-08-31

Status: RESEARCH. Prices read from provider pages this day. Decisions are the user's; no code without GO.
Covers vi-dancer AND sprite-dancer (sprite = fal only today).

## What the apps pay today (fal)

- Seedance 2.5: $0.0214 per 1k tokens (fal model page, read today) = ~$0.473/s at 720p, ~$0.221/s at 480p. Registry pins 0.462 / 0.208 — slightly stale-low.
- Seedance 2.0: $0.3034/s at 720p (registry pin, fal).
- vi-dancer ALREADY has ModelArk direct wired (`src/main/providers/modelark.ts`, engines `seedance2ark` / `seedance25ark`). Token-billed, estimate blank by the cost-honesty law. Needs a ModelArk key in Settings.

## Verified 720p prices, $ per second of output, no video input

| Provider | 2.0 | 2.5 | Proof |
|---|---|---|---|
| Official token rate (ByteDance "Seed") | $7.00/M tok = $0.151/s | $10.70/M tok = $0.231/s | OpenRouter model pages, read today |
| Replicate | not checked | $0.2312 | replicate.com model page, read today |
| OpenRouter | $0.151 | $0.2311 | their model pages, read today |
| CometAPI | — | ~$0.231 | their pricing article (their own listed rate) |
| EvoLink | not checked | $0.296 | evolink.ai model page, read today |
| PiAPI | — | $0.35 ($0.385 "less restriction") | piapi.ai model page, read today |
| WaveSpeed | not checked | $0.36 ($1.80 per 5s) | wavespeed.ai model page, read today |
| fal (current) | $0.3034 | $0.473 | fal model page, read today |
| Kie.ai | OPEN | OPEN | credit-billed, no public number on their pages |
| Atlas Cloud | OPEN | OPEN | pricing page 404'd |

Facts that matter:

- The cheap tier IS the official ByteDance token rate. Replicate, OpenRouter, CometAPI resell it unmarked. fal charges 2x ($21.40/M vs $10.70/M).
- ModelArk direct bills the same official tokens. So vi-dancer's cheapest 2.5 route is ALREADY WIRED.
- ModelArk caveats (in the registry): video refs parked (need public URLs), refuses real human faces, key in Settings.
- Replicate 2.5 extras vs fal: seed input EXISTS, 30 image refs / 10 video refs / 10 audio refs (fal: no seed, 9/3/3). 480p/720p only, same as fal.
- TRAP: video-INPUT jobs on Replicate 720p = $0.9676/s. Reference-video work is where cheap routes stop being cheap.
- The source chat's one miss: it said OpenRouter had no 2.5. It does, at the official rate.

## Options (user picks)

1. vi-dancer, no code: put a ModelArk key in Settings, use the (ModelArk) engines. 2.5 at ~half fal.
2. sprite-dancer: port modelark.ts + two registry rows from vi-dancer (bible ch12 port process, vi-dancer = reference). Sprite only sends image refs, so the parked video refs cost nothing.
3. New Replicate adapter (either app): official price plus seed input and video refs, no face policy seen. New machinery — only on his word.
4. Question for him: token-billed engines show a blank estimate (cost honesty). The official token rate is now proven and computes exactly like fal's formula. Fill the estimate, or keep blank?
