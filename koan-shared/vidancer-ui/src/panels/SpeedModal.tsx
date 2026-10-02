import { useState } from 'react'
import type { Project, Timeline, TimelineItem, Take } from '../shared/types'
import { Dropdown } from '@koan/shared'
import { vd } from '../api'
import { useStore } from '../store'
import { Modal } from '../ui/Modal'
import { ctl } from '../ui/controls'
import { Ic, Link2, Link2Off } from '../ui/icons'
import { effDur, remapped, resolveTake, sourceDurOf } from '../lib/timelineUtils'
import { remapRange } from '../shared/remap'
import { applySpeed, canReverse, reachOf, SPEED_MAX, SPEED_MIN } from '../lib/speed'
import { smpte, TC_FPS } from '../lib/time'
import { denseEnough, flowTimes } from '../shared/enhance'
import { toast } from '../ui/Toast'

// timecode or seconds → seconds ("00:00:04:12", "4.5")
const parseDur = (s: string): number | null => {
  const t = s.trim()
  const tc = /^(\d+):(\d+):(\d+)[:;](\d+)$/.exec(t)
  if (tc) return Number(tc[1]) * 3600 + Number(tc[2]) * 60 + Number(tc[3]) + Number(tc[4]) / TC_FPS
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? n : null
}
const pct = (sp: number): string => String(Math.round(sp * 1000) / 10)
// list 52: a copy made for Optical Flow — more frames, the take's own length, nothing else done
const flowCopy = (t?: Take): boolean => !!t?.enhanced?.interp && !t.enhanced.upscale && (t.enhanced.interp.slowmo ?? 1) === 1

// list 51 — Premiere's Clip Speed / Duration (right-click → speed / duration…, Ctrl+R): Speed and
// Duration tied by the chain, Reverse Speed, Maintain Audio Pitch, Ripple Edit, Time Interpolation.
// Works on every selected block; the rules live in lib/speed (applySpeed), one write = one undo.
export function SpeedModal({ project, timeline, itemIds, onClose }: { project: Project; timeline: Timeline; itemIds: string[]; onClose: () => void }): React.JSX.Element {
  const items = itemIds.map((id) => timeline.items.find((x) => x.id === id)).filter((x): x is TimelineItem => !!x)
  const first = items[0]
  // the first block's source window: the chain turns speed ↔ duration on it (Premiere does the same)
  const win = first && !first.useRecipe ? Math.min(first.outSec ?? reachOf(project, first), reachOf(project, first)) - (first.inSec ?? 0) : 0
  const [speed, setSpeed] = useState(pct(first?.speed ?? 1))
  const [dur, setDur] = useState(smpte(first ? effDur(first, project.clips) : 0))
  const [linked, setLinked] = useState(true)
  const [reverse, setReverse] = useState(items.length > 0 && items.every((x) => x.reverse))
  const [keepPitch, setKeepPitch] = useState(!items.some((x) => x.pitchShift))
  const [ripple, setRipple] = useState(true)
  const firstClip = first && !first.nestId ? project.clips.find((c) => c.id === first.clipId) : undefined
  const firstTake = firstClip ? resolveTake(firstClip, first) : undefined
  const [interp, setInterp] = useState(first?.interp === 'blend' ? 'blend' : flowCopy(firstTake) ? 'flow' : 'sample')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const reversible = items.some((x) => canReverse(x, project.clips))
  // list 56: a time-remapped block's speed lives on its line — Speed, Duration and Reverse grey for it
  const nRemap = items.filter(remapped).length
  const allRemap = items.length > 0 && nRemap === items.length
  const remapWhy = 'time remapping is on: the speed line on the block sets its speed (right-click → time remapping → remove for one speed)'
  const onSpeed = (v: string): void => {
    setSpeed(v)
    const sp = Number(v) / 100
    if (linked && sp > 0 && win > 0) setDur(smpte(win / sp))
  }
  const onDur = (v: string): void => {
    setDur(v)
    const d = parseDur(v)
    if (linked && d && win > 0) setSpeed(pct(win / d))
  }
  const run = async (): Promise<void> => {
    setError('')
    const sp = Number(speed) / 100
    if (!(sp >= SPEED_MIN - 1e-9 && sp <= SPEED_MAX + 1e-9)) return setError(`Speed runs ${SPEED_MIN * 100} % to ${SPEED_MAX * 100} %.`)
    const d = parseDur(dur)
    if (!linked && !d) return setError('Type a duration, like 00:00:04:12 or 4.5.')
    try {
      const st = useStore.getState()
      const p = st.project
      const tl = p?.timelines.find((t) => t.id === timeline.id)
      if (!p || p.dir !== project.dir || !tl) throw Error('The project or timeline changed.')
      const r = applySpeed(p, tl, itemIds, { speed: sp, duration: linked ? undefined : d!, reverse, keepPitch, blend: interp === 'blend', ripple })
      if (!r.changed) throw Error('Those blocks sit on a locked track.')
      // list 52 — Optical Flow: a slowed block plays a copy of its take with the frames it needs
      // (ENHANCE's Interpolate, "smoother": same length, ×2/×4/×8 the frames). A copy that exists is
      // switched to here; a missing one opens ENHANCE on the take, and the blocks switch when it
      // lands. Frame Sampling / Blending sends a block on such a copy back to its take.
      const need: { clipId: string; takeId: string; itemIds: string[]; times: number }[] = []
      const flowing = interp === 'flow'
      let next = r.items.map((x) => {
        if (!itemIds.includes(x.id) || x.nestId || x.useRecipe || tl.items.includes(x)) return x // untouched = on a locked track
        const c = p.clips.find((k) => k.id === x.clipId)
        const t = c && resolveTake(c, x)
        if (!c || !t) return x
        const base = flowCopy(t) && c.takes.some((k) => k.id === t.enhanced!.of) ? t.enhanced!.of : t.id
        if (!flowing) return base !== t.id ? { ...x, takeId: base } : x
        // list 56: a remapped block needs the frames its slowest part plays at
        const need0 = remapped(x) ? remapRange(x.remap!, x.inSec ?? 0, Math.min(x.outSec ?? sourceDurOf(x, p.clips), sourceDurOf(x, p.clips)))[0] : sp
        if (need0 >= 1 || denseEnough(t.enhanced, need0)) return x // at speed or faster no frame is missing
        const copy2 = c.takes.filter((k) => k.enhanced?.of === base && flowCopy(k) && denseEnough(k.enhanced, need0)).pop()
        if (copy2) return { ...x, takeId: copy2.id }
        const g = need.find((n) => n.clipId === c.id && n.takeId === base)
        if (g) {
          g.itemIds.push(x.id)
          g.times = Math.max(g.times, flowTimes(need0))
        } else need.push({ clipId: c.id, takeId: base, itemIds: [x.id], times: flowTimes(need0) })
        return x
      })
      if (next.every((x, i) => x === r.items[i])) next = r.items
      // reversed copies first (made once per take, kept next to it) — nothing changes until they exist
      if (reverse) {
        const files = [...new Set(next.filter((x) => itemIds.includes(x.id) && canReverse(x, p.clips)).map((x) => resolveTake(p.clips.find((c) => c.id === x.clipId)!, x)!.file))]
        for (let i = 0; i < files.length; i++) {
          setBusy(files.length > 1 ? `reversing ${i + 1} of ${files.length}…` : 'reversing…')
          const rv = await vd().mediaReverse(files[i])
          if (!rv?.ok) throw Error(`Couldn't make the reversed copy: ${rv?.error ?? 'unknown error'}`)
        }
      }
      setBusy('saving…')
      await st.setTimelineBoth(next, r.audioItems, tl.id)
      if (need.length) {
        const n = need[0]
        st.openEnhance({ kind: 'take', clipId: n.clipId, takeId: n.takeId }, { times: n.times, itemIds: n.itemIds })
        if (need.length > 1) toast(`Optical Flow: ${need.length - 1} more take${need.length > 2 ? 's need' : ' needs'} a copy with more frames — right-click those blocks → enhance…`, { kind: 'info' })
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }
  const lbl: React.CSSProperties = { width: 70, textAlign: 'right', fontSize: 12, color: 'var(--body)' }
  const check = (on: boolean, set: (v: boolean) => void, text: string, opts?: { disabled?: boolean; title?: string }): React.JSX.Element => (
    <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: opts?.disabled ? 'default' : 'pointer', marginBottom: 7, opacity: opts?.disabled ? 0.45 : 1 }} title={opts?.title}>
      <input type="checkbox" checked={on} disabled={opts?.disabled || !!busy} onChange={(e) => set(e.target.checked)} />
      <span style={{ fontSize: 12 }}>{text}</span>
    </label>
  )
  return (
    <Modal title="Clip Speed / Duration" width={380} onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 12px' }}>
        <div style={{ flex: 1 }}>
          <div style={row}>
            <span style={lbl}>Speed:</span>
            <input aria-label="Speed percent" type="number" min={SPEED_MIN * 100} max={SPEED_MAX * 100} step={1} value={speed} disabled={!!busy || allRemap} title={allRemap ? remapWhy : undefined} onChange={(e) => onSpeed(e.target.value)} style={{ ...ctl, width: 70 }} />
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>%</span>
          </div>
          <div style={{ ...row, marginBottom: 0 }}>
            <span style={lbl}>Duration:</span>
            <input aria-label="Duration" value={dur} disabled={!!busy || !!first?.useRecipe || allRemap} onChange={(e) => onDur(e.target.value)} style={{ ...ctl, width: 110, fontFamily: 'var(--mono)' }} title={allRemap ? remapWhy : first?.useRecipe ? 'a storyboard block runs its recipe length — only its speed changes' : 'timecode or seconds'} />
          </div>
        </div>
        {/* the chain: speed and duration move together (on) or apart (off: the out-point moves) */}
        <div style={{ alignSelf: 'stretch', width: 10, border: '1px solid var(--line2)', borderLeft: 'none', borderRadius: '0 4px 4px 0', margin: '10px 0' }} />
        <button
          className="btn vd-hbtn"
          aria-label={linked ? 'speed and duration linked' : 'speed and duration unlinked'}
          aria-pressed={linked}
          title={linked ? 'linked: changing one changes the other · click to unlink' : 'unlinked: speed keeps the duration (the out-point moves) · click to link'}
          disabled={!!busy}
          onClick={() => setLinked((v) => !v)}
          style={{ padding: '4px 6px' }}
        >
          <Ic i={linked ? Link2 : Link2Off} size={14} />
        </button>
      </div>
      {check(reverse, setReverse, 'Reverse Speed', allRemap ? { disabled: true, title: remapWhy } : reversible ? undefined : { disabled: true, title: 'a nest or a storyboard block can’t play reversed yet — a rendered take can' })}
      {nRemap > 0 && (
        <p data-remapnote style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 8px' }}>
          {allRemap ? 'Time remapping is on: the speed line on the block sets its speed. Pitch and Time Interpolation still apply.' : `${nRemap} of these blocks ${nRemap === 1 ? 'is' : 'are'} time-remapped: ${nRemap === 1 ? 'it keeps its' : 'they keep their'} speed line${nRemap === 1 ? '' : 's'}.`}
        </p>
      )}
      {check(keepPitch, setKeepPitch, 'Maintain Audio Pitch', { title: 'on: the sound keeps its pitch at any speed · off: the pitch follows the speed, like tape' })}
      {check(ripple, setRipple, 'Ripple Edit, Shifting Trailing Clips', { title: 'on: everything after the clip moves with its new length · off: the clip only grows into free room' })}
      <div style={{ ...row, marginTop: 10 }}>
        <span style={{ fontSize: 12 }}>Time Interpolation:</span>
        <Dropdown
          value={interp}
          options={[
            { value: 'sample', label: 'Frame Sampling' },
            { value: 'blend', label: 'Frame Blending', title: 'blends neighbouring frames when the speed changes (shows in the export)' },
            { value: 'flow', label: 'Optical Flow', title: 'a slowed block plays a copy of its take with the frames between made by an interpolation model — OK opens ENHANCE on the take when no copy has them yet' }
          ]}
          onChange={setInterp}
          disabled={!!busy}
          style={{ flex: 1 }}
        />
      </div>
      {error && <p role="alert" style={{ color: 'var(--bad)', fontSize: 12, margin: '8px 0 0' }}>{error}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
        <button type="button" className="btn vd-hbtn" disabled={!!busy} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn" disabled={!!busy || !items.length} onClick={() => void run()}>
          {busy ?? 'OK'}
        </button>
      </div>
    </Modal>
  )
}
