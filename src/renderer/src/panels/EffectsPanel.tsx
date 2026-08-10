// EFFECTS — the per-block effects panel, Premiere grammar:
//   transform — PINNED on top, always visible, never "added" (like Premiere's Motion)
//   blend     — mode + opacity, how the block meets the layers below
//   effects   — chips add modules; added rows stack here and DRAG to reorder (drag = move, the law)
// Every slider has a ↺, every section has a ↺, the panel has a ↺ for the whole block.
// Follows the selected timeline block. Controls write an instant fxDraft (the Monitor previews it
// live) and a debounced commit through the whole-array timeline write.
//
// Data mapping: the pinned transform is stored as the LAST stack entry (type 'transform') — the
// AE order: effects run first, transform last, blend at combine. The effects list is every entry
// before it. Registry-driven: a new effect module needs ZERO edits here.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { activeItems, resolveView } from '../lib/timelineUtils'
import { allEffects, getEffect } from '../fx/core/registry'
import { sidecarsOf, invalidateSidecars } from '../fx/fxUtils'
import { runPass, cancelPass } from '../fx/passRunner'
import '../fx/effects'
import { BLEND_MODES, type FxEntry, type FxParamSpec } from '../fx/core/types'
import { emptyFx2, freshEntryId, packFx2, readFx2, type FxV2 } from '../fx/fxData'
import { Section } from '../ui/Section'
import { ctl } from '../ui/controls'

const fmtVal = (spec: FxParamSpec, v: number): string => {
  if (spec.fmt === 'toggle') return v >= 0.5 ? 'on' : 'off'
  if (spec.fmt === 'deg') return `${v.toFixed(0)}°`
  if (spec.fmt === 'pct') return spec.max <= 4 ? `${Math.round(v * 100)}%` : `${v.toFixed(0)}%`
  return String(Math.round(v * 100) / 100)
}

const resetBtn: React.CSSProperties = { background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontSize: 11, padding: '0 2px', lineHeight: 1 }

function ParamRow(props: { spec: FxParamSpec; value: number; onChange: (v: number) => void }): React.JSX.Element {
  const { spec, value } = props
  const dirty = value !== spec.def
  if (spec.fmt === 'toggle') {
    const on = value >= 0.5
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span className="lb" style={{ width: 52, marginBottom: 0 }}>{spec.label}</span>
        <button
          style={{ ...ctl, flex: 1, cursor: 'pointer', color: on ? 'var(--amber)' : undefined, borderColor: on ? 'var(--amber)' : undefined }}
          title={spec.hint ?? `${spec.label} · click flips`}
          onClick={() => props.onChange(on ? 0 : 1)}
        >
          {fmtVal(spec, value)}
        </button>
        <span style={{ width: 44 }} />
        <button style={{ ...resetBtn, visibility: dirty ? 'visible' : 'hidden' }} title={`reset ${spec.label}`} onClick={() => props.onChange(spec.def)}>
          ↺
        </button>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
      <span className="lb" style={{ width: 52, marginBottom: 0 }}>{spec.label}</span>
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        onChange={(e) => props.onChange(parseFloat(e.target.value))}
        onDoubleClick={() => props.onChange(spec.def)}
        title={`${spec.label} · drag sets · double-click resets`}
        style={{ flex: 1, accentColor: 'var(--amber)' }}
      />
      <span style={{ width: 44, textAlign: 'right', fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
        {fmtVal(spec, value)}
      </span>
      <button style={{ ...resetBtn, visibility: dirty ? 'visible' : 'hidden' }} title={`reset ${spec.label}`} onClick={() => props.onChange(spec.def)}>
        ↺
      </button>
    </div>
  )
}

// The stored stack's canonical order: [creative effects…, mask?, transform?]. Mask and transform
// are PINNED sections in the panel, stored as tail entries so the chain runs them after the
// creative stack (a gridded block masks per tile — aux rides the chain) and moves the masked
// result last. splitStack peels the pinned tail; joinStack rebuilds it, dropping neutral pins so
// untouched blocks stay byte-identical.
type MaskState = { source: 'off' | 'subject' | 'depth'; params: Record<string, number> }
const splitStack = (fx: FxV2): { effects: FxEntry[]; mask: MaskState; transform: Record<string, number> } => {
  let rest = fx.stack
  let transform: Record<string, number> = {}
  let mask: MaskState = { source: 'off', params: {} }
  const last = rest[rest.length - 1]
  if (last && last.type === 'transform') {
    transform = last.params
    rest = rest.slice(0, -1)
  }
  const m = rest[rest.length - 1]
  if (m && (m.type === 'maskSubject' || m.type === 'maskDepth')) {
    mask = { source: m.type === 'maskSubject' ? 'subject' : 'depth', params: m.params }
    rest = rest.slice(0, -1)
  }
  return { effects: rest, mask, transform }
}
const joinStack = (effects: FxEntry[], mask: MaskState, transform: Record<string, number>): FxEntry[] => {
  const out = [...effects]
  if (mask.source !== 'off') out.push({ id: 'pinned-mask', type: mask.source === 'subject' ? 'maskSubject' : 'maskDepth', params: mask.params })
  const mod = getEffect('transform')
  const dirty = !!mod && mod.params.some((s) => (transform[s.key] ?? s.def) !== s.def)
  if (dirty) out.push({ id: 'pinned-transform', type: 'transform', params: transform })
  return out
}

export function EffectsPanel(): React.JSX.Element {
  const project = useStore((s) => s.project)
  const selId = useStore((s) => s.selectedTlItemId)
  const item = useMemo(() => (project && selId ? activeItems(project).find((it) => it.id === selId) ?? null : null), [project, selId])

  // working copy — reseeded when the target block changes or undo/redo rewrites the project
  const [fx, setFx] = useState<FxV2>(emptyFx2())
  const seededFor = useRef<string | null>(null)
  const undoTick = useStore((s) => s.undoTick)
  const lastUndoTick = useRef(undoTick)
  useEffect(() => {
    if (!item) {
      seededFor.current = null
      return
    }
    if (seededFor.current === item.id && undoTick === lastUndoTick.current) return
    if (undoTick !== lastUndoTick.current)
      cancelPending() // undo wins — a zombie commit would re-apply the undone values
    else if (seededFor.current && seededFor.current !== item.id)
      flushPending() // switching blocks — the previous block's last edit must not be dropped
    seededFor.current = item.id
    lastUndoTick.current = undoTick
    setFx(readFx2(item) ?? emptyFx2())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, undoTick])

  // instant draft for the Monitor + debounced persist (house rhythm: one write per drag, not per
  // tick). The pending edit is FLUSHED — never dropped — when the target changes or the panel
  // closes; it is CANCELLED only by undo, where the restored state must win.
  const commitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pending = useRef<{ id: string; fx: FxV2 } | null>(null)
  const flushPending = (): void => {
    clearTimeout(commitTimer.current)
    const p = pending.current
    pending.current = null
    if (p) void useStore.getState().commitItemFx(p.id, p.fx)
  }
  const cancelPending = (): void => {
    clearTimeout(commitTimer.current)
    pending.current = null
    useStore.getState().setFxDraft(null)
  }
  const apply = (next: FxV2): void => {
    if (!item) return
    setFx(next)
    useStore.getState().setFxDraft({ itemId: item.id, fx: packFx2(next) ?? null })
    clearTimeout(commitTimer.current)
    pending.current = { id: item.id, fx: next }
    commitTimer.current = setTimeout(() => {
      pending.current = null
      void useStore.getState().commitItemFx(item.id, next)
    }, 400)
  }
  useEffect(() => flushPending, []) // unmount: the last edit must reach the project file

  // drag = move: the effects rows reorder by dragging the row itself (app grammar, no arrows)
  const dragId = useRef<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)

  // the AI data layer for this block's take: existence of the sidecar files + the running pass
  const clip = useMemo(() => (project && item ? project.clips.find((c) => c.id === item.clipId) ?? null : null), [project, item])
  const takeFile = clip && item ? resolveView(clip, item).take?.file : undefined
  const [sidecars, setSidecars] = useState<{ matte?: string; depth?: string } | null>(null)
  const fxJob = useStore((s) => s.fxJob)
  useEffect(() => {
    setSidecars(null)
    if (takeFile) void sidecarsOf(takeFile).then(setSidecars)
  }, [takeFile])
  const generatePass = async (kind: 'matte' | 'depth'): Promise<void> => {
    if (!takeFile) return
    await runPass(takeFile, kind)
    invalidateSidecars(takeFile)
    void sidecarsOf(takeFile).then(setSidecars)
  }

  if (!item)
    return (
      <div className="vd-panel vd-scroll" style={{ padding: 10 }}>
        <div className="vd-subbin">effects</div>
        <div className="vd-hint">select a block on the timeline · right-click a block → effects</div>
      </div>
    )

  const blend = { mode: fx.blend?.mode ?? ('normal' as const), opacity: fx.blend?.opacity ?? 1 }
  const { effects, mask, transform } = splitStack(fx)
  const tMod = getEffect('transform')
  const maskMod = mask.source !== 'off' ? getEffect(mask.source === 'subject' ? 'maskSubject' : 'maskDepth') : undefined
  const applyParts = (nextEffects: FxEntry[], nextMask: MaskState, nextTransform: Record<string, number>): void =>
    apply({ ...fx, stack: joinStack(nextEffects, nextMask, nextTransform) })

  const dropOn = (targetId: string | null): void => {
    const from = dragId.current
    dragId.current = null
    setDragOver(null)
    if (!from || from === targetId) return
    const cur = effects.slice()
    const i = cur.findIndex((e) => e.id === from)
    if (i < 0) return
    const [moved] = cur.splice(i, 1)
    const j = targetId ? cur.findIndex((e) => e.id === targetId) : cur.length
    cur.splice(j < 0 ? cur.length : j, 0, moved)
    applyParts(cur, mask, transform)
  }

  return (
    <div
      className="vd-panel vd-scroll"
      style={{ padding: 10 }}
      // controls must RELEASE focus when the pointer lets go — a focused slider/button swallows
      // the global spacebar (the app's key handler rightly ignores keys aimed at inputs) and
      // play/pause silently dies until the user clicks elsewhere. Deferred so click still lands.
      onPointerUpCapture={(e) => {
        const t = e.target as HTMLElement
        const el = t instanceof HTMLInputElement && t.type === 'range' ? t : t.closest('button')
        if (el) window.setTimeout(() => el.blur(), 0)
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
        <span className="vd-subbin" style={{ margin: 0 }}>effects · this block</span>
        <button style={{ ...resetBtn, marginLeft: 'auto', fontSize: 12 }} title="reset everything on this block" onClick={() => apply(emptyFx2())}>
          ↺ all
        </button>
      </div>

      <Section
        title="transform"
        right={
          <button style={resetBtn} title="reset transform" onClick={() => applyParts(effects, mask, {})}>
            ↺
          </button>
        }
      >
        {(tMod?.params ?? []).map((spec) => (
          <ParamRow
            key={spec.key}
            spec={spec}
            value={transform[spec.key] ?? spec.def}
            onChange={(v) => applyParts(effects, mask, { ...transform, [spec.key]: v })}
          />
        ))}
      </Section>

      <Section
        title="mask"
        right={
          <button style={resetBtn} title="reset mask" onClick={() => applyParts(effects, { source: 'off', params: {} }, transform)}>
            ↺
          </button>
        }
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span className="lb" style={{ width: 52, marginBottom: 0 }}>source</span>
          <select
            value={mask.source}
            onChange={(e) => {
              applyParts(effects, { source: e.target.value as MaskState['source'], params: mask.params }, transform)
              e.currentTarget.blur()
            }}
            style={{ ...ctl, flex: 1 }}
            disabled={!takeFile}
            title={takeFile ? 'what cuts this block' : 'storyboard block · no video to analyze'}
          >
            <option value="off">off</option>
            <option value="subject">subject (AI)</option>
            <option value="depth">depth (AI)</option>
          </select>
          <span style={{ width: 18 }} />
        </div>
        {maskMod &&
          maskMod.params.map((spec) => (
            <ParamRow
              key={spec.key}
              spec={spec}
              value={mask.params[spec.key] ?? spec.def}
              onChange={(v) => applyParts(effects, { ...mask, params: { ...mask.params, [spec.key]: v } }, transform)}
            />
          ))}
        {/* the DATA layer: generated once per take, lives next to the file, every effect can read it */}
        {takeFile ? (
          <div style={{ marginTop: 6, borderTop: '1px solid var(--line)', paddingTop: 6 }}>
            {(['matte', 'depth'] as const).map((kind) => {
              const label = kind === 'matte' ? 'subject data' : 'depth data'
              const have = !!sidecars?.[kind]
              const running = fxJob != null
              return (
                <div key={kind} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span className="lb" style={{ width: 78, marginBottom: 0 }}>{label}</span>
                  {have ? (
                    <span style={{ fontSize: 10, color: 'var(--ok)' }}>✓ generated</span>
                  ) : (
                    <button
                      className="btn vd-hbtn"
                      disabled={running}
                      title={running ? 'one AI pass at a time · wait for the current one' : `analyze this take → ${label} file next to it (first run downloads the model)`}
                      onClick={() => void generatePass(kind)}
                    >
                      generate
                    </button>
                  )}
                </div>
              )
            })}
            {fxJob && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--amber)', fontFamily: 'var(--mono)', marginTop: 2 }}>
                <span>{fxJob.label} · {Math.round(fxJob.pct)}%</span>
                <button style={{ ...resetBtn, fontSize: 10 }} title="cancel this pass · nothing gets saved" onClick={() => cancelPass()}>
                  × cancel
                </button>
              </div>
            )}
            {mask.source === 'subject' && !sidecars?.matte && <div className="vd-hint">mask is on but subject data is missing · generate it above</div>}
            {mask.source === 'depth' && !sidecars?.depth && <div className="vd-hint">mask is on but depth data is missing · generate it above</div>}
          </div>
        ) : (
          <div className="vd-hint">storyboard block · render a take first, then analyze it</div>
        )}
      </Section>

      <Section
        title="blend"
        right={
          <button style={resetBtn} title="reset blend" onClick={() => apply({ ...fx, blend: undefined })}>
            ↺
          </button>
        }
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span className="lb" style={{ width: 52, marginBottom: 0 }}>mode</span>
          <select
            value={blend.mode}
            onChange={(e) => {
              apply({ ...fx, blend: { ...blend, mode: e.target.value as (typeof BLEND_MODES)[number] } })
              e.currentTarget.blur() // hand the spacebar back to the transport
            }}
            style={{ ...ctl, flex: 1 }}
          >
            {BLEND_MODES.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <span style={{ width: 18 }} />
        </div>
        <ParamRow
          spec={{ key: 'opacity', label: 'opacity', min: 0, max: 1, step: 0.01, def: 1, fmt: 'pct' }}
          value={blend.opacity}
          onChange={(v) => apply({ ...fx, blend: { ...blend, opacity: v } })}
        />
        <div className="vd-hint">how this block meets the track below · normal @ 100% = plain cut</div>
      </Section>

      <Section
        title="effects"
        right={
          effects.length > 0 && (
            <button style={resetBtn} title="remove every added effect" onClick={() => applyParts([], mask, transform)}>
              ↺
            </button>
          )
        }
      >
        {effects.length === 0 && <div className="vd-hint" style={{ marginBottom: 6 }}>none yet · add below — drag rows to reorder, top runs first</div>}
        {effects.map((entry) => {
          const mod = getEffect(entry.type)
          return (
            <div
              key={entry.id}
              onDragOver={(e) => {
                e.preventDefault()
                if (dragOver !== entry.id) setDragOver(entry.id)
              }}
              onDragLeave={() => setDragOver((d) => (d === entry.id ? null : d))}
              onDrop={(e) => {
                e.preventDefault()
                dropOn(entry.id)
              }}
              style={{
                border: `1px solid ${dragOver === entry.id ? 'var(--amber)' : 'var(--line)'}`,
                borderRadius: 5,
                background: 'var(--raised)',
                padding: '6px 8px',
                marginBottom: 6
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: mod ? 6 : 0 }}>
                {/* ONLY the handle drags — a draggable row hijacks every slider drag inside it */}
                <span
                  draggable
                  onDragStart={(e) => {
                    dragId.current = entry.id
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', entry.id)
                  }}
                  onDragEnd={() => {
                    dragId.current = null
                    setDragOver(null)
                  }}
                  style={{ color: 'var(--dim)', fontSize: 10, cursor: 'grab', padding: '2px 4px', margin: '-2px 0' }}
                  title="drag to reorder"
                >
                  ⠿
                </span>
                {mod ? (
                  <span style={{ fontSize: 11, color: 'var(--gold)', fontFamily: 'var(--mono)' }}>{mod.label}</span>
                ) : (
                  <span style={{ fontSize: 11, color: 'var(--bad)' }}>unknown effect “{entry.type}”</span>
                )}
                <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 2 }}>
                  {mod && (
                    <button
                      style={resetBtn}
                      title={`reset ${mod.label}`}
                      onClick={() => applyParts(effects.map((e) => (e.id === entry.id ? { ...e, params: {} } : e)), mask, transform)}
                    >
                      ↺
                    </button>
                  )}
                  <button style={resetBtn} title="remove this effect" onClick={() => applyParts(effects.filter((e) => e.id !== entry.id), mask, transform)}>
                    ×
                  </button>
                </span>
              </div>
              {(mod?.params ?? []).map((spec) => (
                <ParamRow
                  key={spec.key}
                  spec={spec}
                  value={entry.params[spec.key] ?? spec.def}
                  onChange={(v) =>
                    applyParts(effects.map((e) => (e.id === entry.id ? { ...e, params: { ...e.params, [spec.key]: v } } : e)), mask, transform)
                  }
                />
              ))}
              {mod?.needs?.depth && !sidecars?.depth && (
                <div className="vd-hint">flat without depth data · generate it in the mask section</div>
              )}
              {mod?.needs?.matte && !sidecars?.matte && (
                <div className="vd-hint">inactive without subject data · generate it in the mask section</div>
              )}
            </div>
          )
        })}
        {/* drop past the last row = send to the end */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            dropOn(null)
          }}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6, paddingTop: 4 }}
        >
          {allEffects()
            .filter((m) => !m.internal)
            .map((m) => (
              <button
                key={m.key}
                className="vd-slot"
                title={`add ${m.label}`}
                style={{ cursor: 'pointer' }}
                onClick={() => applyParts([...effects, { id: freshEntryId(), type: m.key, params: {} }], mask, transform)}
              >
                + {m.chip}
              </button>
            ))}
        </div>
      </Section>
    </div>
  )
}
