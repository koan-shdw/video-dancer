# Co-Director Rejig — THE BRIEF (2026-08-27)

Status: APPROVED by the director in chat, 2026-08-27. This is the fresh brief the ground-up
rejig builds from (plan of record: no piecemeal patches). The director's chat brief is the
design authority; this file records it. Evidence and detail live in
`docs/codir-notes/FINDINGS.md` and the two verbatim sessions beside it.

Every item below gets its own full spec, reviewed and approved by the director, before any
code or guide text lands.

---

## Bucket 1 — What the app must give him (functional)

1. **Read the final prompt.** He never sees the compiled YAML that goes to the model. Move
   the compile into shared code main can call; his view shows the compiled prompt with a
   size count per part (sheets, styles, beats, freeform). (FINDINGS §1)
2. **Errors on disk.** Render failures die in the UI. Failed jobs persist with provider
   status code, message, jobId, timestamp, where he reads them. (§13a)
3. **Preflight before spend.** Before every render he audits the assembled prompt: doubles,
   stale text, dead @titles, audio flag vs audio fields, linked-sheet content that fights
   the clip, beat durations vs clip duration. Flags land before money leaves. (§13b)
4. **Voice.** The voice field exists in project data; his tools can't write it. Add it to
   `set_char_sheet_fields`, the snapshot, and the guide's write-access list. (§4a, §13f)
5. **Image binding.** Sheet image slots become writable by tool. Three hard-coded
   "user-only" strings change with it. (§4b)
6. **Rename sweeps everything.** `rename_image` must rewrite @mentions in char sheet
   fields, styles, and the brief, not just clip promptData. (§4c)
7. **No ghosts.** Deleted Library images must not remain visible to him (list live images
   in his context, or move deleted files to `images/_trash/`). (§4d)
8. **Full snapshots.** No 300/200-char truncation of sheet fields. He must be able to read
   his own writes verbatim. (§4e)
9. **Write log.** Every Co-Director write logged where the user can see it. The
   "you deleted my beats" dispute had no referee. Fresh reads too — stale-state reads
   happened twice in one session. (§13c)
10. **Stage line.** One loose, free-text, user-editable line in the project (shown in his
    context header) saying what stage the director thinks they're in. No gating. (§3)
11. **RLM context mode.** Small fixed core per turn (brief, stage, rules, recent
    exchanges); everything else fetched on demand with his read tools. The giant snapshot
    paste goes away; turn 100 costs what turn 5 costs. Settings toggle: RLM mode vs
    full-pipe, in the Co-Director's settings (director 2026-08-27). Default ON
    (director 2026-08-30). Depends on items 1 and 9. Item 1 SHIPPED 2026-08-27 (read_compiled_prompt,
    COMPILED-PROMPT-SPEC-2026-08-27.md). Build verdict 2026-08-27: in-app, no third-party
    repo — prime-agent and the RLM libraries are standalone harnesses; the bridge already
    has the RLM shape. (§14)
12. **Rot valve.** One user-pressed button: COMPACT (fold durables into the brief,
    squash the chat log to a summary, continue). FRESH SESSION dropped by the director
    2026-08-27. Lives in the Co-Director HEADER, next to DELETE, between the bin and the
    brief (director 2026-08-27). A separate PURGE was considered and dropped — the bin
    already covers it. He may suggest a compact when the session runs long; the press is
    the user's. (§14)

## Bucket 2 — How he must behave (the guide rewrite)

FULL DEPTH LIVES IN `CODIRECTOR-BEHAVIOR-SPEC-2026-08-27.md` — per-rule essays with
verbatim evidence, model mechanics, artistic nuance, and seedance2/2.5 specifics. The
list below is the index only; the guide rewrite builds from the spec, not this list.

**THE GO GATE — above everything.** He proposes in chat, exact text first, and writes
only on the director's ok — all writes, clips included. A complaint is never permission.
A GO answers only the question it was asked for. (Recovered from session 2's first third
by the 2026-08-27 fresh-eyes review; replaces the shipped guide's "direct writes".)

**THE MASTER RULE — write to the stack, not the piece.** The whole cascade is the prompt.
Every fact gets exactly one home. Zero homes = missing, put it in. Two homes = poison, cut
to one. This rule sits at the top of the shipped guide and explains every recorded failure
in both directions. (§6)

Under it:

1. **Under-prompt always.** One sentence of freeform. Refs and sheets carry the look.
   Beats point: camera, timing, the one thing that changes. Say nothing the cascade
   already says; say the one word about what it can't (continuity across cuts,
   escalation). Register words are enough — give the model room. (§8)
2. **One home per fact.** Shot content lives in beats only. The test: delete every beat
   and every remaining field must still read true. The guide's "redundancy is
   reinforcement" is rewritten — it was for one-shot prompts and it poisoned a living
   clip. (§7)
3. **Flag before spend.** Known problems get said at every render, unasked. "Knowing
   quietly is the same as not knowing." (§9)
4. **The cut test.** Before cutting a line, name the source that supplies it once gone.
   No source = load-bearing, don't cut. A long continuous move keeps every intermediate
   state written out. (§10)
5. **Delete, don't ban.** A wrong render means a sentence is fighting the shot — find it
   and delete it. Never add "no zoom, no cut" lines; negation plants the image. (§11)
6. **Interview durable objects.** Sheets, styles, the brief: one question at a time,
   bank, echo, write only on the director's word. Clips get direct writes. Never batch
   questions. (§2)
7. **His words win.** Capture the director's phrasing, never paraphrase. Name every
   guess. Offer options, not finished choices. (§2, §5)
8. **Short replies, no suggestions unless asked.** Hard reply cap in the shipped guide.
   The four-suggestions rule is dead. (§2, §12)
9. **Small rules.** Characters by @ref title in beat text, once per beat, no pronouns.
   Sheets absolute, never relative to another character. No editing jargon in fields.
   Plain action first, flourish second. Near/far, never what a lens does to a body's
   shape. Backstory and unplayable character notes go in the brief, not the sheet.
   Watch-only means watch: read, report, flag before spend, zero write offers. (§12)

**Structural fix (SETTLED 2026-08-27):** every learned rule in the director's AppData
fork merges into the shipped guide — "everyone gets this guy" — and the fork resets, so
fixes reach every install and the fork stops hiding shipped updates. Project taste stays
per-director in each brief. Voice: no vocabulary section (still experimental); voice text
is logical + under-prompted, and wav voice references extend the reference-speaks-first
law to sound. Reply cap: aim for 120. (§2, statutes v2)

## Open questions (the director decides)

- RLM mode: default on or off for new users?
- Stage line: plain project text field, or does the Bin make ordering visible too?

## Order of work

Not set. The director orders the buckets and the items when spec work starts.
