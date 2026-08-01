# Video Dancer — Complete Feature Manual

> Exhaustive, deduplicated catalogue of every user-facing capability and automatic behavior in `vi-dancer` (C:/KOAN_IMG/vi-dancer). Merged from 8 extractor passes and cross-checked against `docs/full-audit-2026-06-13.md`. STATUS markers: **[SHIPPED]** unless flagged **[PARTIAL]**, **[COMING SOON]**, or **[DEAD]**.
>
> **Snapshot date 2026-06-13.** Later rounds live in dated addenda — v0.6 (multi-supplier, Seedance 2.5, video/audio refs, Library videos, Video Editor tree): `feature-manual-v0.6-addendum-2026-08-01.md`.

---

## 1. Timeline (sequence editor)

### 1.1 Transport bar
| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **Previous Clip** | Steps playhead to previous clip (tlIndex−1, min 0) | Click SkipBack button / `←` | Timeline.tsx:853-855 |
| **Play / Pause** | Starts/stops timeline playback; icon toggles | Click Play/Pause / `Space` | Timeline.tsx:856-858 |
| **Next Clip** | Steps to next clip (tlIndex+1, capped at last) | Click SkipForward / `→` | Timeline.tsx:859-861 |
| **Loop toggle** | Toggle loop playback; dimmed (0.4 opacity) when off | Click Repeat icon | Timeline.tsx:862-864 |
| **Filmstrip toggle** | Show/hide video-frame thumbnails on all blocks (off = faster plain blocks) | Click Film icon | Timeline.tsx:865-871 |
| **Slice tool toggle** | Arm/disarm razor; cursor → crosshair, button turns red when armed | Click Scissors / `S` | Timeline.tsx:873-880 |
| **Scrubber snap (magnet)** | Toggle snapping of slice/trim edges to playhead (within SNAP_PX) | Click Magnet icon | Timeline.tsx:882-888 |
| **Beat snap (magnet+music)** | Toggle snapping of slice/out-trim to music beat ticks | Click paired Magnet+Music icons | Timeline.tsx:889-897 |
| **Mute all clip audio** | Mute/unmute entire timeline's clip audio (playback + export); red when muted | Click Clapperboard+Volume | Timeline.tsx:903-912 |
| **Mute music lane** | Mute/unmute the music lane (playback + export); red when muted | Click Music+Volume | Timeline.tsx:913-921 |
| **Export timeline (Upload)** | Export active timeline to mp4; disabled while busy or empty | Click Upload icon | Timeline.tsx:922-928 |
| **Zoom Out** | Divide zoom by 1.5 (min 1 = fit); dimmed at fit | Click ZoomOut | Timeline.tsx:929-931 |
| **Zoom level / reset to fit** | Shows zoom % or "fit"; click resets to 1× | Click zoom-% label (only active when >1) | Timeline.tsx:932-939 |
| **Zoom In** | Multiply zoom by 1.5 (max 8); dimmed at max | Click ZoomIn | Timeline.tsx:940-942 |
| **Export status / reveal file** | Inline export progress/error; click reveals output in Explorer; red=error, amber=progress | Auto; click message | Timeline.tsx:946-955 |
| **Active timeline name + aspect** | Read-out of active timeline name & aspect ratio (tooltip: double-click in Bin to edit) | Auto | Timeline.tsx:956-958 |
| **Clip count** | Shows "N clips" on track | Auto | Timeline.tsx:959 |
| **Time readout (timecode)** | Shared TimeReadout SMPTE position display | Auto | Timeline.tsx:960 |

### 1.2 Ruler, track, zoom
| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **Horizontal zoom scrolling** | When zoom>1 ruler/track/audio/playhead widen and scroll together; hidden overflow at fit | Auto; trackpad/scrollbar | Timeline.tsx:964-965 |
| **Time ruler / scrub bar** | Click/drag scrubs playhead; auto-raises Timeline Monitor | mousedown/drag on ruler | Timeline.tsx:967-979 |
| **Ruler tick marks + labels** | Auto-spaced ticks (1/5/10/30s by total length) with second labels | Auto | Timeline.tsx:971-978, 686 |
| **Empty timeline drop hint** | "drag clips from the Bin here →" when empty | Auto | Timeline.tsx:995-997 |
| **Click empty track** | Clears selection (normal) or disarms slice (slice mode) | Click track background | Timeline.tsx:988-992 |
| **Timeline playhead** | 2px amber bar at current sequence %; isolated re-render | Auto | Timeline.tsx:1071, playback.tsx:7-16 |
| **Scrub → raise Monitor** | Scrubbing ruler auto-raises Timeline Monitor | Auto via raiseTimelineMonitor | Timeline.tsx:745 |
| **Fractional scrub mapping** | Pixel pos → clip index + within-clip offset via cumulative segments | Auto in seekFromClientX | Timeline.tsx:727-743 |
| **Bottom hint bar** | Context-sensitive shortcut/cut instructions; switches by slice mode | Auto | Timeline.tsx:1075-1079 |

> **NOTE [PARTIAL]:** No zoom-to-content; ruler ticks computed from total not viewport → ticks fall off-screen at high zoom (audit Medium, Timeline.tsx:964-965).

### 1.3 Clip blocks
| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **Click to select + move playhead** | Selects block (amber ring), sets tlIndex; Delete then removes it | Click TlBlock | Timeline.tsx:1031-1034 |
| **Double-click to edit** | Opens clip in Clip Editor (disabled in slice mode) | Double-click block | Timeline.tsx:1035, 145-148 |
| **Remove (✕)** | Removes this instance from timeline | Click ✕ (top-right) | Timeline.tsx:245-253, 1036 |
| **Clip name** | Top-left name with ellipsis | Auto | Timeline.tsx:195-197 |
| **Duration label** | Effective trimmed seconds (2dp); ▶ if take video, ▦ if not | Auto | Timeline.tsx:208-210 |
| **Take label / take picker trigger** | Shows "take N/M", "C · recipe", or "no take"; click opens take menu | Click take-label (▾) | Timeline.tsx:199-207, 287-322 |
| **Per-instance take picker menu** | Portal dropdown of "C — live recipe" + all takes; active = amber ✓ | Click option in portal menu | Timeline.tsx:287-322 |
| **Per-instance mute (via take menu)** | Mute/unmute only this instance's clip audio | Click mute row in take menu | Timeline.tsx:309-319 |
| **Muted indicator** | Small VolumeX icon when instance muted | Auto | Timeline.tsx:206 |
| **Playhead-in-block marker** | Quiet amber-dim border when playhead inside block | Auto | Timeline.tsx:133 |
| **Selection amber ring** | "sel" class amber ring when selected | Auto | Timeline.tsx:126-127 |
| **Drop-active left border** | 3px amber left border on drop target during TLITEM drag | Auto | Timeline.tsx:131 |
| **Dashed outline (no take)** | Dashed amber-dim outline for storyboard/recipe-only blocks | Auto | Timeline.tsx:135-136 |
| **Hover tooltip** | "double-click to edit · drag to reorder" / "click to cut here" / "no take to cut" | Hover | Timeline.tsx:162 |
| **Filmstrip frames** | Real sampled frames tiled at true aspect (never stretched) | Auto when filmstrips on + has video | Timeline.tsx:100-121, 164-173 |
| **Fallback thumbnail (recipe blocks)** | First ref image as static thumb for C/recipe blocks | Auto via useThumbUrl | Timeline.tsx:121, 173 |
| **Live trim scrub preview video** | Hidden `<video>` seeked to dragged-edge source-second while trimming | Auto during trim | Timeline.tsx:175-193, 832-840 |
| **Beat reference image overlays** | Per-beat image background over its proportional span, windowed to trim | Auto | Timeline.tsx:211-244 |
| **Colored beat band indicators** | 6px colored bands per beat (BEAT_COLORS cycle), windowed to trim | Auto | Timeline.tsx:237-242 |

### 1.4 Trimming
| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **In-point handle (left edge)** | Drag adjusts in-point; non-recipe instances only | mousedown drag left handle | Timeline.tsx:271-278 |
| **Out-point handle (right edge)** | Drag adjusts out-point; non-recipe instances only | mousedown drag right handle | Timeline.tsx:279-285 |
| **Trim snap to playhead** | In-trim snaps to playhead source frame (within 10px) when scrubber snap on | Auto during drag | Timeline.tsx:772, 791 |
| **Trim snap to beat ticks (out)** | Out-trim snaps to nearest music beat tick (within 10px) when beat snap on | Auto during out-trim | Timeline.tsx:773-795 |
| **Live local preview (no store write during drag)** | dragTrim overrides locally; store written once on mouseup | Auto | Timeline.tsx:798, 800-806 |
| **Drag-start guard while trimming** | Suppresses accidental reorder drag-start mid-trim | Auto | Timeline.tsx:1038-1041 |

### 1.5 Slice tool
| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **Click to cut clip** | Cuts a take-video clip at pixel pos into two contiguous instances; auto-disarms | Click sliceable block | Timeline.tsx:86-98, 813-829 |
| **Cut snaps to playhead** | Guide snaps amber within SNAP_PX of playhead | Auto | Timeline.tsx:63-67, 92 |
| **Cut snaps to beat ticks** | Guide snaps green within SNAP_PX of music beat | Auto | Timeline.tsx:68-73, 1025 |
| **Cut guide cursor line** | Vertical line: red free / amber playhead / green beat; widens to 3px when snapped | Auto on mousemove | Timeline.tsx:254-270 |
| **MouseLeave hides guide** | Guide disappears, snap resets on leave | Auto | Timeline.tsx:158-161 |
| **Click empty track to disarm** | Disarms slice tool | Click track background | Timeline.tsx:988-992 |
| **Right-click to disarm** | Disarms slice + suppresses context menu | Right-click panel | Timeline.tsx:845-850 |
| **Keyboard S to toggle** | Toggle slice (ignored while typing) | `S`/`s` | Timeline.tsx:589-598 |
| **Keyboard Esc to disarm** | Disarms slice (ignored while typing) | `Esc` | Timeline.tsx:594-596 |
| **One-shot auto-disarm** | Slice reverts to selection after each cut | Auto | Timeline.tsx:829 |
| **Minimum cut width guard** | Ignores cut if either half < 0.15s | Auto | Timeline.tsx:820 |
| **Dynamic last-frame remap after cut** | Rebinds last-frame still to right half | Auto via imageRemapDynamic | Timeline.tsx:826-828 |
| **canSlice guard** | Only clips with a rendered take video are sliceable; others show not-allowed cursor | Auto | Timeline.tsx:1024 |

> **NOTE (audit High):** Slice's `imageRemapDynamic` is fire-and-forget outside the `timelineSet` await → dangling binding if first write fails (Timeline.tsx:825-828). All timeline mutations are by-index with no CAS → concurrent writes can race.

### 1.6 Audio (music) lane
| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **Accept music drop (MIME_AUDIO)** | Drop ♪ track from Library; drop X-pos sets startSec | Drop on audio lane | Timeline.tsx:469-483 |
| **Drop highlight** | Lane tints amber on AUDIO dragover | Auto | Timeline.tsx:485 |
| **Empty-state hint** | "♪ audio — drag music from the Library" | Auto | Timeline.tsx:487-491 |
| **Lane-level tooltip (empty)** | "drag a ♪ track from the Library here" | Hover | Timeline.tsx:486 |
| **Drag music block (move)** | Reposition startSec; 3px threshold before move; committed on mouseup | Drag block body | Timeline.tsx:416-464, 430-432 |
| **Trim in-point (left)** | Trims music in-point, adjusts startSec to keep alignment | Drag left handle | Timeline.tsx:533 |
| **Trim out-point (right)** | Sets music outSec, clips to source duration | Drag right handle | Timeline.tsx:548 |
| **Remove music (✕)** | Removes music assignment | Click ✕ | Timeline.tsx:537-546 |
| **Double-click expand/collapse** | Toggle lane 24px ↔ 64px; expanded draws waveform | Double-click block | Timeline.tsx:497-503 |
| **Click to cycle waveform view** | wave → beats → both (260ms timer distinguishes from double-click) | Click block (expanded) | Timeline.tsx:449-457 |
| **Waveform canvas rendering** | Draws peaks / beat ticks / both; reads CSS vars for theming | Auto when expanded | Timeline.tsx:371-408 |
| **Analyzing spinner/label** | "analyzing…" before wave ready | Auto | Timeline.tsx:523-527 |
| **View mode label** | "wave"/"beats"/"wave+beats" amber top-right | Auto | Timeline.tsx:528-532 |
| **Block title tooltip** | Track title + expand/cycle/move/trim hints + startSec | Hover | Timeline.tsx:505 |
| **Music block startSec clamp** | Clamped to [0, total−0.25] | Auto | Timeline.tsx:431 |
| **Local drag preview (no store write during drag)** | setDrag local; store on mouseup | Auto | Timeline.tsx:443, 459-460 |

---

## 2. Clip Editor / Render Panel

### 2.1 Identity & setup
| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **Clip name input** | Names current clip; commits to store (applies to uncommitted clip on commit) | Blur / Enter | RenderPanel.tsx:783-794 |
| **+ new Clip** | New blank storyboard clip; ADOPTS uncommitted form content instead of discarding | Click "+ new" | RenderPanel.tsx:791-794, 505-517 |
| **Uncommitted content warning banner** | Amber dashed notice when form not yet saved to Bin | Auto | RenderPanel.tsx:796-800 |
| **Setup section (collapsible)** | "setup — model · mode · output" wraps model/mode/duration/res/aspect/audio | Click header | RenderPanel.tsx:802-863 |
| **Model (engine) dropdown** | Lists registered engines; switching keeps inputs; out-of-list value preserved via withCurrent(); T-chip drop target | Select; drop T-chip | RenderPanel.tsx:804-811 |
| **Render mode toggle (ref2v / i2v)** | Switch modes; unsupported modes greyed (0.35); carries images across | Click mode chip; T-chip drop | RenderPanel.tsx:812-830 |
| **Image carry-across on mode switch** | ref2v→i2v promotes first ref to start; i2v→ref2v migrates start/end into refs | Auto in switchMode | RenderPanel.tsx:522-530 |
| **Model notes label** | Shows model.notes when present | Auto | RenderPanel.tsx:831 |
| **Duration dropdown** | From model.durations; "auto" assumes 5s + asterisk; T-chip drop target | Select; drop T-chip | RenderPanel.tsx:835-840 |
| **Resolution dropdown** | From model.resolutions; out-of-list preserved; T-chip drop target | Select; drop T-chip | RenderPanel.tsx:841-846 |
| **Aspect ratio dropdown** | From model.aspectRatios; out-of-list preserved; T-chip drop target | Select; drop T-chip | RenderPanel.tsx:847-852 |
| **Generate audio checkbox** | Toggle native audio; disabled+forced-on when model.audioToggle false (label "audio: always on"); T-chip drop | Click checkbox | RenderPanel.tsx:855-862 |
| **withCurrent out-of-list preservation** | Prepends stored value not in engine list so it stays selectable (validation still flags) | Auto | RenderPanel.tsx:20-21 |

### 2.2 Prompt & fields
| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **Prompt & fields section (collapsible)** | Wraps textarea, link chip, @mention, YAML preview, ClipFields | Click header | RenderPanel.tsx:865-996 |
| **Freeform prompt textarea** | Resizable; auto-detects @mentions; auto-collects @title refs; accepts image & T-chip drops | Type / resize | RenderPanel.tsx:941-957 |
| **Drag Library image → insert @ref** | Inserts @title at caret + adds to ref list | Drop MIME_IMAGE | RenderPanel.tsx:426-444, 1068-1083 |
| **T-chip → restore prompt** | Restores freeform from take snapshot (same clip only) | Drop MIME_TAKE | RenderPanel.tsx:949-953 |
| **@mention autocomplete** | Up to 8 matching library titles; click inserts + adds ref | Type "@…"; click item | RenderPanel.tsx:458-478, 959-974 |
| **Expand/collapse fields toggle** | Shows/hides ClipFields + YAML preview | Click "▸/▾ fields" | RenderPanel.tsx:868-871 |
| **YAML preview** | Read-only `<pre>` of generated YAML appended under prompt | Auto when expanded | RenderPanel.tsx:975-980 |
| **Structured ClipFields panel** | Scene/characters/production editor; T-chip drop restores all fields | Visible when expanded | RenderPanel.tsx:983-995 |
| **Link another clip's prompt** | Splice another clip's live freeform before/after | Click "link a clip's prompt"; pick clip | RenderPanel.tsx:911-938 |
| **Linked prompt chip (live preview)** | Shows @name + truncated text; full prompt on hover | Auto | RenderPanel.tsx:878-890 |
| **Double-click linked chip → open clip** | Opens linked clip, focuses its prompt textarea | Double-click chip | RenderPanel.tsx:879-882, 144-149 |
| **Flip linked position (before/after)** | Toggle "⇄ before/after yours" | Click ⇄ | RenderPanel.tsx:892-897 |
| **Unlink prompt (✕)** | Removes prompt link | Click ✕ | RenderPanel.tsx:898-900 |
| **Linked clip removed warning** | "linked clip removed" + unlink when target gone | Auto | RenderPanel.tsx:903-909 |
| **Link picker close on outside click** | Closes dropdown | Click outside | RenderPanel.tsx:915-938 |
| **Link picker "no other clips"** | Empty-state placeholder | Auto | RenderPanel.tsx:916-919 |
| **Effective prompt composition** | buildCombined splices freeform link + resolves field links; lint runs on local, API gets resolved | Auto | RenderPanel.tsx:90-122 |

### 2.3 References (ref2v) / Frames (i2v)
| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **References section (collapsible)** | Ref images + max-count + warning + drop zone + "+ add" (ref2v) | Click header | RenderPanel.tsx:1011-1110 |
| **Frames section (collapsible)** | Start/end frame slots (i2v) | Click header | RenderPanel.tsx:1011-1064 |
| **Drag image onto refs zone** | Adds ref + inserts @title; amber dashed outline on hover | Drop MIME_IMAGE | RenderPanel.tsx:1068-1083 |
| **T-chip → restore refs** | Replaces ref list from take snapshot | Drop MIME_TAKE | RenderPanel.tsx:1079-1081, 716-719 |
| **Yellow warning outline (un-@mentioned ref)** | Warns when ref @title absent from combined prompt | Auto | RenderPanel.tsx:1093 |
| **Clear ref (✕)** | Removes ref + strips @title from prompt (word-boundary regex) | Click ✕ on thumb | RenderPanel.tsx:1094-1104 |
| **"+ add" chip** | Opens image picker (reference mode) | Click "+ add" | RenderPanel.tsx:1107 |
| **Start frame slot (i2v)** | Assign/placeholder; accepts image + T-chip drops | Click placeholder; drop | RenderPanel.tsx:1013-1036 |
| **Start frame clear** | Removes start frame | Click ✕ | RenderPanel.tsx:1032 |
| **End frame slot (i2v)** | Optional end image; greyed (0.35) when model.endFrame false (stored, not sent) | Click placeholder; drop | RenderPanel.tsx:1037-1063 |
| **End frame stored-but-not-sent** | Kept in state/persisted when engine lacks end-frame support | Auto | RenderPanel.tsx:1053-1055 |

### 2.4 Validation & lint (display)
| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **Validation error messages** | Red "✕" lines from validateForm(); BLOCK render | Auto | RenderPanel.tsx:1112-1124 |
| **Validation warning messages** | Amber "⚠" non-blocking warnings | Auto | RenderPanel.tsx:1117-1120 |
| **Lint warning messages** | Amber "⚠" content-lint from lintFields() | Auto | RenderPanel.tsx:1121-1123 |

### 2.5 Render footer & dispatch
| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **Sticky render footer** | Render button + status always visible | Auto | RenderPanel.tsx:1227-1253 |
| **Render button** | "▶ Render (adds a take)" / "(new clip)" + model label + est cost; "rendering…" while busy; blocked on errors | Click | RenderPanel.tsx:1228-1249 |
| **Estimated cost display** | Live ~$ from resolution $/s × duration; asterisk on auto; tooltip breakdown | Auto | RenderPanel.tsx:186-190, 1231-1236 |
| **Blocked-by-validation tooltip** | "fix the ✕ items above first"; click → "fix first: …" no API call | Hover/click | RenderPanel.tsx:1231-1232, 579 |
| **Status bar** | Single-line lifecycle state; red on error; ellipsis + tooltip | Auto | RenderPanel.tsx:1250-1252 |
| **Timeline slot status** | "timeline clip — slot N" / "slot N · C — live recipe" | Auto | RenderPanel.tsx:303 |

### 2.6 Image picker modal
| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **Image picker modal** | Full-screen library picker scoped to ref/start/end; click outside or ✕ closes | Open via "+ add"/placeholder | RenderPanel.tsx:1275-1299 |
| **"import new"** | System file dialog; assigns first imported to active slot | Click | RenderPanel.tsx:1287 |
| **"Library is empty" empty state** | Hint when no images | Auto | RenderPanel.tsx:1290 |

### 2.7 Per-field links (see also §3 ClipFields)
| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **Per-field links (fieldLinks)** | Link scene/production sub-field to another clip; linked value prepended | Via ClipFields UI | RenderPanel.tsx:124-143 |
| **Open linked clip from field** | Opens + selects linked clip | "open link" | RenderPanel.tsx:139-142 |
| **Per-field preview tooltip** | preview() returns linked field's current value | Hover | RenderPanel.tsx:126-130 |

---

## 3. Beats & structured fields

### 3.1 Beats timeline bar
| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **Beats bar (proportional)** | Colored segments proportional to length; empty hint "click to add a beat"; 8-color cycle | Auto | Beats.tsx:152-245 |
| **Add beat — click empty space** | Appends "shot" beat, length 3s; selects it; re-fits if auto-time | Click bar empty area | Beats.tsx:84-88, 155 |
| **Add beat — "＋" button** | Same as click empty | Click ＋ | Beats.tsx:265 |
| **Remove beat — "✕"** | Removes selected beat; clamps selection; re-fits if auto-time | Click ✕ | Beats.tsx:266 |
| **Select beat (click)** | Sets active selection | Click segment | Beats.tsx:173-176 |
| **Open editor (double-click)** | Selects + opens field editor | Double-click segment | Beats.tsx:177-181 |
| **Drag-to-reorder beats** | Reorder by HTML5 drag (`application/x-vd-beat`); 3px amber left-border drop indicator | Drag segment | Beats.tsx:182-202 |
| **Drag boundary to resize** | Redistribute length between adjacent beats; min 0.25s; snaps 0.25s | Drag boundary handle | Beats.tsx:106-128, 229-237 |
| **Tail/overflow indicator** | Gray "+ add" tail; bar + counter turn red when beats exceed duration | Auto | Beats.tsx:55-56, 137-139, 224-228 |
| **Count + duration summary** | "# beats · sum/durations"; red when over | Auto | Beats.tsx:136-139 |
| **Playback scrubber line** | White playhead overlaid imperatively | Auto via playheadRef | Beats.tsx:239-244 |
| **Per-segment name + length** | Name 10px bold, length 8px, ellipsis | Auto | Beats.tsx:218-222 |
| **Beat tooltip (name)** | Native title tooltip | Hover | Beats.tsx:203 |
| **Resize handle tooltip** | "drag to resize" | Hover | Beats.tsx:234 |
| **Drop-target highlight** | 3px amber inset left-border on drag-over | Auto | Beats.tsx:43, 187-193, 208 |
| **Selected beat highlight** | White 2px inset box-shadow | Auto | Beats.tsx:208 |

### 3.2 Auto-time
| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **Auto-time toggle** | Keep beats filling 100% of duration (each keeps % share); hidden when showAutoTime false | Click "↻ auto time" | Beats.tsx:44-45, 140-149 |
| **Auto-time tooltip** | Explains percentage-share behavior | Hover | Beats.tsx:145 |
| **Auto-time opacity state** | Full opacity on, 0.45 off | Auto | Beats.tsx:143 |
| **Proportional re-fit on load/duration change** | Rescale (fitArr) when sum differs >0.05s; last beat absorbs remainder | Auto | Beats.tsx:61-65, emitYaml.ts:10-20 |
| **Auto-rebalance others on resize** | Redistribute other beats when one length edited | Auto | Beats.tsx:69-83 |
| **Selection auto-clamp on removal** | Clamps sel to last valid index | Auto | Beats.tsx:48-50 |

### 3.3 Beat editor fields
| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **Collapse/expand editor** | "▸/▾" toggles full field set | Click chevron | Beats.tsx:250-252 |
| **Beat name input** | Names beat; YAML key (snake-cased) | Type | Beats.tsx:253 |
| **Start timecode (read-only)** | Cumulative start in seconds (monospace) | Auto | Beats.tsx:254 |
| **Length number input** | Beat duration; step 0.25, min 0; rebalances when auto-time | Type/spin | Beats.tsx:255-263 |
| **End timecode (read-only)** | Cumulative end in seconds | Auto | Beats.tsx:264 |
| **Reference image auto-display** | 96×56 thumb "reference (auto, from @ref)" above camera field | Auto | Beats.tsx:270-275 |
| **Camera field + word-count lint** | MentionArea; live "N/20" word count, red when over 20 | Type | Beats.tsx:131, 276-279 |
| **Action field** | MentionArea w/ @mention | Type | Beats.tsx:280-281 |
| **Lighting field** | MentionArea w/ @mention | Type | Beats.tsx:282-283 |
| **Dialogue field** | Single-line input → YAML | Type | Beats.tsx:284-289 |
| **VFX field** | Single-line input → YAML | Type | Beats.tsx:284-289 |
| **Reaction field** | Single-line input → YAML | Type | Beats.tsx:284-289 |
| **SFX field** | Single-line input → YAML | Type | Beats.tsx:284-289 |
| **Beats section T-chip drop (RenderPanel)** | Restore beats from take, proportionally rescaled to current duration | Drop MIME_TAKE on beats body | RenderPanel.tsx:999-1007, 711-715 |
| **Beat @ref auto-add to refs** | @titles in beat fields auto-added to ref list (ref2v) | Auto | RenderPanel.tsx:387-397 |

### 3.4 MentionArea (shared)
| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **@-mention autocomplete** | Up to 8 case-insensitive matches, gold monospace | Type "@…" | MentionInput.tsx:14-19, 46-60 |
| **Pick mention (click)** | Inserts title + space, restores caret/focus | mousedown item | MentionInput.tsx:22-35, 51-53 |
| **Dismiss on blur (150ms)** | Lets click fire first | Auto | MentionInput.tsx:43 |
| **Max 8 suggestions** | slice(0,8) | Auto | MentionInput.tsx:21 |
| **Dropdown max-height scroll** | >160px scrolls | Auto | MentionInput.tsx:47 |
| **Vertically resizable** | resize: vertical | Drag handle | MentionInput.tsx:44 |

> **NOTE [tech debt]:** RenderPanel inlines a duplicate MentionArea (RenderPanel.tsx:446-478) separate from MentionInput.tsx — bugs must be fixed twice (audit Low).

### 3.5 Scene / Characters / Production (ClipFields)
| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **Scene: title** | YAML `title`; field-linkable | Type | ClipFields.tsx:158 |
| **Scene: reference_handling** | Poses to AVOID; YAML `reference_handling` | Type | ClipFields.tsx:159 |
| **Scene: style** | YAML `style` | Type | ClipFields.tsx:160 |
| **Scene: visual_feel** | YAML `visual_feel` | Type | ClipFields.tsx:161 |
| **Characters count "(N)"** | Live count in header | Auto | ClipFields.tsx:164 |
| **Add character "+ add"** | Appends blank character card | Click | ClipFields.tsx:164 |
| **Remove character "✕"** | Removes card | Click | ClipFields.tsx:170 |
| **Character: name** | snake_case YAML key | Type | ClipFields.tsx:168 |
| **Character: reference label** | @ref label (e.g. @maya) | Type | ClipFields.tsx:169 |
| **Character: base / features / physics** | YAML under character_modeling | Type | ClipFields.tsx:172-174 |
| **Production: avoid (required)** | YAML `avoid`; lint fires when empty + beats exist | Type | ClipFields.tsx:180 |
| **Production: audio_design** | YAML `audio_design` | Type | ClipFields.tsx:181 |
| **Production: lighting (overall)** | YAML `lighting` | Type | ClipFields.tsx:182 |
| **Production: critical_constraint** | YAML `critical_constraint` | Type | ClipFields.tsx:183 |
| **Production: subtext** | YAML `subtext` | Type | ClipFields.tsx:184 |
| **Field-linking: link a field** | Link icon → dropdown of clips; prepends source value at render | Click Link2; pick clip | ClipFields.tsx:23-91 |
| **Field-linking: linked chip + preview** | Chip "@clip — value"; tooltip "double-click → open" | Hover; double-click | ClipFields.tsx:28-58 |
| **Field-linking: unlink (✕)** | Clears link | Click ✕ | ClipFields.tsx:56-58 |
| **Field-linking: "no other clips"** | Empty-state | Auto | ClipFields.tsx:69-71 |
| **Field-linking: picker item hover preview** | Native tooltip of clip's same-field value | Hover | ClipFields.tsx:80 |
| **Linked-field placeholder change** | "add text after the linked field…" | Auto | ClipFields.tsx:107, 116 |
| **Area textareas vertically resizable** | resize: vertical on all Area fields | Drag handle | ClipFields.tsx:117 |
| **Section divider / top border** | Visual separation | Auto | ClipFields.tsx:156 |
| **Amber section headers** | scene/characters/production_notes amber small-caps | Auto | ClipFields.tsx:123-126 |
| **Character card styling** | Border, radius 5, panel bg | Auto | ClipFields.tsx:8, 165 |

### 3.6 YAML assembly & lint engine (emitYaml.ts)
| Feature | What it does | File:line |
|---|---|---|
| **Freeform + structured merge** | buildCombined joins freeform + YAML with `\n\n`; empties omitted | emitYaml.ts:83-85 |
| **title + duration output** | Emits `title`, `duration "Ns"`/`"auto"` when title/style present | emitYaml.ts:28-34 |
| **character_modeling block** | Named characters → snake_case keys; non-empty subfields | emitYaml.ts:36-45 |
| **cinematic_storyboard block** | Beats with content → `HH.MM_HH.MM_snake_name` keys | emitYaml.ts:47-64 |
| **production_notes block** | Non-empty production fields | emitYaml.ts:66-79 |
| **JSON.stringify quoting** | All values double-quoted/escaped → valid YAML | emitYaml.ts:4-6 |
| **Character snake-casing** | lowercase, non-alnum→_, default "x" | emitYaml.ts:7-9 |
| **Beat timecode formatting** | Zero-padded hundredths | emitYaml.ts:12-15 |
| **Beat ref image resolution** | Per-beat @mention priority → clip's first @mention fallback | emitYaml.ts:136-143 |
| **BEAT_COLORS palette** | 8-color cycle (5 vars + --ok + 2 fixed hues) | emitYaml.ts:121 |
| **MIN_BEAT 0.25s** | Enforced min beat size | emitYaml.ts:123, Beats.tsx:116 |
| **beatRanges cumulative lookup** | {start,end} per beat | emitYaml.ts:125-133 |
| **newBeat / newCharacter / EMPTY_SCENE / EMPTY_PRODUCTION defaults** | Factory defaults | emitYaml.ts:111-118, 145-151 |
| **fitArr proportional rescale** | Sum-to-duration utility | Beats.tsx:10-20 |
| **beatAtTime** | Active-beat index at time t (live highlight) | beatUtils.ts:7-12 |
| **beatImgUrls** | Pre-computes all beat ref thumbnails | beatUtils.ts:21-23 |

> **NOTE [PARTIAL/bug]:** `beatRefFile` matches `@maya` (with @) against titles stored without @ → beat ref thumbnails may render blank (audit Medium, emitYaml.ts:136-143).

**Lint warnings (lintFields, advisory):** camera >20 words (89-92); beats sum ≠ duration when auto-time off (95-98); production.avoid empty with beats (99-101); attached image not @referenced (102-104); filler words epic/amazing/beautiful/stunning/cool (105-108).

**Validation errors (validateForm, hard-block, validation.ts):** empty prompt (25); unsupported mode (27-29); i2v missing start frame (30); i2v end-frame-not-supported warning (31); ref2v no refs (33); ref2v too many refs (34); invalid duration (37-38); invalid resolution (39-40); invalid aspect (41-42). Returns `{errors[], warnings[]}` — errors block, warnings allow (21-44).

---

## 4. Generation / Render (engines & pipeline)

| Feature | What it does | Trigger | File:line | Status |
|---|---|---|---|---|
| **Video render run** | Uploads refs, builds payload, polls fal, downloads mp4 to renders/, creates/updates Clip + Take w/ frozen snapshot, returns bytes + delta | `render:run` IPC | index.ts:467-531, fal.ts | SHIPPED |
| **Render progress streaming** | "uploading…/submitting…/rendering…/downloading…/done" via `render:progress` | Auto | fal.ts:97-138, RenderPanel.tsx:228-231 | SHIPPED |
| **Render tab badge** | "⏳ Clip Editor" while rendering | Auto | RenderPanel.tsx:581, App.tsx:411-413 | SHIPPED |
| **Render success toast + bin status** | "render done ✓ — saved to bin"; plays bytes inline | Auto | RenderPanel.tsx:615-617 | SHIPPED |
| **Render error toast + status** | Red error + "render failed: …" toast | Auto | RenderPanel.tsx:619-621 | SHIPPED |
| **Slot adoption of fresh take** | New take adopted into the edited slot only | Auto | RenderPanel.tsx:607-610 | SHIPPED |
| **New clip auto-select** | Selects newly created clip after render | Auto | RenderPanel.tsx:611-613 | SHIPPED |
| **Credit refresh after render** | refreshCredit() | Auto | RenderPanel.tsx:617 | SHIPPED |
| **Engine: Seedance 2 (ref2v)** | Up to 9 ref images; `bytedance/seedance-2.0/reference-to-video` | Engine dropdown | models.ts:29-46, fal.ts:62-78 | SHIPPED |
| **Engine: Seedance 2 (i2v)** | Start + optional end image; `…/image-to-video` | Engine + mode | models.ts:29-46, fal.ts:72-77 | SHIPPED |
| **Engine: Sora 2 (i2v)** | Start image only; no end/seed/refs; audio always on; `fal-ai/sora-2/image-to-video` | Engine dropdown | models.ts:47-65, fal.ts:53-60 | SHIPPED |
| **Engine capability descriptor** | Per-model field gating (modes/endFrame/maxRefs/durations/res/aspect/audioToggle/seed/endpoints/price/notes) | Auto | models.ts:11-66 | SHIPPED |
| **Cost estimate (price/sec)** | pricePerSec map drives editor cost display | Auto | models.ts:43-45, 62 | SHIPPED |
| **fal key cleared after each request** | Credentials reset to "" in finally | Auto | fal.ts:44-46 | SHIPPED |
| **fal queue status reporting** | IN_QUEUE/IN_PROGRESS forwarded | Auto | fal.ts:99-106 | SHIPPED |
| **fal error body surfacing** | 422 detail + sent field names in error | Auto | fal.ts:108-119 | SHIPPED |
| **Prompt link (cross-clip freeform)** | promptLink {clipId,pos} splices another clip's freeform | clip:setPromptData | types.ts:117-119 | SHIPPED |
| **Field links (per-field inheritance)** | fieldLinks map prepends source clip's field | clip:setPromptData | types.ts:120-122 | SHIPPED |
| **Sora 2 character references** | Declares characterRefs:2 via Characters API | — | models.ts:53 | **COMING SOON** (not wired into editor) |

---

## 5. Takes & Versioning

| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **Takes & versions section (collapsible)** | C-chip + T-chips + keeper/slot labels + dynamic-still buttons; only when ≥1 take | Click header | RenderPanel.tsx:1126-1195 |
| **C (live recipe) chip** | Slot mode: use live recipe (clears trim); bin mode: preview recipe; shows ★ when active | Click C | RenderPanel.tsx:1138-1149 |
| **T-chip click (keeper / slot take)** | Bin: set keeper; slot: assign to THIS slot only; loads take into preview | Click Tn | RenderPanel.tsx:1150-1171 |
| **T-chip drag (MIME_TAKE)** | Sets {clipId,takeId}; droppable on fields or Bin | Drag Tn | RenderPanel.tsx:1154-1155 |
| **T-chip drop highlight on field** | Dashed amber outline on supported drop target | Auto | RenderPanel.tsx:687-688, 681-685 |
| **Other-clip takes rejected** | Drop rejected if clipId ≠ selected | Auto | RenderPanel.tsx:672-676 |
| **Snapshot-less take reported** | "take N predates snapshots — nothing to restore" | Auto | RenderPanel.tsx:697-699 |
| **Restore status message** | "↩ {field} restored from take {N}" | Auto | RenderPanel.tsx:749 |
| **Multi-slot warning banner** | "take applies to THIS slot only…" when editing slot + >1 take | Auto | RenderPanel.tsx:1132-1135 |
| **"takes — sets this slot (#N)" label** | Dynamic label by slot/bin mode | Auto | RenderPanel.tsx:1128-1130 |
| **Take resolution priority** | item.takeId → keeperTakeId → last take → recipe | Auto | timelineUtils.ts:25-30 |
| **Shorter-take auto-clamp** | Effective duration clamps to take length | Auto | timelineUtils.ts:75-76 |
| **Frozen take beats (no live bleed)** | Takes show only snapshot beats | Auto | timelineUtils.ts:42 |
| **Take freeze snapshot** | addTake deep-copies promptData into take.snapshot | Auto | project.ts:286-288 |
| **Set keeper take** | Which take is shown/exported | clip:setKeeper | index.ts:353, project.ts:490-497 |
| **Clone clip from take** | New clip from take's snapshot; reuses file; "·copy" | clip:fromTake | index.ts:351, project.ts:466-487 |
| **Clone take → new clip (drop on Bin)** | Drag T-chip to Bin clones take to top-level clip | Drop on Bin | Bin.tsx:97-108 |
| **Take duration backfill** | Persists real measured duration on Take | take:setDuration | index.ts:356-358, project.ts:297-305 |

---

## 6. Library (images + music)

| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **Drag-over highlight** | 2px dashed amber on OS-file/EDITNODE drag | Auto | Library.tsx:157-161 |
| **Drop OS image files** | Imports jpeg/png/webp/gif/bmp/avif | Drop files | Library.tsx:186-193 |
| **Drop OS audio files** | Imports mp3/wav/m4a/aac/ogg/flac | Drop files | Library.tsx:194 |
| **Drop Image Editor node (MIME_EDITNODE)** | Saves edited image as new Library asset (= ★) | Drop EDITNODE | Library.tsx:165-184 |
| **EDITNODE drop toast** | Success toast with title | Auto | Library.tsx:178-179 |
| **Import image button** | Native file picker for images | Click | Library.tsx:198-200 |
| **New image (generate AI)** | Opens Image Editor for from-scratch Nano Banana gen | Click | Library.tsx:202-205 |
| **Import music button** | Native picker mp3/wav/m4a | Click | Library.tsx:207-209 |
| **No-project hint** | "Open or create a project first." | Auto | Library.tsx:211 |
| **Empty-images hint** | How to add images | Auto | Library.tsx:213-215 |
| **Image tile → drag to clip slot (MIME_IMAGE)** | Drop onto ref/start/end slots | Drag | Library.tsx:139-140 |
| **Image tile → folder-move (MIME_MOVE)** | Carries {kind:'lib',id} | Drag | Library.tsx:141 |
| **Image tile double-click → Image Editor** | Opens editor with image | Double-click | Library.tsx:143 |
| **Dynamic-still tooltip** | "⟳ live frame still — re-extracts…" | Hover | Library.tsx:144-148 |
| **Regular image tooltip** | "double-click = edit with AI…" | Hover | Library.tsx:148 |
| **Dynamic-still "⟳ " label prefix** | Prepended in thumbnail label | Auto | Library.tsx:150 |
| **rev cache-bust for dynamic stills** | Thumbnail rev = dynamic.rev | Auto | Library.tsx:150 |
| **Right-click: edit with AI** | Opens Image Editor | Right-click → item | Library.tsx:116 |
| **Right-click: rename @title** | Prompt rename; alert on collision | Right-click → item | Library.tsx:118-123 |
| **Right-click: duplicate** | Duplicates image | Right-click → item | Library.tsx:125 |
| **Right-click: delete (clip-use guard)** | Confirm noting clip refs; file stays on disk | Right-click → item | Library.tsx:127-133 |
| **Music section** | "♪ music" with one AudioRow per track | Auto when audio>0 | Library.tsx:216-225 |
| **AudioRow → drag to audio lane (MIME_AUDIO)** | Assigns timeline music | Drag | Library.tsx:42-45 |
| **AudioRow duration display** | SMPTE mm:ss:ff; "…" while loading | Auto | Library.tsx:57-59 |
| **AudioRow auto-detect duration** | Hidden Audio element persists real duration once | Auto | Library.tsx:26-38 |
| **AudioRow right-click rename** | Prompt rename | Right-click | Library.tsx:65-70 |
| **AudioRow right-click delete (timeline-use guard)** | Confirm; file stays on disk | Right-click | Library.tsx:74-81 |
| **AudioRow tooltip** | "drag onto the timeline's audio lane…" | Hover | Library.tsx:51 |
| **AudioRow grab cursor** | cursor:grab | Auto | Library.tsx:51 |

---

## 7. Bin (clips + timelines)

| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **Panel drag-over highlight (MIME_TAKE)** | 2px dashed amber on take drag | Auto | Bin.tsx:90-95 |
| **Drag-leave highlight removal** | Removes outline | Auto | Bin.tsx:96 |
| **Drop take → clone as new clip** | cloneTakeToClip into new top-level clip | Drop MIME_TAKE | Bin.tsx:97-108 |
| **New clip button** | Creates empty storyboard clip | Click "+ New clip" | Bin.tsx:114-116 |
| **Import from project** | Folder picker → cross-project import modal | Click | Bin.tsx:118-133 |
| **Import auto-select all** | All source clips pre-selected | Auto | Bin.tsx:127 |
| **No-project hint** | "No project open…" | Auto | Bin.tsx:135 |
| **Timelines section** | Lists timelines as icon tiles (name/aspect/clip count, ▤ badge) | Auto | Bin.tsx:137-180 |
| **Timeline tile active border** | Amber border on active timeline | Auto | Bin.tsx:164-165 |
| **New timeline button** | Creates empty timeline | Click "+ timeline" | Bin.tsx:141-143 |
| **Click timeline tile → activate** | Switches Timeline panel to it | Click | Bin.tsx:151 |
| **Double-click timeline tile → editor** | Activates + opens Timeline Editor | Double-click | Bin.tsx:152-155 |
| **Right-click timeline tile** | Context menu: rename/edit settings/duplicate/delete | Right-click | Bin.tsx:156-159 |
| **Timeline tile tooltip** | "click=show · double-click=editor · right-click=actions" | Hover | Bin.tsx:160 |
| **Timeline ctx: rename** | Prompt rename | Menu item | Bin.tsx:229-232 |
| **Timeline ctx: edit settings** | Opens Timeline Editor | Menu item | Bin.tsx:233-236 |
| **Timeline ctx: duplicate** | Duplicates timeline | Menu item | Bin.tsx:237 |
| **Timeline ctx: delete (guard)** | Confirm if has clips (undoable) | Menu item | Bin.tsx:238-241 |
| **Timeline menu close on backdrop** | Closes on outside click | Click overlay | Bin.tsx:207 |
| **Clip tile dashed outline (no takes)** | Storyboard indicator | Auto | Bin.tsx:73 |
| **Clip tile → drag to timeline (MIME_CLIP)** | Adds to timeline | Drag | Bin.tsx:64-67 |
| **Clip tile → folder-move (MIME_MOVE)** | Carries {kind:'bin',id} | Drag | Bin.tsx:65-66 |
| **Clip tile tooltip** | "drag onto timeline · double-click=editor…" | Hover | Bin.tsx:68 |
| **Clip tile double-click → Clip Editor** | Selects + opens editor | Double-click | Bin.tsx:69-72 |
| **Clip tile click → select** | Selects clip | Click | Bin.tsx:81 |
| **Clip tile active border** | Amber when selected | Auto | Bin.tsx:81 |
| **Clip tile take-count badge** | "name · Nt" or "name · ▦" | Auto | Bin.tsx:77 |
| **Clip tile thumbnail** | First ref image | Auto | Bin.tsx:35-38 |
| **Clip right-click: rename** | Prompt rename | Menu item | Bin.tsx:44-48 |
| **Clip right-click: duplicate** | Duplicates clip | Menu item | Bin.tsx:50 |
| **Clip right-click: delete (timeline-use guard)** | Confirm w/ instance count (undoable) | Menu item | Bin.tsx:52-58 |
| **Details footer** | Selected clip name/model/duration/take state/seed/ref titles | Auto | Bin.tsx:186-203 |
| **Footer model line (modelFor)** | Human-readable model name | Auto | Bin.tsx:198 |
| **Footer seed (clipSeed)** | keeper → last → recipe seed | Auto | Bin.tsx:199, clipMeta.ts:13-16 |
| **Footer ref titles** | Comma-separated @titles | Auto | Bin.tsx:189-201 |
| **No-clips hint** | "No clips yet…" | Auto | Bin.tsx:182 |

### 7.1 Cross-project import modal
| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **Clip grid** | Source clips as 132px cards (thumb/name/takes/duration/beats/engine) | Auto | Bin.tsx:267-299 |
| **Toggle clip selection** | Amber outline = selected | Click card | Bin.tsx:274-281 |
| **Select All / None** | Select/deselect all | Click "all"/"none" | Bin.tsx:263-264 |
| **Close (✕ / backdrop)** | Closes if not busy | Click | Bin.tsx:252, 265 |
| **Selection count** | "N of M selected" | Auto | Bin.tsx:302 |
| **Import button (disabled states)** | Dimmed when none selected or busy | Auto | Bin.tsx:304-306 |
| **Execute import** | importClips → applyDelta; "importing…" during | Click | Bin.tsx:307-319 |
| **Storyboard/rendered badge** | ▶ or ▦ | Auto | Bin.tsx:289 |
| **Beat count** | "· N beats" | Auto | Bin.tsx:294 |
| **No-clips hint** | "That project has no clips." | Auto | Bin.tsx:268 |
| **Header text** | "renders + refs are COPIED in; source untouched" | Auto | Bin.tsx:261 |

---

## 8. Folders (generic Foldered tree)

| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **Nested folder tree** | Unlimited nesting; indented w/ left border | Auto | Foldered.tsx:129-157 |
| **Click row → collapse/expand** | Toggle ▾/▸ | Click row | Foldered.tsx:134 |
| **Item count badge** | "(N)" direct items | Auto | Foldered.tsx:148 |
| **Folder drag-over highlight** | Amber tint on MIME_MOVE over header | Auto | Foldered.tsx:136-141 |
| **Drop item → into folder** | moveItem(kind,id,folderId) | Drop on header | Foldered.tsx:105-117 |
| **Drop item → root** | moveItem(…,null) | Drop on background | Foldered.tsx:163-170 |
| **Root drop-target outline** | Dashed amber-dim on root drag | Auto | Foldered.tsx:171 |
| **Right-click: rename folder** | Prompt rename | Menu | Foldered.tsx:85-90 |
| **Right-click: new subfolder** | Child folder | Menu | Foldered.tsx:91-92 |
| **Right-click: open in new tab** | Scoped folder panel | Menu | Foldered.tsx:93 |
| **Right-click: delete (reparent)** | Confirm; items move to parent | Menu | Foldered.tsx:94-101 |
| **Right-click background: new folder** | Root (or scoped) folder | Right-click bg | Foldered.tsx:162 |
| **Item ctx: "↪ move to root"** | Moves out of all folders | Menu | Foldered.tsx:80-82 |
| **Item ctx: "↪ {folder}" entries** | One per folder | Menu | Foldered.tsx:83 |
| **Menu separator before move entries** | 1px line | Auto | Foldered.tsx:80 |
| **Portal rendering** | createPortal to body (no clipping) | Auto | Foldered.tsx:40-45 |
| **Menu max-height scroll** | 320px overflow:auto | Auto | Foldered.tsx:23 |
| **Close on mousedown outside** | Closes menu | mousedown overlay | Foldered.tsx:14-16 |
| **Close after item click** | onClick then close | Click item | Foldered.tsx:31-34 |
| **Scoped root (folder tab)** | Shows only sub-tree under rootFolder | Auto | Foldered.tsx:54-55, 67-68 |
| **Items grid layout** | flex-wrap 6px gap | Auto | Foldered.tsx:119-127 |
| **Drag-leave clears only correct target** | Anti-flicker functional updater | Auto | Foldered.tsx:142 |
| **Same-kind drop guard** | Mismatched kind ignored | Auto | Foldered.tsx:113 |

---

## 9. Image Editor

| Feature | What it does | Trigger | File:line | Status |
|---|---|---|---|---|
| **Entry point** | Double-click Library image opens editor; hint until opened | Double-click | ImageEditor.tsx:217-223 | SHIPPED |
| **From-scratch session** | editorImageId='' → text-to-image; placeholder canvas | "new image" button | ImageEditor.tsx:91, 158, 234 | SHIPPED |
| **Canvas image viewer (view-only)** | Contain-fit img of selected node/root; no draw/mask tools | Auto | ImageEditor.tsx:229-238 | **PARTIAL** (Phase 2 masking placeholder) |
| **Canvas overlay label** | Node prompt / "original · primary" / "new image" badge | Auto | ImageEditor.tsx:235-237 | SHIPPED |
| **Reference image strip (drop target)** | Drag Library images as refs; amber dashed on hover | Drop MIME_IMAGE | ImageEditor.tsx:243-269 | SHIPPED |
| **Reference thumbnails** | 52×34 thumbs + title + clear (×) | Auto | ImageEditor.tsx:261-267 | SHIPPED |
| **Max-refs warning** | "⚠ identity fidelity drops…" at refWarnAt (3) | Auto | ImageEditor.tsx:160, 268 | SHIPPED |
| **Prompt textarea** | Resizable; placeholder differs edit vs scratch | Type | ImageEditor.tsx:271-279 | SHIPPED |
| **@mention autocomplete** | Up to 8 matches; insert + add ref | Type "@…" | ImageEditor.tsx:166-190, 280-295 | SHIPPED |
| **@mention dismiss on blur (150ms)** | Closes dropdown | Auto | ImageEditor.tsx:275 | SHIPPED |
| **Aspect ratio selector** | auto + 10 ratios (edit) / 10 (scratch, no auto) | Select | ImageEditor.tsx:298-303, imageModels.ts:26-27 | SHIPPED |
| **Variants selector (1–4)** | Images per run; default 1 | Select | ImageEditor.tsx:304-309, imageModels.ts:31 | SHIPPED |
| **Seed input** | Optional integer; non-numeric = random | Type | ImageEditor.tsx:311, 197 | SHIPPED |
| **Generate + live cost** | "Generate · ~$X.XXX" (variants × $0.039); dimmed when busy/empty | Click | ImageEditor.tsx:312-326, imageModels.ts:32 | SHIPPED |
| **Generate from node vs original** | Tooltip + parentNodeId differs by selection | Auto | ImageEditor.tsx:316-317, 198-199 | SHIPPED |
| **Status/progress line** | starting…/uploading…/generating…/downloading…/done; red on error | Auto | ImageEditor.tsx:327-329, 94 | SHIPPED |
| **Auto-jump to first new result** | Selects first new node | Auto | ImageEditor.tsx:209 | SHIPPED |
| **Credit refresh after gen** | refreshCredit() | Auto | ImageEditor.tsx:211 | SHIPPED |
| **@title editor** | Inline rename; Enter/blur commits; snaps back on collision | Type | ImageEditor.tsx:338-345, 100-108 | SHIPPED |
| **Auto-populate title on open** | Fills current title | Auto | ImageEditor.tsx:96-99 | SHIPPED |
| **Duplicate image** | Copies asset (not tree) | Click Copy icon | ImageEditor.tsx:348-350 | SHIPPED |
| **Delete image + tree (confirm)** | Reports clip refs + tree size; tagged Library images survive | Click Trash | ImageEditor.tsx:351-353, 135-141 | SHIPPED |
| **Edited-from lineage** | "edited from @title" / "deleted image" | Auto | ImageEditor.tsx:355-359 | SHIPPED |
| **Results tree section label** | "results tree — click = view + set as base" | Auto | ImageEditor.tsx:362 | SHIPPED |
| **Root (original) row** | First row; amber ring when primary; click → original | Click | ImageEditor.tsx:364-396 | SHIPPED |
| **Make-primary on root** | Reverts primary to original | Click CircleDot | ImageEditor.tsx:382-394 | SHIPPED |
| **Tree empty state** | "no results yet — Generate to grow the tree" | Auto | ImageEditor.tsx:397 | SHIPPED |
| **Node rows + depth indent** | Indent depth×12 (cap 6); click selects + views | Click | ImageEditor.tsx:398-406, 25-46 | SHIPPED |
| **Node hover tooltip** | Full prompt + primary + drag-to-Library hint | Hover | ImageEditor.tsx:405-406 | SHIPPED |
| **Branch collapse/expand** | ▸/▾; "+N folded" count | Click triangle | ImageEditor.tsx:408-417, 78-84 | SHIPPED |
| **Node thumb → drag to Library (MIME_EDITNODE)** | Saves result as new Library image | Drag | ImageEditor.tsx:420-429 | SHIPPED |
| **Primary node amber ring** | 2px ring on primary thumb | Auto | ImageEditor.tsx:427, 373-374 | SHIPPED |
| **Primary indicator text** | "◉ primary · " in row | Auto | ImageEditor.tsx:433 | SHIPPED |
| **Library star indicator** | "★ " when tagged | Auto | ImageEditor.tsx:434 | SHIPPED |
| **Ref mini-thumbs on node** | Up to 4 16×16 ref thumbs | Auto | ImageEditor.tsx:439-444 | SHIPPED |
| **Node action buttons (on select)** | Make Primary / Tag / Delete Branch inline | Auto when selected | ImageEditor.tsx:446-484 | SHIPPED |
| **Make Primary (node)** | Library + all clips switch to this file | Click CircleDot | ImageEditor.tsx:449-458 | SHIPPED |
| **Tag to Library (★)** | Saves node as new @image | Click Star | ImageEditor.tsx:461-469 | SHIPPED |
| **Delete Branch** | Deletes node + descendants; tagged copies survive | Click Trash | ImageEditor.tsx:471-481, 127-134 | SHIPPED |
| **Block delete if branch has primary** | Alert blocks deletion | Auto guard | ImageEditor.tsx:127-134 | SHIPPED |
| **Details footer** | Selected node/root prompt + seed/refs/tag/primary | Auto | ImageEditor.tsx:491-528 | SHIPPED |
| **"→ send to prompt"** | Copies node prompt into textarea (refs unaffected) | Click | ImageEditor.tsx:514-524 | SHIPPED |
| **Auto-reset on target change** | Clears prompt/refs/seed/status | Auto | ImageEditor.tsx:144-151 | SHIPPED |
| **Auto-open on primary** | Lands on primary node | Auto | ImageEditor.tsx:145 | SHIPPED |
| **Auto-fallback when node deleted** | Falls back to root | Auto | ImageEditor.tsx:153-156 | SHIPPED |
| **DFS tree flatten + collapse** | treeRows() w/ hiddenCount | Auto | ImageEditor.tsx:25-46, 77 | SHIPPED |
| **Clip-use/tree-size in delete confirm** | Reports downstream impact | Auto | ImageEditor.tsx:109-110, 139 | SHIPPED |
| **Right column scroll + pinned footer** | Tree scrolls, footer fixed; width 230px | Auto | ImageEditor.tsx:334-336, 490 | SHIPPED |
| **Add ref guards** | Reject root-as-ref, duplicates, >maxImages−1 | Auto | ImageEditor.tsx:163-165 | SHIPPED |

**Image generation backend (falImage.ts):** Nano Banana / Gemini 2.5 Flash Image, edit vs t2i endpoint (39-111); key cleared after call (43-45); upload base+refs to fal (33-37, 63-66); refs clamped maxImages−1 (65); variants clamped to model max (55); 'auto'→'1:1' for t2i (59); queue status progress (75-78); detailed error w/ field names (81-89); download to images/edits/ (97-107); empty-file guard (103); seed returned/stored (109). Model descriptor: 11 aspects edit / 10 generate (imageModels.ts:26-27); max 6 images (24); price $0.039/image (32).

---

## 10. Frame-grab & Continue-clip (dynamic stills)

| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **Frame grab (Program Monitor)** | Saves current program frame as PNG to Library | Click "frame" (camera) | Monitor.tsx:359-361 |
| **Frame grab mode: as-shown vs raw** | Crop to timeline aspect, or full uncropped frame | Toggle button | Monitor.tsx:362-364 |
| **Frame grab (Source Monitor)** | Saves current preview frame (full PNG) to Library | Click Camera | SourceMonitor.tsx:447-451 |
| **Frame grab auto-note** | "frame · clip · SMPTE" / "· take N · SMPTE" | Auto | Monitor.tsx:222, SourceMonitor.tsx:322-323 |
| **Frame grab status message** | "✓ title → Library" / "no frame"; clears 2500ms | Auto | Monitor.tsx:219-226, 365; SourceMonitor.tsx:325-327, 452 |
| **framePngBytes utility** | Captures HTMLVideoElement frame as PNG; tainted-canvas → null | Programmatic | frameGrab.ts:5-37 |
| **Cover-crop to aspect** | Center-crop to cropAspect | Auto | frameGrab.ts:13-23 |
| **Full native frame (no crop)** | When cropAspect omitted/'auto' | Auto | frameGrab.ts:13 |
| **Dynamic still — first frame** | "⊢ first frame" → Library still re-extracting on trim/slice/take change | Click (slot mode) | RenderPanel.tsx:1174-1183, index.ts:273-275, project.ts:645-683 |
| **Dynamic still — last frame** | "last frame ⊣" → ideal next-clip start frame; follows right half on slice | Click (slot mode) | RenderPanel.tsx:1184-1190, project.ts:645-683 |
| **Dynamic still toast** | "title → Library — live frame" / "couldn't grab that frame" | Auto | RenderPanel.tsx:658-663 |
| **Dynamic still remap on slice** | Rebinds last-frame still to right-half item | image:remapDynamic | index.ts:277, project.ts:687-694 |
| **Dynamic still auto-reconcile** | 400ms debounce re-extracts changed stills; freezes removed ones; excluded from undo; pushes delta | Auto | project.ts:696-750 |
| **Frame extraction (ffmpeg)** | Single PNG at ms-precise timestamp | Auto | export.ts:27-33 |
| **Save frame to Library** | Writes PNG bytes + note as new @imageN | library:saveFrame | index.ts:267-270, project.ts:357-371 |

---

## 11. Playback — Program Monitor + Source Monitor

### 11.1 Program (Timeline) Monitor
| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **Monitor panel container** | Plays assembled timeline | Auto | Monitor.tsx:15 |
| **Aspect-ratio stage (letterbox/pillarbox)** | Black canvas fitted to timeline aspect; cover-fill crop | Auto | Monitor.tsx:29-42, 138-142 |
| **ResizeObserver auto-fit** | Recomputes stage geometry on resize | Auto | Monitor.tsx:31-42 |
| **Program video (media://)** | Streams active take; no IPC blob | Auto | Monitor.tsx:58, 313-340 |
| **Storyboard still fallback** | Beat ref image / keyframe for recipe/unrendered clips | Auto | Monitor.tsx:60-68, 341-343 |
| **Empty-timeline placeholder** | "press ▶ on the timeline" / "drag clips from the Bin…" | Auto | Monitor.tsx:344-347 |
| **Play/pause sync** | Reacts to tlPlaying; ignores AbortError | Auto | Monitor.tsx:164-169 |
| **Seek on clip/playhead change** | Applies inSec+seekOffset; defers to loadedmetadata | Auto via seekTick | Monitor.tsx:145-162 |
| **Trim-aware playback** | Fires tlNext at outSec−50ms; progress over trimmed span | Auto | Monitor.tsx:327-338 |
| **Auto-advance (tlNext)** | On out-point or onEnded | Auto | Monitor.tsx:321-322, 337 |
| **Take real-duration backfill** | reportTakeDuration on loadedmetadata | Auto | Monitor.tsx:323-326 |
| **Storyboard hold-clock** | rAF simulates playback for take-less clips; resumes from scrub | Auto | Monitor.tsx:171-195 |
| **Storyboard scrub beat sync** | Updates active beat from tlProgress while paused | Auto | Monitor.tsx:199-208 |
| **Active beat reset on clip change** | curBeat=0 on new clip | Auto | Monitor.tsx:211 |
| **Details overlay toggle** | "details ▾/▴" show/hide recipe overlay | Click | Monitor.tsx:233-241 |
| **Beat/recipe details overlay** | Active beat metadata or clip style/feel/prompt + model + seed | Auto/toggle | Monitor.tsx:243-307 |
| **Beat ref image behind overlay** | Blurred 50%-opacity background | Auto | Monitor.tsx:248-267 |
| **Per-beat active tracking** | beatAtTime() on timeupdate | Auto | Monitor.tsx:333-336 |
| **SMPTE timecode readout** | HH:MM:SS:FF @ 24fps current/total | Auto | Monitor.tsx:351-355 |
| **Music lane (hidden audio)** | rAF-synced; in/out trim + startSec respected | Auto | Monitor.tsx:75-135, 232 |
| **Music drift correction** | Hard-correct seek on >0.35s drift | Auto | Monitor.tsx:119-124 |
| **Music mute sync** | Reflects musicMuted instantly | Auto | Monitor.tsx:81-84 |
| **Video layer mute (vMuted)** | Silences video on layer/instance mute; focusAudio on unmute | Auto | Monitor.tsx:86-91 |
| **onPlay audio focus claim** | Becomes sole audible player | Auto | Monitor.tsx:317-320 |
| **C-mode trim bypass** | useRecipe plays 0→full recipe duration | Auto | Monitor.tsx:55-57 |

### 11.2 Source Monitor (Clip Preview)
| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **Source Monitor panel** | Previews double-clicked slot or Bin-selected clip | Auto | SourceMonitor.tsx:16 |
| **Empty placeholder** | "double-click a timeline clip — or pick one in the Bin…" | Auto | SourceMonitor.tsx:174-180 |
| **Dual preview target** | Slot (with take/trim) vs Bin clip; status "#3 · slot" / "· bin" | Auto | SourceMonitor.tsx:38-44, 506-510 |
| **Take resolution priority** | slot takeId → keeperTakeId → latest | Auto | SourceMonitor.tsx:49-53 |
| **Recipe / C-mode preview** | Live storyboard beats when useRecipe/previewRecipe | Auto | SourceMonitor.tsx:47-48 |
| **Clip preview video (take)** | media:// contain-fit; click toggles play | Click video | SourceMonitor.tsx:396-429 |
| **Storyboard still fallback** | Beat ref/keyframe; click toggles hold-clock | Click image | SourceMonitor.tsx:430-432 |
| **No-take placeholder** | "no rendered take for this clip yet" | Auto | SourceMonitor.tsx:433-434 |
| **Play/pause button** | Toggle video/hold-clock; restarts if at end | Click | SourceMonitor.tsx:438-440 |
| **Play in→out window** | "↗ in→out" plays only trimmed span then stops | Click | SourceMonitor.tsx:441-443 |
| **Mute/unmute** | Toggle audio; claims focus on unmute | Click | SourceMonitor.tsx:444-446 |
| **Defaults to muted per clip** | Resets muted on new url | Auto | SourceMonitor.tsx:126-129 |
| **Details overlay toggle** | Info "details" show/hide | Click | SourceMonitor.tsx:453-455 |
| **Beat/recipe details overlay** | Model+seed + beat fields / clip style/feel/freeform | Auto/toggle | SourceMonitor.tsx:344-394 |
| **Live SMPTE timecode** | current/total via ref (no per-frame state) | Auto | SourceMonitor.tsx:34, 83, 458-461 |
| **Scrub bar — click to seek** | Jump to clicked time | Click | SourceMonitor.tsx:268-286, 462 |
| **Scrub bar — drag to scrub** | Continuous real-time scrub | Drag | SourceMonitor.tsx:279-284 |
| **Per-beat colored bands** | Proportional bands; ref image or BEAT_COLORS; pointer-events off | Auto | SourceMonitor.tsx:463-482 |
| **In/out region highlight** | Amber-tinted trim window | Auto | SourceMonitor.tsx:483-485 |
| **In-point drag handle** | Move in-point; min window 0.25s; tooltip; slot-trim mode only | Drag left | SourceMonitor.tsx:488-489 |
| **Out-point drag handle** | Move out-point; min 0.25s; slot-trim only | Drag right | SourceMonitor.tsx:490 |
| **Slide window (↔ handle)** | Slide whole trim window preserving length | Drag ↔ pill | SourceMonitor.tsx:492-498 |
| **Click inside region to seek** | Plain click seeks (not slide) | Click | SourceMonitor.tsx:255-266 |
| **Cursor feedback during slide** | body cursor 'grabbing' | Auto | SourceMonitor.tsx:242, 250 |
| **Trim committed on mouseup only** | No per-mousemove IPC | Auto | SourceMonitor.tsx:199-203, 220-224 |
| **Source playhead line** | White 2px imperative | Auto | SourceMonitor.tsx:35, 82, 500-501 |
| **In/out timecode labels** | in / clip+take+mode / out | Auto | SourceMonitor.tsx:503-511 |
| **Take/slot number in status** | "take N/total" / "C — live recipe"; "#N" / "· bin" | Auto | SourceMonitor.tsx:506-508 |
| **Beats editor panel** | Editable beats below scrub bar (when beats>0, max 45% height) | Auto | SourceMonitor.tsx:515-535 |
| **Frozen take beats (read-only)** | "❄ frozen…" notice; pointer-events off, 0.75 opacity | Auto | SourceMonitor.tsx:518-522 |
| **Live recipe beats editable** | Edit via Beats; persistBeats draft + debounced save | Edit fields | SourceMonitor.tsx:522-534 |
| **Beat edit debounce (500ms)** | Instant draft + debounced save | Auto | SourceMonitor.tsx:95-110 |
| **Beat draft flushed on clip change** | Writes pending edit for old clip | Auto | SourceMonitor.tsx:159-169 |
| **Beat draft flushed on unmount** | No lost work | Auto | SourceMonitor.tsx:171-172 |
| **Beats save scoped to beats only** | No imageIds race | Auto | SourceMonitor.tsx:92 |
| **Beat playhead on beats bar** | Imperative line | Auto | SourceMonitor.tsx:33, 82, 529 |
| **Storyboard hold-clock (source)** | rAF advances pos for take-less clips | Auto | SourceMonitor.tsx:138-156 |
| **In/out window stop at out** | Pauses at outSec−0.03 | Auto | SourceMonitor.tsx:422-425 |
| **Take real-duration backfill (source)** | reportTakeDuration on metadata | Auto | SourceMonitor.tsx:403-407 |
| **View-duration fallback chain** | vdur → durationSec → declaredDur → 5s | Auto | SourceMonitor.tsx:71-73, 163 |
| **Muted-icon sync via audio bus** | Speaker icon updates when another player steals focus | Auto | SourceMonitor.tsx:130-135 |

### 11.3 Shared playback / audio
| Feature | What it does | File:line |
|---|---|---|
| **Audio bus — single owner** | One `<video>` audible at a time; focusAudio mutes others | audioBus.ts:6-11 |
| **muteAll** | Silences every player, clears ownership | audioBus.ts:13-17 |
| **subAudio** | Players subscribe to ownership changes for icon sync | audioBus.ts:24-29 |
| **Playhead component** | 2px amber bar, isolated per-frame re-render | playback.tsx:7-16 |
| **TimeReadout component** | "HH:MM:SS:FF / HH:MM:SS:FF" isolated subscription | playback.tsx:19-29 |
| **Playhead position math** | pct=(seg.start+tlProgress×seg.dur)/total | playback.tsx:11-12, 22-23 |

> **Inline Clip Editor preview** (RenderPanel.tsx:1197-1273) also covers: 200px take player auto-play/loop, muted by default (233-237), audio bus sync (239-245), pause on overlay open (246-249), play/pause + mute + click-to-toggle buttons (1201-1210), fullscreen overlay w/ native controls (1255-1273), focusAudio on overlay play (1267), muteAll on close (223-226), media:// streaming + object-URL revoke (199-205, 192-197).

### 11.4 Waveform / beat analysis (waveform.ts)
| Feature | What it does | File:line |
|---|---|---|
| **Audio decode (OfflineAudioContext)** | 22050Hz; 50 peaks/sec envelope + onset array | waveform.ts:29-87 |
| **LRU cache (max 20)** | Keeps envelope+beats, discards raw buffer | waveform.ts:15-27 |
| **Inflight dedup** | One fetch+decode per track | waveform.ts:89-104 |
| **Gated by enabled flag** | Skips decode when collapsed | waveform.ts:107-128 |
| **Onset detection** | Energy-flux vs 20-frame avg, 2.2× thresh, 0.22s min gap | waveform.ts:58-85 |

---

## 12. Panels & Workspaces

| Feature | What it does | Trigger | File:line | Status |
|---|---|---|---|---|
| **App header bar** | Logo, project controls, workspace switcher, fal credit, settings, help | Auto | App.tsx:431-583 | SHIPPED |
| **Logo / About** | Opens About modal | Click logo | App.tsx:432 | SHIPPED |
| **Maximize/restore panel** | Maximize focused group; Esc/restore exits | Click "max"/"restore" / Esc | App.tsx:483-497 | SHIPPED |
| **Dockview layout engine** | Dock/tab/resize/split/rearrange panels | Drag tabs/borders | App.tsx:606 | SHIPPED |
| **Default panel layout** | Library TL, Bin below, Timeline Monitor center, Clip Editor right, Clip Monitor tabbed, Timeline below | Auto/reset | App.tsx:34-48 | SHIPPED |
| **Library / Bin / Timeline Monitor / Clip Monitor / Timeline / Timeline Editor / Image Editor / Clip Editor / Folder panels** | Individual dockview panels | Tabs / double-clicks | App.tsx:17-29 | SHIPPED |
| **Folder panel (folderbin)** | Folder as own panel; raises if open | "Open in panel" | App.tsx:26-29, 291-309 | SHIPPED |
| **Clip Monitor title → clip name** | "Clip Monitor — name" | Auto | App.tsx:382-408 | SHIPPED |
| **Timeline Monitor auto-raise on playback** | Front on Space/play; takes over maximize | Auto | App.tsx:419-427 | SHIPPED |
| **Workspace switcher dropdown** | Active name + list; click applies layout | Click chip | App.tsx:514-566 | SHIPPED |
| **Reset to Default** | Built-in layout | Menu | App.tsx:553-555 | SHIPPED |
| **Add / Manage** | Opens Workspaces modal | Menu | App.tsx:556-564 | SHIPPED |
| **Workspaces modal: save current as new** | Captures + activates new layout (Enter saves) | Type + Save | WorkspacesModal.tsx:25-53 | SHIPPED |
| **Workspaces modal: switch ("use")** | Switch when not active | Click "use" | WorkspacesModal.tsx:63-66, 85 | SHIPPED |
| **Workspaces modal: active checkmark** | ✓ on active | Auto | WorkspacesModal.tsx:60, 74 | SHIPPED |
| **Workspaces modal: rename** | Editable name; Default locked; no dupes | Edit + Enter/blur | WorkspacesModal.tsx:75-83 | SHIPPED |
| **Workspaces modal: delete** | Removes; falls to Default if active | Click Trash | WorkspacesModal.tsx:87 | SHIPPED |
| **Default workspace info** | Built-in, locked, "use" to switch | Auto | WorkspacesModal.tsx:59-66 | SHIPPED |
| **Workspaces global persistence** | Per-name layout JSON in settings; survives restart | Auto | App.tsx:201-249 | SHIPPED |
| **Default stays pristine** | Default never persists rearrangements | Auto | App.tsx:201-204 | SHIPPED |
| **Ensure source panel on restore** | Backfills Clip Monitor into old layouts | Auto | App.tsx:51-56 | SHIPPED |
| **About modal: version** | "Video Dancer vX.Y.Z" from main | Auto | AboutModal.tsx:7-9 | SHIPPED |
| **About modal: external links** | FFmpeg/GPL/ffmpeg-static/ffmpeg.org/fal.ai via openExternal | Click | AboutModal.tsx:11-18 | SHIPPED |
| **About modal: open log folder** | Reveals crash-log folder | Click | AboutModal.tsx:39-41 | SHIPPED |
| **About modal: FFmpeg attribution** | License + bundling + source pointer | Auto | AboutModal.tsx:28-35 | SHIPPED |
| **Modal shell: close ✕ / backdrop / Esc** | All modals | Click/Esc | Modal.tsx:18-48 | SHIPPED |
| **Modal shell: scrollable, portal** | 88vh scroll, 94vw; createPortal to body | Auto | Modal.tsx:25-42 | SHIPPED |
| **Text prompt / Confirm / Alert dialogs** | Reusable imperative dialogs (rename/confirm/alert) | Programmatic | prompt.tsx:95-115 | SHIPPED |
| **Panel error boundary** | Crash isolation per panel + name/error/↻ retry | Auto/click retry | PanelErrorBoundary.tsx:1-32 | SHIPPED |
| **Panel bus openers** | Module-level open/raise for folder/timeline-editor/image-editor/clip-editor/timeline-monitor | Auto | panelBus.ts:3-46 | SHIPPED |

> **NOTE:** Foldered collapse state is local-only and resets on panel unmount (audit Medium, Foldered.tsx:63). `panelBus` openers are never cleared → stale closures silently no-op panel-open after HMR/remount (audit High).

---

## 13. Settings

| Feature | What it does | Trigger | File:line | Status |
|---|---|---|---|---|
| **Settings button** | Opens Settings modal | Click | App.tsx:511-513 | SHIPPED |
| **fal API key input** | Video + image gen key (password); local only | Type + Save | SettingsModal.tsx:19-70, types.ts:270 | SHIPPED |
| **fal admin key input** | Billing-scope key for credit balance | Type + Save | SettingsModal.tsx:20-71, types.ts:271 | SHIPPED |
| **Astria API key input** | Stored; "NOT used by Video Dancer" | Type + Save | SettingsModal.tsx:21-76, types.ts:272 | **COMING SOON** |
| **Anthropic API key input** | Stored; "Claude prompt brain — coming later" | Type + Save | SettingsModal.tsx:22-77, types.ts:273 | **COMING SOON** |
| **Save button** | Persists keys; "saved ✓"; refreshes credit | Click | SettingsModal.tsx:34-43, 79-82 | SHIPPED |
| **Keys-stored-locally notice** | Explains userData storage | Auto | SettingsModal.tsx:63-65 | SHIPPED |
| **Key check on close** | Re-reads settings; hides missing-key banner | Auto | App.tsx:109-112 | SHIPPED |
| **FAL credit badge** | "FAL $X.XX"; "…"/"⚠"/"—"; click refreshes | Click / auto | App.tsx:274-583 | SHIPPED |
| **Missing-FAL-key warning banner** | Amber banner + "open Settings" + ✕ dismiss | Auto | App.tsx:585-604 | SHIPPED |
| **fal credit fetch** | Billing API via falAdminKey | fal:credit | index.ts:161-177 | SHIPPED |
| **App version query** | Returns Electron app version | app:version | index.ts:250 | SHIPPED |
| **Open crash log folder** | Reveals userData/logs/ | log:open | index.ts:251 | SHIPPED |
| **Manual update check** | Immediate update check (errors swallowed) | update:check | updater.ts:45 | SHIPPED |
| **Restart to install update** | quitAndInstall | update:restart | updater.ts:44 | SHIPPED |

**Persisted preference settings:** showFilmstrips (types.ts:279, store.ts:67/254-258), snapPlayhead (types.ts:280, store.ts:65/261-266), snapBeats (types.ts:281, store.ts:66/267-272), workspaces/activeWorkspace (types.ts:277-278), lastProjectDir/recentProjects. `autoTime` is in-memory only (store.ts:67/274). `tlLoop` toggled via toggleLoop, default on (store.ts:179/538).

> **NOTE [tech debt]:** API keys stored plaintext in settings.json (no safeStorage); a parse error silently resets all keys (audit High).

---

## 14. Keyboard Shortcuts

| Key | Action | Guard | File:line |
|---|---|---|---|
| **Space** | Play/pause timeline (only with clips) | Not in form fields | App.tsx:163-166 |
| **←** | Previous clip | Not in form fields | App.tsx:168-171 |
| **→** | Next clip | Not in form fields | App.tsx:172-175 |
| **Home** | First clip | Not in form fields | App.tsx:176-179 |
| **End** | Last clip | Not in form fields | App.tsx:180-183 |
| **Delete / Backspace** | Remove selected timeline block | Block selected | App.tsx:153-158 |
| **Escape** | Clear timeline selection | Block selected | App.tsx:160 |
| **Escape** | Exit maximized panel | Panel maximized | App.tsx:131 |
| **Escape** | Close modal | Modal open | Modal.tsx:18-23 |
| **Ctrl+Z / Cmd+Z** | Undo (toast feedback) | Not in form fields | App.tsx:139-142 |
| **Ctrl+Shift+Z / Ctrl+Y** | Redo (toast feedback) | Not in form fields | App.tsx:140-145 |
| **?** | Toggle cheat sheet | Not in form fields | App.tsx:149-151 |
| **S / s** | Toggle slice tool | Not in form fields | Timeline.tsx:589-598 |
| **Esc** (Timeline) | Disarm slice tool | Not in form fields | Timeline.tsx:594-596 |
| **Input guard** | All global shortcuts suppressed in INPUT/TEXTAREA/SELECT/contentEditable | — | App.tsx:133-136 |

**Cheat Sheet modal** documents all of the above plus 11 drag-drop gestures (CheatSheet.tsx:5-26), the S-slice note (9), and footer note re: shortcuts-don't-fire-while-typing + Ctrl+Z undo (43-45). Help button opens it (App.tsx:508-510).

---

## 15. Drag & Drop (MIME registry)

| MIME | Payload | From → To | File:line |
|---|---|---|---|
| **MIME_CLIP** `text/plain` | clip id | Bin → timeline track | dragDrop.ts:3, Timeline.tsx:718-721 |
| **MIME_IMAGE** `application/x-vd-image` | abs file path | Library → clip slots / prompt / refs / Image Editor refs | dragDrop.ts:4 |
| **MIME_TAKE** `application/x-vd-take` | {clipId, takeId} | Clip Editor takes → form fields / Bin / timeline | dragDrop.ts:5, Timeline.tsx:706-717 |
| **MIME_TLITEM** `application/x-vd-tlitem` | array index | timeline block → reorder (insert before / append to end) | dragDrop.ts:6, Timeline.tsx:1037-1059, 723-724 |
| **MIME_MOVE** `application/x-vd-move` | {kind, id} | clip/image → folder header / root | dragDrop.ts:7 |
| **MIME_BEAT** `application/x-vd-beat` | beat index | beat → reorder | dragDrop.ts:8 |
| **MIME_AUDIO** `application/x-vd-audio` | audio id | Library AudioRow → timeline audio lane | dragDrop.ts:9 |
| **MIME_EDITNODE** `application/x-vd-editnode` | {sessionId, nodeId} | Image Editor node → Library | dragDrop.ts:10 |

Plus: OS file drop (images/audio) onto Library (Library.tsx:186-194, index.ts:281-299); drag-to-reorder same-position no-op guard (Timeline.tsx:691-692); drag-over highlight for drop targets (Timeline.tsx:1044-1052).

> **NOTE [tech debt]:** `MIME_CLIP='text/plain'` collides with any OS text drag onto the timeline; Beats.tsx uses the raw `'application/x-vd-beat'` literal not the MIME_BEAT constant (audit Low).

---

## 16. Project & Persistence (main process)

| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **New project (save dialog)** | Creates folder + images/renders + "Timeline 1" 16:9 + project.json | project:new | index.ts:196-207, project.ts:325-336 |
| **Open project (dir dialog)** | Reads + migrates project.json | project:open | index.ts:209-219 |
| **Open last project on launch** | Reopens last dir; null if gone | project:openLast | index.ts:221-225 |
| **Open by known path (recents)** | Opens recent; updates list | project:openPath | index.ts:228-233 |
| **Recent projects list** | Most-recent-first, capped 8, deduped, stale filtered | project:recents | index.ts:234-237 |
| **Recent projects dropdown** | Header ▾ shows recents (folder name + full-path tooltip) | Click ▾ | App.tsx:438-471 |
| **Auto-record recents on open/new** | Pushes dir to front, stores lastProjectDir | Auto | index.ts:190-194 |
| **Current project name display** | Folder icon + name / "no project" | Auto | App.tsx:473-481 |
| **Get current project** | Full Project to renderer | project:get | index.ts:239 |
| **New project button** | New blank project; clears filmstrip cache; resets playback | Click "New" | App.tsx:435 |
| **Open project button** | Native folder picker | Click "Open" | App.tsx:436 |
| **Undo** | Snapshot history (cap 80); reconcile; toast | Ctrl+Z / project:undo | project.ts:195-206, store.ts:208-214 |
| **Redo** | Forward through redo stack; toast | Ctrl+Y / project:redo | project.ts:207-217, store.ts:215-221 |
| **Undo history depth** | 80 JSON snapshots, FIFO; media never deleted | Auto | project.ts:44-49 |
| **Atomic project save** | Serialized tmp+rename; sync snapshot at enqueue | Auto | project.ts:138-165 |
| **Schema migration (→v5)** | v0-2→timelines, v3→editSessions, v4→audio; newer opens best-effort | Auto on open | project.ts:98-129 |
| **Atomic settings save** | Serialized tmp+rename; corruption reported | settings:set | index.ts:78-105 |
| **Settings get / set** | Full read / partial patch | settings:get/set | index.ts:157-158 |
| **Per-project layout save/load** | layout.json in project folder | layout:save/load | index.ts:446-464 — **[DEAD]** declared but never invoked by renderer |
| **Image file picker dialog** | jpg/png/webp multi-select | dialog:pickImages | index.ts:179-186 |
| **Import images (picker)** | Copy to images/; unique @imageN; delta | library:import | index.ts:256-264 |
| **Import images (OS drag)** | Copy dropped images; delta | library:importPaths | index.ts:281-284 |
| **Import audio (picker)** | Copy to audio/; title from filename | audio:import | index.ts:287-295 |
| **Import audio (OS drag)** | Copy dropped audio; delta | audio:importPaths | index.ts:296-299 |
| **Rename audio** | Rename track (blank rejected) | audio:rename | index.ts:300 |
| **Delete audio** | Removes track; clears timeline bindings; file stays | audio:delete | index.ts:302 |
| **Audio duration backfill** | Persist measured duration once | audio:setDuration | index.ts:301, project.ts:602-609 |
| **New clip (empty/storyboard)** | Blank PromptData; "clip N" | clip:new | index.ts:339, project.ts:325-336 |
| **Rename clip** | Blank rejected | clip:rename | index.ts:337, project.ts:348-355 |
| **Delete clip** | Removes clip + all timeline instances | clip:delete | index.ts:436, project.ts:500-511 |
| **Duplicate clip** | Copies takes (files reused) + "·copy" | clip:duplicate | index.ts:437, project.ts:514-534 |
| **Set clip prompt data** | Persist live recipe w/o rendering | clip:setPromptData | index.ts:341, project.ts:339-345 |
| **Delete image** | Removes from library + clip refs; file stays; sessions kept | image:delete | index.ts:438, project.ts:537-551 |
| **Duplicate image** | Copies file + new @imageN | image:duplicate | index.ts:439, project.ts:553-564 |
| **Rename image (@title uniqueness)** | Normalizes; rejects dupes; rewrites all @mentions incl. snapshots (word-boundary) | image:rename | index.ts:440, project.ts:789-836 |
| **@title normalization** | Leading @, spaces→underscores | Auto | types.ts:19-24 |
| **Add folder** | Bin/lib, nested via parent | folder:add | index.ts:441, project.ts:838-848 |
| **Rename folder** | Blank rejected | folder:rename | index.ts:442, project.ts:850-857 |
| **Delete folder (reparent)** | Children/items → parent; non-destructive | folder:delete | index.ts:443, project.ts:859-887 |
| **Move item to folder** | Clip/image → folder or root | item:move | index.ts:444, project.ts:1141-1159 |
| **Tag edit node to Library** | Copy node file as @image w/ lineage; idempotent | image:tagNode | index.ts:417, project.ts:923-943 |
| **Delete edit branch** | Node + descendants; tagged survive; primary protected | image:deleteBranch | index.ts:418, project.ts:970-998 |
| **Set primary node** | Swap image.file → every clip follows; null reverts | image:setPrimary | index.ts:278, project.ts:950-967 |
| **Cross-project pick source** | Peek clips (name/takes/duration/beats/engine/thumb); no project switch | import:pickProject | index.ts:421-429, project.ts:1003-1033 |
| **Cross-project copy clips** | Physical copy of takes+images; re-mint ids; resolve @title collisions | import:clips | index.ts:430-433, project.ts:1039-1139 |
| **Reveal file in Explorer** | Reveals existing path | shell:reveal | index.ts:244-246 |
| **Open external link** | https only | shell:openExternal | index.ts:247-249 |
| **Project folder auto-uniqueness** | Numeric suffix if name exists | Auto | project.ts:168-171 |
| **@title auto-numbering (gap-safe)** | Next free integer, scans gaps | Auto | project.ts:257-260 |

### 16.1 Timeline data-model operations (main)
Set items (whole array — single write for all mutations) — timeline:set (index.ts:343, project.ts:381-388); add (391-403); rename (405-412); set aspect (414-421); duplicate (423-436); delete — never zero, recreates "Timeline 1" (438-456); set active (458-463). Set music (audioId+startSec+in/out, or null) — timeline:setMusic (303-305, types.ts:144-149); video mute (306-308); music mute (306-308); export res (309-311); export fps (309-311). TimelineItem fields: per-instance takeId override (types.ts:136-137), useRecipe/C-view toggle (137), trim in/out (138-139), per-instance mute (140).

---

## 17. Quality-of-life / Automatic behaviors

**Clip Editor autosave & sync:** auto-save form 600ms debounce, beats only if dirty here (RenderPanel.tsx:557-576); auto-sync external beats from Clip Monitor (323-332); auto-update ref paths on file swap (336-345); auto-rewrite @mentions on rename, caret-preserving (349-379); form clear on project switch (482-503); form load on clip select w/ undo support (251-319); adopt uncommitted content on "+ new" (505-517); pending-focus double-click link → prompt (70, 145-149, 304-314).

**Recipe/take math:** recipeDur auto→5s (timelineUtils.ts:19-21); C-instance trims ignored & always live recipe (37, 1020, timelineUtils.ts:72-78); buildSegs safe total ≥1 (94).

**Filmstrip cache:** lazy one-decode-per-file w/ inflight dedup (filmstrip.ts:86-101); LRU cap 50 + access-order update (21-38); cleared on project switch (16-18); CORS-safe media:// extraction (43-46); JPEG q0.6 h90 (7, 75); 20 samples (8, 63); true aspect preserved (54, Timeline.tsx:117-118); windowed re-sample on trim (129-149); per-block ResizeObserver, count cap 40 (Timeline.tsx:103-114, 119); decoder released after extract (81-82).

**Audio lane QoL:** auto-learn track duration (Timeline.tsx:353-357); block-width ResizeObserver (361-370); lazy decode only when expanded (344); always-on beat-snap decode (663); beat-times mapped to timeline space (664-672); 3px move threshold (429).

**Monitor/Source QoL:** ResizeObserver auto-fit (Monitor.tsx:31-42); take/audio real-duration backfill; storyboard hold-clocks; beat-draft flush on change/unmount; trim committed on mouseup only; imperative playheads (no per-frame re-render).

**Store-level (store.ts):** undo/redo toast feedback + index clamp (208-221); delta merge preserving identity (224-253); timeline switch resets playback (231-234); edit index tracks item by id (241-245); auto-report take/audio duration (492-496, 375-379); image rename broadcast renameSignal (437-449); file-swap broadcast fileSwap (192-200); export done/error/import/open-path toasts (398-406, 343-368, 337); main→renderer delta/export/render/image-progress push subscriptions (App.tsx:125-127); filmstrip cache clear on project switch (311-333).

**App-shell QoL:** auto-open last project (App.tsx:377); auto-save layout 600ms debounce, never empty (371-376); Clip Editor "⏳" badge during render (411-413); Timeline Editor "⏳" during export (414-416); Clip Monitor only raises on real target change (388-408); Clip Editor raises only on real double-click (405-407).

**Main-process QoL:** auto-create "Untitled" project on render with none open (index.ts:473); render source-image auto-import to Library, path-dedup (484-492); auto-increment clip name (519); dynamic-still auto-reconcile 400ms (project.ts:696-750); project:delta push (index.ts:137, project.ts:628-631); crash/error log + rotation + uncaught capture (log.ts:46-75); renderer error log (log.ts:77-79, index.ts:252); renderer-crash detection (index.ts:133-135); media:// secure project-scoped streaming w/ Range (index.ts:9-12, 534-589); 403 outside project (534-544, 555-556); auto-hidden menu bar (119); min size 1024×640 (113-114); default 1440×900 (111-112); ProjectDelta partial merge (types.ts:181-194); ffmpeg-static bundled (export.ts:6-12); media probe via ffmpeg stderr cached (54-73).

> **NOTE (audit):** `importImage()` dedup compares source vs destination path → never matches → re-copies every drag (High, project.ts:245). delete/duplicate never GC or copy media files → unbounded disk growth (High). Double `tlNext()` per advance can skip two slots (High, Monitor.tsx:321,337).

---

## 18. Export

| Feature | What it does | Trigger | File:line |
|---|---|---|---|
| **Export timeline to MP4** | Full ffmpeg re-encode; native Save dialog → exports/name.mp4; one at a time; progress streamed | export:run / Export button | index.ts:315-335 |
| **Export Timeline Editor button** | "export mp4"; disabled when busy/empty | Click | TimelineEditor.tsx:103-110 |
| **Export resolution picker** | 480/720/1080p (short side), default 1080 | Click chip | TimelineEditor.tsx:79-88, index.ts:309-311 |
| **Export FPS picker** | auto/24/30, default auto | Click chip | TimelineEditor.tsx:91-100, index.ts:309-311 |
| **Export status / reveal** | Path + click-to-reveal; red error, amber success | Auto/click | TimelineEditor.tsx:111-128 |
| **Storyboard/C export hint** | Explains beat-frame export | Auto | TimelineEditor.tsx:129-131 |
| **Progress streaming** | "probing…/exporting WxH @ fps…/N%/done" via export:progress | Auto | index.ts:331, export.ts:227-243 |
| **Storyboard/C clip rendering** | Beat ref images held for beat window (matches Monitor) | Auto | export.ts:128-148 |
| **Video fill-centered crop** | Scale-up + center-crop to fill canvas (no letterbox) | Auto | export.ts:179-186 |
| **Music lane mix** | amix under clip audio; startSec + trim honored | Auto | export.ts:204-215 |
| **Per-clip audio mute** | Muted instances get silent stream | Auto | export.ts:182 |
| **Output codec/quality** | H.264 CRF18 yuv420p + AAC 192k 48k, faststart | Auto | export.ts:218-222 |
| **Auto FPS from first clip** | Native rate clamped 12–60, fallback 24 | Auto | export.ts:156-162 |
| **Reveal export file** | Show in Explorer | shell:reveal | index.ts:244-246 |
| **No-concurrent-exports guard** | "an export is already running" | Auto | index.ts:318 |
| **Default output path** | exports/name.mp4, illegal chars stripped | Auto | index.ts:322-325 |
| **Empty-timeline guard** | Error w/o opening dialog | Auto | index.ts:319-321, export.ts:94-95 |

### 18.1 Timeline Editor panel (settings)
Open by double-click timeline in Bin (TimelineEditor.tsx:12-13); edit name commit on blur/Enter (46-54); name syncs external changes (24-27); aspect picker 16:9/9:16/1:1/4:3/3:4/21:9 (59-69); aspect auto-fill hint (70-73); details: clip count + SMPTE total (134-141); empty state "open a project…" (32-38).

---

## 19. Build, Auto-Update, Logging

| Feature | What it does | File:line | Status |
|---|---|---|---|
| **Silent auto-update (Windows packaged)** | electron-updater polls feed 4s after launch + every 3h; silent background download; installs on quit; update:status events | updater.ts:17-49 | SHIPPED (Windows only) |
| **Auto-Update chip (downloading)** | "updating…" dimmed chip | App.tsx:498-507 | SHIPPED |
| **Auto-Update chip (ready)** | "restart to update (vX.Y.Z)"; click restarts | App.tsx:498-507 | SHIPPED |
| **Update status events to renderer** | downloading/progress/ready forwarded | updater.ts:27-43 | SHIPPED |
| **Auto-update macOS / Linux** | Guarded off (platform !== win32); manual .dmg | updater.ts:9-12, 23 | **COMING SOON** (needs Apple signing) |
| **Crash/error log (main)** | console + uncaught/rejection → userData/logs/main.log, rotates 2MB | log.ts:46-75 | SHIPPED |
| **Renderer error log** | RENDERER-prefixed entries | log.ts:77-79, index.ts:252 | SHIPPED |
| **Renderer crash detection** | render-process-gone logged | index.ts:133-135 | SHIPPED |

> **NOTE (audit High):** Updater error never reaches renderer (console-only) → 404/feed mismatch invisible. `package.json` version `0.0.1` must be bumped before first Release or auto-update never fires. `update:restart`/`update:check` handlers only registered on Windows-packaged builds → unhandled invocation elsewhere.

---

## 20. Coming Soon / Partial / Dead

| Item | Status | Notes | File:line |
|---|---|---|---|
| **Image Editor canvas masking/drawing tools** | **PARTIAL** | View-only canvas; Phase 2 placeholder | ImageEditor.tsx:229-238 |
| **Sora 2 character references** | **COMING SOON** | characterRefs:2 declared, not wired into editor | models.ts:53 |
| **Astria API key** | **COMING SOON** | Stored, "NOT used by Video Dancer" | SettingsModal.tsx:21, types.ts:272 |
| **Anthropic / Claude prompt brain** | **COMING SOON** | Key stored, "coming later" | SettingsModal.tsx:22, types.ts:273 |
| **macOS / Linux auto-update** | **COMING SOON** | Disabled until Apple Developer signing | updater.ts:9-12 |
| **Per-project layout save/load (layout:save / layout:load)** | **DEAD** | IPC declared in preload/main/env.d.ts but never invoked by any renderer panel | index.ts:446-464, preload + env.d.ts |
| **WebGpuVideoSpike component** | **DEAD** | Phase-0 WebGPU/WebCodecs proof; not imported anywhere; CSS still bundled | preview/WebGpuVideoSpike.tsx |
| **Static preload version field** | **STALE** | `window.vidancer.version='0.0.1'` hardcoded; use app:version for live value | preload/index.ts:7 |

---

## Feature count per category

| Category | Count |
|---|---|
| 1. Timeline (transport, ruler, blocks, trim, slice, audio lane) | 71 |
| 2. Clip Editor / Render Panel | 43 |
| 3. Beats & structured fields (incl. ClipFields, MentionArea, YAML/lint engine) | 79 |
| 4. Generation / Render (engines & pipeline) | 21 |
| 5. Takes & Versioning | 18 |
| 6. Library | 30 |
| 7. Bin (clips + timelines + import modal) | 46 |
| 8. Folders | 23 |
| 9. Image Editor (+ falImage backend) | 58 |
| 10. Frame-grab & Continue-clip (dynamic stills) | 15 |
| 11. Playback (Program + Source Monitor, audio bus, waveform, inline preview) | 79 |
| 12. Panels & Workspaces | 30 |
| 13. Settings | 22 |
| 14. Keyboard Shortcuts | 15 |
| 15. Drag & Drop (MIME registry) | 11 |
| 16. Project & Persistence (main process) | 62 |
| 17. Quality-of-life / Automatic behaviors | 70 |
| 18. Export (+ Timeline Editor panel) | 24 |
| 19. Build, Auto-Update, Logging | 9 |
| 20. Coming Soon / Partial / Dead | 8 |
| **TOTAL (deduplicated catalogue entries)** | **~734** |

> Counts are catalogue rows after dedup; features appearing in multiple extractor slices (e.g. snap toggles in both Timeline and Settings, take-resolution priority in Timeline/Takes/Source Monitor, media:// streaming, reportTakeDuration) are listed once in their primary section and cross-referenced rather than double-counted. Every distinct feature from all 8 extractor lists plus the 3 audit-only additions (dead `layout:save/load` channels, dead `WebGpuVideoSpike`, stale hardcoded preload version) is represented.