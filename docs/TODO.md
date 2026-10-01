# THE LIST

Video Dancer's to-do list, rebuilt fresh on 2026-09-29 from his own words in the chat logs, with
every item checked against the code that day. Open items only. Nothing here is built unless the
item says so.

How it works: a new ask goes here in his words, and it gets built only when he picks it. Each
item = his words (verbatim), then plain lines on what it is and where it stands. "(was N)" = its
number on the old list, `docs/TODO-2026-09-22.md`, which lives in git history (commit 1b89dd1).
Code comments that cite "TODO-2026-09-22 §N" point there.

## Timeline

3. **Nest** (was 61). "add ability to turn a selection of clips into a nest and it makes a new
   timeline with that nested edit in it, just like premier" (09-29). The selected clips move into
   a new timeline in the Bin, and one block that plays that timeline takes their place. Part 1
   confirmed 09-29 ("works great"). Part 2 built 09-29, test later: the nest's own dissolve,
   speed and effects, its sound's level, fades, keyframes and unlink, its thumbnails and
   waveform, audio dropped on its sound cutting into it, the Co-Director keeping nests.
4. **Audio keyframes, the last two Premiere fixes** (not on the old list). "+0 should be in tbe
   middle of the clip, and double click shoudl snap it · also this doesnt work like premier, we
   shoudl be able to change to the bezier tool and the app point tool, what are the hotkeys for it
   in premier?" (09-09). 0 dB in the middle is done. Built 09-30, test later: double-click the
   line or a keyframe = back to 0 dB; V = Selection, P = Pen (a click on the line adds a
   keyframe, a box selects keyframes, clips stay put); Ctrl-click a keyframe = Linear ↔ Auto
   Bezier (Adobe's rule; it used to delete).
5. **Export several timelines at once** (was 46). "add right click export to timelines in the
   bin." (08-07, done) · "allow selectmultiple timelinesfrom bin and export them all" (08-10).
   Pick several timelines in the Bin and export them all, one file each, named after its
   timeline. Agreed 08-10: a default export folder in Settings that single exports use too.
   Built 09-30, test later: pick timelines in the Bin (Ctrl / Shift-click), right-click →
   export N timelines…, one folder for the lot; Settings → export → export folder (set = every
   export lands there, no save box; clear = asked each time).
49. **Timelines as tabs, and in their own windows** (09-29). "mtuple timelines can be opened as
    tabs in the timeline section or even dragged into thier own timeline windows" (09-29). Several
    timelines open as tabs in the Timeline panel, the Premiere way (there, double-clicking a nest
    opens it in a new tab), and a tab dragged out becomes its own window. Built 09-30, test later:
    a tab strip on the Timeline panel (a timeline shown from the Bin or a nest opens a tab; drag
    along = reorder; × / middle-click closes the tab, never the timeline); drag a tab out = it
    floats in its own timeline panel (dock it anywhere); a click in a timeline panel makes its
    timeline the active one (the Monitor follows) and gives it the keys.
51. **Clip speed with reverse, Premiere's dialog** (09-29). "i want to be able to control a clips
    speed, with reverse in there" · "make sure its right lick option like premier too" · "so
    mppremiers speed change looks like this but the one you build it shit" (09-29, with a
    screenshot of Premiere's Clip Speed / Duration dialog). Right-click opens that dialog: Speed %
    and Duration tied by the chain button, Reverse Speed, Maintain Audio Pitch, Ripple Edit
    Shifting Trailing Clips, Time Interpolation (Frame Sampling, Frame Blending, and 52's
    interpolation models in Optical Flow's place). Built 09-30 (Ctrl+R opens it too), test
    later. Optical Flow built 10-01 with 52, test later: on a slowed block it plays a copy of
    the take with the frames it needs; with no such copy yet, OK opens ENHANCE on the take.
53. **Copy, cut and paste in the timeline** (09-29). "also im noticing copy/cut past in timeline
    doesnt work, fix it" · "paste" (09-29). Clicking a timeline block left the keyboard in the last
    text box clicked, so Ctrl+C / X / V went there. Fixed 09-29, test later.
55. **A duplicated timeline keeps all of it** (09-30). Found while building the nest: the copy
    kept only the clips and the audio blocks, so its scores, markers, extra tracks, locks and
    mutes, work range and export settings were lost. Fixed 09-30 (his call: a found bug gets
    fixed), test later: duplicate a timeline from the Bin or through the Co-Director and the
    copy holds everything, each block its own.
56. **Speed ramps** (10-01). "It also allows for slowmotion and slowmo ramping." (10-01), said of
    interpolation. A block whose speed changes along its length, drawn on the timeline the
    Premiere way (time remapping: the speed line on the block, with keyframes). Today 51's dialog
    sets one speed for the whole block. An interpolated copy from ENHANCE (52) gives the slow
    part of a ramp its frames. Spec: `SPEED-RAMPS-SPEC-2026-10-01.md` (Adobe's own page read
    10-01). Built 10-01, test later: right-click a block → time remapping ▸ speed puts the speed
    line on it (100 % in the middle, up to 1000 %, down to 10 %) with a keyframe strip along its
    top. Drag the line = that part's speed, a tooltip says how much; the block grows or shrinks
    as you drag and stops at the next block (its end trimmed there, nothing moves). Ctrl-click
    the line (or click it with the Pen) = a keyframe; click a keyframe, pull its handles apart =
    a ramp; drag it = move it; Delete or its right-click = remove it. time remapping ▸ remove =
    one speed again. Its sound plays at normal speed (Premiere: time remapping is the
    picture's). The speed dialog greys Speed, Duration and Reverse on it; its Optical Flow reads
    the slowest part. The Monitor and the export follow the line (proven with real frames). Not
    on a nest, a storyboard block or a reversed block.

## Effects

52. **ENHANCE: interpolate and upscale** (09-29, mapped with him 10-01). "in the effects i want
    to be able to add a new feature which will let us interpolate clips using online and local
    models including topaz headless" · "may as well put enlaring in there too, online, local and
    topaz" · "make sure its right lick option like premier too" (09-29) · "the interpolation and
    enlarging are two different processes really and they need to be mapped out properly" · "we
    make a new window called ENHANCE it has two sections in it withthier own pills and design
    model choices and settings Interpolate and Enlarge" · "word upscale tgats ht ewor di was
    lookign for" · "A take appears in its monitor same layout as clip gen, etc. With a slide bar
    which lets you see before and after as well as a replay speed setting so you can see the
    before and after of its playback with interpolacing." · "Once a clip is enhanves a copy of it
    appears in its clip gen window with an outline around it to indicate that its an enhances
    version. blue for interpolated, green for enhances and purple for both, If the clip that was
    being enhances is from the library then it appears in the libaray next to the original, if it
    was a take tat was also dragged into the library same goes." · "the setting sin the window
    let us have all the options for topaz locally before we open the headless and enhave giving
    us ful ability to do it withotu opening the app, also also for the other models online, local
    etc those setting will change depending on the mode / service." (10-01). A new window,
    ENHANCE, with two sections, INTERPOLATE and UPSCALE, each with its own engine pills, model
    choice and settings. The take sits in a monitor laid out like Clip Gen's, with a before and
    after slide bar and a replay speed. The result is a copy: a new take in Clip Gen with an
    outline (blue = interpolated, green = upscaled, purple = both), and next to the original in
    the Library when the source is there. Engines: RIFE on fal, Topaz on fal, SeedVR2 on fal;
    RIFE and Real-ESRGAN on his PC; Topaz Video on his PC, every option, never opened. An
    interpolated copy is what gives 51's slowed blocks and 56's ramps their frames, and it turns
    on 51's Optical Flow. It took in the old 41 (upscale and enhance), off the list 10-01 on his
    word: "the upscale and enhance is already done". Spec:
    `ENHANCE-SPEC-2026-10-01.md` (the 09-30 one, `INTERPOLATE-ENLARGE-SPEC-2026-09-30.md`, is
    replaced by it). Built 10-01, test later: right-click a take in Clip Gen, a timeline block or
    a Library video → enhance…, or Window → Enhance. The monitor plays the take and its newest
    copy together with the slide bar, replay speed and zoom. The two cards, their engines, models
    and settings; the button says the price. RIFE and Real-ESRGAN download in the Models card
    (enhance). A free 2 s preview runs on the engines of his PC. Not proven: no engine has made a
    copy of a real take yet (Topaz only ran on a test pattern 10-01). His first look (10-01):
    "yeah its good but a few cleanups" · "The slider should always be on the mintor currently zoom
    cna zoom the slider so its out of the sceeen, also hand drag not just scroll bars, mouse
    scroll should zoom in and out". Fixed 10-01, test later: the slide bar stays on the monitor
    at any zoom, the mouse wheel zooms at the pointer (fit to 800 %, the zoom box says how far),
    a drag moves the zoomed picture with the hand, the scroll bars stay, a click still plays and
    pauses. "dbl click gores back to 100%" (10-01). Fixed 10-01, test later: a double-click on the
    picture goes to 100 % with that spot in the middle; at 100 % a double-click goes back to fit
    (my pick, Lightroom's toggle); playback stays as it was. "disable click play" · "only for
    the enhance module" (10-01). Fixed 10-01, test later: in ENHANCE a click on the picture does
    nothing, the play button plays and pauses; at fit the pointer is a magnifier. The other
    monitors keep click to play. "a  enhanved clip on the timeline shoudl also have the outline" · "also have a right
    click on the imtem in the timeline where we can select the enhanved version of it enhances
    then a submenu comes up with any enhannced version" (10-01). Built 10-01, test later: a
    timeline block playing an enhanced copy wears the same outline, inside the selection ring,
    with what was done in its tooltip; right-click a block → enhanced ▸ lists the original and
    every enhanced copy of its take (colour, what was done, a tick on the one playing); a pick
    plays it, a longer copy ripples like any take switch; no copies = greyed with the reason.
42. **Depth lane** (09-08). Parked by him ("put pin in this for later"): depth maps of a dance as
    a motion reference, from a tutorial. Spec: `DEPTH-LANE-SPEC-2026-10-01.md`. Built
    10-01, test later: right-click a Library video, a take in Clip Gen or a timeline block → make
    depth video · $0.48 (its seconds × $0.04). One queue row: fal's Depth Anything Video, VDA
    large, grayscale, the tutorial's settings. The depth map lands in the Library next to its
    source, "<name> · depth map", in a grey outline; its tooltip says to drop it in a clip's
    @video refs (the motion without the look). Never a take. A crash mid-job lands it on the
    next open. Not proven: no depth map was made on fal.

## Takes

6. **Keepers are flags** (was 53, 55, 56). "add ability to hit tilder when selecting takes to make
   it a "take" and again to turn the take off, like lightroom, also add it to right click" (09-25)
   · "add a "keeper" only toggle for the takes" · "we'll need more than one keeper ina t ae set
   and for the starts to stay on when they are" (09-26) · "we can have mutple keepers in a take
   set, tilda or click keepersets is as a keeer, its a flag" (09-29). Click or ~ flags a take,
   ~ again or its ★ unflags it, right-click has both, stars stay lit, "★ only" shows just the
   keepers. Spec ready: `KEEPERS-SPEC-2026-09-29.md`. Built 09-30, test later, in Clip Gen, Sheet
   Gen, Image Gen, Score and Voice: click = a keeper that plays (the others stay flagged), ~ =
   flag / unflag the selected, a lit ★ = click to unflag, right-click ★ keeper / ☆ not a keeper,
   ★ only. The take flagged last plays; a new render lands unflagged (it plays only while nothing
   is flagged); an old project's keeper is its one flag.

## Bin and Library

7. **Shift-click multi-selects folders** (was 70). "if hold shift when click a folder it mutle
   selects folders" (09-29). Shift-click picks the range from the last folder clicked, the
   Premiere way. Ctrl-click already adds one. Built 09-30, test later (Bin and Library folder
   chips).

## Image Edit

8. **GPT Image 2.5** (was 65). His pick 09-29 (supplier review #4: "yes"). Flare and Sunburst on
   fal: 16 refs, masks, transparent background. GPT Image 2 stays listed. Built 09-30, test later:
   both in Image Edit's model list, quality up to max (the default), and a background dial
   (auto, transparent, opaque): transparent gives a see-through PNG.
9. **More suppliers for Nano Banana** (was 57). "add other suppliers for nano banana on image
    edit, see if ant of our bidges allow for it and add them as postenital supppmiers" (09-26).
    Every Nano Banana row is fal only today. Found 09-29: logins through Higgsfield, Pika, Artlist
    (beta) and Runway; keys through Google direct, Runway, Magnific, Pika, Astria and Venice.
    Each one becomes a VIA row. Built 09-30, test later: Nano Banana 2 and Pro run straight from
    Google on the Google key already in Settings (VIA Google: $0.067 and $0.134 an image at 1K,
    fal's are $0.08 and $0.15), and on the Venice key (VIA Venice: $0.10 and $0.18, built from
    Venice's docs with 14, not proven). On the logins: "3. yes" (09-30, to asking them what they
    have and one test picture each). Built 09-30, test later: Higgsfield, Runway and Pika are
    VIA rows on Nano Banana 2 and Pro, paid from each plan's credits; the button shows credits
    where the supplier states them. Proven with one test picture each on Higgsfield (1.5 of its
    credits) and Runway (7 of its credits). Pika's login had 0 credits, so its row is built from
    its tool list and not proven. Not added: Magnific (its list carries no Nano Banana for his
    account), Artlist (not logged in), Astria (its public docs don't say how its Nano Banana
    takes a size or reference images), and key boxes for Runway, Magnific and Pika (their
    logins cover them).
10. **Seedream 5 Pro on ModelArk** (was 12). No quote found in the chats; his standing call
    (08-31) is that ModelArk is the cheap provider he wants. The ModelArk row already sits greyed
    on Seedream ("not wired yet"). Found 09-29: it works, $0.045 an image; Seedream 5.0 Flash is
    there too at $0.018. Built 09-30, test later: Seedream 5.0 Pro's ModelArk row is live (sizes
    2K, 1.5K, 1K: $0.09 at 2K, $0.045 up to 1.5K), and Seedream 5.0 Flash is listed on fal
    ($0.027) and ModelArk ($0.018). fal stays the first pick; the VIA pick is remembered per model.
11. **Remove the original Nano Banana** (09-29 review). "4. remove old nano" (09-29). Google retired
    it (`gemini-2.5-flash-image`); fal still serves it. Take it out of Image Edit's picker so old
    edits keep their name, like Sora 2. Built 09-30, test later.
50. **Our suppliers as VIA rows in Image Edit** (09-29). "also add that we should be able to use the
    VIA of our supplires in image edit, such as modelark, etc" (09-29). Every Image Edit model runs
    through fal only today; Seedream's ModelArk row sits greyed ("not wired yet"). Overlaps 9
    (Nano Banana's suppliers) and 10 (Seedream on ModelArk). Built 09-30 with 9 and 10, test
    later: ModelArk on Seedream 5.0 Pro and Flash, Google on Nano Banana 2 and Pro, Venice on
    Nano Banana 2, Pro and Seedream 5.0 Pro; each supplier shows its own sizes and price. GPT
    Image stays fal only (Venice's edit door takes no mask, and no Bridge login takes one for it).
    The Bridge logins came with 9: Higgsfield, Runway and Pika on Nano Banana 2, Pro and Seedream
    5.0 Pro, and Higgsfield on Seedream 5.0 Flash.

## Video models

12. **Take Sora 2 out** (was 69). "2. yes remove sora" (09-29). OpenAI shut Sora 2 down on 09-24.
    Hide it from the pickers so old takes still play, and drop its name from the Settings hint
    and the About box. Built 09-30, test later: out of Clip Gen's MODEL list (a clip that still
    pins it keeps its row, with a note that it was shut down), out of the Settings hint and the
    About box; the Co-Director is told never to pick it.
13. **Omni Flash 1.1** (was 63). His pick 09-29 (review #1: "yes"). The upgrade of Omni Flash on
    fal: 3 to 10 s, extends to 40 s, up to 4K, sound on. Newest is the default; 1.0 stays listed.
    Built 09-30, test later: Gemini Omni Flash 1.1 in Clip Gen's MODEL list above 1.0 (360p to
    4K, 3 to 10 s, an end frame on image-to-video); the Video Editor opens on it and its edits
    take a resolution. Also built 09-30, test later: its video refs in Clip Gen (up to three
    clips of 3 s each, @video1…), and extending a video in the Video Editor (the engine row
    "Gemini Omni Flash 1.1 (Google) — extend"): it adds 3 to 10 seconds to the end, up to 40 s
    in all, on the Google key. A video of 10 s or less is sent; one that an extend made
    continues from its session on Google. fal has no extend door, so this is Google's own API
    (no free tier there, about $0.10 a second added at 720p). Not proven against Google.
14. **Venice** (was 34). "look into adding vencie ai into video dancer as borth api and bridge"
    (09-08) · "spec it out lets add it dont forget adding it to settings, and VIA" (09-08, as the
    spec records it) · "what about venice?" (09-23). The spec is written and his four answers are
    in (`VENICE-SPEC-2026-09-08.md`): Seedance 2 and 2.5, a Co-Director option, bitrate high,
    keep the fast rows. Found 09-29: key only, no login, which the spec already plans for. Built
    09-30, test later, NOT proven against Venice (no key here; the spec's build-status block
    lists it all): the Venice key in Settings; Seedance 2, Seedance 2 fast and Seedance 2.5 as
    Venice VIA rows in Clip Gen and the Video Editor, each render showing Venice's own quote
    first; a Venice key row on the Bridge panel and a Venice lane under Bridge (auto); Venice as
    a third Co-Director engine in Settings (Claude through Venice). Venice's own logo is on its
    Bridge row ("4. yes" 09-30, to the download). Still open: his first render on his key is
    the probe.
15. **Swap LTX to its newer text encoders** (not on the old list). "1. swap it" (09-29). Lightricks
    updated both LTX text encoders on 08-17; the app still runs the old ones. First find a
    download of the new files that needs no gated login (there wasn't one on 08-25). Built 09-30,
    test later: open mirrors found whose files are byte-identical to Lightricks' current ones
    (same sha256), and the app now pins those. An install that holds the old encoder keeps
    rendering on it; its Models card row shows "update" (15.4 GB, or 26.3 GB for full), which
    fetches the new file, checks it, then swaps it in. The old file stays beside it as `.prev`
    until one local LTX render has run on the new one.
16. **LTX with only the full size installed can't render** (not on the old list; my 08-27 note).
    The app still blocks it with "its render recipe is unproven (probe pending)", but the full
    (dev bf16) recipe was proven in the app on 08-27. The block goes. Built 09-30, test later:
    with only full installed, Clip Gen renders on it; a distilled size still wins when one is
    installed.
17. **Seedance 2.5 preview lane** (was 33). "find out how its done if its possible and if we can
    do it" (09-22, from his Discord screenshot). Dreamina renders at 480p, then the same video at
    1080p. Research first: how they do it, whether we can reach it, whether we can copy it on fal.
    Researched 09-30: it is ByteDance's Draft mode (a 480p Draft, then a 1080p final made from the
    Draft's id, within 7 days), and both fal and ModelArk have it. Findings and the answers:
    `SEEDANCE25-DRAFT-LANE-2026-09-30.md`. Built 09-30, test later: a "draft" switch beside
    resolution in Clip Gen on Seedance 2.5 (fal and ModelArk). On = a cheap 480p draft; the take
    wears a DRAFT badge and says how many days are left. Right-click the draft take, "finish at
    1080p": the same video lands as a new take, the draft stays. 1080p is also a normal size on
    both rows now. Not proven against fal or ModelArk (a real draft costs money). ModelArk's
    1080p file is 10-bit H.265 and has to be proven to play in his app.
## Audio

18. **Gemini 3.8 voice** (was 52). "look into adding Gemini 3.8 text-to-speech to voice" (09-24)
    · "add Gemini 3.8 TTS for voice" (09-29); his pick 09-29. It fits his Gemini key: 30 voices
    plus a library, a voice from words or a 30 s sample, 2 speakers, tags like <laugh>. Built
    09-30, test later: Gemini 3.8 Flash TTS and Flash-Lite in the Voice card, on the Google key: a
    voice designed from the description (saved in his Google project) or one of its 30 voices, a
    style line that is steered and never read, tags in the test line. Also built 09-30, test
    later, the three extras:
    - **Bigger library.** A "search voices" box beside the voice list: his words (warm, british,
      old man) search Google's library and the matches fill the list, his own saved voices first.
    - **Two speakers.** A "second speaker" pick: another voice of the project, or a ready voice.
      The test line is then a dialogue: each line starts with a speaker's name ("Kai: …",
      "Mira: …"); "Mira (whispering): …" says how that one line is delivered. Each voice brings
      its own style line. The take lands on the voice that rendered it.
    - **Copy a sample.** A "consent clip" box beside the clone sample, and the statement the
      real speaker has to read (30 languages). With a sample (10 to 30 s) and the consent clip,
      the next take copies the voice and saves it in his Google project; later takes re-use it.
      Without the clip the voice is designed from the description, as before.
    Not proven against Google: none of the three was sent (a copy needs a real speaker's clip).
19. **Eleven v4 voice** (was 64). His pick 09-29 (review #2: "yes"). ElevenLabs' newest speech
    model, on his ElevenLabs key. Built 09-30, test later: Eleven v4 and v4 Turbo in the Voice
    card, on the ElevenLabs key: a voice picked from his account, one designed from the
    description, or a clone of the sample (a designed or cloned voice is saved in his ElevenLabs
    account and later takes speak in it).
20. **Lyria 3.5 in Score** (was 66). His pick 09-29 (review #7: "yes"). Songs from text or up to
    10 images plus his own lyrics; it sings; about 8 cents a song. Built 09-30, test later: Lyria
    3.5 in Score's model list, on the Google key: the style prompt, beats as its timeline lines,
    his lyrics or instrumental. The length is asked for in the prompt, so a take can run a little
    short or long of the span. Also built 09-30, test later: a "pictures" strip under the lyrics
    in the Score card. Up to 10 Library pictures (drag them in, or click ＋) and the music follows
    their mood and colours. Greyed on every other model. Not proven against Google.
21. **ElevenLabs Music v2.5 in Score** (09-29 review). "40. yes add those newer models" (09-29).
    The newer version of the ElevenLabs music model Score has (v2 today). Newest is the default;
    v2 stays listed. Built 09-30, test later: ElevenLabs Music v2.5 in Score's model list, above
    v2.
22. **Sound effects** (was 67). His pick 09-29 (review #8: "yes"). A new slot. Candidates: Sonilo
    v1.1 video-to-sound-effects, Pika Soundtrack and SFX, Mirelo SFX 1.6. Where it lives is the
    first spec question. Researched 09-30 (ElevenLabs makes effects from words too, on his key):
    findings and the answers in `AUDIO-SLOTS-SPEC-2026-09-30.md`. Built 09-30, test later: a new
    card, "SFX Gen" (Window menu), beside Score and Voice. "＋ new sound fx" in the card makes a
    sound; it lands in the Bin with the scores and goes on a score track like one. Two models:
    Sonilo v1.1 makes the sound of the footage under the sound's span (fal key, about $0.009 a
    second; words steer it, "moments" give a stretch its own sound); ElevenLabs makes a sound
    from words (his ElevenLabs key; length 0.5 to 30 s, can loop). Not proven against fal or
    ElevenLabs. Not built: Mirelo and Pika (Pika needs a key the app does not have).
23. **Lip-sync** (was 68). His pick 09-29 (review #9: "yes"). A new slot. Candidates: sync-3,
    VEED Lipsync v2, H3 Max Lip Sync. Where it lives is the first spec question. Researched
    09-30: findings and the answers in `AUDIO-SLOTS-SPEC-2026-09-30.md`. Built 09-30, test later,
    all on the fal key:
    - **A take's mouths matched to a voice.** Video Editor, engine "sync-3 — lip-sync" or "VEED
      Lipsync v2 — lip-sync". Instead of words it asks for the voice: a Bin voice or a Library ♪
      track (with a from/to). sync-3 also asks what to do when the lengths differ. The result is
      a node in the tree like any edit. About $8 a minute (sync-3), $0.07 a second (VEED).
    - **From the timeline.** Right-click a block with a Library sound under it: "lip-sync this
      take to ♫ …" opens the Video Editor with that sound and both windows already set. Nothing
      renders until Generate.
    - **A still that talks.** Clip Gen, model "H3 Max Lip Sync (a talking still)": one reference
      picture and one audio ref (a Library track or a Bin voice) make a video as long as the
      voice (5 s to 15 min). No prompt is sent. 480p to 2K, $0.05 to $0.32 a second.
    Not proven against fal.
24. **Music refs in Score** (was 40). "it lets you put in monusc and alter it, so we'll want to
    make adjustments to score so we can use music refs" (09-20). Score takes a track as a
    reference and alters it. No Score model takes one today. Research first: Pika Music takes a
    track reference (09-29 review). Researched 09-30: two engines the app already has can do it
    (ACE-Step 1.5 local: cover, repaint, style reference; ElevenLabs Music: an uploaded track
    conditions the plan). Findings and the answers in `AUDIO-SLOTS-SPEC-2026-09-30.md`. Built
    09-30, test later: a "music ref" box in the Score card (drag a Library ♪ track in, or click),
    a "from (s)" start, and one dial from "only the style" to "keep the tune". ACE-Step re-makes
    the track in the style prompt (its cover task, free, local). ElevenLabs Music v2 / v2.5
    uploads the track once (they check uploads for copyright) and every section of the plan
    follows its stretch of it. Greyed with the reason on every other model. Not proven: no
    render was run on ACE-Step with a track, nothing was sent to ElevenLabs.
57. **A beat in the score, from the timeline** (10-01). "add to list, right click on timeline,
    breat beat in score" if a score is in the timeline." · "This will ad a new beat to the scores
    section whisch is blank. in this area" (10-01, with a screenshot of the Score card's BEATS
    list: the rows of a time and a line of text, under compose and ＋ beat). Right-click the
    timeline while a score is on it: "create beat in score" adds a new blank row to that score's
    beats. Not said by him: the new beat's time (my reading: where he right-clicked). Built
    10-01, test later: right-click the timeline (an empty track, the audio or score ground, or a
    score block) → ♪ create beat in score. A blank beat lands in the score under that spot, at
    that second of its span, and the Score card opens on it with the new row ready to type in.
    Off any score: greyed, with the reason. Two scores there: a submenu names each. No score on
    the timeline: no entry.
44. **Voice extras** (08-20). Parked by him ("we're done with voice for now"): Clip Gen fills an
    @audio slot when a sheet links a voice, dialogue vs timbre slot modes with a duration lock, a
    render-dialogue flow. Spec: `VOICE-EXTRAS-SPEC-2026-10-01.md`. Built 10-01, test later:
    - **The slot a sheet brings.** Link a char sheet whose VOICE box holds a voice: a 🎤 @audio
      slot lands with it (the voice, ⛉ the sheet's name); unlink the sheet and it goes. The ＋ box
      lists the Bin's voices, and a voice dragged from the Bin adds one too. The voice's
      description is the character's voice line when the sheet's own is empty.
    - **Timbre or dialogue.** A pill on the slot: timbre (the voice's sound, the words from the
      dialogue lines; its tooltip warns they can drift) or dialogue (this exact audio, lips in
      sync). The prompt says which, one line per slot. Dialogue locks the clip's length to the
      audio, rounded up to the engine's next length (🔒 on the duration box); another length is
      allowed and raises a ⚑ above the render button. A Library track cycles ref, timbre,
      dialogue.
    - **Render dialogue.** "🎤 dialogue" on a voice slot speaks the beats' dialogue lines for
      that character through the voice (its engine and settings, priced where the engine has a
      rate), as a queue row. It lands in the Library as "voice · dialogue · clip" and the slot
      flips to it in dialogue mode, the length locked.
    The Co-Director's sheet links bring and take the slot the same way. Not built: ambience or
    foley mixed into the dialogue track. Not proven: no dialogue was rendered.

## Co-Director

25. **The newest Claude models everywhere** (was 51). "update the bridge so it can use the new
    opus5.5 model for codirector" (09-24) · "add new models opus5.5 to claude bridge mode" (09-26)
    · "imadiate change to video dancer, change the codirector in bridge mode to allow for opus
    5.5" (09-28, done). The bridge list has Opus 5.5 but not Fable 5.1 or Sonnet 5.5, and its
    default is still Fable 5. The API list has only Sonnet 5, Opus 5 and Haiku 4.5, with an
    out-of-date Sonnet price. Newest is the default. Built 09-30, test later: both lists carry
    Fable 5.1, Opus 5.5 and Sonnet 5.5, the newest of each first, the older ones still listed.
    The default is Fable 5.1 on the bridge and Sonnet 5.5 on the API. Prices are today's (Sonnet
    5 stays $2 / $10, the rise was called off). The Director's Room chip flips Opus 5.5 and
    Sonnet 5.5. Sonnet 5.5 on the bridge needs Claude Code 2.1.284; the app offers the update.
    Haiku 4.5 stays listed: it is still active, Anthropic promises it until at least 10-15 and
    has announced no end.
26. **Pick how hard it thinks** (was 29). "add ability to chose the level of intelligent for the
    model, ultra for opus for exmaple" (09-21). A thinking level, up to the top on Opus, beside
    the model pick (my pick for the spot). Built 09-30, test later: Settings → Co-Director,
    beside the model: thinking auto, low, medium, high, xhigh, max (the top). It rides every
    exchange on all three engines, and the panel header shows it beside the model's name. Haiku
    has no levels, so the pick greys there. A higher level gets more room to think and a longer
    wait before a timeout.
27. **Full access to every feature** (was 25). "codriector needs full access to all the latest
    features image gen etc" (09-21). It can set an Image Gen prompt and refs, but can't start an
    image gen, set LoRAs, strength, aspect, size or the refs switch, or reach Image Edit, the
    Civitai drag or export. Also from 14: check that its duplicate works on image gens. "also add
    to list giving codirector access to making new image gen clips and whtaever else hes missing"
    (09-29). First step when picked: list every feature it can't reach yet. Built 09-30, test
    later, the Image Gen part: it makes a new image gen, sets every dial in the panel (model,
    aspect, size, renders, seed, the refs switch and boosts, loras and weights, unleashed),
    duplicates and renames one, flags the ★ take and copies a take into the Library. Firing the
    render stays his. The list of everything else it can't reach is in
    `CODIRECTOR-REACH-2026-09-30.md`, with the answers. On firing renders: "yes but needs go
    command and there needs to be a button in the UI for codirector which enables it" (09-30).
    Built 09-30, test later: a "renders" button in the Co-Director panel and the Room, off until
    he turns it on. With it on, and only when his whole message is the single word go, it
    presses render for a clip or an image gen, and the job lands in the Queue as his own click
    would. The app checks the switch and the go itself; 20 renders at most per go.
    Also built 09-30, test later, the rest of its reach, in the order he was given:
    - **Clip Gen's dials**: mode, resolution, aspect, sound, negative, draft, start and end
      frame, video and audio refs, loras, the prompt link, the pictures on beats. It is refused a
      size the engine can't make, and told when something is kept but won't be sent.
    - **Score and sound fx**: make one, write its style, beats, lyrics, length, model, music ref
      and pictures, flag the keeper, rename, duplicate, delete (undoable).
    - **Voice**: make one, write its description, test line, model, image, sample, consent clip,
      ready voice, style, second speaker; flag the keeper, rename, delete (undoable).
    - **The timeline's sound**: Library audio on the A tracks, scores and sound fx on the S
      tracks (start, length, track, gain, fades, mute), export settings and the two track mutes.
    - **Takes**: colour and disable (clip, score, voice, image gen), remove a clip's take, a clip
      from a take, clips from images.
    - **Library**: rename audio and video, duplicate an image, folders of every kind, which edit
      is an image's face.
    - **Firing, more kinds** (same switch, same go): a score or sound fx, a voice take, an image
      edit, a video edit (a lip-sync too).
    - **It sees them**: scores, sound fx, voices, Library audio and video and the timelines'
      sound are in its index; read_object opens each in full.
    Kept with him: keys, logins, model downloads, switching a MOOD on, undo, imports and exports
    (a file picker), a block's effects, and deleting anything whose file goes with it.
28. **The commuters fixes** (was 14). From his paste, "more notes heres what codriector said
    recently point out its issues" (09-20). The guide side was fixed by the Co-Director chat
    (commit a64da81). Still open in the code: a tool to delete or edit a learned rule; the save
    tool is still "remember" and saves on "remember / save that / keep it in mind" instead of
    only on "save". The rest (it sees its own tool calls, knows its real tool list, reads the
    render not the prompt, keeps the brief in front, keeps corrections past 300 messages) gets
    checked at spec. Built 09-30, test later: the save tool is now "save rule": it saves only
    on the word save, in his words. Edit rule and delete rule change or remove one rule, by its
    number or its text; the rules show numbered, with their file named. Every reply keeps the
    list of tools it ran and reads it back, so it can't deny a call. Its whole tool list is
    spelled out in its instructions. COMPACT now keeps his corrections word for word. Checked,
    already true: the brief rides every exchange; the guide tells it to judge by the render.
    Also built 09-30, test later: the chat folds itself. When the live conversation reaches 40
    messages (all that ride one exchange), the app presses COMPACT by itself after the reply:
    the older ones go into the brief and a digest, his corrections word for word. The panel
    reads "folding the older messages…" while it does; a message typed meanwhile waits.
29. **Web research when he asks** (was 54). "also add ability for codirector to research shit
    online, so it can look online and research if we ask it to" (09-26). The bridge blocks Claude
    Code's own web search and page reading today; they open up when he asks. The API engine needs
    Anthropic's web search tool. Built 09-30, test later: say research, look it up, search
    online, or paste a link, and that exchange (and his follow-ups to it) can search the web and
    read pages. Every other exchange has no web tools. The bridge uses Claude Code's own search
    and page reading; the API uses Anthropic's (a search costs 1 cent, reading a page costs its
    tokens). A research reply names its sources. Not on the Venice engine: its wire has no such
    tools.
30. **New MOODS styles** (not on the old list). "yeah lets put a pin in that untl the syste isin
    place and when it is lets go nuts on them" (09-08). MOODS shipped in 0.15.0, so the pin is
    due: new styles in the same format. The 09-08 note names SHDW, KOAN, 90s dark fantasy CGI and
    retro OVA: all four get a first draft for him to fix. Built 09-30, test later: four new
    MOODS in the MOODS fold, switched off like any mood: 90S DARK FANTASY CGI, RETRO OVA, SHDW,
    KOAN. Each is a whole mood (how to write, what to know, a locked closing line, examples),
    marked "first draft" and version 0.1. SHDW and KOAN are his own styles: they were written
    from what SHDW.world and the KOAN site show on screen, so they are a guess for him to
    correct. The files: `src/main/moods/*.vmd`; he can also edit them in his moods folder. They
    are in the app he runs from source only: a released build leaves them out until he says
    they are his.
54. **The Co-Director imports a skill as a MOOD** (09-30). "i want the ability with vdance
    codirector to import anew skill and even oif ts a ZIP codirevor will open ist read it an
    assimialte it into its MOODS adding it to the moods set" (09-30). Built 09-30, test later:
    drop a skill on the MOODS fold (a SKILL.md, a skill folder, a .zip or a .skill), ⇪ add it, or
    give the Co-Director its path in chat. He opens it, reads it, writes its header and adds it
    to the set, switched off. Every text file in the skill is carried word for word (the old add
    kept only the first two); scripts are left out and never run; a MOOD of the same name is
    replaced only on his ok. A .vmd still installs straight away.
31. **The rest of the 08-27 Co-Director brief** (not on the old list; he approved the brief
    08-27, `CODIRECTOR-REJIG-BRIEF-2026-08-27.md`). Not built, checked in the code: failed renders
    kept on disk with the provider's reason; a check of the assembled prompt before every paid
    render; its tools writing the voice field and the sheet image slots; deleted Library images
    leaving its view; a stage line. Not checked: a rename reaching sheets, styles and the brief;
    a write log he can read. Built 09-30, test later: its tools write a sheet's voice line and
    bind or unbind a sheet's image; renaming a Library image now reaches sheets, styles, the
    brief, image gen prompts and every clip field; a Library image opens by its @title and a
    deleted one doesn't, and the bridge is told a file no @title opens is not an image; the
    full snapshot shows sheet fields whole; every reply shows the tools it ran under it, in
    the panel and the Room. Failed renders kept on disk: built with 47. The stage line is the
    brief's BUILD STATE line, already in the guide. Built 09-30, test later, the check before
    every render: the app looks the assembled prompt over and says what it finds, as amber ⚑
    lines above the render button in Clip Gen: sound switched off while the clip describes
    sound; an @title the prompt names that is not attached (or was deleted, or a missing
    @video slot, or words-only mode); a linked char sheet that brings a scene line (movement,
    state, power) into this clip; beats that don't add up to the clip's length; a sentence said
    twice in two places. A flag never blocks the render. The Co-Director reads the same flags
    with the prompt (read_compiled_prompt) and is told to name each one before any render; a
    clip it fires comes back with the flags it rendered with.
32. **Gemini 3.8 Flash for watching cuts** (09-29 review). "40. yes add those newer models"
    (09-29). Watching a cut (Score compose, the Co-Director's watch) defaults to gemini-3.6-flash
    today. 3.8 Flash becomes the default; 3.6 stays listed. Built 09-30, test later: watching a
    take, a timeline and Score compose use gemini-3.8-flash. His saved 3.6 (every Settings save
    wrote it, picked or not) moves to 3.8 once; 3.6 still works when he types it in Settings →
    Google AI → Watch model. The two cost the same.
43. **Community MOODS** (09-08). "eventually i'd like this to be a wired into a commuinity project
    where vMDs can be taken froma repo and downloaded by anyone with the app with the name of the
    uyser who made them in there credited". Spec: `COMMUNITY-MOODS-SPEC-2026-10-01.md` (the repo
    and the pull request are the MOODS spec's own §8, approved 09-08). Built 10-01, test later:
    ⇣ community in the MOODS fold lists the shared MOODS, each with its maker, version and size;
    one click installs (switched off, the maker credited on the chip), update asks first.
    Right-click a MOOD → share to the community: it asks, writes the file with his name as the
    maker, shows it in Explorer and opens the repo's upload page (drag it in: a pull request). It
    is greyed with the reason for someone else's MOOD and for the two made from someone else's
    skills. The repo (the empty list, the rules, a workflow that rebuilds `index.json` on every
    merge and checks every pull request) is public since 10-01 with his GO:
    https://github.com/koan-shdw/vidancer-moods. Its list answers and the workflow's first run
    passed, so ⇣ community says nothing is shared yet. No MOOD has gone through it yet.
## Logins, keys and setup

33. **Several logins per bridge** (was 24). "look into the ability to log to multiple account on
    the same platform and use the same credits in the credit pool" (09-21) · "i wanted to have
    mutple logins for higgsfield because a friend said she managed to have 5 accounts ot make the
    most of thier deals and i wanted to pool them in one place" (09-23) · "several of same bridge,
    ability ot hit a plus and add a new one for each bridge" (09-29). A ＋ on every Bridge row adds
    another login; each gets its own row and credit bar, all in one pool. The answers are in
    `LOGINS-SPEC-2026-09-30.md`. Built 10-01, test later: a ＋ on every logged-in Bridge row.
    It says what their login page does (it signs in whichever account the browser has open), then
    offers their login in the browser or the link to paste into a private window. Each login is
    its own row and credit bar, named "Higgsfield 1, 2, 3"; double-click a name to change it. A
    render spends the login with the most credits left, and moves to the supplier's next login
    when that one is out of credit. Not proven against a supplier: no second account was ever
    logged in.
34. **Artlist and ElevenLabs bridge logins** (was 35). "any other suppliers have MCP?" → "yeah
    eleven and pika" (08-31). Both refused our login on 09-01 (they only let known apps in).
    Artlist has since opened a login MCP in beta: try again, ElevenLabs with it. Built 09-30,
    test later: Artlist's Bridge row is open to a login try again, and a refusal shows their own
    words on the row. ElevenLabs stays shut: it now wants a public page that describes the app.
    Where the page lives: "github for now, we will eventually have shdw.work" (09-30). His try
    09-30: Artlist refused, and its full reply is "dynamic client registration is disabled". Its
    login server takes the same public page ElevenLabs does, so one page opens both. Built 09-30,
    test later: the page file is in the public repo's clone (`oauth/client.json`), and both rows
    log in through it. It works once that repo is pushed and its GitHub page is switched on;
    until then the row says the page is not up yet. A refusal now shows the supplier's real
    reason. Not proven against either supplier.
35. **GPT and other chat logins** (was 30). "add new logins with gpt and also research other LLM
    servies which we can use such as the new deekseek that came out this week other logins, a
    more seemlyess login experience, can we for exampel login to claude code direct accoutn
    without api, and wat other LLMs can we do that to" (09-21). Found 09-29: ChatGPT signs in
    through OpenAI's Codex CLI and Google through the Gemini CLI, and the app can drive both;
    DeepSeek is key only. "after GPT login make it available as a codirector engine" (09-29):
    once GPT is logged in, it's a Co-Director engine next to the API and the Claude bridge.
    The answers are in `LOGINS-SPEC-2026-09-30.md`. Built 10-01, test later: Settings →
    co-director → engine has three more picks. ChatGPT (Codex) runs on his ChatGPT login through
    the Codex program his Codex app already carries (found, signed in, its models listed).
    Gemini CLI runs on a Google login once he installs it. DeepSeek API runs on a key, with its
    box in the same card. An expired ChatGPT or Google login gets the same sign-in button as
    Claude's. Not proven: no exchange was sent on any of the three.
36. **Setup wizard** (was 31). "A install and login wizard that lets users log into all the
    servies in a single login wizard the LLM, the video the image it outlines all the serves that
    each will provide and guies them for the login" (09-21). The answers are in
    `LOGINS-SPEC-2026-09-30.md`. Built 10-01, test later: the first run opens a setup wizard in
    the Welcome card's place, and Settings has a "setup wizard" button at its top. Pages: start,
    co-director, video, image, voice and music, watching. Every service is a row: its name,
    connected or not, what it gives, and its own key steps or login. No "recommended" tag.
37. **Missing-key wizard** (was 49). "shgoudlnt the app have a function where if it tried to do
    somehting that need sna api key it being up a wizard to give the user instructiosn on how to
    add it?" (09-23). A job that needs a key he doesn't have opens that service's key steps
    instead of failing. Built 09-30, test later: any job that fails for a missing key opens a
    card named for the supplier: get a key (opens their key page), paste it, save. The key is
    checked first where the supplier has a free check, and a refused key is never saved.
38. **Log in to Claude from the app** (was 50). "i want to see if we can 0auth into claud or have
    a seemless way to login to the bridge with cloaud code locally without having to use
    terminal" (09-23). When the login expires, a button signs in (browser page, no terminal) and
    retries the job. Today the app only says the login expired. Built 09-30, test later: an
    expired login shows "sign in to claude" in the Co-Director panel, the Room and Settings. It
    runs Claude Code's own sign-in in his browser, then sends the failed message again.
46. **ModelArk credit shown like fal's** (09-29). "see if we can have modelark credit displayed liek
    fal" · "add to list for later" (09-29). The Ark key he uses only runs models; a second
    BytePlus key (an Access Key) reads the bills. His pick 10-01: "2. yes" to this month's spend.
    Spec: `MODELARK-SPEND-SPEC-2026-10-01.md`. Built 10-01, test later: Settings → the ModelArk
    row has two boxes for the Access Key (ID and secret), checked with BytePlus when saved; a
    refused key is not saved. The ARK chip then shows "ARK $x this month": what BytePlus billed,
    not what is left, product by product in its tooltip. Found the same day in BytePlus's own
    SDK, not on their docs pages: a balance call (QueryBalanceAcct) on the same key. Not built:
    his call whether the chip shows what is left instead, like fal.

## Whole app

39. **Remove the splash's boot timer** (not on the old list). The splash is killed for now
    (09-29: "no loading splash kill it for now"). The temporary boot timer from its tries (the
    `[perf]` lines in `App.tsx`) is still in the app and served nothing else: take it out.
    Built 09-30, test later: the boot timer is out of the app shell and out of the filmstrip
    reader. Nothing on screen changes; the log no longer fills with [perf] lines.
47. **A failed render says what went wrong in one plain line** (09-29). "yes add to list" (09-29),
    after a ModelArk failure filled the queue row with raw code: `error (404) @ modelark/submit:
    {"error":{"code":"ModelNotOpen","message":"Your account ... has not activated the model
    dreamina-seedance-2-5-260628. Please activate the model service in the Ark Console..."}}`.
    The row gets one plain line (here: Seedance 2.5 isn't switched on for this ModelArk account,
    activate it in the Ark Console); the full reply stays in the log. Built 09-30, test later:
    a failed job's Queue row and its toast show one plain line (not switched on, key refused, out
    of credit, busy, the supplier's own fault, refused content, no connection). Hover the line
    for the supplier's full reply; it also goes to the log and into the project's failure list,
    which the Co-Director can read when asked why a render failed.
48. **LoRA card wraps when the sidebar is narrow** (09-29). "text and inuse should wrap under when
    its made this short" · "add to list do later" (09-29), with two screenshots of Image Gen's
    LoRA sidebar: in a narrow sidebar the card's name, badges and trigger chip squeeze (the chip
    stacks one letter per line) and "in use" runs off the edge. When narrow, the text and the
    button move under the image. Built 10-01, test later: a lora row narrower than the picture
    plus about 160 px puts its name, chips and use / in use under the picture (local, civit and
    official rows, in Image Gen and Clip Gen); wider, they stay beside it.

## Blocked or parked

40. **Suno** (was 39). "we need some new music gen apis what about suno and 11labs" (09-08).
    Blocked: Suno has no public API (checked 09-29). Checked again 10-01: still none. Since 07-01
    Suno takes developers into a curated partner program through an intake form (his to fill in,
    if he wants in).
45. **ArtCraft** (was 23). "good now lets scope this into it too
    https://app.getartcraft.com/pricing same questiosn" (09-08) · "also add this to the list"
    (09-21) · "2. later" (09-29). Parked: ask their team later. Seedance on ArtCraft plan credits;
    spec written (`ARTCRAFT-SPEC-2026-09-08.md`); their staff have to turn on API keys for his
    account first.

## Fresh-install checks (his call 09-23: test on a fresh install, not this one)

- The Bridge banner that says bridging needs an AI (was 37).
- The Hugging Face login prompt on a gated download (was 38).
- 36, 37 and 38 once built.

## Old numbers

Done or confirmed (his word 09-29: everything built and waiting on his test is confirmed): 1-8,
10, 11, 13, 16, 17, 19, 20, 21, 26, 27, 28, 32, 36, 41, 42, 43, 44, 45, 48, 58, 60 (the score tracks, built after the rebuild and
confirmed 09-29: "score works good work"), 62 (keys 1 to 9 hide tracks, confirmed 09-30: the nest
test he passed used a number key). Dropped: 9 (the
trigger already rides), 15 (YuE), 22 (the splash, killed 09-29: "no loading splash kill it
for now"; his design stays in `SPLASH-SPEC-2026-09-09.md` and the old list), 59 (09-29: "image gen
queue works perfectly"). Off the list, not the app: 18
(SignalRgb), 47 (the Photoshop plugin, its own project). Every other old number is a "(was N)"
above.
