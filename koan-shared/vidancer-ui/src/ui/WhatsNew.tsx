import { Modal } from './Modal'

// ---- What's-New: shown ONCE, on the first launch after an auto-update lands (Settings
// lastRunVersion bump drives it — see the boot effect in App). The list is written by hand per
// release: plain words, only things a user can see and touch. Cutting a release = push the current
// WHATS_NEW onto the FRONT of HISTORY, then write the new version + list here. ----

export const WHATS_NEW: { version: string; features: string[] } = {
  version: '0.24.0',
  features: [
    'Image Gen’s queue keeps the prompt and settings each render had when you queued it. Change the prompt, loras or anything else and queue again as often as you like while one renders.',
    'The Co-Director can line up many prompts on one image gen in one go: ask for 20 variations, say go, and they render one after another on that gen. Your own prompt stays as it was.',
    'The Co-Director sees the prompt and settings behind every take of an image gen (loras and weights, unleashed, size, refs) and can look at each picture.',
    'The Co-Director sees your take marks: every ★, colour and disabled take, in clips, image gens, scores and voices. Delete a take and the marks stay on the right ones.',
    'The Co-Director reads a lora’s examples from Civitai, with their prompts and pictures. Ask for “the samurai ones” and remake them, with or without changes.',
    'Press ~ on a picture in Watched or in a lora’s examples to tag it for the Co-Director: it sees every tagged picture and its prompt with each message. ~ again untags.',
    'Watched and lora example tiles select like takes: click, Ctrl-click, Shift-click and the arrows. The prompt and loras menu is on right-click.',
    'Pick where models are downloaded: change in the Models card. It applies on the next start.'
  ]
}

// every release before the current one, newest first — the scroll below the fold
export const HISTORY: { version: string; features: string[] }[] = [
  {
    version: '0.23.1',
    features: [
      'The Mac installer is back.',
      'ENHANCE with Topaz on your PC no longer stalls when the copy is done first.'
    ]
  },
  {
    version: '0.23.0',
    features: [
      'Sound fx live on the audio tracks. Drop one on an A track and it lands there; on a video or score track it goes to the first free A track. A pink block, hatched until it is rendered. Click it to open it in the SFX card.',
      'Sonilo makes the sound of the footage under the sound fx block.',
      'Sound fx have their own card in the Bin with their own folders. Drag them onto the timeline from there, or a take straight out of the SFX card.',
      'Projects with sound fx on score tracks move them to audio tracks when they open. The music stays on the score tracks.',
      'The speed line works with the Pen too: a drag changes the speed, a click adds a keyframe.',
      'Switched-on buttons keep their words readable: the renders switch, tether, run now in the Queue and the rest.',
      'The thinking level sits on the same line as the model in Settings.',
      'Share a MOOD to the community without setting your name first. It asks once.',
      'MOOD names are outlines until you switch them on. + new, add, share and community stay filled.',
      'The guide file buttons in Settings line up on the right.',
      'A render fal refuses to hand back stops being retried.'
    ]
  },
  {
    version: '0.22.0',
    features: [
      'Nest a selection. Right-click selected clips and nest them: they move into a new timeline in the Bin, and one block plays it in their place, with its own speed, effects, dissolve and level.',
      'Score tracks. Scores sit on their own S tracks under the audio, each with mute, solo and lock, and they are orange so they stand apart.',
      'Keys 1 to 9 hide or show a video track and its audio track together.',
      'Timelines open as tabs. Drag a tab out and it becomes its own timeline panel; clicking a timeline panel gives it the keys and the Monitor.',
      'Clip Speed / Duration, the Premiere way. Right-click a block or press Ctrl+R: speed and duration chained, reverse, and keep pitch.',
      'Time remapping. Right-click a block, time remapping, speed: a speed line on the block. Drag it for slow motion or speed-up, Ctrl-click to add a keyframe, pull a keyframe apart for a ramp. Its sound plays at normal speed.',
      'J, K and L shuttle like Premiere. J plays backward, L forward, and each press goes faster, up to 8×. K stops.',
      'The ruler stays at the top while the tracks scroll.',
      'A score sets the timeline length when it runs past the video, or when it is on its own.',
      'Copy, cut and paste work right after you click a block.',
      'A duplicated timeline keeps everything: scores, markers, tracks, locks and export settings.',
      'Audio keyframes: P is the Pen (click the line for a keyframe, box-select keyframes), V is Selection, double-click goes back to 0 dB, Ctrl-click switches a keyframe between Linear and Auto Bezier.',
      'Export several timelines at once. Select them in the Bin, right-click, export. Settings can set one export folder for every export.',
      'Right-click the timeline over a score, create beat in score: a blank beat lands at that second and the Score card opens on it.',
      'ENHANCE (Window, Enhance, or right-click a take, block or video): interpolate and upscale with Topaz on your PC, RIFE, Real-ESRGAN or fal, compared before and after on a slide bar. The result is a new copy with a coloured outline; the original stays.',
      'Make a depth video. Right-click a video, take or block: a grey depth map lands in the Library, ready for your @video refs.',
      'Keepers are flags. Flag several takes in a set as keepers, and unflag them again.',
      'Shift-click selects a run of folders.',
      'GPT Image 2.5 in Image Edit, with a background pick: auto, transparent or opaque.',
      'More ways to pay for an image: Seedream 5.0 Pro and Flash on ModelArk, Nano Banana 2 and Pro straight from Google or on Venice, and on your Higgsfield, Runway and Pika logins from their plan credits.',
      'The original Nano Banana is out of the picker; Google retired it.',
      'Gemini Omni Flash 1.1 in Clip Gen, 360p to 4K with video refs, and the Video Editor starts on it. Extend a video by 3 to 10 seconds, up to 40, on your Google key.',
      'Venice: Seedance 2 and 2.5 on your Venice key, and Claude on Venice for the Co-Director.',
      'Seedance 2.5 drafts. A draft switch renders a cheap 480p take; right-click it to finish at 1080p.',
      'H3 Max Lip Sync in Clip Gen: a still that talks to a voice.',
      'Local LTX moves to Lightricks’ newer text encoders (an older install offers update in the Models card), and renders with only the full size installed.',
      'Sora 2 is gone: OpenAI shut it down. Clips that used it keep their takes.',
      'Gemini 3.8 voices in the Voice card: design a voice from words, search Google’s voice library, or have two speakers in one line.',
      'Eleven v4 and v4 Turbo voices: pick one of yours, design one, or clone a sample.',
      'Lyria 3.5 in Score, with up to 10 pictures to set the mood.',
      'ElevenLabs Music v2.5 in Score.',
      'SFX Gen (Window menu): sound effects from the footage under them (Sonilo) or from words (ElevenLabs), placed on a score track.',
      'Lip-sync in the Video Editor with sync-3 or VEED Lipsync v2. Right-click a block to lip-sync it to the sound under it.',
      'Music refs in Score: drop a track in and ACE-Step or ElevenLabs Music follows it, from only its style to its tune.',
      'Voice extras: a char sheet’s voice comes with it as an @audio slot, each slot is timbre or dialogue, and a clip’s dialogue lines render to a Library track.',
      'Fable 5.1, Opus 5.5 and Sonnet 5.5 for the Co-Director, and a thinking level beside the model.',
      'The renders switch. Turn it on and the Co-Director may press render for you, only when your whole message is go.',
      'The Co-Director sets every Image Gen dial, flags takes and copies takes to the Library.',
      'Say research or paste a link and the Co-Director searches the web for that exchange.',
      'More Co-Director engines: ChatGPT through Codex, Gemini CLI and DeepSeek.',
      'Rules by number: save rule, edit rule, delete rule. Replies show the tools they ran, and the chat compacts itself at 40 messages.',
      'A check before every render flags problems in the assembled prompt, above the render button.',
      'Gemini 3.8 Flash watches takes and cuts.',
      'Drop a skill on the MOODS fold to make it a MOOD. Share your MOODS with the community, and install other people’s from ⇣ community.',
      'Several logins per Bridge supplier in one pool. A render spends the login with the most credits.',
      'Artlist and ElevenLabs Bridge rows log in through Video Dancer’s own page.',
      'A setup wizard on first run, and in Settings: every service, what it gives, and its key or login.',
      'A job that needs a missing key opens that supplier’s key card.',
      'Sign in to Claude from the app when the login runs out.',
      'ModelArk balance: add a BytePlus Access Key in Settings and the ARK chip shows what is left.',
      'A failed render says what went wrong in one plain line. Hover it for the supplier’s full reply.',
      'LoRA rows wrap in a narrow sidebar.'
    ]
  },
  {
    version: '0.21.1',
    features: [
      'MiniMax H3 runs on your own machine. Pick it in Clip Gen, with refs and upscale. One LoRA side panel serves it and Image Gen, and every local render shows its own progress notes.',
      'Kling O3 Edit joins the Video Editor. A second true edit engine beside Omni Flash: up to 15 seconds, and it keeps the original sound.',
      'Audio works like video on the timeline. Each video track has the audio track with the same number, and audio landing on audio cuts what is under it instead of stacking. Unlink frees the sound in one step.',
      'Linked clips move as one. Drag the audio and its video comes too. Delete takes both halves, Alt+Delete takes one. Slicing a clip cuts its sound with it.',
      'Copy, cut and paste every block. Ctrl+C and Ctrl+X work on video, audio and score. Ctrl+V pastes at the playhead over what is there, Ctrl+Shift+V inserts and pushes the rest right. A copied video brings its audio.',
      'The razor cuts audio and score blocks too, by click or Ctrl+K.',
      'Image Edit uses the queue. Generate now runs at once, ＋ queue runs in order, and pressing again adds another render. Every run shows in the Queue window and lands in the tree.',
      'Image Edit starts on Nano Banana Pro, and the blocking sheet draws on Pro too.',
      'Drag a Civitai image onto the Image Gen PNG box. Its prompt and LoRAs load, and missing LoRAs download.',
      'Image Gen takes show their LoRAs and strengths. Right-click a take to send its seed, its LoRAs or its prompt back into the gen.',
      'Take a job out of the Image Gen line, or cancel the render that is running.',
      'LoRA rows open their Civitai page and their posted examples. Drag an example into Watched.',
      'Bench Library and Bin items. Right-click, disable: the item dims and leaves the pickers, and nothing that uses it changes.',
      'Paste screen grabs into the Library, drag images in from a browser, or double-click empty space to import.',
      'Export as. Right-click any media or take, pick a format and a place.',
      'Arrow keys step through every tile grid and takes row, previewing as you land.',
      'Folders are chips over the grid. Click one, ctrl-click to add more, drag a folder onto another to nest it.',
      'The Window menu lists panels A to Z.',
      'The Co-Director runs on Opus 5.5 over the bridge. Pick it in Settings, or flip the Director’s Room chip between Sonnet and Opus 5.5.',
      'Claude Code too old for a model? The Co-Director says so and offers update claude code, then sends your message again. Settings says it too.',
      'An expired Claude login is named in plain words, and Settings shows whether Claude Code is logged in.',
      'Compose writes the beats with the model that watched the cut: Gemini when it watched, Claude reading still frames when Gemini is off. A note beside the beats says how they were made.',
      'The Co-Director follows sharper rules for character sheets and Image Gen prompts.'
    ]
  },
  {
  version: '0.20.1',
  features: [
    'Every project stays in the Open window. No more limit of eight. Four across, four rows, scroll for the rest, and drag the strip under the cards to make the list taller. Double-click opens a project.',
    'Folders for projects. Right-click a card for new folder, drag cards onto folders, select several and file them together. Folders live in the window only; nothing on disk moves.',
    'Lost projects come back. On first launch the app looks beside your known projects and adds what it finds. Find projects picks a folder and adds everything inside.',
    'Open in Photoshop. Right-click a Library image, an Image Gen take or an Image Edit result and choose open in. The app opens a copy, watches for your save, PSD included, and asks to import it when you come back. The original never changes.',
    'Image Edit picks its model. Nano Banana, Nano Banana 2, Nano Banana Pro, GPT Image 2 and Seedream 5.0 Pro, with VIA, size and quality beside it. Each result remembers what made it.',
    'Select where the edit happens. Box or lasso an area in Image Edit. The model still sees the whole picture; only your selection changes and the rest stays your original pixels.',
    'Compare in Image Edit. See the base image next to the result, side by side.',
    'The Image Edit results tree zooms. Slider on the tree, or ctrl and scroll.',
    'Workspaces moved to the middle of the top bar, bigger and bolder.',
    'Saves survive cloud sync. A project inside Dropbox or OneDrive keeps saving while the sync client holds the file.',
    'Image Gen fails fast and says why. An engine crash stops the wait in seconds, oversized references shrink before they load, and running out of memory is named in plain words.',
    'A mood the Co-Director saves shows in the MOODS fold at once.'
  ]
},
  {
  version: '0.19.0',
  features: [
    'Move the picture inside the crop. Drag to position it, use handles or the mouse wheel to zoom, Reset to start over. Apply makes a new primary version and keeps the original.',
    'The primary image reaches the model. References follow the current primary when generation starts, including queued video start and end frames. Editing the original or another tree node sends the image you are viewing.',
    'Tell the Co-Director everything at once. All waiting messages go together in one follow-up after the current reply. New notes form the next batch, and each waiting note can still be removed.',
    'Score names its supplier. VIA shows fal, ElevenLabs or Local and explains the key and credits. Missing keys have a clear reason before you render.',
    'Compose follows the selected score span. It watches the cut once, sets the music length to the span and preserves existing beats in a duplicate. Queued scores keep the settings you submitted.',
    'ElevenLabs music keeps its timing. Short lead-ins and long sections preserve the requested plan length; lyrics work in vocal mode, and Stop ends the request wait.',
    'Installed local models leave your editor in front. The Models card opens for setup or download progress.',
    'Score and Voice take colors stay visible when you change the keeper.'
  ]
},
  {
  version: '0.18.1',
  features: [
    'Dissolves live on the timeline. Drag the small cut marker to make one, drag either edge for length, double-click for exact duration and Center, Start or End at cut. Stripes tell you when the footage runs out and edge frames repeat.',
    'Both shots keep moving through a dissolve. Preview and export use the same overlap, with effects intact. Frame grabs capture the blended picture too.',
    'Select together, delete together. Ctrl-click across the Bin and Library, right-click a selected item, delete the selection. One Undo brings it all back; the source files stay on disk.',
    'Watch the cut. The Timeline toolbar reviews the whole edit or your marked range, with motion, effects and sound. Ask a question there, or ask the Co-Director to watch the timeline.',
    'Watch has a model setting. Google failures can fall back to Claude still frames, clearly marked as having no motion or sound.',
    'Voice names its supplier. VIA shows who runs the model and whose credits it spends. Image and clone-sample uploads keep their correct file type; access errors point to the failed step.',
    'Drag an Image Gen take straight into reference A or B. It joins the Library and fills the slot, including takes from another Image Gen card.',
    'The monitor keeps its picture while you scrub. Save failures report properly, recovered renders avoid duplicate takes, and imports finish in the project they belong to.'
  ]
},
  {
  version: '0.17.2',
  features: [
    'The Co-Director shows what it read. Under send, after every exchange: rounds, tokens read per round, tokens written. Hover it for the split, fresh against cached, and what the prompt was made of. The exact prompt lands in codir-last-prompt.txt in the app data folder.',
    'Remembered rules survive updates. What you told the Co-Director to remember lives in its own file now, so every app update reaches its instructions. Your saved rules carry over on first launch.',
    'The Claude Code bridge loads its tools up front. No search round before the first write.',
    'Tighter Co-Director instructions. Same rules, fewer words, each said once.',
    'Export takes long volume curves. A busy volume line no longer fails the export on Windows.',
    'No stale frame at a cut. A reused player waits for its own decoded frame before it shows.'
  ]
  },
  {
  version: '0.17.0',
  features: [
    'Audio keyframes, the Premiere way — the volume line is in dB, 0 dB at the middle. Ctrl-click the line for a keyframe, ctrl-click it again to remove it, drag it (Shift locks one axis), drag the line between two to lift both. Right-click a keyframe: Linear, Bezier, Auto Bezier, Continuous Bezier, Hold, Ease In, Ease Out, with handles you drag. Delete removes what you selected.',
    'Fades are transitions — Ctrl+Shift+D puts a one-second Constant Power fade on a selected block’s edges. Drag the fade’s inner edge for length, double-click to type it, right-click for Constant Power, Constant Gain or Exponential. Export traces the same curve.',
    'Watched has a civit tab — every image you liked on civitai.com, as tiles. Click one: send its prompt to the open image gen, use the loras it used or search civit for them, import it, open it on the site, or send it to the Co-Director for a prompt of his own.',
    'Send to project, everything — ctrl-click across the Bin and the Library, right-click, send N to project. Image gens, scores, voices, styles, timelines, music and videos all travel now, refs and takes included.',
    'Clips under a clip keep their sound — mute the top block and the ones beneath play on, in the monitor and in the export.',
    'The Tether is a pointer — talk to the Co-Director as in the panel; he just knows what “this one” is. The option cards and the heat bar left the window.',
    'The lane header has a keyframe navigator — ◁ ◇ ▷ while a lane is tall: previous, add or remove at the playhead, next.',
    'Small things — no stray frame at a cut; the LoRA sidebar’s previews zoom with a slider or ctrl-scroll; the Image Gen prompt box takes the Co-Director’s writes.'
  ]
  },
  {
  version: '0.16.0',
  features: [
    'Image Gen — a new panel beside Image Editor. Krea 2 renders on your own GPU, free, through the bundled engine. Prompt, two refs (scene and subject, a boost number under each, a REFS switch), model, aspect, size, renders, seed, then the LoRA stack: two slots with weight sliders and the unleashed row. ▶ Generate adds a take; ★ a keeper, drag it to the Library, or open it in Image Editor.',
    'The LoRA sidebar — local | civit. Point local at your LoRA folders and every file finds its own trigger words and thumbnail. civit browses Civitai for Krea 2 LoRAs: previews scroll under the mouse, download lands in its own folder with the previews, use drops it in a slot. Settings gets a Civitai sign-in check.',
    'Krea 2 in the Models card — a new image section: the official turbo rows (fp8, int8, nvfp4, bf16), the essentials, and Civitai checkpoints. Download there, pick in the panel.',
    'drop png here to read — drop any Comfy or A1111 PNG on the box beside the refs: send to prompt fills the prompt, and the menu lists the LoRAs it used, use when you have one, search civit when you don’t.',
    'Co-Director reaches Image Gen — he writes its prompt, adds or removes its refs, and drops refs from clips when you ask. The open image gen’s refs and ★ take ride every exchange, so he sees what you see.',
    'Every monitor resizes — Clip Gen’s handle now sits under the Video Editor, Image Editor, Image Gen and Sheet Gen previews, and Sheet Gen plays its takes with the timecode bar.',
    'The Bin and the Library in cards — every type in its own collapsible card: drag them into your order, fold what you don’t use. Image gens live in the Bin like clips.',
    'Small things — scene and subject read inside the ref boxes; Score Gen’s compose and + beat sit inside the beats card; sidebar chips wrap; drawn folder and score icons everywhere.'
  ]
  },
  {
  version: '0.15.0',
  features: [
    'Sheet Gen — right-click a Library image: make char plate, scene plate or expression plate. One boring 15-second capture (grey, static, a new view every 3 seconds) renders on your model, then build sheet pulls a clean frame from every view and stacks the 2×2 reference sheet. Character sheets 3:4, scene plates 16:9 with the subject stripped, expressions five big feelings. The views land in their own Library folder, the sheet at the root.',
    'MOODS — style briefs the Co-Director puts on. A fold above his prompt box (panel and Room) lists them: click = on for the session, pin = this project, #name in a message = once. Two ship: HARDCORE ANIME and 80S DARK FANTASY. + new interviews you and writes one; add takes any .vmd, .md or skill zip; share saves the file for anyone else.',
    'The TETHER — Shift+D. A small window on a string: park it beside a field, a section, a beat, a sheet, an image or a clip and that becomes “this one” for the Co-Director. Drag the ⌖ to pin it anywhere, click ⌖ to cut the string. Ask in its box and he answers there; ask for options and you get three cards, each with a commit button that writes straight into the field.',
    'INTENSITY — a five-step meter above every Co-Director prompt box: how hard he writes, never how much. Click the lit step again for auto.',
    'He can watch video now — paste a Google AI key in Settings and “how’s the latest render?” makes him watch the take with Gemini Flash and answer from what it saw. Without the key he reads still frames instead. A GEM chip beside FAL shows what the watching has cost.',
    'Seedance 2.5 speaks its own language — on any 2.5 door the fields compile into the bracketed prose 2.5 was tuned on ([Global Setting], [Character Styling], [Timestamp Storyboard], [Negative Prompts]) instead of the Seedance 2 YAML. Refs go out as [Image1] on fal and @image1 elsewhere. Seedance 2 keeps its YAML.',
    'Assembly — a new panel. Assembly concept reads your Co-Director conversation and the storyboard and writes the cut as an outline; correct it in the box, lock it, press assemble: he watches every take, picks one per shot, trims it, and lays the first cut on a NEW timeline. Hover a block to see which shot it serves. You refine from there.',
    'Block — a button between + beat and auto time. Draws a rough black-and-white storyboard of the beats (one panel each, arrows for camera and motion), files it under Library → blocking and attaches it last as the staging reference. Warns first if the beats read like a fight.',
    'Score Gen watches the cut — stretch the score bar over a span and press compose: the span renders to a proxy, Gemini watches it whole, and the beats land on the real cut points. ElevenLabs Music v2 is a new score door: your beats become its section plan, key in Settings.',
    'Co-Director learned more — a new Director rigs guide (the five camera laws, every rig move with what it looks like), the Seedance 2 v3 laws (camera moves by default, one earned hold, the word band), and field notes: sheets over singles, gray-area vocabulary, which doors censor, aspect is born-in.',
    'Small things — the Co-Director header sits on three rows; the Sheet Gen preview moved to the top with a ⤢ preview; sheets check their own views before they show you; Enter saves a key in Settings.'
  ]
  },
  {
  version: '0.14.0',
  features: [
    'Bridge — a new panel where you LOG IN to your suppliers instead of pasting keys: Higgsfield, Runway, Magnific and Pika sign you in on their own sites, and renders spend those accounts’ subscription credits. The top shows your whole pool: each account’s credit, one stacked bar of who holds what, and rough render minutes at 480 / 720 / 1080.',
    'Seedance through your logins — Seedance 2 and 2.5 rows for every connected account, refs and all. Higgsfield and Runway proven live; Magnific and Pika need their paid tiers.',
    'The model dropdown split in two — MODEL picks the model, VIA picks who runs it: fal, ModelArk, Astria or a Bridge login. Your via pick is remembered per model.',
    'Bridge (auto) — pick Bridge as the via and the app quietly spends from whichever logged-in account holds the most credit. The queue names the one it picked.',
    'The queue talks — while a Bridge render cooks, the app and the supplier converse in faint speech bubbles behind the queue: the ask, the answer, the job accepted, plain words typed out live.',
    'Claude answers the weird moments — some suppliers reply with a question instead of a render (“want my 3D RENDER preset?”). Your Co-Director’s Claude answers it for you — never touching your prompt, model or money — and the render continues.',
    'The picked lane or nothing — a render can only run on the exact model and supplier you picked. Anything the app can’t honor refuses before a cent moves, and errors speak the supplier’s own words instead of raw code.',
    'Clip Gen became cards — Takes, Model, Prompt and Beats each in their own bordered space. Ref chips float above the prompt, tilted and grouped by type; double-click one to open that ref. Right-click a take: load this take’s recipe fills the whole form.',
    'The house dropdown — one rounded, roomy dropdown everywhere the app used the browser’s. Grey helper text retired; hover anything for its story. Empty gen panels now float their citizens — double-click to open one.',
    'The lora shelf grew up — tabs, per-version rows, a drop zone for your own files, and failed installs retry in place.'
    ]
  },
  {
    version: '0.13.1',
    features: [
      'Grab the frame under the playhead — right-click a timeline block: current frame → Library. The exact still the monitor shows, same grab as its 📷 button; greyed with the reason when the playhead isn’t over that clip.'
    ]
  },
  {
    version: '0.13.0',
    features: [
    'The LoRA shelf is open — the Models card loras section is live: browse Civitai right there, official Lightricks adapters scanned straight off their Hugging Face (new ones appear on their own), and any .safetensors you drop in models/loras/ shows up too. One click installs, with the same byte and weight checks every model file gets.',
    'Pick loras in Clip Gen — a ＋ lora button under the prompt on LTX renders. Each pick wears its own 0-2 strength slider, they chain in the order you pick them, and the mix freezes into the take.',
    'Trigger chips — a lora’s trigger words ride along as chips; tap one and it drops into your prompt. They matter: tested side by side, a style lora with no trigger word barely shows, with it the whole frame turns.',
    'Thumbnails that work — lora cards show their preview image now, and holding the mouse on one for half a second pops a big preview beside the cursor.',
    'Built for a long shelf — installed loras group by model family, a search box covers names and trigger words, source chips filter official / civitai / own, ★ pins favorites on top. A Civitai key field lives in Settings — browsing needs nothing, their downloads want a key.',
    'The Models card folds — every category collapses like the Settings cards do.',
    'Co-Director travels lighter — a COMPACT button folds an old conversation into a short digest, and the new context mode reads project state fresh off disk each turn instead of hauling it all along. Default on; Settings has the switch.'
    ]
  },
  {
    version: '0.12.0',
    features: [
      'Pick your LTX size in the model dropdown — every installed size sits there as its own entry, LTX 2.5 (quality int8) next to (standard Q5). Only what is downloaded shows; the pick saves with the clip and freezes into the take. Switching sizes restarts the engine clean, so back-to-back renders never jam the RAM.',
      'Full dev bf16 unlocked — the biggest LTX renders for real now: 20 steps, true guidance, its own negative line. Download the full row in Models and pick it in the dropdown.',
      'A negative box under the prompt — what must never appear. Live on the bf16 pick; greyed with the reason everywhere else, and it keeps your words either way.',
      'The render bar shows the render — local renders drive the Queue bar with the engine’s own step counter: loading the model, sampling step 5/20 with seconds a step, decoding frames. A clock is not a progress bar.',
      'Downloads own up — a broken model download shows a red reason that survives restart, raises a toast wherever you are, and the button flips to resume with the files done and the GB left. Landed files never re-download.',
      'Takes name their model — hover a take card: the exact size that rendered it, the seed, and the transformer file the engine itself confirmed it loaded.',
      'The wizard got honest about speed — int8 measured about 40x faster than the GGUF sizes on a 16 GB card, so it now recommends int8 from 12 GB up.'
    ]
  },
  {
    version: '0.11.0',
    features: [
      'Timeline blocks know their take — drag a clip down and its block rides the ★ keeper: pick a different take in Clip Gen and the shot swaps live, a dotted amber ring and ★ marking it. Drag a take down and it pins for good — the block reads KATA - take 3 and never moves.',
      'Delete a take — right-click a take card in Clip Gen. Not disable, gone: pinned shots on the timeline leave with it, dynamic shots hop to the keeper. The video file stays on disk and Ctrl+Z brings it all back.'
    ]
  },
  {
    version: '0.10.0',
    features: [
      'Take over a linked field — double-click a link chip and its text drops into the field, yours to edit. The field now REPLACES the link instead of adding after it; click the faded chip to link back up (the field clears). Works on linked characters and on scene/production links — right-click one of those chips to open its source.',
      'Find in the prompt preview — mouse over the generated-from-fields box and press Ctrl+F: a little finder with match count, prev/next arrows, Enter and Esc. The preview text is selectable now too.'
    ]
  },
  {
    version: '0.9.0',
    features: [
      'Style sheets moved into the Bin — 🎨 tiles beside your char sheets, scores and voices; double-click opens the Style Sheet panel, folders and multi-select work like everywhere else. Same styles, same links, new home.',
      'One editor for v2v — Clip Edit folded into the Video Editor: every edit lands in the same results tree, keep one by dragging it out, and ⑂ carries your trim window in with it.',
      'Render now — fire renders instantly, several at once. ＋ Queue still lines them up in order.',
      'The Queue panel keeps up — live progress on every running job, N running · M waiting up top, and ▶ on any waiting job jumps it to run now. Rate-limited instant jobs re-queue themselves once instead of failing.',
      'Send to project — right-click clips, images, music, char sheets or a whole timeline and push copies into another project. Timelines bring everything they use; it all lands in a folder named after this project.',
      'Char sheets got folders — organize them like clips and images: drag in, multi-select, same grammar.',
      'Transforms see past the frame — shrink or slide a clip and the picture beyond the crop reveals itself to work against, Premiere-style.',
      'Image-heavy projects run light — tiles stream a small cached copy instead of decoding full-size renders, and the grid view grew a loop button that locks drift to whole cells.'
    ]
  },
  {
    version: '0.8.0',
    features: [
      'Clip Gen turned results-first — the take monitor sits full width at the top with the takes right under it. A clip with nothing rendered yet starts straight at the fields.',
      'The take monitor grew a real jogger — timecode, scrubbing, the take’s beat colors banding the bar, and an in/out window with bracket handles. Press I / O at the playhead or drag the edges; Space plays and pauses while Clip Gen is fronted.',
      'Drag the preview anywhere — onto the timeline it lands as that exact take, trimmed to your in/out window; onto the Library it becomes a video ready to ride as a @video ref; ref slots take it too. Double-click any take card to review it big in the Clip Monitor.',
      'Premiere came to the timeline — a 👁 hides any video track from playback AND export, audio lanes got M/S, the middle bar between video and audio drags to rebalance, track rows and lanes resize, and the view always runs past the last clip so there’s room to drop.',
      'Filmstrips fill the blocks — bright frames edge to edge, beat colors still riding on top.',
      'Fixes that matter: beat prompts written while a render cooked no longer vanish when the take lands · no more stray frames at cuts and slices · jogging never flashes black · last-frame stills can’t come back empty.',
      'The Co-Director learned Seedance 2.5 — its guides were rebuilt from the official + community canon (reference role-binding, audio and dialogue direction, the 30-second grammar), and it can now put clips on Seedance 2.5 and ModelArk.'
    ]
  },
  {
    version: '0.7.6',
    features: [
      'Storyboard text found its corner — the preview overlay in the monitor now pins to the top of the pane itself, not the top of the letterboxed picture. Same spot every time, whatever shape the clip is.',
      'Room sessions stay lean — a quiet refresh every dozen messages keeps hour-long conversations from dragging old state around. You won’t notice it; your 5-hour window will.'
    ]
  },
  {
    version: '0.7.5',
    features: [
      'Your 5 hours go further — bridge mode now keeps ONE living Claude session per conversation instead of re-teaching it everything every message. Only what changed gets sent; the rest reads from cache at a tenth the weight against your subscription window.',
      'A model dial in the Room — the ⚭ chip in the top-right pill flips Opus ⇄ Sonnet with one click. Sonnet for routine passes, Opus for the heavy creative ones. Settings still carries the full list.',
      'Sessions reset themselves when it matters — clear the log, switch project, model or guides, and the next message starts clean. A dead session re-seeds itself, no error to deal with.'
    ]
  },
  {
    version: '0.7.4',
    features: [
      'The Screen moved to the side — takes float in at a slight angle beside the Room chat, fold to a corner with ▾, straighten when you hover, ✕ to clear. The conversation stays center stage.',
      'Char sheets link from the Room — tell the Co-Director to put a character in a clip and it LINKS the ⛉ sheet instead of pasting a copy: sheet edits reach every linked clip, and the sheet’s image rides in as a ref on its own.',
      'The Co-Director got cheaper — smarter caching cuts a working exchange to roughly a third of its old cost, and long builds come back quicker.',
      'This card remembers — scroll down for every release back to the first.',
      'Copy works again in both chats — select any message text.'
    ]
  },
  {
    version: '0.7.3',
    features: [
      'The Screen — say “let’s review the latest take” in the Director’s Room and it floats up big behind the chat, playing with sound, while you keep talking. No clip name needed: you get the newest render in the project.',
      'Click any playing side-pop to put that exact take on the Screen. Mute, go wall-to-wall, or ✕ it from the marquee up top.',
      'The Co-Director can run the Screen too — ask it to show a take and it puts it up (or clears it) itself.',
      'A− / A+ type sizing came to the Co-Director panel — same as the room.'
    ]
  },
  {
    version: '0.7.2',
    features: [
      'The Co-Director’s hands got finer — keeper takes, per-cut speed / mute / crossfades, duplicating clips and timelines, folders, and @title renames that rewrite every prompt automatically.',
      'It reads the whole cut now — takes, trims, and keepers show in its view of every timeline, and char sheets show all seven character fields.',
      'The writing cloud drifts — while it writes a field, the text floats in at a side of the Director’s Room, lingers, and breathes out. A different side each time.'
    ]
  },
  {
    version: '0.7.1',
    features: [
      'The Co-Director builds everything now — char sheets, new timelines, whole cuts (clips in order, takes, trims), renames and deletes. Same access you have, every write undoable and shown as a keep/revert card.',
      'It sees your timelines — ask about the cut and it knows exactly what’s on it, take numbers included.',
      'What stays yours: renders, image generation, and file imports — anything that spends money or needs a picker. It proposes; you fire.'
    ]
  },
  {
    version: '0.7.0',
    features: [
      'The Director’s Room — a full-screen space for the Co-Director conversation: big type, the app blurred behind it. Open it from the Co-Director panel header.',
      'Context pops — name a clip in the conversation and its take starts playing in a floating card beside the chat. Say “take 2” to pick that one.',
      'The moodboard — every image and take the conversation touches, scattered like prints on a desk. Click to zoom, mark two to compare.',
      'On the Table · Still to Decide · Changes — the session’s working state floats beside the talk; every Co-Director write becomes a card you can keep or revert.',
      'The writing cloud — while a field is being filled, the text materializes softly behind the chat so you can read along as it lands.',
      'Type while it works — messages sent mid-run queue up and fire in order when the Co-Director frees up.'
    ]
  },
  {
    version: '0.6.0',
    features: [
      'Seedance 2.5 — the new engine, with reference videos and audio riding into renders: @Video and @Audio slots next to your @image refs.',
      'Library videos — import reference footage, copy takes into the Library, drop any of it straight onto the timeline.',
      'The Video Editor — edit sessions on any video: a tree of versions, a two-mode composer, bakes back to the Library.',
      'Three suppliers — fal, Higgsfield and ModelArk keys side by side in Settings, with live credit chips. Renders pick the cheapest healthy route.'
    ]
  },
  {
    version: '0.5.0',
    features: [
      'Timeline v2 — absolute time, multiple video tracks, gaps, per-track mute / solo / lock. Add and delete tracks as the cut grows.',
      'Clip audio always visible — linked companions ride with their video; free blocks carry gain, fades and trims of their own.',
      'Real editing — overwrite drops, ripple paste and delete, rolling trims, per-block speed, cross-dissolves, razor, markers, in/out loop, JKL.',
      'Take cards — big thumbnails, right-click color marks, disabled takes skipped when picking keepers.',
      'Export — the whole cut composites out: speed changes, audio lanes, music, fades, range window.'
    ]
  },
  {
    version: '0.4.0',
    features: [
      'The Co-Director — a conversational copilot that writes your project fields with you, powered by Claude.',
      'The guide system — four editable knowledge files with load toggles; it learns your corrections and keeps them.'
    ]
  },
  {
    version: '0.3.0',
    features: [
      'Project Styles — named field bundles any clip can borrow, so one look flows through the whole film.',
      'Stills on the timeline and monitor, a Window menu, an output mirror and a draw layer.'
    ]
  },
  {
    version: '0.2.2',
    features: ['Paste works everywhere — app menu and right-click. Drop guards and a start-project prompt.']
  },
  {
    version: '0.2.1',
    features: ['Pop-out windows retired for the steadier Watched panel; the watch button fixed.']
  },
  {
    version: '0.2.0',
    features: [
      'Vid2vid — Clip Edit sessions on your renders, driven by Gemini Omni Flash.',
      'The render Queue, themes, and first-run onboarding.'
    ]
  },
  {
    version: '0.1.0',
    features: ['The first cut — storyboard-first clips, Seedance renders, the Library, a timeline, exports.']
  }
]

function Rows({ features }: { features: string[] }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {features.map((f, i) => {
        const [head, ...rest] = f.split(' — ')
        return (
          <div key={i} style={{ display: 'flex', gap: 9 }}>
            <span style={{ color: 'var(--amber)' }}>◆</span>
            <span>
              <b style={{ color: 'var(--txt-hi)' }}>{head}</b>
              {rest.length > 0 && <> — {rest.join(' — ')}</>}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function WhatsNewModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <Modal title={`new in v${WHATS_NEW.version}`} width={540} onClose={onClose}>
      <div style={{ fontSize: 12.5, color: 'var(--txt)', lineHeight: 1.6 }}>
        {/* current release first, then the full history — one scroll, newest to oldest */}
        <div className="vd-scroll" style={{ maxHeight: '58vh', overflowY: 'auto', paddingRight: 6 }}>
          <Rows features={WHATS_NEW.features} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0 12px' }}>
            <span style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)' }}>earlier</span>
            <span style={{ flex: 1, borderTop: '1px solid var(--line)' }} />
          </div>
          {HISTORY.map((rel) => (
            <div key={rel.version} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10.5, fontFamily: 'var(--mono)', color: 'var(--gold)', marginBottom: 6 }}>v{rel.version}</div>
              <Rows features={rel.features} />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 14 }}>
          <span style={{ fontSize: 10.5, color: 'var(--dim)' }}>you’re on the newest version — scroll for the whole story · this card shows once per update</span>
          <span className="btn" style={{ marginLeft: 'auto' }} onClick={onClose}>
            nice
          </span>
        </div>
      </div>
    </Modal>
  )
}
