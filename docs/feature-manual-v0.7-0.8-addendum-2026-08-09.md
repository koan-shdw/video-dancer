# Feature manual addendum — v0.7 → v0.8 (written 2026-08-09)

*Continues `feature-manual-2026-06-13.md` + the v0.6 addendum. Covers 0.7.0–0.7.6 and 0.8.0
plus the 2026-08-09 audit-fix round. WhatsNew.tsx stays the per-release source of truth; this
is the narrative version.*

## The Director's Room (0.7.0)

A full-screen overlay for talking to the Co-Director: the app blurs beneath, the chat sits
center, a moodboard rail on the left, context cards on the right (On the Table · Still to
Decide · Changes). Context pops surface the clips/takes the conversation mentions — click one
for a lightbox. The "writing cloud" drifts beside the chat while the AI writes into fields.
Enter mid-run queues follow-ups; they fire in order when the run frees up. Open it from the
Co-Director panel header (and the Window menu).

**The Screen (0.7.3)**: the Room's big floating take player behind the chat — the AI can put a
take "on screen" (`show_on_screen`), you can too from any pop.

## Co-Director full access (0.7.1–0.7.2)

The copilot now reaches everything a user can — char sheets (all fields), clip/style deletes,
whole timelines (`create_timeline`, `set_timeline_clips`, per-item take/trims/speed/mute/
dissolve/disable), keeper takes, duplicates, folders, `@rename` (every @mention rewritten
project-wide) — EXCEPT anything that spends money: renders and image generation stay
user-side, always. Snapshot context includes timelines, sheets and folders so it sees what it
edits. Bridge engine (your local Claude Code subscription) keeps one living conversation with
scheduled re-seeds so long sessions stay lean (0.7.5), and the Monitor overlay pins to its
pane (0.7.6).

## Clip Gen, results-first (0.8.0)

The generation panel leads with RESULTS: a big take preview with the canon jogger, visible
bracket handles and **I/O keys** for an in/out window, drag-the-preview-out to place it, take
cards below. The recipe (fields + beats) sits one tab over — the storyboard is still the
source of truth; the panel just stops hiding what you paid for.

## Premiere timeline round (0.7.x–0.8.0)

Track mechanics matured: insert-drop (Ctrl), take-switch ripple, slip (Ctrl+Alt-drag), Q/W
ripple-to-playhead, Premiere keys (C slice tool · S = master snap toggle · ,/. nudges · J/K/L
· M markers · I/O range), captured scrub, ripple end-trims, gap select + delete, rolling
trims, marquee groups, per-block speed and dissolves. **⟲ loop** (v17): right-click a block —
a faded tail of repeats fills to the next block on the track or the sequence end; the tail's
end grip sets a fixed length; every repeat is a live projection of the one block (trims, take,
fx and speed follow instantly; one undo).

## Suppliers: four (0.6 → 0.8)

fal (recommended, everything) · **BytePlus ModelArk** (Seedance direct from ByteDance; no real
human faces per their policy) · **Astria** (Seedance 2 on plan credits; t2v + first/last-frame
i2v, no refs over their API) · Higgsfield (connected-and-waiting: their API has no Seedance
yet; the engine lights up the day it ships). Settings shows each as its own card with
save-&-test; the header carries one chip per connected supplier.

## Playground shelf (0.8.0)

The Open picker grows a shelf of downloadable sample projects ("playgrounds") — one click
downloads (cached) and stamps a fresh copy as a normal project. First one: **1 AM**.

## Effects v2 (uncommitted era → 0.8.x)

Per-block ordered effect stacks (transform · grid · focus · air · push · subject/depth masks)
with blend modes, composited live in the Timeline Monitor by a WebGL2 chain; AI passes
(subject matte, depth) run locally in a worker and cache next to the take. Export bakes the
same chain at full resolution — preview and file match by construction. `✦ effects…` on any
block's right-click; amber badge marks carriers.

## 2026-08-09 audit round (user-visible)

- **SAVES FAILING banner**: a failing disk/cloud save is now impossible to miss; clears when a
  save lands. One-time notice for projects living in cloud-synced folders.
- **Queue survives quits**: pending renders persist per project; reopening offers a one-click
  re-queue. Double-click can't queue two identical paid renders. Jobs stamped to their project
  — switching projects parks them instead of rendering into the wrong one.
- **Crash recovery got teeth**: recovery entries survive transient errors, work for every
  supplier's key, and poll hiccups no longer kill a paid render.
- **Export cancel** (✕ in the timeline toolbar while exporting); failed exports never leave a
  truncated file that looks finished.
- **Keys stay masked**: Settings shows saved keys as last-4 only; the full key never enters
  the UI again. Save-&-test still works on saved keys.
- Cheat sheet: ⟲ loop rows; tour: current keys + a Co-Director step; README: current
  timeline grammar.
