import { useEffect, useState } from 'react'
import { EmptyState } from '../ui/EmptyState'
import { useStore } from '../store'
import { activeTimeline, buildSegs } from '../lib/timelineUtils'
import { smpte } from '../lib/time'
import { ctl } from '../ui/controls'
import { Ic, Upload } from '../ui/icons'

// the timeline's canvas — clips that don't match auto-FILL centered (cropped), per design
const ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']

// ---- Timeline Editor: settings for the ACTIVE timeline (sibling of the Clip Editor) ----
// opens when a timeline is double-clicked in the Bin; starts with name + aspect ratio.
export function TimelineEditorPanel(): React.JSX.Element {
  const project = useStore((s) => s.project)
  const renameTimeline = useStore((s) => s.renameTimeline)
  const setTimelineAspect = useStore((s) => s.setTimelineAspect)
  const setTimelineExportPrefs = useStore((s) => s.setTimelineExportPrefs)
  const startExport = useStore((s) => s.startExport)
  const exportState = useStore((s) => s.exportState)
  const tl = activeTimeline(project)

  // name edits commit on blur/Enter (same pattern as the Clip Editor's clip name)
  const [name, setName] = useState(tl?.name ?? '')
  useEffect(() => {
    setName(tl?.name ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tl?.id, tl?.name])
  const commitName = (): void => {
    if (tl && name.trim() && name.trim() !== tl.name) void renameTimeline(tl.id, name.trim())
  }

  if (!project) {
    return <EmptyState>open a project to edit its timelines</EmptyState>
  }
  if (!tl) {
    return (
      <EmptyState>
        no timeline open — pick one on the Bin&apos;s timeline strip
        <br />
        <span className="btn vd-hbtn" style={{ marginTop: 8, display: 'inline-block' }} onClick={() => void useStore.getState().addTimeline()}>
          ＋ new timeline
        </span>
      </EmptyState>
    )
  }

  const { total } = buildSegs(tl.items, project.clips)

  return (
    <div className="vd-panel vd-scroll vd-inspector">
      <div className="field">
        <div className="lb">timeline name</div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && commitName()}
          placeholder="timeline name"
          style={{ ...ctl, width: '100%' }}
        />
      </div>

      <div className="field">
        <div className="lb">aspect ratio — the canvas every clip renders into</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ASPECTS.map((a) => (
            <span
              key={a}
              className={'vd-slot' + (tl.aspectRatio === a ? ' filled' : '')}
              onClick={() => void setTimelineAspect(tl.id, a)}
              title={`set the timeline canvas to ${a}`}
            >
              {a}
            </span>
          ))}
        </div>
        <p className="vd-hint" style={{ marginTop: 6 }}>
          clips that don’t match the canvas are auto-filled centered (edges crop) in the Timeline Monitor.
        </p>
      </div>

      <div className="field" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
        <div className="lb">export — mp4 (H.264 + AAC) of this timeline</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 9.5, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: 1 }}>res</span>
          {(['480', '720', '1080'] as const).map((r) => (
            <span
              key={r}
              className={'vd-slot' + ((tl.exportRes ?? '1080') === r ? ' filled' : '')}
              onClick={() => void setTimelineExportPrefs(tl.id, { exportRes: r })}
              title={`${r}p tier (the shorter side of the output)`}
            >
              {r}p
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 9.5, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: 1 }}>fps</span>
          {(['auto', '24', '30'] as const).map((f) => (
            <span
              key={f}
              className={'vd-slot' + ((tl.exportFps ?? 'auto') === f ? ' filled' : '')}
              onClick={() => void setTimelineExportPrefs(tl.id, { exportFps: f })}
              title={f === 'auto' ? 'use the first rendered clip’s frame rate' : `${f} fps`}
            >
              {f}
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 9.5, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: 1 }}>quality</span>
          {(['draft', 'standard', 'high'] as const).map((q) => (
            <span
              key={q}
              className={'vd-slot' + ((tl.exportQuality ?? 'standard') === q ? ' filled' : '')}
              onClick={() => void setTimelineExportPrefs(tl.id, { exportQuality: q })}
              title={q === 'draft' ? 'fast check-cut encode' : q === 'high' ? 'slow + cleanest (bigger file)' : 'the default balance'}
            >
              {q}
            </span>
          ))}
        </div>
        <span
          className="btn vd-hbtn"
          style={{ opacity: exportState.busy || tl.items.length === 0 ? 0.5 : 1, pointerEvents: exportState.busy ? 'none' : undefined }}
          onClick={() => tl.items.length > 0 && void startExport(tl.id)}
          title="render this timeline to an mp4 (clips + storyboard frames + music, mutes respected)"
        >
          <Ic i={Upload} /> export mp4
        </span>
        {exportState.msg && (
          <div
            onClick={() => exportState.file && void window.vidancer.revealFile(exportState.file)}
            title={exportState.file ? 'click to show the exported file in Explorer' : undefined}
            style={{
              marginTop: 6,
              fontSize: 10.5,
              fontFamily: 'var(--mono)',
              color: exportState.msg.startsWith('export error') ? 'var(--bad)' : 'var(--amber)',
              wordBreak: 'break-all',
              cursor: exportState.file ? 'pointer' : undefined,
              textDecoration: exportState.file ? 'underline' : undefined
            }}
          >
            {exportState.msg}
            {exportState.file ? ' — show file' : ''}
          </div>
        )}
        <p className="vd-hint" style={{ marginTop: 6 }}>
          storyboard / C blocks export as their beat reference frames — exactly what the Monitor shows.
        </p>
      </div>

      <div className="field" style={{ fontSize: 11, color: 'var(--muted)', borderTop: '1px solid var(--line)', paddingTop: 8 }}>
        <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)', marginBottom: 4 }}>details</div>
        <div>
          {tl.items.length} clip{tl.items.length === 1 ? '' : 's'} · {smpte(total)} total
        </div>
        <div style={{ color: 'var(--dim)', marginTop: 2 }}>this timeline is the one showing in the Timeline panel</div>
      </div>
    </div>
  )
}
