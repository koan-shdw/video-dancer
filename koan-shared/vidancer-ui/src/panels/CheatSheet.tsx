import { Modal } from '../ui/Modal'

// the ? overlay: every keyboard shortcut + the drag/click vocabulary on one card.
// This carries discoverability until real docs exist — keep it in sync when gestures change.
const KEYS: [string, string][] = [
  ['Space', 'play / pause (the fronted monitor owns it)'],
  ['← / →', 'step the playhead 1 frame (Shift = 5)'],
  ['↑ / ↓', 'jump to the previous / next cut'],
  ['Home / End', 'timeline start / end'],
  ['J / K / L', 'back 5s · pause · play'],
  ['Q / W', 'ripple-trim the clip under the playhead: cut its head / tail to the playhead — everything after closes up'],
  [', / .', 'nudge the selected block(s) 1 frame left / right (Shift = 5)'],
  ['C', 'slice tool (click a clip to cut) — Premiere razor'],
  ['S', 'snapping on / off (both magnets)'],
  ['A', 'select forward — click a clip to select it + everything after (V / Esc cancels)'],
  ['Ctrl+K', 'razor at the playhead (selected clip first, else the topmost visible)'],
  ['M', 'marker at the playhead'],
  ['I / O', 'set in / out range (loops playback · windows the export)'],
  ['− / = / \\', 'zoom out / in / fit'],
  ['Ctrl+C / Ctrl+X', 'copy / cut the selected block — video, lane audio or ♪ score; a linked clip goes as one'],
  ['Ctrl+V / Ctrl+Shift+V', 'paste at the playhead on its own track or lane: overwrite · insert (everything after shifts right)'],
  ['Alt+Delete', 'delete one half of a linked clip (Delete takes both)'],
  ['Del / Backspace', 'remove the selected timeline block'],
  ['Esc', 'clear selection · cancel slice · close overlays · restore a maximized panel'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'undo / redo (project-wide)'],
  ['?', 'this cheat-sheet']
]
const GESTURES: [string, string][] = [
  ['drag a Bin clip → timeline', 'add it to the sequence'],
  ['drag a Library image → prompt / ref slots', 'drop its @name into the recipe'],
  ['drag a 👁 watched tile → Library / clip slot', 'import it into the project (staging strip)'],
  ['drag a ♪ track → the audio lanes', 'a teal ♫ block on the lane under the cursor — several tracks can layer now; ⋮⋮ marks the one driving the beat grid (right-click to change)'],
  ['drag a ♪ score → the audio lanes', 'lands on the lane under the cursor (purple block) — stretch it over a span; that span is what compose reads'],
  ['♪ score block', 'click select (Del removes) · double-click = volume view · drag move (snaps; Shift off) · left edge trims · right edge stretches (sets the render length)'],
  ['right-click a ♪ score block', '♪ score card · ✨ compose from this span · mute · fades · gain · remove'],
  ['double-click any audio block', 'the tall VOLUME view for ITS lane (Premiere): the amber line is the level in dB (drag it) · ctrl-click the line = keyframe · ctrl-click a keyframe = remove · click / shift-click select, Delete removes · drag = move (Shift locks one axis) · drag the segment between two keyframes = both levels · right-click a keyframe = Linear · Bezier · Auto Bezier · Continuous Bezier · Hold · Ease In · Ease Out (handles drag)'],
  ['volume band · fades', 'top = +6 dB, dashed = 0 dB, floor = silence — plays live and bakes into export identically · Ctrl+Shift+D = 1 s Constant Power fade on both edges; drag a fade\'s inner edge, double-click = length, right-click = Constant Power / Constant Gain / Exponential · lane header ◁ ◇ ▷ = keyframe navigator'],
  ['right-click a block → ♪ insert audio → A#', 'drops a COPY of its audio on the matching lane at the exact timecode + trims (the block mutes itself — unmute to layer); the copy is free: J/L-cut it, fade it, band it'],
  ['audio lanes collide', 'one lane, one occupant — drops/moves hop to clear ground (a new lane appears if all are full), trims stop at neighbors'],
  ['right-click a score take card', 'restore recipe → editor · color · disable'],
  ['drag a T-chip → a Clip Gen field', 'restore just that field from the take'],
  ['drag a T-chip → Bin', 'clone the take into a new clip'],
  ['alt-drag a Bin clip → desktop / folder', 'copy its video file there (original stays)'],
  ['double-click: Bin clip / image / ▤ timeline / timeline block', 'opens its editor'],
  ['click any audio block', 'select (Del removes · Esc clears) — blue selects its whole clip, Premiere linked-selection'],
  ['drag a timeline block', 'move it (up/down = change track) — dropping on clips overwrites them, Premiere-style'],
  ['Alt-drag a block', 'drag out a duplicate (the original stays)'],
  ['Ctrl-drop a dragged block', 'INSERT instead of overwrite — everything at the drop point shoves right'],
  ['Shift-drag a block', 'keep its time — only the track changes'],
  ['Ctrl+Alt-drag a trimmed block’s body', 'SLIP — shift which part of the take plays; the block itself stays put'],
  ['right-click a block → ⊘ disable', 'invisible + silent (playback AND export) but keeps its slot — right-click again to enable'],
  ['switch a block’s take (or S-B)', 'the length difference ripples everything after it — shorter pulls left, longer pushes right'],
  ['click a gap between clips', 'select the gap — Del closes it and ripples every channel left'],
  ['drag empty track space', 'marquee group-select — drag any selected block to move the group'],
  ['right-click empty track space', 'paste here (no ripple) · close gap · marker'],
  ['right-click a track label (V1/V2…)', 'mute · solo · lock · add video/audio track · delete empty track'],
  ['rail header (top)', '+V +A −A track management · C = master mute for ALL clip audio — per-lane M/S below (all mixing lives on the rail)'],
  ['right-click a timeline block', 'stills → Library · dissolve · speed · effects · ⟲ loop · disable · unlink audio · ⑂ edit v2v · remove / ripple delete'],
  ['right-click a block → ✦ effects…', 'ordered effect stack + blend mode for that block — live in the Timeline Monitor, amber fx badge marks blocks that carry one'],
  ['right-click a block → ⟲ loop', 'a faded tail of repeats fills to the next block on the track (or the sequence end) — every repeat follows the block’s live trims/take/fx'],
  ['drag a loop tail’s end grip', 'set where the tail stops — release at the natural wall to go elastic again'],
  ['blue audio = linked, green = free', 'right-click blue to unlink onto a lane; green drags between lanes, edges trim, fades in the menu'],
  ['wheel over the timeline', 'pan · Ctrl+wheel = zoom at the cursor'],
  ['right-click a Bin clip / image / T-chip', 'actions menu (⑂ edit take v2v, export, rename…)'],
  ['hover a Bin clip thumbnail', 'scrub through its keeper take (mouse X = position)'],
  ['⊢ first / last ⊣ in the Clip Monitor (slot mode)', 'LIVE frame still → Library (follows edits)'],
  ['drag a block’s edges', 'trim — an END trim ripples everything after it (Alt = leave the gap, Ctrl = rolling)'],
  ['drag the bar under a Gen / Edit preview', 'resize the preview (remembered)'],
  ['zoom buttons in the timeline toolbar', 'zoom the timeline (click the % to fit)'],
  ['🖥 in the timeline toolbar', 'push playback fullscreen to another display (Esc there closes)'],
  ['ctrl+scroll over the Bin / Library (or the slider)', 'thumbnail size, Explorer-style'],
  ['take N ▾ on a block', 'switch that instance’s take, or S-B = the live storyboard'],
  ['camera button on a monitor', 'save the current frame to the Library'],
  ['✏ draw on the Image Editor canvas', 'pen marks guide the model — sent only while visible'],
  ['Window ▾ in the header', 'reopen / raise any panel (closed ones come back)'],
  ['Co-Director panel (Window ▾)', 'talk to the AI copilot — it fills fields, beats, styles & refs directly (tinted until you edit)'],
  ['@ in the Co-Director chat', 'reference a Library image — the AI sees the actual image'],
  ['click any field, then say "this one"', 'the Co-Director knows which field you last clicked (subtle ring)']
]

export function CheatSheet({ onClose }: { onClose: () => void }): React.JSX.Element {
  // Esc closes via the Modal shell; the '?' toggle is owned by App's global handler alone
  const row = ([k, v]: [string, string]): React.JSX.Element => (
    <div key={k} style={{ display: 'flex', gap: 10, padding: '3px 0', alignItems: 'baseline' }}>
      <span style={{ flex: '0 0 215px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--amber)' }}>{k}</span>
      <span style={{ fontSize: 11.5, color: 'var(--txt)' }}>{v}</span>
    </div>
  )
  return (
    <Modal title="shortcuts & gestures" width={560} onClose={onClose}>
      <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)', margin: '2px 0 4px' }}>keyboard</div>
      {KEYS.map(row)}
      <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)', margin: '12px 0 4px' }}>mouse & drag-drop</div>
      {GESTURES.map(row)}
      <p style={{ marginTop: 12, marginBottom: 0, fontSize: 10.5, color: 'var(--dim)' }}>
        shortcuts never fire while you’re typing in a field · most things are undoable with Ctrl+Z
      </p>
    </Modal>
  )
}
