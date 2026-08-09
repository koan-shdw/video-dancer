// Clip Edit — non-destructive vid2vid (Gemini Omni Flash /edit). Works on a SOURCE take, never
// mutates it: the first successful generation forks a new "edit clip" into the Bin (draft until
// then — sliding the window and typing cost nothing), and every generation after that stacks a
// take on it, exactly like Clip Gen re-rolls. The panel never touches the timeline; splicing an
// edit in is the user's move with the existing slice + take-picker tools.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { mediaUrl } from '../media'
import { smpte } from '../lib/time'
import { toast } from '../ui/Toast'
import { MODELS, modelFor } from '../../../shared/models'
import { openClipEdit } from '../panelBus'
import { ResizeHandle } from '../ui/ResizeHandle'
import type { EngineId } from '../../../shared/types'

const V2V_ENGINES = Object.values(MODELS).filter((m) => m.v2v)

export function ClipEditPanel(): React.JSX.Element {
  const project = useStore((s) => s.project)
  const target = useStore((s) => s.editTarget)
  const setEditTarget = useStore((s) => s.setEditTarget)
  const setKeeper = useStore((s) => s.setKeeper)
  const reportTakeDuration = useStore((s) => s.reportTakeDuration)

  const [engine, setEngine] = useState<EngineId>(V2V_ENGINES[0]?.id ?? 'omniflash')
  const [prompt, setPrompt] = useState('')
  const [inS, setInS] = useState(0)
  const [outS, setOutS] = useState(0)
  const [srcDur, setSrcDur] = useState(0) // learned from take.durationSec or video metadata
  const [status, setStatus] = useState('idle')
  const [viewTakeId, setViewTakeId] = useState<string | null>(null) // null = previewing the source
  const [playing, setPlaying] = useState(false)
  const vidRef = useRef<HTMLVideoElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const pvBoxRef = useRef<HTMLDivElement>(null) // preview box — drag-resize clamps against its scroll parent
  const previewH = useStore((s) => s.previewH.clipEdit)
  const setPreviewH = useStore((s) => s.setPreviewH)

  const caps = modelFor(engine).v2v

  // resolve what we're working on: a bound edit clip, or a draft over a source take
  const bound = target?.clipId ? project?.clips.find((c) => c.id === target.clipId) : undefined
  const sourceRef = bound?.promptData.sourceVideo ?? target?.source
  const srcClip = sourceRef ? project?.clips.find((c) => c.id === sourceRef.clipId) : undefined
  const srcTake = srcClip?.takes.find((t) => t.id === sourceRef?.takeId)
  // an edit clip outlives its source clip: fall back to the recipe's pinned (project-relative)
  // path. Forward slash — Windows accepts it and macOS needs it (media:// resolves both).
  const boundSv = bound?.promptData.sourceVideo
  const srcFile = srcTake?.file ?? (boundSv?.file && project ? `${project.dir}/${boundSv.file}` : undefined)

  // a first gen binds the draft to the clip it just created — that targetKey change must NOT
  // re-run the reset effect (it would wipe a prompt tweak typed during the render + the ✓ status)
  const justBoundRef = useRef<string | null>(null)

  // (re)load panel state when the target changes — draft window prefills from the timeline trims,
  // a bound clip from its frozen recipe. The window is part of the key: ⑂ on a second slot of the
  // SAME clip+take (different trims) must reload.
  const targetKey = `${target?.clipId ?? ''}|${target?.source?.clipId ?? ''}|${target?.source?.takeId ?? ''}|${target?.source?.inSec ?? ''}|${target?.source?.outSec ?? ''}`
  useEffect(() => {
    if (target?.clipId && target.clipId === justBoundRef.current) {
      justBoundRef.current = null
      return
    }
    skipSaveRef.current = true // the load below must not autosave itself back
    setPrompt(bound?.promptData.freeform ?? '')
    setViewTakeId(bound?.keeperTakeId ?? null)
    setStatus('idle')
    setPlaying(false)
    const known = srcTake?.durationSec ?? 0
    setSrcDur(known)
    // timeline trims outlive take swaps, so the prefilled window can exceed THIS take — clamp
    let wantIn = sourceRef?.inSec ?? 0
    let wantOut = sourceRef?.outSec ?? (known > 0 ? Math.min(known, wantIn + (caps?.maxInSec ?? 10)) : 0)
    if (known > 0) {
      wantOut = Math.min(wantOut, known)
      wantIn = Math.min(wantIn, Math.max(0, wantOut - 0.25))
    }
    setInS(wantIn)
    setOutS(wantOut)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey])

  // source length can be unknown (durationSec not yet learned) — read it from the file's metadata
  const learnDur = (d: number): void => {
    if (!(d > 0) || srcDur > 0) return
    setSrcDur(d)
    setOutS((o) => (o > 0 ? Math.min(o, d) : Math.min(d, inS + (caps?.maxInSec ?? 10))))
    setInS((i) => Math.min(i, Math.max(0, d - 0.25)))
    if (srcClip && srcTake) reportTakeDuration(srcClip.id, srcTake.id, d)
  }

  // completion watcher: edits run through the QUEUE (progress lives in the Queue panel). When a
  // job for the clip this panel is showing finishes, surface its fresh take.
  const queue = useStore((s) => s.queue)
  useEffect(() => {
    const job = queue.find((j) => j.kind === 'edit' && j.status === 'done' && !j.consumed)
    if (!job) return
    useStore.getState().consumeJob(job.id)
    const p = job.payload as EditArgs
    if (p.clipId && p.clipId === target?.clipId) {
      if (job.resultTakeId) setViewTakeId(job.resultTakeId)
      setStatus('done ✓')
    }
    // jobs for clips the panel moved on from: consumed above, the take is safe in the Bin
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue])

  // bound clips autosave their recipe (prompt + window) like Clip Gen does — a shutdown mid-think
  // loses nothing. skipSaveRef swallows the save the reset effect's own load would trigger.
  const saveTimer = useRef<number | undefined>(undefined)
  const skipSaveRef = useRef(true)
  useEffect(() => {
    if (!bound) return
    if (skipSaveRef.current) {
      skipSaveRef.current = false
      return
    }
    window.clearTimeout(saveTimer.current)
    const b = bound
    saveTimer.current = window.setTimeout(() => {
      const sv = b.promptData.sourceVideo
      if (!sv) return
      const patch: Partial<PromptData> = {
        freeform: prompt,
        sourceVideo: {
          ...sv,
          ...(inS > 0.01 ? { inSec: inS } : { inSec: undefined }),
          ...(srcDur <= 0 || outS < srcDur - 0.01 ? { outSec: outS } : { outSec: undefined })
        }
      }
      void window.vidancer.clipSetPromptData(b.id, patch).then((d) => d && useStore.getState().applyDelta(d))
    }, 600)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt, inS, outS])

  const minSpan = Math.max(0.25, caps?.minInSec ?? 0.25)
  const maxSpan = caps?.maxInSec ?? 10
  const span = Math.max(0, outS - inS)
  const overMax = span > maxSpan + 0.001
  const est = caps ? span * (caps.pricePerSecIn + caps.pricePerSecOut) : 0

  // ---- window bar: drag handles to trim, drag the middle to SLIDE the window ----
  const onBarDrag = (kind: 'in' | 'out' | 'slide', e: React.MouseEvent): void => {
    e.preventDefault()
    const bar = barRef.current
    if (!bar || srcDur <= 0) return
    const secPerPx = srcDur / bar.getBoundingClientRect().width
    const startX = e.clientX
    const i0 = inS
    const o0 = outS
    const move = (ev: MouseEvent): void => {
      const d = (ev.clientX - startX) * secPerPx
      if (kind === 'in') {
        // in edge: clamp to [0, out-minSpan], and never widen past maxSpan
        setInS(Math.max(Math.max(0, o0 - maxSpan), Math.min(o0 - minSpan, i0 + d)))
      } else if (kind === 'out') {
        setOutS(Math.min(Math.min(srcDur, i0 + maxSpan), Math.max(i0 + minSpan, o0 + d)))
      } else {
        const w = o0 - i0
        const ni = Math.max(0, Math.min(srcDur - w, i0 + d))
        setInS(ni)
        setOutS(ni + w)
      }
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const viewTake = viewTakeId && bound ? bound.takes.find((t) => t.id === viewTakeId) : undefined
  const previewFile = viewTake?.file ?? srcFile
  const previewIsSource = !viewTake

  const togglePlay = (): void => {
    const v = vidRef.current
    if (!v) return
    if (v.paused) {
      if (previewIsSource && (v.currentTime < inS || v.currentTime > outS - 0.05)) v.currentTime = inS
      void v.play()
    } else v.pause()
  }

  const run = async (): Promise<void> => {
    if (!sourceRef) return
    if (!prompt.trim()) {
      toast('write the instruction first', { kind: 'error' })
      return
    }
    if (srcDur > 0 && overMax) {
      toast(`window is ${span.toFixed(1)}s — ${modelFor(engine).label} accepts at most ${maxSpan}s`, { kind: 'error' })
      return
    }
    // send a window when it's a real sub-range — including when the source duration hasn't been
    // learned yet (the panel SHOWS a window, so silently editing the whole source would be wrong)
    const sendWindow = srcDur > 0 ? inS > 0.01 || outS < srcDur - 0.01 : outS > inS
    const source = {
      clipId: sourceRef.clipId,
      takeId: sourceRef.takeId,
      ...(sendWindow ? { inSec: inS, outSec: outS } : {})
    }
    // Generate COMMITS the fork: the edit clip (recipe + window, no takes) hits the Bin and disk
    // right now — instant feedback, and a shutdown mid-render loses nothing re-runnable
    let clipId = bound?.id
    if (!clipId) {
      const created = await window.vidancer.editCreateClip({ engine, prompt: prompt.trim(), source })
      if (!created) {
        toast('could not create the edit clip — source take missing?', { kind: 'error' })
        return
      }
      useStore.getState().applyDelta(created.delta)
      clipId = created.clipId
      justBoundRef.current = created.clipId // keep the typed prompt through the rebind
      setEditTarget({ clipId: created.clipId })
    }
    useStore.getState().enqueueRender({
      kind: 'edit',
      label: bound?.name ?? `${srcClip?.name ?? 'source'} · edit`,
      thumbVideo: srcFile,
      thumbSeek: inS,
      engineLabel: modelFor(engine).label,
      estCost: est > 0 ? est : undefined,
      payload: { engine, prompt: prompt.trim(), clipId, source }
    })
    setStatus('queued → watch the Queue panel')
  }

  const rename = async (name: string): Promise<void> => {
    if (!bound || !name.trim()) return
    useStore.getState().applyDelta(await window.vidancer.clipRename(bound.id, name.trim()))
  }

  if (!sourceRef) {
    return (
      <div className="vd-panel vd-scroll" style={{ padding: 14, color: 'var(--dim)', fontSize: 12, lineHeight: 1.6 }}>
        <b style={{ color: 'var(--muted)' }}>Clip Edit — change a video with words (v2v)</b>
        <br />
        Pick a take to edit: ⑂ on a take in Clip Gen, or ⑂ on a timeline block.
        <br />
        Nothing is created in the Bin until the first generation succeeds.
      </div>
    )
  }

  const winL = srcDur > 0 ? (inS / srcDur) * 100 : 0
  const winW = srcDur > 0 ? (span / srcDur) * 100 : 100

  return (
    <div className="vd-panel vd-scroll" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
      {/* header: clip name (bound) or draft note */}
      {bound ? (
        <input
          defaultValue={bound.name}
          key={bound.id}
          onBlur={(e) => void rename(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          style={{ background: 'transparent', border: 'none', borderBottom: '1px solid var(--line)', color: 'var(--txt-hi)', fontSize: 13, fontWeight: 600, padding: '2px 0', outline: 'none' }}
        />
      ) : (
        <div style={{ fontSize: 11, color: 'var(--amber)', border: '1px dashed var(--amber-dim)', borderRadius: 6, padding: '5px 8px' }}>
          draft — <b>{srcClip?.name ?? 'source'}</b> is untouched; hitting Generate forks a new ⑂ edit clip into the Bin
        </div>
      )}

      {/* source line */}
      <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
        source: <b style={{ color: 'var(--txt-hi)' }}>{srcClip?.name ?? '(deleted clip — file pinned)'}</b>
        {srcClip && (
          <span
            className="btn vd-hbtn"
            onClick={() => useStore.getState().selectClip(srcClip.id)}
            title="select the source clip in the Bin"
          >
            go to source
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', color: 'var(--dim)' }}>{srcDur > 0 ? smpte(srcDur) : '…'}</span>
      </div>

      {/* preview */}
      <div ref={pvBoxRef} style={{ position: 'relative', background: '#000', borderRadius: 6, overflow: 'hidden', minHeight: 120, height: previewFile ? previewH : undefined, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {previewFile && (
          <video
            ref={vidRef}
            key={previewFile}
            src={mediaUrl(previewFile)}
            onClick={togglePlay}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onLoadedMetadata={(e) => {
              if (previewIsSource) learnDur(e.currentTarget.duration)
              else if (bound && viewTake && e.currentTarget.duration > 0) reportTakeDuration(bound.id, viewTake.id, e.currentTarget.duration)
            }}
            onTimeUpdate={(e) => {
              // previewing the source loops inside the chosen window — that's what gets edited
              const v = e.currentTarget
              if (previewIsSource && !v.paused && srcDur > 0 && v.currentTime > outS - 0.03) v.currentTime = inS
            }}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block', cursor: 'pointer' }}
          />
        )}
        <span style={{ position: 'absolute', top: 6, left: 8, fontSize: 10, fontFamily: 'var(--mono)', color: '#fff', background: 'rgba(0,0,0,.55)', padding: '2px 6px', borderRadius: 4, pointerEvents: 'none' }}>
          {previewIsSource ? 'source' : `take ${bound ? bound.takes.findIndex((t) => t.id === viewTakeId) + 1 : ''}`}
          {!playing ? ' · click to play' : ''}
        </span>
        {!previewIsSource && (
          <span className="btn vd-hbtn" style={{ position: 'absolute', top: 4, right: 6 }} onClick={() => setViewTakeId(null)}>
            view source
          </span>
        )}
      </div>
      {previewFile && (
        <ResizeHandle
          value={previewH}
          maxOf={() => {
            const sc = pvBoxRef.current?.closest('.vd-scroll') as HTMLElement | null
            return (sc?.clientHeight ?? 640) - 60
          }}
          onChange={(h) => setPreviewH('clipEdit', h)}
        />
      )}

      {/* window bar — only meaningful on the source */}
      <div>
        <div style={{ fontSize: 10, color: 'var(--dim)', marginBottom: 3, display: 'flex' }}>
          <span>
            window {smpte(inS)} → {smpte(outS)} ({span.toFixed(1)}s{srcDur > 0 && srcDur > maxSpan ? ` of ${srcDur.toFixed(1)}s` : ''})
          </span>
          {overMax && <span style={{ color: 'var(--bad)', marginLeft: 8 }}>max {maxSpan}s</span>}
          <span style={{ marginLeft: 'auto' }}>drag edges to trim · drag middle to slide</span>
        </div>
        <div ref={barRef} style={{ position: 'relative', height: 22, background: 'var(--bg0)', border: '1px solid var(--line)', borderRadius: 4 }}>
          <div
            onMouseDown={(e) => onBarDrag('slide', e)}
            style={{ position: 'absolute', top: 0, bottom: 0, left: `${winL}%`, width: `${winW}%`, background: overMax ? 'color-mix(in srgb, var(--bad) 30%, transparent)' : 'color-mix(in srgb, var(--amber) 25%, transparent)', border: `1px solid ${overMax ? 'var(--bad)' : 'var(--amber)'}`, borderRadius: 3, cursor: 'grab' }}
          />
          <div onMouseDown={(e) => onBarDrag('in', e)} style={{ position: 'absolute', top: 0, bottom: 0, left: `calc(${winL}% - 3px)`, width: 7, cursor: 'ew-resize', background: 'var(--amber)', borderRadius: 2 }} />
          <div onMouseDown={(e) => onBarDrag('out', e)} style={{ position: 'absolute', top: 0, bottom: 0, left: `calc(${winL + winW}% - 3px)`, width: 7, cursor: 'ew-resize', background: 'var(--amber)', borderRadius: 2 }} />
        </div>
      </div>

      {/* edit instruction */}
      <div>
        <div className="lb" style={{ marginBottom: 3 }}>
          edit instruction <span style={{ color: 'var(--dim)' }}>— words only ({modelFor(engine).label} takes no refs or masks)</span>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={'Remove the ball. Keep everything else the same.'}
          rows={3}
          style={{ width: '100%', background: 'var(--field)', color: 'var(--txt-hi)', border: '1px solid var(--line2)', borderRadius: 5, padding: '7px 9px', fontSize: 12, resize: 'vertical' }}
        />
        {caps && <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>{caps.promptHint}</div>}
      </div>

      {/* engine (only shown once there's a choice) + render bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {V2V_ENGINES.length > 1 && (
          <select value={engine} onChange={(e) => setEngine(e.target.value as EngineId)} style={{ background: 'var(--field)', color: 'var(--txt-hi)', border: '1px solid var(--line2)', borderRadius: 5, fontSize: 11, padding: '4px 6px' }}>
            {V2V_ENGINES.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        )}
        <span className="btn" onClick={() => void run()}>
          ▶ Generate edit
        </span>
        {est > 0 && <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }} title="output + input video tokens">~${est.toFixed(2)}</span>}
        <span style={{ fontSize: 11, color: status.startsWith('error') ? 'var(--bad)' : 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{status}</span>
      </div>

      {/* takes — same grammar as Clip Gen: click = view, ★ = keeper, ⑂ = edit this take further */}
      {bound && bound.takes.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {bound.takes.map((t, i) => (
            <span
              key={t.id}
              className={'vd-slot' + (t.id === viewTakeId ? ' filled' : '')}
              onClick={() => setViewTakeId(t.id)}
              title={`view take ${i + 1}${t.id === bound.keeperTakeId ? ' (keeper)' : ''}${t.disabled ? ' (disabled)' : ''} · double-click = make keeper`}
              onDoubleClick={() => void setKeeper(bound.id, t.id)}
              style={t.disabled ? { opacity: 0.45 } : undefined}
            >
              T{i + 1}
              {t.id === bound.keeperTakeId ? ' ★' : ''}
            </span>
          ))}
          {viewTake && (
            <span
              className="btn vd-hbtn"
              title="fork again: edit THIS take further (a new draft — nothing created until it generates)"
              onClick={() => {
                setEditTarget({ source: { clipId: bound.id, takeId: viewTake.id } })
                openClipEdit()
              }}
            >
              ⑂ edit this take
            </span>
          )}
        </div>
      )}
    </div>
  )
}
