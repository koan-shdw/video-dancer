import { Modal } from './Modal'

// ---- What's-New: shown ONCE, on the first launch after an auto-update lands (Settings
// lastRunVersion bump drives it — see the boot effect in App). The list is written by hand per
// release: plain words, only things a user can see and touch. Cutting a release = push the current
// WHATS_NEW onto the FRONT of HISTORY, then write the new version + list here. ----

export const WHATS_NEW: { version: string; features: string[] } = {
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
}

// every release before the current one, newest first — the scroll below the fold
export const HISTORY: { version: string; features: string[] }[] = [
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
