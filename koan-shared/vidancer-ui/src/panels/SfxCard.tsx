import { vd } from '../api'
import { useEffect, useRef, useState } from 'react'
import { EmptyState } from '../ui/EmptyState'
import { useStore } from '../store'
import { ctl } from '../ui/controls'
import { audioModelsOf, audioModelFor } from '../shared/audioModels'
import { emitScoreInput, mmss } from '../shared/emitScore'
import { AudioTakeRow, TAKE_COLORS } from './shared/takeRows'
import { FloatPick } from '../ui/FloatPick'
import { ContextMenu, Section, Dropdown, type MenuEntry } from '@koan/shared'
import { Ic, ScoreIcon, Plus, Trash2 } from '../ui/icons'
import { useTakeMultiSelect } from '../lib/takeSelection'
import { arrowNav } from '../lib/arrowNav'
import { isKeeper } from '../shared/keepers'
import { KeeperStar, KeepersOnlySwitch, keeperEntries, toggleKeepers, useKeepersOnly } from '../lib/keeperUi'
import { scoreRenderRequest, scoreVia } from '../shared/scoreRequest'

const lb: React.CSSProperties = { fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)', marginBottom: 3 }
const mkId = (): string => crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
void KeeperStar

// ---- SFX card (list 22, 2026-09-30): sound effects, its own card beside Score and Voice, built
// the way Score is. A sound-fx clip IS a score clip of kind 'sfx' — so takes, keepers and send-to-project
// already know it. On the timeline it is an A-track block (v24, his 10-02 "clip effect not score"). Two ways to make the sound: from the
// FOOTAGE under its timeline span (Sonilo watches it), or from WORDS (ElevenLabs). ----
export function SfxCardPanel(): React.JSX.Element {
  const editorSfxId = useStore((s) => s.editorSfxId)
  const clip = useStore((s) => (s.editorSfxId ? s.project?.scoreClips.find((x) => x.id === s.editorSfxId) : undefined))
  // v24: a sound fx's spans are its blocks on the A tracks
  const spans = useStore((s) => (s.project?.timelines.find((t) => t.id === s.project?.activeTimelineId)?.audioItems ?? []).filter((x) => 'sfxId' in x.source && x.source.sfxId === s.editorSfxId).length)
  const saveScoreClip = useStore((s) => s.saveScoreClip)
  const enqueueRender = useStore((s) => s.enqueueRender)
  const [draft, setDraft] = useState<ScoreClip | null>(null)
  const [emitOpen, setEmitOpen] = useState(false)
  const [takeMenu, setTakeMenu] = useState<{ x: number; y: number; takeId: string; takeIds: string[] } | null>(null)
  const [keepersOnly, setKeepersOnly] = useKeepersOnly('score')
  const takeSelection = useTakeMultiSelect(clip?.id, clip?.takes.filter((t) => !keepersOnly || isKeeper(clip, t.id)).map((t) => t.id) ?? [])
  const [closedSecs, setClosedSecs] = useState<Set<string>>(new Set())
  const sec = (id: string, title: React.ReactNode, body: React.ReactNode): React.JSX.Element => (
    <Section
      title={title}
      collapsible
      open={!closedSecs.has(id)}
      onToggle={() =>
        setClosedSecs((s) => {
          const n = new Set(s)
          if (n.has(id)) n.delete(id)
          else n.add(id)
          return n
        })
      }
    >
      {body}
    </Section>
  )
  const settingsRev = useStore((s) => s.settingsRev)
  const [keys, setKeys] = useState({ fal: false, elevenlabs: false, google: false })
  useEffect(() => {
    void vd().getSettings().then((s) => setKeys({ fal: !!s?.falKey, elevenlabs: !!s?.elevenKey, google: !!s?.googleKey }))
  }, [settingsRev])
  // draft + debounced push — the Score card's editing machinery
  const timer = useRef<number | undefined>(undefined)
  const pendingRef = useRef<ScoreClip | null>(null)
  const flush = (): void => {
    window.clearTimeout(timer.current)
    const pend = pendingRef.current
    pendingRef.current = null
    if (pend) void useStore.getState().saveScoreClip(pend.id, { name: pend.name, beats: pend.beats, recipe: pend.recipe })
  }
  useEffect(() => {
    flush()
    setDraft(clip ? (JSON.parse(JSON.stringify(clip)) as ScoreClip) : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorSfxId])
  useEffect(() => {
    if (!clip) {
      if (editorSfxId) setDraft(null)
      return
    }
    if (pendingRef.current) return // our edit is the newest intent
    setDraft((d) => (d && JSON.stringify(d) === JSON.stringify(clip) ? d : (JSON.parse(JSON.stringify(clip)) as ScoreClip)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => flush(), [])

  const newSfx = (): void => void useStore.getState().createScoreClip(undefined, 'sfx').then((id) => id && useStore.getState().setEditorScore(id))
  if (!clip || !draft) {
    const all = (useStore.getState().project?.scoreClips ?? []).filter((s) => s.kind === 'sfx')
    return (
      <EmptyState>
        {all.length > 0 ? (
          <>
            no sound open — double-click one
            <FloatPick items={all.map((s) => ({ id: s.id, label: s.name, face: <span style={{ width: 86, height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', background: 'var(--bg0)', borderRadius: 4 }}><Ic i={ScoreIcon} size={22} /></span> }))} onOpen={(id) => useStore.getState().setEditorScore(id)} hint="double-click to open it here" />
          </>
        ) : (
          <>no sound open — make one here, then stretch it over the footage it belongs to</>
        )}
        <br />
        <span className="btn vd-hbtn" style={{ marginTop: 8, display: 'inline-block' }} onClick={newSfx}>
          ＋ new sound fx
        </span>
      </EmptyState>
    )
  }

  const push = (next: ScoreClip): void => {
    setDraft(next)
    pendingRef.current = next
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      pendingRef.current = null
      void saveScoreClip(next.id, { name: next.name, beats: next.beats, recipe: next.recipe })
    }, 500)
  }
  const model = audioModelFor(draft.recipe.engine)
  const via = scoreVia(model)
  const fromFootage = !!model.videoToMusic
  const opt = (k: string): string | number | boolean | undefined => draft.recipe.options?.[k]
  const setOpt = (k: string, v: string | number | boolean): void => push({ ...draft, recipe: { ...draft.recipe, options: { ...(draft.recipe.options ?? {}), [k]: v } } })
  const setBeat = (id: string, patch: Partial<ScoreBeat>): void => push({ ...draft, beats: draft.beats.map((b) => (b.id === id ? { ...b, ...patch } : b)) })
  const words = String(opt('styleText') ?? '').trim()
  const keyReady = model.provider === 'local' || keys[model.provider]
  // gating law: the reason sits on the card BEFORE the click
  const why = !keyReady
    ? `Add your ${via.label} API key in Settings first.`
    : fromFootage && spans === 0
      ? 'drag this sound from the Bin onto an audio track (A1, A2…) over the footage: it makes the sound of what is under it'
      : !fromFootage && !words
        ? 'write what the sound is'
        : ''
  const job = (): Parameters<typeof enqueueRender>[0] => ({
    kind: 'score' as const,
    label: draft.name,
    engineLabel: `${model.label} · via ${via.label}`,
    payload: scoreRenderRequest(draft, useStore.getState().project!, useStore.getState().selectedAudioItemId) // its A block (v24)
  })
  const F = ({ on, off, label, children }: { on: boolean; off: string; label: string; children: React.ReactNode }): React.JSX.Element => (
    <div title={on ? undefined : `off — ${off}`} style={{ opacity: on ? 1 : 0.4 }}>
      <div style={lb}>{label}</div>
      {children}
    </div>
  )

  return (
    <div className="vd-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="vd-scroll" style={{ flex: 1, minHeight: 0 }}>
        <div title="sound effects — renders land as takes, the keeper plays on the timeline" style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--amber)', marginBottom: 8 }}>
          <Ic i={ScoreIcon} size={11} /> sound fx
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10 }}>
          <input value={draft.name} onChange={(e) => push({ ...draft, name: e.target.value })} placeholder="sound name" style={{ ...ctl, flex: 1 }} />
          <span className="btn vd-hbtn" title="create a new sound fx (lands in the Bin's sound fx)" onClick={() => { flush(); newSfx() }}>
            <Ic i={Plus} size={11} /> new
          </span>
        </div>

        {sec('model', 'model', <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '0 0 auto' }}>
              <div style={lb}>model</div>
              <Dropdown
                value={draft.recipe.engine}
                options={audioModelsOf('sfx').map((m) => ({ value: m.id, label: m.label, title: [m.notes, m.priceNote].filter(Boolean).join('\n') }))}
                onChange={(v) => push({ ...draft, recipe: { ...draft.recipe, engine: v } })}
                style={{ minWidth: 170 }}
                title={[model.notes, model.priceNote].filter(Boolean).join('\n')}
              />
            </div>
            <div style={{ flex: '0 0 auto' }}>
              <div style={lb}>via</div>
              <Dropdown value={model.provider} options={[{ value: model.provider, label: via.label }]} disabled onChange={() => {}} style={{ minWidth: 110 }} title={via.hint} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <F on={!fromFootage} off="the footage under the span IS the length" label="length (s, 0.5 to 30)">
              <input
                type="number"
                min={0.5}
                max={30}
                step={0.5}
                disabled={fromFootage}
                value={typeof opt('sfxSec') === 'number' && Number(opt('sfxSec')) > 0 ? Number(opt('sfxSec')) : ''}
                onChange={(e) => setOpt('sfxSec', e.target.value === '' ? 0 : Math.max(0.5, Math.min(30, Number(e.target.value) || 0.5)))}
                placeholder="auto"
                title="blank = the model picks the length that fits the sound"
                style={{ ...ctl, width: 92 }}
              />
            </F>
            <F on={!fromFootage} off="a sound made from footage does not loop" label="loop">
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--muted)', cursor: fromFootage ? 'default' : 'pointer', height: 24 }}>
                <input type="checkbox" disabled={fromFootage} checked={opt('loop') === true} onChange={(e) => setOpt('loop', e.target.checked)} />
                loops smoothly
              </label>
            </F>
            <F on={!fromFootage} off="words-only engines" label={`follow the words · ${Number(opt('promptInfluence') ?? 0.3).toFixed(2)}`}>
              <input type="range" min={0} max={1} step={0.05} disabled={fromFootage} value={Number(opt('promptInfluence') ?? 0.3)} onChange={(e) => setOpt('promptInfluence', Number(e.target.value))} style={{ width: 130 }} title="0 = loose and varied · 1 = exactly what the words say" />
            </F>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>{fromFootage ? `${via.hint} It watches the footage under this sound’s span on the timeline.` : via.hint}</div>
        </>)}

        {sec('sound', 'the sound', <>
          <div style={lb} title={fromFootage ? 'optional — steers the sound of every scene. Leave it empty and the model listens to the footage by itself.' : 'what the sound is — the model makes exactly this'}>
            {fromFootage ? 'what it should sound like (optional)' : 'what the sound is'}
          </div>
          <textarea
            value={String(opt('styleText') ?? '')}
            onChange={(e) => setOpt('styleText', e.target.value)}
            rows={2}
            placeholder={fromFootage ? 'e.g. dry, close, no music — footsteps on wet stone, cloth, breath' : 'e.g. a heavy wooden door slams shut in a stone hall, long echo'}
            style={{ ...ctl, width: '100%', resize: 'vertical' }}
          />
        </>)}

        {sec(
          'moments',
          <span style={{ opacity: fromFootage ? 1 : 0.55 }} title={fromFootage ? '"from second X: this sound" — each moment gives its stretch of the footage its own sound, up to the next moment' : 'not sent to this engine — words make one sound. Moments belong to sounds made from footage.'}>
            moments{fromFootage ? '' : ' · not sent'}
          </span>,
          <>
            <div className="lb" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span>moments</span>
              <span style={{ color: 'var(--dim)' }}>{draft.beats.length}</span>
              <span
                className="btn vd-hbtn"
                style={{ marginLeft: 'auto' }}
                onClick={() => {
                  const last = draft.beats[draft.beats.length - 1]
                  push({ ...draft, beats: [...draft.beats, { id: mkId(), at: last ? last.at + 2 : 0, text: '' }] })
                }}
              >
                <Ic i={Plus} size={11} /> moment
              </span>
            </div>
            {draft.beats.length === 0 && <div style={{ fontSize: 11, color: 'var(--dim)', margin: '2px 0 6px' }}>no moments — the model splits the footage into scenes by itself</div>}
            {draft.beats.map((b) => (
              <div key={b.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, opacity: fromFootage ? 1 : 0.55 }}>
                <input type="number" min={0} step={0.5} value={b.at} onChange={(e) => setBeat(b.id, { at: Math.max(0, Number(e.target.value) || 0) })} title="seconds from the start of the span" style={{ ...ctl, width: 66, flex: '0 0 auto' }} />
                <span style={{ fontSize: 9.5, color: 'var(--dim)', width: 34, flex: '0 0 auto', fontFamily: 'var(--mono)' }}>{mmss(b.at)}</span>
                <input value={b.text} onChange={(e) => setBeat(b.id, { text: e.target.value })} placeholder="a door slams / glass breaks / a crowd gasps" style={{ ...ctl, flex: 1 }} />
                <span style={{ cursor: 'pointer', color: 'var(--dim)', flex: '0 0 auto' }} title="delete this moment" onClick={() => push({ ...draft, beats: draft.beats.filter((x) => x.id !== b.id) })}>
                  <Ic i={Trash2} size={12} />
                </span>
              </div>
            ))}
          </>
        )}

        {/* PROOF above FIRE: the exact outgoing content (the Score card's block) */}
        {(() => {
          try {
            const { input } = emitScoreInput(draft.recipe.engine, draft.beats, draft.recipe.options ?? {})
            return (
              <div style={{ margin: '10px 0 2px' }}>
                <div style={{ ...lb, cursor: 'pointer', marginBottom: emitOpen ? 4 : 0 }} onClick={() => setEmitOpen((v) => !v)} title="the exact content the engine receives — byte-identical to what the render sends">
                  {emitOpen ? '▾' : '▸'} generated from fields (sent to the engine)
                </div>
                {emitOpen && (
                  <div style={{ background: 'var(--field)', border: '1px solid var(--line)', borderRadius: 5, padding: 8, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {Object.entries(input)
                      .map(([k, v]) => `${k}:\n${typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)}`)
                      .join('\n\n')}
                  </div>
                )}
              </div>
            )
          } catch (err) {
            return <div style={{ fontSize: 10, color: 'var(--dim)', margin: '10px 0 2px' }}>{err instanceof Error ? err.message : String(err)}</div>
          }
        })()}

        {sec(
          'takes',
          <span title="click = select · ~ or right-click = keeper · ~ = flag / unflag the selected · a lit ★ = click to unflag · ★ only = just the keepers · right-click = color / disable / restore recipe">takes{takeSelection.selectedIds.length > 1 ? ` · ${takeSelection.selectedIds.length} selected` : ''}<KeepersOnlySwitch on={keepersOnly} onChange={setKeepersOnly} /></span>,
          <>
            {clip.takes.length === 0 && <div style={{ fontSize: 11, color: 'var(--dim)' }}>no takes yet — renders land here</div>}
            <div {...arrowNav((id) => takeSelection.selectOnly(id), (id) => toggleKeepers('score', clip.id, takeSelection.selectedIds.length ? takeSelection.selectedIds : id ? [id] : [], null))} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {clip.takes.map((t, i) => (keepersOnly && !isKeeper(clip, t.id) ? null : (
                <AudioTakeRow
                  key={t.id}
                  take={t}
                  index={i}
                  keeper={isKeeper(clip, t.id)}
                  playing={t.id === (clip.keeperTakeId ?? clip.takes[clip.takes.length - 1]?.id)}
                  onUnflag={() => toggleKeepers('score', clip.id, [t.id], false)}
                  engineLabel={t.engine ? audioModelFor(t.engine).label : undefined}
                  dragMime="vd/score-take"
                  dragPayload={JSON.stringify({ scoreClipId: clip.id, takeId: t.id })}
                  dragHint="drag → Bin scores = its own sound"
                  selected={takeSelection.isSelected(t.id)}
                  onSelect={(e) => takeSelection.select(e, t.id)}
                  onMenu={(pos) => {
                    const takeIds = takeSelection.contextIds(t.id)
                    if (!takeSelection.isSelected(t.id)) takeSelection.selectOnly(t.id)
                    setTakeMenu({ ...pos, takeId: t.id, takeIds })
                  }}
                />
              )))}
            </div>
          </>
        )}
      </div>

      {why && <div style={{ margin: '6px 0 0', fontSize: 10.5, color: 'var(--bad)' }}>✕ {why}</div>}
      <div style={{ margin: '8px 0 0', display: 'flex', gap: 6 }}>
        <span
          className="btn"
          style={{ flex: 1, textAlign: 'center', opacity: why ? 0.45 : 1, cursor: why ? 'not-allowed' : undefined }}
          aria-disabled={!!why}
          title={why || `starts immediately, alongside anything running — ${model.priceNote ?? ''}`}
          onClick={() => {
            if (why) return
            flush()
            useStore.getState().renderNow(job())
          }}
        >
          {`▶ Render now · ${model.label} · via ${via.label}`}
        </span>
        <span
          className="btn"
          style={{ flex: '0 0 auto', textAlign: 'center', opacity: why ? 0.45 : 1, cursor: why ? 'not-allowed' : undefined }}
          aria-disabled={!!why}
          title={why || 'add to the render queue — runs in order, one at a time'}
          onClick={() => {
            if (why) return
            flush()
            enqueueRender(job())
          }}
        >
          ＋ Queue
        </span>
      </div>
      {takeMenu &&
        (() => {
          const t = clip.takes.find((x) => x.id === takeMenu.takeId)
          if (!t) return null
          const ids = takeMenu.takeIds.filter((id) => clip.takes.some((take) => take.id === id))
          const selected = ids.map((id) => clip.takes.find((take) => take.id === id)).filter((take): take is ScoreTake => !!take)
          const batch = ids.length > 1
          const label = batch ? `${ids.length} selected takes` : 'take'
          const updateSelected = (patch: { color?: string | null; disabled?: boolean }): void => {
            void (async () => {
              for (const id of ids) await useStore.getState().setScoreTakeMeta(clip.id, id, patch)
            })()
          }
          const entries: MenuEntry[] = [
            ...keeperEntries('score', clip, ids),
            {
              label: <>restore recipe → card (the words and settings from this take)</>,
              onClick: () => {
                if (t.snapshot) void saveScoreClip(clip.id, { beats: t.snapshot.beats, recipe: t.snapshot.recipe })
              }
            },
            { label: <>{selected.every((take) => take.disabled) ? `enable ${label}` : `disable ${label} (skipped by keeper fallback)`}</>, onClick: () => updateSelected({ disabled: !selected.every((take) => take.disabled) }) },
            ...TAKE_COLORS.map(
              (c) =>
                ({
                  label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block' }} />{t.color === c ? 'color ✓' : `color${batch ? ` ${ids.length}` : ''}`}</span>,
                  onClick: () => updateSelected({ color: t.color === c && !batch ? null : c })
                }) as MenuEntry
            )
          ]
          return <ContextMenu x={takeMenu.x} y={takeMenu.y} entries={entries} onClose={() => setTakeMenu(null)} />
        })()}
    </div>
  )
}
