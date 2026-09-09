# Co-Director TETHER window + HEAT — spec (2026-09-08)

Director's brief, his words (2026-09-08): a floating panel we can drag around the UI; it draws a
linked line to the nearest field and the Co-Director knows that's the field we're working on,
with the full project context behind it. Not a replacement — a new window; the docked panel
stays. Shift+D shows/hides it. A focus button in its top corner lets us drag the tether to
any target by hand, so it's not always nearest. Targets = an individual field, a holder (the
beat bar, a char sheet, a Library image, a production-note field, any field a prompt sits in),
or a general whole thing. It's giving the Co-Director attention, plus a small prompt field
where we say what we want done to that thing; he hits back with suggestions and we commit.
HEAT = our word for the intensity dial (auto / 1–5): how hard he writes, not how much.

Status: DRAFT for approval. No code until GO. Renderer + one main IPC; settings for HEAT.

## 1. What exists (verified in the package, 2026-09-08)

- Focus today: `store.focusField { kind: 'clip' | 'style', ownerId, path }`, set ONLY by
  Clip Gen / Style fields on click (`useFieldFocus` in `panels/ClipFields.tsx`); every
  exchange carries it as "Last-clicked field ('this one')" (codir.ts buildContext /
  buildCoreContext). Beats, char sheets, Library images, timelines set nothing.
- No DOM markers on fields (no data-attributes) — the tether needs a registry (§3).
- One send path: `store.codirSendText(text)` → `codir:send`; replies land in the project log;
  the docked panel and the Director's Room are two views of it.
- Floating surfaces: the Director's Room is a fixed full-screen portal (z 1800). No small
  floating window exists yet.
- App key map (App.tsx onKey): Esc, Ctrl/⌘+Z/Y, `?`, Delete/Backspace. **Shift+D is free.**
- Writers a commit can use: `saveClipPromptData` (clip fields + beats), `saveStyle`,
  `saveCharSheet`. Library images carry no prompt text — an image is a holder, not a writable.
- RLM core (item 11) is live: the tether adds one line to it, never a second paste.

## 2. The window

- A small floating card (Director's Room chrome, docked-panel type size), portal-mounted over
  the workspace, z above dockview, below modals. Default 340×260, drag by its header, remembers
  position + size per user (localStorage — a viewer convenience, not project state).
- **Shift+D** toggles it (App key map; ignored while typing in an input/textarea — same guard
  the other keys use). Also a `⌖ tether` button in the docked Co-Director header.
- Header: the mode glyph + the target's name ("scene.style on KATA" / "beat 3 'the strike'" /
  "char sheet Monk" / "clip KATA"), the **focus button ⌖** (§4), the **HEAT dial** (§6),
  ✕ close.
- Body: the last exchange's reply (same bubble grammar as the panel) with **commit** buttons
  on proposals (§5); the mini prompt (one textarea, Enter sends, Shift+Enter newline — the
  panel's grammar, @-mentions work); the busy/status line.
- It is a third VIEW of the one conversation — same store, same log, same queue. Nothing
  typed here is a different channel.

## 3. Targets and the registry (three levels)

Every thing a prompt can sit in registers a DOM target: `data-tether="<kind>|<ownerId>|<path>"`
on its element, stamped by one hook `useTetherTarget(kind, ownerId, path?)`.

| level | kind | ownerId | path | writable by commit |
|---|---|---|---|---|
| field | `clip` / `style` / `sheet` | the owner id | `scene.style`, `production.avoid`, `freeform`, `beats.<beatId>.action`, `character.features` … | yes |
| holder | `beat` (one beat) / `beats` (the bar) / `sheet` (the card) / `image` (a Library tile) | id | — | beat: yes (its fields); image: no |
| whole | `clip` / `timeline` / `library` / `bin` | id or `*` | — | no (context only; a proposal here comes back as a message, not a write) |

Registration sites (copy-the-sibling: the same hook everywhere): ClipFields' controls (via
`fieldChrome`/`useFieldFocus`, already own meta + path), Beats' bar + each band + the editor
fields, CharSheet's fields + card, StyleSheet's fields, Library tiles, Bin clip tiles, the
Timeline panel root. `focusField`'s type widens to the table above; the store's
`setFocusField` stays the one setter; codir.ts's "Where the user is" line renders the new
kinds ("this one: beat 'the strike' (id) on clip KATA" / "the whole clip KATA").

## 4. The tether line and who wins

- An SVG overlay (portal, pointer-events none) draws one line from the window's anchor (the
  ⌖ button's centre) to the target's nearest edge point, with a dot on the target. `--amber`,
  1.5px, the target gets the focused ring (`fieldChrome` focused style) while tethered.
- **Nearest wins by default**: on every window move (rAF-throttled) and on scroll/resize, the
  registry is scanned; the candidate is the target whose rect is closest to the anchor, fields
  beating holders beating wholes when they overlap (smallest rect wins a tie). Off-screen
  targets never win; nothing within reach (§4 radius) = no tether and `focusField` cleared.
  Nearest updates `focusField` live; the Co-Director reads it on the next exchange.
- Reach: a target counts only if its rect is within 160px of the anchor (measured to the
  nearest edge). Beyond that the line is gone and focus is null — proximity, not memory.
- Hiding the window (Shift+D / ✕) clears the tether and `focusField`; showing it again starts
  from nearest.
- **Pin beats nearest**: drag from the ⌖ button and drop on any target → that target is
  pinned (the line stays on it while the window moves). Click ⌖ once = unpin (back to nearest).
  Pin survives scroll; if the pinned target unmounts, back to nearest.
- The docked panel and the Room keep working exactly as before; the tether only feeds the
  same `focusField`.

## 5. Propose → commit (the mini prompt)

- The mini prompt sends through `codirSendText` with a leading app-generated line the user
  never types: `(tether: the target is <kind/name/path>. Answer with PROPOSALS for it — up to
  three, each in its own fenced block — and change nothing.)` The exchange is a normal
  conversation turn (logged, visible in the panel + Room), so history and the go-gate stay
  one system.
- The reply renders in the window; every fenced block gets a **commit** button. Commit =
  the renderer writes that text into the target's field through the existing writer
  (`saveClipPromptData` / `saveStyle` / `saveCharSheet`) — undoable like any edit — and the
  field wears the enhanced tint (`meta.enhanced`) as the Co-Director's own writes do. No
  model tool runs on commit; the model never writes from the tether. Writable targets only;
  a whole-thing target shows the proposals without commit buttons.
- Statute 1 (go-gate) is honoured by construction: the tether never lets him write — the
  human commits.

## 6. HEAT

- `Settings.codirHeat: 'auto' | 1 | 2 | 3 | 4 | 5` (user-level, default `auto`). Dial on the
  tether header AND the docked Co-Director header — one value, two views (the panel's own
  grammar: a small Dropdown, `heat auto · 1 · 2 · 3 · 4 · 5`).
- Rides the core context as ONE line when not auto: `HEAT <n>/5 — write field text at this
  heat: 1 = plain, restrained, literal; 3 = full craft; 5 = maximum force, sensory stacking,
  the least-likely read. Heat is how HARD you write, never how MUCH (statute 6 still
  governs length).` Auto = no line.
- Inline override works by his words ("at 5") — nothing to build; the guide gains one
  sentence naming the dial.

## 7. Files

- package: `panels/CoDirectorTether.tsx` (window + line + registry scan), `lib/tether.ts`
  (`useTetherTarget`, registry, nearest math), `store.ts` (focusField widened, `tetherOpen`,
  `tetherPin`, `codirHeat`), App.tsx (Shift+D, mount), the registration sites in §3,
  CoDirector.tsx (⌖ button + heat dial).
- main: `codir.ts` — the new focus kinds in the "Where the user is" line; the HEAT line in
  both context builders (reads settings, passed like `rlm`); guide sentence.

## 8. Acceptance

1. Shift+D shows/hides the window; it drags, remembers its place.
2. Drag it beside a Clip Gen field → line snaps to that field, the field wears the ring, the
   next exchange's "this one" names it. Beside the beat bar → the bar; beside a Library tile
   → that image; over nothing → the last target holds.
3. ⌖ drag onto a field elsewhere → pinned; window moves, line stays; ⌖ click → nearest again.
4. Mini prompt "make it colder" on `scene.visualFeel` → up to three fenced proposals →
   commit writes one into the field (undo reverts), the field tints.
5. HEAT 5 → the compiled context carries the line (read_compiled_prompt-style check via the
   log); auto → no line.
6. The docked panel and the Room are unchanged.

## 9. Settled (director, 2026-09-08)

1. Proposals: **three** per ask, pick one to commit.
2. Over nothing in auto mode: **no tether, no focus** — proximity only. Pinned: stays on the
   pinned target until ⌖ is clicked (back to auto) or ⌖ is dragged to a new one.
3. Hidden window: **drop** the tether and the focus — "we don't want the Co-Director stuck on
   a field without us knowing." Attention is only ever what you can see.
   Approved same day; build GO given.

## 10. Fix 2026-09-09 — "the commit buttons for ideas aren't working" (his report)

Two faults, both on the Image Gen prompt (the target he was parked on):
1. `writable()` treated every dotless path as a SECTION (context only) — Image Gen's one field is
   `prompt`, dotless, so its commit buttons were dimmed with the "needs a field target" tip.
   Now: kind `imagegen` is writable exactly when path === `prompt`.
2. The Image Gen panel keeps the prompt as a 400 ms-autosave DRAFT seeded only when the open job
   changes — an outside write (tether commit, `set_image_gen_prompt`, undo) never reached the box,
   and the next keystroke saved the old text back. Now the box re-syncs whenever the recipe's
   prompt differs from what the panel itself last saved (own saves are ignored), and on undoTick.

Clip Gen / Style / Sheet forms were already reloading on undoTick; unchanged. Built, UNTESTED in-app.
