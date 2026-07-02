import { Modal } from '../ui/Modal'

// the ? overlay: every keyboard shortcut + the drag/click vocabulary on one card.
// This carries discoverability until real docs exist — keep it in sync when gestures change.
const KEYS: [string, string][] = [
  ['Space', 'play / pause the timeline'],
  ['← / →', 'previous / next clip'],
  ['Home / End', 'first / last clip'],
  ['S', 'slice tool (click a clip to cut · snaps to the scrubber)'],
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
  ['drag a block’s edges', 'trim (snaps to the scrubber · live preview frame)'],
  ['zoom buttons in the timeline toolbar', 'zoom the timeline (click the % to fit)'],
  ['ctrl+scroll over the Bin / Library (or the slider)', 'thumbnail size, Explorer-style'],
  ['take N ▾ on a block', 'switch that instance’s take, or C = live recipe'],
  ['camera button on a monitor', 'save the current frame to the Library']
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
