import { useMemo, useRef, useState } from 'react'
import { EmptyState } from '../ui/EmptyState'
import { useStore } from '../store'
import { mediaUrl } from '../media'
import { audioModelFor, audioModelsOf, DEFAULT_VOICE_ENGINE } from '../../../shared/audioModels'
import { MIME_AUDIO, MIME_VOICE } from '../lib/dragDrop'
import { focusAudio } from '../audioBus'
import { confirmDialog, textPrompt } from '../prompt'
import { toast } from '../ui/Toast'
import { ctl } from '../ui/controls'
import { Ic, Play, Pause, Trash2 } from '../ui/icons'

const lb: React.CSSProperties = { fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)', marginBottom: 3 }

// per-1000-character rates from the fal schema reads 2026-08-20 — the cost face is honest or absent
const CHAR_RATE: Record<string, number> = { 'chatterbox-api': 0.04, 'chatterbox-multilingual': 0.025, 'f5-tts-api': 0.05 }

// ---- Voices card (VOICES-SPEC-2026-08-20): design or clone a character voice as a RESULTS
// TREE — the audio sibling of the Image Editor. Every generation is a node; branch from any
// node with a refinement; every node can re-read a test line; nothing is real until KEPT
// (keep = a 🎤 Library voice, bindable to a char sheet). ----
export function VoicesCardPanel(): React.JSX.Element {
  const project = useStore((s) => s.project)
  const sessions = useStore((s) => s.project?.voiceSessions)
  const voices = useStore((s) => s.project?.voices)
  const audio = useStore((s) => s.project?.audio)
  const sheets = useStore((s) => s.project?.charSheets)
  const editorVoiceSessionId = useStore((s) => s.editorVoiceSessionId)
  const setEditorVoiceSession = useStore((s) => s.setEditorVoiceSession)
  const createVoiceSession = useStore((s) => s.createVoiceSession)
  const deleteVoiceSession = useStore((s) => s.deleteVoiceSession)
  const deleteVoiceBranch = useStore((s) => s.deleteVoiceBranch)
  const keepVoiceNode = useStore((s) => s.keepVoiceNode)
  const enqueueRender = useStore((s) => s.enqueueRender)

  const [engine, setEngine] = useState(DEFAULT_VOICE_ENGINE)
  const [mode, setMode] = useState<'design' | 'clone'>('clone')
  const [desc, setDesc] = useState('')
  const [refine, setRefine] = useState('')
  const [testLine, setTestLine] = useState('')
  const [cloneSrc, setCloneSrc] = useState<{ voiceId?: string; audioId?: string } | null>(null)
  const [srcPick, setSrcPick] = useState(false)
  const [srcOver, setSrcOver] = useState(false)
  const [language, setLanguage] = useState('')
  const [selNodeId, setSelNodeId] = useState<string | null>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  const session = sessions?.find((s) => s.id === editorVoiceSessionId) ?? null
  const model = audioModelFor(engine)
  const engines = audioModelsOf('voice')
  // the effective mode obeys the engine's capabilities (law 7: impossible modes never pretend)
  const effMode: 'design' | 'clone' = mode === 'design' && !model.voiceDesign ? 'clone' : mode === 'clone' && !model.voiceClone ? 'design' : mode
  const selNode = session?.nodes.find((n) => n.id === selNodeId) ?? null

  // depth-first tree order with depth for indentation (roots in creation order)
  const treeRows = useMemo(() => {
    const nodes = session?.nodes ?? []
    const out: { node: (typeof nodes)[number]; depth: number }[] = []
    const walk = (parentId: string | null, depth: number): void => {
      for (const n of nodes.filter((x) => (x.parentId ?? null) === parentId)) {
        out.push({ node: n, depth })
        walk(n.id, depth + 1)
      }
    }
    walk(null, 0)
    return out
  }, [session?.nodes])

  if (!project) return <EmptyState>open a project to design its voices</EmptyState>

  const sessionLabel = (s: { id: string; sheetId?: string }, i: number): string => {
    const sheet = s.sheetId ? sheets?.find((x) => x.id === s.sheetId) : undefined
    return sheet ? `⛉ ${sheet.name}` : `session ${i + 1}`
  }
  const srcName = cloneSrc?.voiceId
    ? voices?.find((v) => v.id === cloneSrc.voiceId)?.title ?? '(gone)'
    : cloneSrc?.audioId
      ? audio?.find((a) => a.id === cloneSrc.audioId)?.title ?? '(gone)'
      : null

  const play = (nodeId: string, file: string): void => {
    const el = audioRef.current
    if (!el) return
    if (playingId === nodeId && !el.paused) {
      el.pause()
      setPlayingId(null)
      return
    }
    el.src = mediaUrl(file)
    el.muted = false
    focusAudio(el) // one player sounds at a time — the house audio bus
    void el.play()
    setPlayingId(nodeId)
  }

  // the queue-row both render lanes dispatch (the ScoreCard grammar). Branching: a selected
  // node is the parent and the refinement rides; a clean root uses the desc / clone source.
  const branching = !!selNode
  const estCost = CHAR_RATE[model.id] != null && testLine.trim() ? (testLine.trim().length / 1000) * CHAR_RATE[model.id] : undefined
  const voiceJob = (): Parameters<typeof enqueueRender>[0] | null => {
    if (!session) return null
    const cloneRef = branching
      ? { refNodeId: selNode!.id } // iterate ON the candidate — it becomes the reference
      : cloneSrc?.voiceId
        ? { refVoiceId: cloneSrc.voiceId }
        : cloneSrc?.audioId
          ? { refAudioId: cloneSrc.audioId }
          : {}
    return {
      kind: 'voice' as const,
      label: `voice · ${sessionLabel(session, (sessions ?? []).indexOf(session))}`,
      engineLabel: model.label,
      ...(estCost != null ? { estCost } : {}),
      payload: {
        sessionId: session.id,
        parentId: branching ? selNode!.id : null,
        engine: model.id,
        mode: branching ? (model.voiceClone ? 'clone' : 'design') : effMode,
        ...(branching ? { refinement: refine } : { desc }),
        text: testLine,
        ...cloneRef,
        options: { ...(language.trim() ? { language: language.trim().toLowerCase() } : {}) }
      }
    }
  }
  const canRender = !!session && !!testLine.trim() && (branching ? true : effMode === 'design' ? !!desc.trim() : !!cloneSrc)
  const renderWhy = !session
    ? 'pick or create a session first'
    : !testLine.trim()
      ? 'write the test line every candidate reads'
      : branching
        ? ''
        : effMode === 'design'
          ? desc.trim()
            ? ''
            : 'describe the voice first'
          : cloneSrc
            ? ''
            : 'pick a clone source (a 🎤 voice or ♪ track)'
  const dispatch = (lane: 'now' | 'queue'): void => {
    const job = voiceJob()
    if (!job) return
    if (lane === 'now') useStore.getState().renderNow(job)
    else enqueueRender(job)
    setRefine('')
  }

  return (
    <div className="vd-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <audio ref={audioRef} onEnded={() => setPlayingId(null)} onPause={() => setPlayingId(null)} style={{ display: 'none' }} />
      <div className="vd-scroll" style={{ flex: 1, minHeight: 0 }}>
        <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--amber)', marginBottom: 8 }}>
          🎤 voices <span style={{ color: 'var(--dim)', textTransform: 'none', letterSpacing: 0 }}>— design or clone a character voice; branch, refine, and KEEP the winner (kept voices bind to char sheets)</span>
        </div>

        {/* session row */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10 }}>
          <select
            value={session?.id ?? ''}
            onChange={(e) => {
              setEditorVoiceSession(e.target.value || null)
              setSelNodeId(null)
            }}
            style={{ ...ctl, flex: 1 }}
          >
            <option value="">(pick a session…)</option>
            {(sessions ?? []).map((s, i) => (
              <option key={s.id} value={s.id}>
                {sessionLabel(s, i)} · {s.nodes.length} candidate{s.nodes.length === 1 ? '' : 's'}
              </option>
            ))}
          </select>
          <span
            className="btn vd-hbtn"
            title="start a fresh voice tree (sheet-bound sessions start from the sheet's 🎤 button)"
            onClick={() =>
              void createVoiceSession().then((id) => {
                if (id) {
                  setEditorVoiceSession(id)
                  setSelNodeId(null)
                }
              })
            }
          >
            ＋ session
          </span>
          {session && (
            <span
              className="btn vd-hbtn"
              style={{ color: 'var(--bad)' }}
              title="delete this tree — kept voices survive (they were copied to the Library)"
              onClick={async () => {
                if (await confirmDialog(`Delete this voice tree (${session.nodes.length} candidates)? Kept voices survive. (undoable — Ctrl+Z)`, { confirmLabel: 'Delete', danger: true })) {
                  void deleteVoiceSession(session.id)
                  setEditorVoiceSession(null)
                }
              }}
            >
              ✕
            </span>
          )}
        </div>

        {!session && (
          <p className="vd-hint">no session picked — ＋ session starts a free tree, or press 🎤 on a char sheet to design that character&apos;s voice.</p>
        )}

        {session && (
          <>
            {/* ENGINE — the model is the biggest choice, its own line (ScoreCard grammar) */}
            <div style={{ marginBottom: 8 }}>
              <div style={lb}>engine</div>
              <select value={engine} onChange={(e) => setEngine(e.target.value)} style={{ ...ctl, width: '100%' }}>
                {engines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                    {m.provider === 'local' ? ' — local (installs first)' : m.provider === 'elevenlabs' ? ' — needs its key' : ''}
                  </option>
                ))}
              </select>
              {model.notes && <p className="vd-hint" style={{ margin: '4px 0 0' }}>{model.notes}</p>}
              {model.priceNote && <p className="vd-hint" style={{ margin: '2px 0 0' }}>{model.priceNote}</p>}
            </div>

            {/* MODE — design (words → voice) vs clone (sample → voice); branching overrides */}
            {!branching && (
              <div style={{ marginBottom: 8 }}>
                <div style={lb}>mode</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['design', 'clone'] as const).map((m) => {
                    const ok = m === 'design' ? !!model.voiceDesign : !!model.voiceClone
                    return (
                      <span
                        key={m}
                        className="btn vd-hbtn"
                        style={{ flex: 1, textAlign: 'center', ...(effMode === m ? { background: 'var(--amber)', color: 'var(--on-accent)' } : {}), ...(ok ? {} : { opacity: 0.4, cursor: 'default', color: 'var(--dim)' }) }}
                        title={m === 'design' ? (ok ? 'describe the voice in words — the engine invents it' : `${model.label} clones only — Seed Audio designs`) : ok ? 'speak in a reference sample’s voice' : `${model.label} designs only`}
                        onClick={() => ok && setMode(m)}
                      >
                        {m === 'design' ? '✎ design from words' : '⧉ clone a sample'}
                      </span>
                    )
                  })}
                </div>
              </div>
            )}

            {/* the prompt: desc (root design) · clone source (root clone) · refinement (branch) */}
            {branching ? (
              <div style={{ marginBottom: 8 }}>
                <div style={lb}>refine — on top of the selected candidate</div>
                <textarea value={refine} onChange={(e) => setRefine(e.target.value)} rows={2} placeholder="e.g. deeper, less rasp, slower" style={{ ...ctl, width: '100%', resize: 'vertical' }} />
              </div>
            ) : effMode === 'design' ? (
              <div style={{ marginBottom: 8 }}>
                <div style={lb}>voice description</div>
                <textarea
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  rows={3}
                  placeholder="e.g. a low, gravelled elder's voice — slow, deliberate cadence, dry humor underneath"
                  style={{ ...ctl, width: '100%', resize: 'vertical' }}
                />
              </div>
            ) : (
              <div
                onDragOver={(e) => {
                  const t = Array.from(e.dataTransfer.types)
                  if (t.includes(MIME_VOICE) || t.includes(MIME_AUDIO)) {
                    e.preventDefault()
                    setSrcOver(true)
                  }
                }}
                onDragLeave={() => setSrcOver(false)}
                onDrop={(e) => {
                  setSrcOver(false)
                  const v = e.dataTransfer.getData(MIME_VOICE)
                  const a = e.dataTransfer.getData(MIME_AUDIO)
                  if (v) setCloneSrc({ voiceId: v })
                  else if (a) setCloneSrc({ audioId: a })
                }}
                style={{ marginBottom: 8, outline: srcOver ? '2px dashed var(--amber)' : 'none', outlineOffset: 2, borderRadius: 4 }}
              >
                <div style={lb}>clone source — the ~10-30s sample whose voice is copied</div>
                <div style={{ position: 'relative', display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className="btn vd-hbtn" onClick={() => setSrcPick((p) => !p)} title="pick a 🎤 Library voice or ♪ track — or drag one here">
                    {srcName ? `⧉ ${srcName}` : 'pick a source…'} ▾
                  </span>
                  {cloneSrc && (
                    <span style={{ cursor: 'pointer', color: 'var(--dim)' }} title="clear" onClick={() => setCloneSrc(null)}>
                      ✕
                    </span>
                  )}
                  {srcPick && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 2, minWidth: 240, maxHeight: 240, overflow: 'auto', background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 4 }}>
                      {(voices ?? []).length === 0 && (audio ?? []).length === 0 && <div style={{ padding: '5px 9px', color: 'var(--dim)', fontSize: 11 }}>no voices or music yet — keep a candidate, or import audio in the Library</div>}
                      {(voices ?? []).map((v) => (
                        <div key={v.id} onMouseDown={(e) => { e.preventDefault(); setCloneSrc({ voiceId: v.id }); setSrcPick(false) }} style={{ padding: '5px 9px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 280 }}>
                          🎤 {v.title}
                        </div>
                      ))}
                      {(audio ?? []).map((a) => (
                        <div key={a.id} onMouseDown={(e) => { e.preventDefault(); setCloneSrc({ audioId: a.id }); setSrcPick(false) }} style={{ padding: '5px 9px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 280 }}>
                          ♪ {a.title}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* test line — the words every candidate reads, compared by ear */}
            <div style={{ marginBottom: 8 }}>
              <div style={lb}>test line — every candidate reads this{model.maxTextChars ? ` (≤${model.maxTextChars} chars on ${model.label})` : ''}</div>
              <textarea
                value={testLine}
                onChange={(e) => setTestLine(e.target.value)}
                rows={2}
                placeholder="e.g. You came here looking for a warrior. What you found is something older."
                style={{ ...ctl, width: '100%', resize: 'vertical' }}
              />
            </div>

            {/* multilingual: the language rides the wire's voice field */}
            {model.id === 'chatterbox-multilingual' && (
              <div style={{ marginBottom: 8 }}>
                <div style={lb}>language — e.g. english, japanese</div>
                <input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="english" style={{ ...ctl, width: 200 }} />
              </div>
            )}

            {/* ---- the TREE: every candidate, branch anywhere, keep the winner ---- */}
            <div style={{ ...lb, marginTop: 12 }}>candidates — click = select (generate branches on it) · ★ keep · ⯈ play</div>
            {treeRows.length === 0 && <p className="vd-hint">no candidates yet — describe or pick a source above and hit ▶ Generate.</p>}
            {treeRows.map(({ node, depth }) => {
              const kept = !!node.keptVoiceId && (voices ?? []).some((v) => v.id === node.keptVoiceId)
              const isSel = selNodeId === node.id
              return (
                <div
                  key={node.id}
                  onClick={() => setSelNodeId(isSel ? null : node.id)}
                  title={isSel ? 'selected — Generate refines ON this candidate · click to unselect' : 'click = select as the branch point'}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    padding: '4px 7px',
                    marginBottom: 3,
                    marginLeft: depth * 16,
                    border: '1px solid var(--line)',
                    borderRadius: 5,
                    background: 'var(--panel)',
                    cursor: 'pointer',
                    outline: isSel ? '2px solid var(--amber)' : 'none',
                    outlineOffset: 1,
                    fontSize: 11.5
                  }}
                >
                  <span
                    className="btn vd-hbtn"
                    style={{ padding: '2px 7px' }}
                    title="play this candidate"
                    onClick={(e) => {
                      e.stopPropagation()
                      play(node.id, node.file)
                    }}
                  >
                    <Ic i={playingId === node.id ? Pause : Play} size={11} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {node.prompt.trim() || node.testLine || '(clone)'}
                  </span>
                  <span style={{ color: 'var(--dim)', fontFamily: 'var(--mono)', fontSize: 9.5, flex: '0 0 auto' }}>{audioModelFor(node.engine).label}</span>
                  {kept ? (
                    <span style={{ color: 'var(--gold)', flex: '0 0 auto' }} title="kept — it lives in the Library">★</span>
                  ) : (
                    <span
                      className="btn vd-hbtn"
                      style={{ padding: '2px 7px', flex: '0 0 auto' }}
                      title="KEEP — this candidate becomes a 🎤 Library voice (bind it to a char sheet)"
                      onClick={async (e) => {
                        e.stopPropagation()
                        const sheet = session.sheetId ? sheets?.find((x) => x.id === session.sheetId) : undefined
                        const name = await textPrompt('Voice name', sheet ? `${sheet.name} voice` : 'voice')
                        if (name == null) return
                        const vid = await keepVoiceNode(session.id, node.id, name)
                        if (vid) {
                          // a sheet-bound session's keeper binds to the sheet right away — one gesture
                          if (session.sheetId && sheets?.some((x) => x.id === session.sheetId)) void useStore.getState().saveCharSheet(session.sheetId, { voiceId: vid })
                          toast(`★ ${name || 'voice'} → Library${session.sheetId ? ' · bound to the sheet' : ''}`, { kind: 'ok' })
                        }
                      }}
                    >
                      ★
                    </span>
                  )}
                  <span
                    style={{ cursor: 'pointer', color: 'var(--dim)', flex: '0 0 auto' }}
                    title="delete this candidate and its branch (kept voices survive)"
                    onClick={async (e) => {
                      e.stopPropagation()
                      const kids = session.nodes.filter((x) => x.parentId === node.id).length
                      if (await confirmDialog(`Delete this candidate${kids ? ' and its whole branch' : ''}? Kept voices survive. (undoable — Ctrl+Z)`, { confirmLabel: 'Delete', danger: true })) {
                        if (selNodeId === node.id) setSelNodeId(null)
                        void deleteVoiceBranch(session.id, node.id)
                      }
                    }}
                  >
                    <Ic i={Trash2} size={12} />
                  </span>
                </div>
              )
            })}
          </>
        )}
      </div>

      {/* ---- the HERO, pinned (Clip Gen grammar): two-lane render, cost on the face ---- */}
      {session && (
        <div style={{ margin: '8px 0 0', display: 'flex', gap: 6 }}>
          <span
            className="btn"
            style={{ flex: 1, textAlign: 'center', ...(canRender ? {} : { opacity: 0.5, cursor: 'default' }) }}
            title={canRender ? `starts immediately, alongside anything running — ${model.priceNote ?? 'fal'}` : renderWhy}
            onClick={() => canRender && dispatch('now')}
          >
            {`▶ ${branching ? 'Refine' : 'Generate'} · ${model.label}${estCost != null ? ` · ~$${estCost.toFixed(3)}` : ''}`}
          </span>
          <span
            className="btn"
            style={{ flex: '0 0 auto', textAlign: 'center', ...(canRender ? {} : { opacity: 0.5, cursor: 'default' }) }}
            title={canRender ? 'add to the render queue — runs in order, one at a time' : renderWhy}
            onClick={() => canRender && dispatch('queue')}
          >
            ＋ Queue
          </span>
        </div>
      )}
    </div>
  )
}
