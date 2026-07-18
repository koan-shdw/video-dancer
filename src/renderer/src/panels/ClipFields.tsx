import { useState } from 'react'
import { useStore } from '../store'
import { newCharacter } from '../emitYaml'
import { ctl as ctlBase } from '../ui/controls'
import { Ic, Link2, Palette } from '../ui/icons'

const ctl: React.CSSProperties = { ...ctlBase, width: '100%' }
const lb: React.CSSProperties = { fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)', marginBottom: 3 }
const card: React.CSSProperties = { border: '1px solid var(--line)', borderRadius: 5, padding: 8, marginBottom: 6, background: 'var(--panel)' }
const x: React.CSSProperties = { cursor: 'pointer', color: 'var(--dim)', padding: '0 4px' }

// lets a field borrow other sources' SAME field — a source is a PROJECT STYLE or another clip.
// Links STACK: each chip shows live (tooltip preview + double-click to open) and at render every
// source's field value is spliced in stack order before your own text here.
export type FieldLinking = {
  links: Record<string, string[]> // path → ordered stack of source ids (styles and/or clips)
  srcName: (id: string) => string
  srcKind: (id: string) => 'style' | 'clip'
  preview: (id: string, path: string) => string
  pickList: { id: string; name: string; kind: 'style' | 'clip' }[] // styles first (pinned above the clips)
  addLink: (path: string, id: string) => void
  removeLink: (path: string, id: string) => void
  openLink: (id: string) => void // style → Project Styles window; clip → that clip in the editor
}

// field chrome shared with the Co-Director: WHO owns these fields (last-clicked focus tracking),
// which paths the AI wrote (tint), and how a manual edit clears that mark
export type FieldMeta = {
  owner: { kind: 'clip' | 'style'; id: string }
  enhanced: string[] // paths the Co-Director last wrote
  onUserEdit: (path: string) => void // manual edit → clear the enhanced mark for that path
}

// the AI-written tint + the last-clicked ring, layered onto any field control's style
export function fieldChrome(meta: FieldMeta | undefined, path: string | undefined, focused: boolean): React.CSSProperties {
  const enhanced = !!(meta && path && meta.enhanced.includes(path))
  return {
    ...(enhanced ? { background: 'color-mix(in srgb, var(--amber) 9%, var(--field))', borderColor: 'var(--amber-dim)' } : {}),
    ...(focused ? { outline: '1px solid color-mix(in srgb, var(--amber) 55%, transparent)', outlineOffset: 1 } : {})
  }
}

// is this field the app-wide "last clicked" one (what the Co-Director means by "this one")?
export function useFieldFocus(meta: FieldMeta | undefined, path: string | undefined): { focused: boolean; onFocus: () => void } {
  const focused = useStore((s) => !!(meta && path && s.focusField && s.focusField.path === path && s.focusField.ownerId === meta.owner.id))
  return {
    focused,
    onFocus: () => {
      if (meta && path) useStore.getState().setFocusField({ kind: meta.owner.kind, ownerId: meta.owner.id, path })
    }
  }
}

const pickHdr: React.CSSProperties = { padding: '4px 9px 2px', fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)' }

function FieldLink({ linking, path }: { linking?: FieldLinking; path?: string }): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  if (!linking || !path) return null
  const stack = linking.links[path] ?? []
  const fieldName = path.split('.')[1]
  const candidates = linking.pickList.filter((c) => !stack.includes(c.id))
  const styleOpts = candidates.filter((c) => c.kind === 'style')
  const clipOpts = candidates.filter((c) => c.kind === 'clip')
  const pickRow = (c: { id: string; name: string; kind: 'style' | 'clip' }): React.JSX.Element => (
    <div
      key={c.id}
      onMouseDown={(e) => {
        e.preventDefault()
        linking.addLink(path, c.id)
        setOpen(false)
      }}
      title={linking.preview(c.id, path) || '(empty)'}
      style={{ padding: '5px 9px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}
    >
      <Ic i={c.kind === 'style' ? Palette : Link2} size={11} /> {c.kind === 'style' ? c.name : '@' + c.name}
    </div>
  )
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 'auto', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {stack.map((id) => {
        const isStyle = linking.srcKind(id) === 'style'
        const name = linking.srcName(id)
        const shown = isStyle ? name : '@' + name
        const val = linking.preview(id, path)
        return (
          <span
            key={id}
            onDoubleClick={() => linking.openLink(id)}
            title={`double-click → open ${shown}${isStyle ? ' in Project Styles' : ''}\n\n${shown}'s ${fieldName}: ${val || '(empty)'}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              maxWidth: 200,
              padding: '1px 6px',
              borderRadius: 4,
              border: '1px solid var(--line2)',
              background: 'var(--raised2)',
              color: 'var(--dim)',
              fontFamily: 'var(--mono)',
              fontSize: 10.5,
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            <Ic i={isStyle ? Palette : Link2} size={11} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {shown}
              {val ? ` — ${val}` : ''}
            </span>
            <span
              title="unlink"
              style={{ cursor: 'pointer', padding: '0 1px' }}
              onClick={(e) => {
                e.stopPropagation()
                linking.removeLink(path, id)
              }}
            >
              ✕
            </span>
          </span>
        )
      })}
      <span style={{ position: 'relative' }}>
        <span
          className="btn vd-hbtn"
          title={stack.length ? 'stack another style / clip onto this field' : "fill this field from a project style or another clip's same field"}
          style={{ fontSize: 10 }}
          onClick={() => setOpen((v) => !v)}
        >
          <Ic i={Link2} size={11} />
        </span>
        {open && (
          <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 40, marginTop: 2, minWidth: 180, maxHeight: 200, overflow: 'auto', background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 4 }}>
            {candidates.length === 0 && <div style={{ padding: '5px 9px', color: 'var(--dim)', fontSize: 11 }}>nothing left to link</div>}
            {styleOpts.length > 0 && <div style={pickHdr}>project styles</div>}
            {styleOpts.map(pickRow)}
            {styleOpts.length > 0 && clipOpts.length > 0 && <div style={{ height: 1, background: 'var(--line2)', margin: '3px 0' }} />}
            {clipOpts.length > 0 && <div style={pickHdr}>clips</div>}
            {clipOpts.map(pickRow)}
          </div>
        )}
      </span>
    </span>
  )
}

function FieldLabel(props: { label: string; linking?: FieldLinking; path?: string }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
      <span style={{ ...lb, marginBottom: 0 }}>{props.label}</span>
      <FieldLink linking={props.linking} path={props.path} />
    </div>
  )
}

function Inp(props: { label: string; value: string; onChange: (v: string) => void; ph?: string; linking?: FieldLinking; path?: string; meta?: FieldMeta }): React.JSX.Element {
  const linked = !!(props.linking && props.path && props.linking.links[props.path]?.length)
  const { focused, onFocus } = useFieldFocus(props.meta, props.path)
  return (
    <div style={{ marginBottom: 6 }}>
      <FieldLabel label={props.label} linking={props.linking} path={props.path} />
      <input
        value={props.value}
        onFocus={onFocus}
        onChange={(e) => {
          props.onChange(e.target.value)
          if (props.path) props.meta?.onUserEdit(props.path)
        }}
        placeholder={linked ? 'add text after the linked field…' : props.ph}
        style={{ ...ctl, ...fieldChrome(props.meta, props.path, focused) }}
      />
    </div>
  )
}
function Area(props: { label: string; value: string; onChange: (v: string) => void; ph?: string; linking?: FieldLinking; path?: string; meta?: FieldMeta }): React.JSX.Element {
  const linked = !!(props.linking && props.path && props.linking.links[props.path]?.length)
  const { focused, onFocus } = useFieldFocus(props.meta, props.path)
  return (
    <div style={{ marginBottom: 6 }}>
      <FieldLabel label={props.label} linking={props.linking} path={props.path} />
      <textarea
        value={props.value}
        onFocus={onFocus}
        onChange={(e) => {
          props.onChange(e.target.value)
          if (props.path) props.meta?.onUserEdit(props.path)
        }}
        placeholder={linked ? 'add text after the linked field…' : props.ph}
        rows={2}
        style={{ ...ctl, resize: 'vertical', ...fieldChrome(props.meta, props.path, focused) }}
      />
    </div>
  )
}
function Section(props: { title: string; action?: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6, gap: 6 }}>
        <span style={{ ...lb, margin: 0, color: 'var(--amber)' }}>{props.title}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>{props.action}</span>
      </div>
      {props.children}
    </div>
  )
}
function Btn(props: { onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="btn vd-hbtn" onClick={props.onClick}>
      {props.children}
    </span>
  )
}

// scene / characters / production — beats now live in the dedicated <Beats> bar
export function ClipFields(props: {
  scene: SceneFields
  setScene: (s: SceneFields) => void
  characters: CharacterField[]
  setCharacters: (c: CharacterField[]) => void
  production: ProductionFields
  setProduction: (p: ProductionFields) => void
  linking?: FieldLinking // per-field "borrow from a project style / another clip's same field" (scene + production)
  meta?: FieldMeta // Co-Director chrome: focus tracking + enhanced tint + manual-edit clearing
}): React.JSX.Element {
  const { scene, setScene, characters, setCharacters, production, setProduction, linking, meta } = props
  const sc = (k: keyof SceneFields, v: string): void => setScene({ ...scene, [k]: v })
  const pn = (k: keyof ProductionFields, v: string): void => setProduction({ ...production, [k]: v })
  const updChar = (i: number, k: keyof CharacterField, v: string): void => {
    setCharacters(characters.map((c, j) => (j === i ? { ...c, [k]: v } : c)))
    meta?.onUserEdit('characters')
  }
  // whole-array enhanced mark for characters (per-card paths would be unstable across reorders)
  const charsEnhanced = !!meta?.enhanced.includes('characters')

  return (
    <div style={{ borderTop: '1px solid var(--line)', marginTop: 8, paddingTop: 8 }}>
      <Section title="scene">
        <Inp label="title" value={scene.title} onChange={(v) => sc('title', v)} linking={linking} path="scene.title" meta={meta} />
        <Area label="reference_handling — name poses to AVOID" value={scene.referenceHandling} onChange={(v) => sc('referenceHandling', v)} linking={linking} path="scene.referenceHandling" meta={meta} />
        <Inp label="style" value={scene.style} onChange={(v) => sc('style', v)} linking={linking} path="scene.style" meta={meta} />
        <Inp label="visual_feel" value={scene.visualFeel} onChange={(v) => sc('visualFeel', v)} linking={linking} path="scene.visualFeel" meta={meta} />
      </Section>

      <Section title={`characters (${characters.length})`} action={<Btn onClick={() => setCharacters([...characters, newCharacter()])}>+ add</Btn>}>
        {characters.map((c, i) => (
          <div key={i} style={{ ...card, ...(charsEnhanced ? { borderColor: 'var(--amber-dim)', background: 'color-mix(in srgb, var(--amber) 5%, var(--panel))' } : {}) }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
              <input value={c.name} onChange={(e) => updChar(i, 'name', e.target.value)} placeholder="name (snake_case)" style={{ ...ctl, flex: 1 }} />
              <input value={c.referenceLabel} onChange={(e) => updChar(i, 'referenceLabel', e.target.value)} placeholder="@ref" style={{ ...ctl, width: 78 }} />
              <span style={x} onClick={() => setCharacters(characters.filter((_, j) => j !== i))}>✕</span>
            </div>
            <Area label="base" value={c.base} onChange={(v) => updChar(i, 'base', v)} />
            <Area label="features" value={c.features} onChange={(v) => updChar(i, 'features', v)} />
            <Area label="physics" value={c.physics} onChange={(v) => updChar(i, 'physics', v)} />
            {/* Seedance conditional sub-fields — movement/state rules parse best INSIDE the character block */}
            <Area label="movement_in_this_scene (optional)" value={c.movement ?? ''} onChange={(v) => updChar(i, 'movement', v)} ph="e.g. never running — fights in close quarters only" />
            <Area label="emotional_state (optional)" value={c.emotionalState ?? ''} onChange={(v) => updChar(i, 'emotionalState', v)} ph="tone carried through the clip" />
            <Area label="state_in_this_scene (optional)" value={c.stateInThisScene ?? ''} onChange={(v) => updChar(i, 'stateInThisScene', v)} ph="starting state — wounds, posture, activity (multi-clip continuity)" />
            <Area label="power_this_scene (optional)" value={c.power ?? ''} onChange={(v) => updChar(i, 'power', v)} ph="mechanical behavior of an ability used in this clip" />
          </div>
        ))}
      </Section>

      <Section title="production_notes">
        <Inp label="avoid (required baseline)" value={production.avoid} onChange={(v) => pn('avoid', v)} ph="Jitter, bent or distorted limbs." linking={linking} path="production.avoid" meta={meta} />
        <Inp label="audio_design" value={production.audioDesign} onChange={(v) => pn('audioDesign', v)} linking={linking} path="production.audioDesign" meta={meta} />
        <Inp label="lighting (overall)" value={production.lighting} onChange={(v) => pn('lighting', v)} linking={linking} path="production.lighting" meta={meta} />
        <Area label="critical_constraint" value={production.criticalConstraint} onChange={(v) => pn('criticalConstraint', v)} linking={linking} path="production.criticalConstraint" meta={meta} />
        <Area label="subtext" value={production.subtext} onChange={(v) => pn('subtext', v)} linking={linking} path="production.subtext" meta={meta} />
        <Inp label="animation_style" value={production.animationStyle ?? ''} onChange={(v) => pn('animationStyle', v)} ph="e.g. stop-motion holds and pops, no smooth tweening" linking={linking} path="production.animationStyle" meta={meta} />
      </Section>
    </div>
  )
}
