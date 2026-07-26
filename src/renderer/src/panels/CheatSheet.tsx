import { Modal } from '../ui/Modal'

// the ? overlay: every keyboard shortcut + the drag/click vocabulary on one card.
// This carries discoverability until real docs exist — keep it in sync when gestures change.
const KEYS: [string, string][] = [
  ['Space', 'play / pause (the fronted monitor owns it)'],
  ['← / →', 'jump to previous / next cut · with a block selected: nudge it 1 frame (Shift = 1s)'],
  ['Home / End', 'timeline start / end'],
  ['J / K / L', 'back 5s · pause · play'],
  ['S', 'slice tool (click a clip to cut)'],
  ['A', 'select forward — click a clip to select it + everything after (V / Esc cancels)'],
  ['Ctrl+K', 'razor at the playhead'],
  ['M', 'marker at the playhead'],
  ['I / O', 'set in / out range (loops playback · windows the export)'],
  ['− / = / \\', 'zoom out / in / fit'],
  ['Ctrl+C / Ctrl+V', 'copy the selected block · ripple-paste at the playhead (everything after shifts right)'],
  ['Del / Backspace', 'remove the selected timeline block'],
  ['Esc', 'clear selection · cancel slice · close overlays · restore a maximized panel'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'undo / redo (project-wide)'],
  ['?', 'this cheat-sheet']
]
const GESTURES: [string, string][] = [
  ['drag a Bin clip → timeline', 'add it to the sequence'],
  ['drag a Library image → prompt / ref slots', 'drop its @name into the recipe'],
  ['drag a 👁 watched tile → Library / clip slot', 'import it into the project (staging strip)'],
  ['drag a ♪ track → audio lane', 'set the timeline’s music (drops at the cursor)'],
  ['drag a T-chip → a Clip Gen field', 'restore just that field from the take'],
  ['drag a T-chip → Bin', 'clone the take into a new clip'],
  ['alt-drag a Bin clip → desktop / folder', 'copy its video file there (original stays)'],
  ['double-click: Bin clip / image / ▤ timeline / timeline block', 'opens its editor'],
  ['double-click the music block', 'waveform view (click cycles wave / beats / both)'],
  ['drag a timeline block', 'move it (Alt = duplicate · Shift = no snap · up/down = change track) — dropping on clips overwrites them, Premiere-style'],
  ['click a gap between clips', 'select the gap — Del closes it and ripples every channel left'],
  ['drag empty track space', 'marquee group-select — drag any selected block to move the group'],
  ['right-click empty track space', 'paste here (no ripple) · close gap · marker'],
  ['right-click a timeline block', 'stills → Library · dissolve · speed · unlink audio · edit with AI · remove / ripple delete'],
  ['blue audio = linked, green = free', 'right-click blue to unlink onto a lane; green drags between lanes, edges trim, fades in the menu'],
  ['wheel over the timeline', 'pan · Ctrl+wheel = zoom at the cursor'],
  ['right-click a Bin clip / image / T-chip', 'actions menu (edit take with AI, export, rename…)'],
  ['hover a Bin clip thumbnail', 'scrub through its keeper take (mouse X = position)'],
  ['⊢ first / last ⊣ in the Clip Monitor (slot mode)', 'LIVE frame still → Library (follows edits)'],
  ['drag a block’s edges', 'trim (snaps to the scrubber · live preview frame)'],
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
