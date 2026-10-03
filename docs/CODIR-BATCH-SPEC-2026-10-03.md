# Co-Director: many renders on one gen + lora examples + ~ tags (spec 2026-10-03)

Built 10-03 (his GO), untested by him. His go before renders stays as it was.

## His words (10-03)

- "make 10 of these with varatiosn and hit render X amount of time for each"
- "i dont want new gens i want you to use the current gen run one at a time and keep going until 20 are done"
- "i also want you to be smart enough to for example look at al the exmaple images wr have for a lora and then recreat each one either directyl or with the instructiosn to change them in come way, even read them so i can say look at the exampel all the ones with samurai remake them with changes"
- "hitting tilda on a watched or exmaple image will tag is the AI shoudl eb able to see whats tagged"
- "then we can also give it instructiosn to say regardless of whats tagged for exmaple anyoen int he exmaple whats a samurai use that as inspo"
- "make sure the seect is consistent with the app"

## His test (10-03, before the fix)

The Co-Director wrote and fired 8 prompts on Fractal Fantasy. T9 came out as prompt 4 (Insect queen), T10 to T16 all as prompt 8 (Two eyes). His words for it: "the queue is looking for the prompt thats currently in there when it starts, not the one which was lined up when it was queued".

## What the app does today (read in the code 10-03)

- `fire_render` has two gates in code (`codir.ts` runTool): the "renders" switch (`Settings.codirFire`) and his whole message being the word go (`isGoWord`). 20 fires per go (`MAX_FIRES_PER_GO`).
- `kind=image_gen` presses Image Gen's own ＋ Queue (`lib/codirFire.ts` → `ImageGen.tsx` `registerFire` → `submit('queue')`) and answers "queued". It never waits for the picture.
- Image Gen's line (`ImageGen.tsx`, `line: QueueItem[]`) holds only the gen's id. `imagegen:render` (`index.ts`) reads the gen's recipe when the render STARTS, not when it was queued.
- Every take stores what ran: `file`, `promptSent`, `snapshot` (`ImageGenTake`).
- `read_object` on an image gen (`dumpImageGen`) lists takes as seed + size only: no prompt, no file. The only picture riding an exchange is the ★ take plus refs A/B (`openImageGenPics`).
- `list_image_gen_options` gives each lora's name, file, trigger words and base. No examples.
- The app already reads a lora's Civitai examples for him: the examples window (`Watch.tsx` `CivitExamplesPanel`, from the LoRA sidebar's right-click) loads `civit:versionImages` (`civitai.ts` `versionImages`: 40 a page, most reactions first, no key needed), each example's popup reads `civitai.generationData` (prompt, negative, seed, size, loras + weights; his key), and files are cached in `userData/civit-cache` (`imageFile`). A folder lora knows its Civitai version (`FolderLoraRow.civitKey`).
- Learned rule 8 (`userData/guides/learned.md`): "Before writing any image prompt, describe the picture to the director in plain conversational English first and wait."
- Exchange limits: bridge 30 turns and a 10 min wall (`codirBridge.ts` `BRIDGE_MAX_TURNS`, `BRIDGE_TIMEOUT_MS`); API lane 12 rounds (`codir.ts` `MAX_ROUNDS`). The bridge runs in the project folder with Read allowed; `civit-cache` is outside it.
- STOP already exists: Image Gen's ✕ takes the gen out of the line, and the cancel button stops the running render.

## The Co-Director's 8 points, checked

1. **Snapshot renders.** The problem is real: every waiting render used the prompt saved when it started, so they all came out as whatever was saved by then (his test above). It also hits his own clicks (＋ Queue twice while a render runs, the waiting ones get the last edit). The fix belongs in the queue, not in a tool flag: part A.
2. **Batch switch + cap.** The cap exists (20 per go). A switch that skips the go changes his 09-30 rule: the open question.
3. **Batch plan tool + status list.** Not needed. The line already runs one at a time and shows its count; each take keeps its own prompt.
4. **Render callback.** Not needed for 20 in a row. Only needed if the Co-Director must look at each picture before writing the next one, which he did not ask for.
5. **Lora examples downloaded on install, next to the lora.** Wrong. The app already fetches examples from Civitai when asked and caches them. Only the tool is missing: part D.
6. **Image metadata tool.** Not needed as a tool. Takes carry their prompts (part B), Civitai examples carry theirs (part D), and a tagged Watched PNG brings the prompt saved in it (part F).
7. **Example to ref.** Not needed. A remake goes through the prompt and the loras.
8. **Instructions.** Only the "Firing renders" lines change (part E). Rule 8 already fits: the list of ideas is the description, the go is the wait.

Also: "Here are the 20, based on your 8 takes" is unproven. `read_object` gave it no take prompts or files; only the ★ take's picture rode along.

## The build

**A. Image Gen's line freezes the recipe when pressed.**
- `QueueItem` gets `recipe: ImageGenRecipe`, copied in `submit` after the prompt box saves.
- `imagegen:render` takes an optional `recipe`; when present it renders that instead of `g.recipe`, with the same checks (prompt, model, refs, loras on disk). The take's `snapshot` is what ran.
- His clicks and `fire_render` both go through it.

**B. `read_object` shows every take.**
- Each take line adds the prompt it ran (`promptSent`, in full: read_object's no-truncation law) and its file (project-relative path, so the bridge can Read it). A take whose prompt matches the one before says "same prompt as Tn".

**C. `fire_render kind=image_gen` takes a `prompts` list.**
- Optional, up to the go's remaining cap. One queued run per prompt on that gen, each frozen (part A) with the gen's settings and that prompt. The gen's own prompt is left as he had it.
- Each prompt counts as one fire. Images per run stay `renders` (1 to 4, `set_image_gen_settings`); more than 4 of one prompt = that prompt listed twice.
- Why a list and not write + fire 20 times: that is 40 calls, past the bridge's 30 turns and the API lane's 12 rounds. One call fits both.
- Without `prompts` it works as today.

**D. `read_lora_examples` (read-only).**
- `lora`: a name or file from `list_image_gen_options`; `cursor` for the next page (Civitai's order, 40 a page); optional `match` (words the prompt must all contain).
- Each example: number, Civitai image id, size, poster, prompt, negative, seed, loras + weights, and the 450-wide picture as a file in `civit-cache` (`civitai.ts` `thumbFile`, cached like `imageFile`).
- Same reads as the examples window: `versionImages` + `generationData` (8 at a time, each image's data remembered). Fact found 10-03: Civitai's public v1 `meta` is empty on every example probed, so prompts come only through `generationData` on his key. No key = pictures only, said in the result.
- The bridge exchange gets `--add-dir` for `civit-cache` (and every tagged picture's folder) so Read reaches them. API lane: the tool answers in text (prompts, no pictures); tagged pictures still ride its message as images. Codex / Gemini CLI lanes: get the paths, whether they can open them is OPEN.
- A remake then uses what exists: `set_image_gen_settings` (loras, size, seed) + the `prompts` list. A lora he doesn't have is named, never downloaded (downloads stay his).

**E. Guide (`codirector.md`).**
- Firing renders: many prompts on one gen = one `fire_render` with `prompts`. Propose them first, one line each, fire on go.
- IMAGE GEN line: read_object's take prompts and files, `read_lora_examples`, and what "the tagged ones" means.

**F. ~ tags (his ask, 10-03).**
- Watched (local and civit) and a lora's examples window: tiles select like the take trays (`useTakeMultiSelect` + `arrowNav`: click = this one, Ctrl/⌘-click = add/remove, Shift-click = range, arrows move, the amber ring). ~ (or `) tags the selected, or the one the arrows sit on; ~ again on an all-tagged selection untags. A tagged tile wears a lit ★ in its corner; a click on the ★ untags.
- Civit tiles: a click now selects; the prompt + loras menu moved to right-click (it was on both). Drag and double-click are unchanged.
- The store keeps `codirTags`; every Co-Director message sends them. Main (`setCodirTags`) gives each its picture (the file, or Civitai's 450-wide tile) and what made it (the PNG's saved prompt, or `generationData`), and they ride the message after the open gen's own pictures, both lanes (`openImageGenPics`).
- ponytail: tags last for the session; keep them in settings if he wants them to outlive a restart.
- "Regardless of what's tagged, the samurai in the examples" is part D's `match`.

**Tests.**
- `test-codir-batch.cjs` (in `npm test`): take prompts and files in read_object; the prompts list (cap, empties, go still gates it, the gen's prompt untouched); read_lora_examples against a stand-in Civitai (match, cursor, no key, unknown lora); tags ride the exchange with their prompts.
- `test-codir-batch-browser.cjs` (`npm run test:codir-batch-ui`), real mouse and keys, house CSS: his clicks (type + ＋ Queue three times while a render runs) and the Co-Director's 10-03 run of eight replayed, each render its own prompt; the prompts list; Watched and example tiles select and ~ tag. Against the old queue the same test fails with his symptom: `["P0","P3","P3","P3"]`.
- Not proven: a live render on his GPU, a live Civitai read on his key, the bridge reading `civit-cache` through `--add-dir` in a real exchange.

## Decided

1. The go stays (his 09-30 words): he asks, the Co-Director lists the ideas, he says go, all of them queue.
2. No separate Watched tool: the ~ tag covers Watched (ponytail, his OK 10-03).
