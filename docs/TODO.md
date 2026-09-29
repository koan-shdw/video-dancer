# THE LIST

Video Dancer's to-do list, rebuilt fresh on 2026-09-29 from his own words in the chat logs, with
every item checked against the code that day. Open items only. Nothing here is built unless the
item says so.

How it works: a new ask goes here in his words, and it gets built only when he picks it. Each
item = his words (verbatim), then plain lines on what it is and where it stands. "(was N)" = its
number on the old list, `docs/TODO-2026-09-22.md`, which lives in git history (commit 1b89dd1).
Code comments that cite "TODO-2026-09-22 §N" point there.

## Timeline

1. **Keys 1 to 9 hide tracks** (was 62). "pressing keyboard keys 1-9 will hide the corresponding
   video/audio channel on the timeline if its in the timeline letting editors quickly hide a
   channel to test different clips while they working" (09-29). Key n hides or shows track n,
   its video and its paired audio; a track that doesn't exist is skipped. No number keys do
   anything on the timeline today.
3. **Nest** (was 61). "add ability to turn a selection of clips into a nest and it makes a new
   timeline with that nested edit in it, just like premier" (09-29). The selected clips move into
   a new timeline in the Bin, and one block that plays that timeline takes their place. Needs a
   block that plays a whole timeline, which the app doesn't have.
4. **Audio keyframes, the last two Premiere fixes** (not on the old list). "+0 should be in tbe
   middle of the clip, and double click shoudl snap it · also this doesnt work like premier, we
   shoudl be able to change to the bezier tool and the app point tool, what are the hotkeys for it
   in premier?" (09-09). 0 dB in the middle is done. Still open: double-clicking the line snaps
   the level back to 0 dB (today it adds a keyframe), and Premiere's Selection (V) and Pen (P)
   tools.
5. **Export several timelines at once** (was 46). "add right click export to timelines in the
   bin." (08-07, done) · "allow selectmultiple timelinesfrom bin and export them all" (08-10).
   Pick several timelines in the Bin and export them all, one file each, named after its
   timeline. Agreed 08-10: a default export folder in Settings that single exports use too.
   Today export works on one timeline at a time.
49. **Timelines as tabs, and in their own windows** (09-29). "mtuple timelines can be opened as
    tabs in the timeline section or even dragged into thier own timeline windows" (09-29). Several
    timelines open as tabs in the Timeline panel, the Premiere way (there, double-clicking a nest
    opens it in a new tab), and a tab dragged out becomes its own window. Today the panel shows one
    timeline, and picking another in the Bin swaps it.

## Takes

6. **Keepers are flags** (was 53, 55, 56). "add ability to hit tilder when selecting takes to make
   it a "take" and again to turn the take off, like lightroom, also add it to right click" (09-25)
   · "add a "keeper" only toggle for the takes" · "we'll need more than one keeper ina t ae set
   and for the starts to stay on when they are" (09-26) · "we can have mutple keepers in a take
   set, tilda or click keepersets is as a keeer, its a flag" (09-29). Click or ~ flags a take,
   ~ again or its ★ unflags it, right-click has both, stars stay lit, "★ only" shows just the
   keepers. Spec ready: `KEEPERS-SPEC-2026-09-29.md`.

## Bin and Library

7. **Shift-click multi-selects folders** (was 70). "if hold shift when click a folder it mutle
   selects folders" (09-29). Shift-click picks the range from the last folder clicked, the
   Premiere way. Ctrl-click already adds one; Shift does nothing on folders today.

## Image Edit

8. **GPT Image 2.5** (was 65). His pick 09-29 (supplier review #4: "yes"). Flare and Sunburst on
   fal: 16 refs, masks, transparent background. GPT Image 2 stays listed.
9. **More suppliers for Nano Banana** (was 57). "add other suppliers for nano banana on image
    edit, see if ant of our bidges allow for it and add them as postenital supppmiers" (09-26).
    Every Nano Banana row is fal only today. Found 09-29: logins through Higgsfield, Pika, Artlist
    (beta) and Runway; keys through Google direct, Runway, Magnific, Pika, Astria and Venice.
    Each one becomes a VIA row.
10. **Seedream 5 Pro on ModelArk** (was 12). No quote found in the chats; his standing call
    (08-31) is that ModelArk is the cheap provider he wants. The ModelArk row already sits greyed
    on Seedream ("not wired yet"). Found 09-29: it works, $0.045 an image; Seedream 5.0 Flash is
    there too at $0.018.
11. **Remove the original Nano Banana** (09-29 review). "4. remove old nano" (09-29). Google retired
    it (`gemini-2.5-flash-image`); fal still serves it. Take it out of Image Edit's picker so old
    edits keep their name, like Sora 2.
50. **Our suppliers as VIA rows in Image Edit** (09-29). "also add that we should be able to use the
    VIA of our supplires in image edit, such as modelark, etc" (09-29). Every Image Edit model runs
    through fal only today; Seedream's ModelArk row sits greyed ("not wired yet"). Overlaps 9
    (Nano Banana's suppliers) and 10 (Seedream on ModelArk).

## Video models

12. **Take Sora 2 out** (was 69). "2. yes remove sora" (09-29). OpenAI shut Sora 2 down on 09-24.
    Hide it from the pickers so old takes still play, and drop its name from the Settings hint
    and the About box. Still listed today.
13. **Omni Flash 1.1** (was 63). His pick 09-29 (review #1: "yes"). The upgrade of Omni Flash on
    fal: 3 to 10 s, extends to 40 s, up to 4K, sound on. Newest is the default; 1.0 stays listed.
14. **Venice** (was 34). "look into adding vencie ai into video dancer as borth api and bridge"
    (09-08) · "spec it out lets add it dont forget adding it to settings, and VIA" (09-08, as the
    spec records it) · "what about venice?" (09-23). The spec is written and his four answers are
    in (`VENICE-SPEC-2026-09-08.md`): Seedance 2 and 2.5, a Co-Director option, bitrate high,
    keep the fast rows. Found 09-29: key only, no login, which the spec already plans for. Ready
    to build.
15. **Swap LTX to its newer text encoders** (not on the old list). "1. swap it" (09-29). Lightricks
    updated both LTX text encoders on 08-17; the app still runs the old ones. First find a
    download of the new files that needs no gated login (there wasn't one on 08-25).
16. **LTX with only the full size installed can't render** (not on the old list; my 08-27 note).
    The app still blocks it with "its render recipe is unproven (probe pending)", but the full
    (dev bf16) recipe was proven in the app on 08-27. The block goes.
17. **Seedance 2.5 preview lane** (was 33). "find out how its done if its possible and if we can
    do it" (09-22, from his Discord screenshot). Dreamina renders at 480p, then the same video at
    1080p. Research first: how they do it, whether we can reach it, whether we can copy it on fal.
## Audio

18. **Gemini 3.8 voice** (was 52). "look into adding Gemini 3.8 text-to-speech to voice" (09-24)
    · "add Gemini 3.8 TTS for voice" (09-29); his pick 09-29. It fits his Gemini key: 30 voices
    plus a library, a voice from words or a 30 s sample, 2 speakers, tags like <laugh>.
19. **Eleven v4 voice** (was 64). His pick 09-29 (review #2: "yes"). ElevenLabs' newest speech
    model, on his ElevenLabs key.
20. **Lyria 3.5 in Score** (was 66). His pick 09-29 (review #7: "yes"). Songs from text or up to
    10 images plus his own lyrics; it sings; about 8 cents a song.
21. **ElevenLabs Music v2.5 in Score** (09-29 review). "40. yes add those newer models" (09-29).
    The newer version of the ElevenLabs music model Score has (v2 today). Newest is the default;
    v2 stays listed.
22. **Sound effects** (was 67). His pick 09-29 (review #8: "yes"). A new slot. Candidates: Sonilo
    v1.1 video-to-sound-effects, Pika Soundtrack and SFX, Mirelo SFX 1.6. Where it lives is the
    first spec question.
23. **Lip-sync** (was 68). His pick 09-29 (review #9: "yes"). A new slot. Candidates: sync-3,
    VEED Lipsync v2, H3 Max Lip Sync. Where it lives is the first spec question.
24. **Music refs in Score** (was 40). "it lets you put in monusc and alter it, so we'll want to
    make adjustments to score so we can use music refs" (09-20). Score takes a track as a
    reference and alters it. No Score model takes one today. Research first: Pika Music takes a
    track reference (09-29 review).

## Co-Director

25. **The newest Claude models everywhere** (was 51). "update the bridge so it can use the new
    opus5.5 model for codirector" (09-24) · "add new models opus5.5 to claude bridge mode" (09-26)
    · "imadiate change to video dancer, change the codirector in bridge mode to allow for opus
    5.5" (09-28, done). The bridge list has Opus 5.5 but not Fable 5.1 or Sonnet 5.5, and its
    default is still Fable 5. The API list has only Sonnet 5, Opus 5 and Haiku 4.5, with an
    out-of-date Sonnet price. Haiku 4.5 retires after 10-15. Newest is the default.
26. **Pick how hard it thinks** (was 29). "add ability to chose the level of intelligent for the
    model, ultra for opus for exmaple" (09-21). A thinking level, up to the top on Opus, beside
    the model pick (my pick for the spot). Nothing today.
27. **Full access to every feature** (was 25). "codriector needs full access to all the latest
    features image gen etc" (09-21). It can set an Image Gen prompt and refs, but can't start an
    image gen, set LoRAs, strength, aspect, size or the refs switch, or reach Image Edit, the
    Civitai drag or export. Also from 14: check that its duplicate works on image gens. "also add
    to list giving codirector access to making new image gen clips and whtaever else hes missing"
    (09-29). First step when picked: list every feature it can't reach yet.
28. **The commuters fixes** (was 14). From his paste, "more notes heres what codriector said
    recently point out its issues" (09-20). The guide side was fixed by the Co-Director chat
    (commit a64da81). Still open in the code: a tool to delete or edit a learned rule; the save
    tool is still "remember" and saves on "remember / save that / keep it in mind" instead of
    only on "save". The rest (it sees its own tool calls, knows its real tool list, reads the
    render not the prompt, keeps the brief in front, keeps corrections past 300 messages) gets
    checked at spec.
29. **Web research when he asks** (was 54). "also add ability for codirector to research shit
    online, so it can look online and research if we ask it to" (09-26). The bridge blocks Claude
    Code's own web search and page reading today; they open up when he asks. The API engine needs
    Anthropic's web search tool.
30. **New MOODS styles** (not on the old list). "yeah lets put a pin in that untl the syste isin
    place and when it is lets go nuts on them" (09-08). MOODS shipped in 0.15.0, so the pin is
    due: new styles in the same format.
31. **The rest of the 08-27 Co-Director brief** (not on the old list; he approved the brief
    08-27, `CODIRECTOR-REJIG-BRIEF-2026-08-27.md`). Not built, checked in the code: failed renders
    kept on disk with the provider's reason; a check of the assembled prompt before every paid
    render; its tools writing the voice field and the sheet image slots; deleted Library images
    leaving its view; a stage line. Not checked: a rename reaching sheets, styles and the brief;
    a write log he can read.
32. **Gemini 3.8 Flash for watching cuts** (09-29 review). "40. yes add those newer models"
    (09-29). Watching a cut (Score compose, the Co-Director's watch) defaults to gemini-3.6-flash
    today. 3.8 Flash becomes the default; 3.6 stays listed.
## Logins, keys and setup

33. **Several logins per bridge** (was 24). "look into the ability to log to multiple account on
    the same platform and use the same credits in the credit pool" (09-21) · "i wanted to have
    mutple logins for higgsfield because a friend said she managed to have 5 accounts ot make the
    most of thier deals and i wanted to pool them in one place" (09-23) · "several of same bridge,
    ability ot hit a plus and add a new one for each bridge" (09-29). A ＋ on every Bridge row adds
    another login; each gets its own row and credit bar, all in one pool. One login per supplier
    today.
34. **Artlist and ElevenLabs bridge logins** (was 35). "any other suppliers have MCP?" → "yeah
    eleven and pika" (08-31). Both refused our login on 09-01 (they only let known apps in).
    Artlist has since opened a login MCP in beta: try again, ElevenLabs with it.
35. **GPT and other chat logins** (was 30). "add new logins with gpt and also research other LLM
    servies which we can use such as the new deekseek that came out this week other logins, a
    more seemlyess login experience, can we for exampel login to claude code direct accoutn
    without api, and wat other LLMs can we do that to" (09-21). Found 09-29: ChatGPT signs in
    through OpenAI's Codex CLI and Google through the Gemini CLI, and the app can drive both;
    DeepSeek is key only. "after GPT login make it available as a codirector engine" (09-29):
    once GPT is logged in, it's a Co-Director engine next to the API and the Claude bridge.
36. **Setup wizard** (was 31). "A install and login wizard that lets users log into all the
    servies in a single login wizard the LLM, the video the image it outlines all the serves that
    each will provide and guies them for the login" (09-21). Today the first-run Welcome only asks
    for fal, ModelArk and Astria keys.
37. **Missing-key wizard** (was 49). "shgoudlnt the app have a function where if it tried to do
    somehting that need sna api key it being up a wizard to give the user instructiosn on how to
    add it?" (09-23). A job that needs a key he doesn't have opens that service's key steps
    instead of failing. Nothing today.
38. **Log in to Claude from the app** (was 50). "i want to see if we can 0auth into claud or have
    a seemless way to login to the bridge with cloaud code locally without having to use
    terminal" (09-23). When the login expires, a button signs in (browser page, no terminal) and
    retries the job. Today the app only says the login expired.

## Whole app

39. **Remove the splash's boot timer** (not on the old list). The splash is killed for now
    (09-29: "no loading splash kill it for now"). The temporary boot timer from its tries (the
    `[perf]` lines in `App.tsx`) is still in the app and served nothing else: take it out.
47. **A failed render says what went wrong in one plain line** (09-29). "yes add to list" (09-29),
    after a ModelArk failure filled the queue row with raw code: `error (404) @ modelark/submit:
    {"error":{"code":"ModelNotOpen","message":"Your account ... has not activated the model
    dreamina-seedance-2-5-260628. Please activate the model service in the Ark Console..."}}`.
    The row gets one plain line (here: Seedance 2.5 isn't switched on for this ModelArk account,
    activate it in the Ark Console); the full reply stays in the log.

## Blocked or parked

40. **Suno** (was 39). "we need some new music gen apis what about suno and 11labs" (09-08).
    Blocked: Suno has no public API (checked 09-29).
41. **Upscale and enhance** (09-29). "upscale / enhance is a later thing". Candidates are in
    `SUPPLIER-MODELS-2026-09-29.md`.
42. **Depth lane** (09-08). Parked by him ("put pin in this for later"): depth maps of a dance as
    a motion reference, from a tutorial.
43. **Community MOODS** (09-08). "eventually i'd like this to be a wired into a commuinity project
    where vMDs can be taken froma repo and downloaded by anyone with the app with the name of the
    uyser who made them in there credited". Later.
44. **Voice extras** (08-20). Parked by him ("we're done with voice for now"): Clip Gen fills an
    @audio slot when a sheet links a voice, dialogue vs timbre slot modes with a duration lock, a
    render-dialogue flow.
45. **ArtCraft** (was 23). "good now lets scope this into it too
    https://app.getartcraft.com/pricing same questiosn" (09-08) · "also add this to the list"
    (09-21) · "2. later" (09-29). Parked: ask their team later. Seedance on ArtCraft plan credits;
    spec written (`ARTCRAFT-SPEC-2026-09-08.md`); their staff have to turn on API keys for his
    account first.
46. **ModelArk credit shown like fal's** (09-29). "see if we can have modelark credit displayed liek
    fal" · "add to list for later" (09-29). Parked for later. First step when picked: research
    whether ModelArk lets an app read the balance with the key he already uses.
48. **LoRA card wraps when the sidebar is narrow** (09-29). "text and inuse should wrap under when
    its made this short" · "add to list do later" (09-29), with two screenshots of Image Gen's
    LoRA sidebar: in a narrow sidebar the card's name, badges and trigger chip squeeze (the chip
    stacks one letter per line) and "in use" runs off the edge. When narrow, the text and the
    button move under the image. Parked for later.

## Fresh-install checks (his call 09-23: test on a fresh install, not this one)

- The Bridge banner that says bridging needs an AI (was 37).
- The Hugging Face login prompt on a gated download (was 38).
- 36, 37 and 38 once built.

## Old numbers

Done or confirmed (his word 09-29: everything built and waiting on his test is confirmed): 1-8,
10, 11, 13, 16, 17, 19, 20, 21, 26, 27, 28, 32, 36, 41, 42, 43, 44, 45, 48, 58, 60 (the score tracks, built after the rebuild and
confirmed 09-29: "score works good work"). Dropped: 9 (the
trigger already rides), 15 (YuE), 22 (the splash, killed 09-29: "no loading splash kill it
for now"; his design stays in `SPLASH-SPEC-2026-09-09.md` and the old list), 59 (09-29: "image gen
queue works perfectly"). Off the list, not the app: 18
(SignalRgb), 47 (the Photoshop plugin, its own project). Every other old number is a "(was N)"
above.
