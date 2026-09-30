# Seedance 2.5 preview lane (list 17): what it is and whether we can do it

Date: 2026-09-30 · Status: BUILT 09-30, untested by him, unproven against fal and ModelArk · His ask (09-22, from his Discord
screenshot): "find out how its done if its possible and if we can do it".

Read that day: BytePlus ModelArk "Create a video generation task" and "Dreamina Seedance 2.5"
(docs.byteplus.com/en/docs/ModelArk/1520757 and /2607688); fal's Seedance 2.5 API pages
(text-to-video, reference-to-video, and the new `bytedance/seedance-2.5/draft/complete`).

## The answer

- **How Dreamina does it.** ByteDance calls it Draft mode. It is two renders that belong together:
  1. A Draft render at 480p: a normal Seedance 2.5 render with the draft flag on.
  2. A final render made from the Draft's id. ByteDance re-uses the Draft's prompt, refs, seed,
     sound setting, shape and length, so the final is the same video at 1080p.
- **Is it possible for us.** Yes, on both of his Seedance 2.5 lanes:
  - **fal** has it. Every Seedance 2.5 door takes `draft: true` and answers with a `draft_id`.
    `bytedance/seedance-2.5/draft/complete` takes that id and renders the 1080p final.
  - **ModelArk** has it. The same task API takes `draft: true`; the final is a second task whose
    content is `{ type: 'draft_task', draft_task: { id } }`.
- **The rules are the same on both.** The Draft is always 480p. The final is always 1080p. The
  Draft id works for 7 days, on the account that made it. The two steps are billed apart.

## The facts a build would stand on

**fal**
- Draft: `draft: true` on `bytedance/seedance-2.5/{text-to-video,image-to-video,reference-to-video}`.
  The reply carries `draft_id` beside the video and the seed.
- Final: `bytedance/seedance-2.5/draft/complete` with `{ draft_id, resolution: '1080p', codec }`.
  1080p is the only size. `codec` is `auto`, `H264` or `H265`.
- Price: the Draft is a 480p render (about $0.22 a second). The final is about $1.16 a second
  ($0.0234 per 1,000 tokens at 1080p). With video refs the final's price is multiplied by 0.6 and
  the input video's seconds are billed too.

**ModelArk**
- Draft: `POST /contents/generations/tasks` with `draft: true` and `resolution: '480p'`.
- Final: a second task with `content: [{ type: 'draft_task', draft_task: { id } }]` and
  `resolution: '1080p'`. The prompt, refs, duration, ratio, seed and `generate_audio` must NOT be
  sent again (an error even when they match).
- The 1080p file is 10-bit H.265. ByteDance warns it may not play everywhere. No codec switch is
  documented there.
- Its no-real-faces rule applies, as on every ModelArk render.

**What the app has today that is out of date**
- The app's fal Seedance 2.5 row was read on 08-08: 480p and 720p only. fal's pages now list
  **1080p** as a normal size, a `codec` switch (H264 / H265) and a `bitrate_mode` switch. None of
  that is in the app.
- The app's ModelArk Seedance 2.5 row also stops at 720p. ModelArk lists 1080p now.

## What a build would be (for his call, nothing is decided)

- Clip Gen, on Seedance 2.5 (fal and ModelArk): a "draft" switch beside resolution. On = the
  render is a 480p Draft; the take remembers its Draft id and the day it runs out.
- On a Draft take: a "finish at 1080p" action (right-click, and a button on the card) for the 7
  days the id lives. It renders the final as a new take next to the Draft.
- On fal the final asks for H264, so it plays everywhere the app plays video. ModelArk's 10-bit
  H.265 has to be proven in his app first (Monitor, timeline, export).
- The queue row and the cost line say which step it is.

## Questions for him

1. Build it?
2. The final lands as a new take beside the Draft (the Draft stays). Right?
3. fal's Seedance 2.5 now renders straight to 1080p too (about $1.16 a second). Add 1080p to the
   fal row, and to the ModelArk row?

Venice's Seedance 2.5 row (list 14) already offers 1080p. Venice documents no draft mode.

## Answers (09-30)

He asked on 09-30 for the obvious questions to be answered for him. An answer in quotes is his own.

1. Build it. His ask was whether it can be done, and it can.
2. Yes: the final is a new take beside the Draft, like every render.
3. Yes: 1080p on the fal row and on the ModelArk row.

## Built (09-30)

- **Clip Gen.** A "draft" switch beside resolution, live on Seedance 2.5 (fal) and Seedance 2.5
  (ModelArk), greyed with the reason on every other engine. On: the size dial shows 480p and does
  not open, the cost line is the 480p price, the queue row reads "<clip> · draft". The switch is
  kept with the clip. 1080p is a normal size on both rows.
- **The draft take.** It keeps the Draft's id, who made it (fal or ModelArk) and when. Its card
  wears a DRAFT badge; the tooltip says how many days are left of the seven.
- **The finish.** Right-click a draft take: "finish T3 at 1080p · ~$6.96". It is its own queue row
  ("<clip> · T3 at 1080p"). The app sends only the Draft's id (fal: `draft/complete` with
  `{ draft_id, resolution: '1080p', codec: 'H264' }`; ModelArk: a task whose content is the
  `draft_task`). The final lands as a new take with the Draft's recipe at 1080p; the Draft stays.
  After seven days the entry is greyed with the reason. A draft finishes only on the account that
  made it.
- **A crash mid-render.** A draft that lands on the next open keeps its id; a finish is recovered
  from the finish door.
- **Code.** `src/main/draft.ts`, `fal.ts`, `providers/modelark.ts`, `render:run` in `index.ts`;
  `panels/RenderPanel.tsx`, `shared/models.ts` (`draft` on the two rows), `shared/types.ts`
  (`Take.draft`). Tests: `scripts/test-seedance-draft.cjs` (in `npm test`),
  `scripts/test-draft-browser.cjs` (`npm run test:draft-ui`).
- **Open.** Nothing was sent to fal or ModelArk: a real draft costs money. fal's price for a
  draft is taken to be the 480p price. ModelArk's 1080p final is 10-bit H.265; whether it plays in
  the Monitor, the timeline and export is unproven.
