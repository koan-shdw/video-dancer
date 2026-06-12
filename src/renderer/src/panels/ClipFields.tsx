import { useState } from 'react'
import { newCharacter } from '../emitYaml'
import { ctl as ctlBase } from '../ui/controls'

const ctl: React.CSSProperties = { ...ctlBase, width: '100%' }
const lb: React.CSSProperties = { fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)', marginBottom: 3 }
const card: React.CSSProperties = { border: '1px solid var(--line)', borderRadius: 5, padding: 8, marginBottom: 6, background: 'var(--panel)' }
const x: React.CSSProperties = { cursor: 'pointer', color: 'var(--dim)', padding: '0 4px' }

// lets a field borrow another clip's SAME field — pick a clip, the chip shows it (live, with a tooltip
// preview + double-click to open), and at render that clip's field value precedes your own text here.
export type FieldLinking = {
  links: Record<string, string> // path → source clip id
  clipName: (clipId: string) => string
  preview: (clipId: string, path: string) => string
  pickList: { id: string; name: string }[]
  setLink: (path: string, clipId: string) => void
  clearLink: (path: string) => void
  openLink: (clipId: string) => void
}

function FieldLink({ linking, path }: { linking?: FieldLinking; path?: string }): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  if (!linking || !path) return null
  const clipId = linking.links[path]
  const fieldName = path.split('.')[1]
  if (clipId) {
    const name = linking.clipName(clipId)
    const val = linking.preview(clipId, path)
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
        <span
          onDoubleClick={() => linking.openLink(clipId)}
          title={`double-click → open @${name}\n\n@${name}'s ${fieldName}: ${val || '(empty)'}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            maxWidth: 200,
            padding: '1px 6px',
            borderRadius: 4,
            border: '1px solid var(--line2)',
            background: 'var(--raised2)',
            color: 'var(--dim)',
            fontFamily: 'var(--mono)',
            fontSize: 10.5,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          🔗 @{name}
          {val ? ` — ${val}` : ''}
        </span>
        <span className="btn vd-hbtn" title="unlink" style={{ fontSize: 10 }} onClick={() => linking.clearLink(path)}>
          ✕
        </span>
      </span>
    )
  }
  return (
    <span style={{ position: 'relative', marginLeft: 'auto' }}>
      <span className="btn vd-hbtn" title="fill this field from another clip's same field" style={{ fontSize: 10 }} onClick={() => setOpen((v) => !v)}>
        🔗
      </span>
      {open && (
        <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 40, marginTop: 2, minWidth: 180, maxHeight: 200, overflow: 'auto', background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 4 }}>
          {linking.pickList.length === 0 ? (
            <div style={{ padding: '5px 9px', color: 'var(--dim)', fontSize: 11 }}>no other clips</div>
          ) : (
            linking.pickList.map((c) => (
              <div
                key={c.id}
                onMouseDown={(e) => {
                  e.preventDefault()
                  linking.setLink(path, c.id)
                  setOpen(false)
                }}
                title={linking.preview(c.id, path) || '(empty)'}
                style={{ padding: '5px 9px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}
              >
                🔗 @{c.name}
              </div>
            ))
          )}
        </div>
      )}
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

function Inp(props: { label: string; value: string; onChange: (v: string) => void; ph?: string; linking?: FieldLinking; path?: string }): React.JSX.Element {
  const linked = !!(props.linking && props.path && props.linking.links[props.path])
  return (
    <div style={{ marginBottom: 6 }}>
      <FieldLabel label={props.label} linking={props.linking} path={props.path} />
      <input value={props.value} onChange={(e) => props.onChange(e.target.value)} placeholder={linked ? 'add text after the linked field…' : props.ph} style={ctl} />
    </div>
  )
}
function Area(props: { label: string; value: string; onChange: (v: string) => void; ph?: string; linking?: FieldLinking; path?: string }): React.JSX.Element {
  const linked = !!(props.linking && props.path && props.linking.links[props.path])
  return (
    <div style={{ marginBottom: 6 }}>
      <FieldLabel label={props.label} linking={props.linking} path={props.path} />
      <textarea value={props.value} onChange={(e) => props.onChange(e.target.value)} placeholder={linked ? 'add text after the linked field…' : props.ph} rows={2} style={{ ...ctl, resize: 'vertical' }} />
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
  linking?: FieldLinking // per-field "borrow from another clip's same field" (scene + production)
}): React.JSX.Element {
  const { scene, setScene, characters, setCharacters, production, setProduction, linking } = props
  const sc = (k: keyof SceneFields, v: string): void => setScene({ ...scene, [k]: v })
  const pn = (k: keyof ProductionFields, v: string): void => setProduction({ ...production, [k]: v })
  const updChar = (i: number, k: keyof CharacterField, v: string): void =>
    setCharacters(characters.map((c, j) => (j === i ? { ...c, [k]: v } : c)))

  return (
    <div style={{ borderTop: '1px solid var(--line)', marginTop: 8, paddingTop: 8 }}>
      <Section title="scene">
        <Inp label="title" value={scene.title} onChange={(v) => sc('title', v)} linking={linking} path="scene.title" />
        <Area label="reference_handling — name poses to AVOID" value={scene.referenceHandling} onChange={(v) => sc('referenceHandling', v)} linking={linking} path="scene.referenceHandling" />
        <Inp label="style" value={scene.style} onChange={(v) => sc('style', v)} linking={linking} path="scene.style" />
        <Inp label="visual_feel" value={scene.visualFeel} onChange={(v) => sc('visualFeel', v)} linking={linking} path="scene.visualFeel" />
      </Section>

      <Section title={`characters (${characters.length})`} action={<Btn onClick={() => setCharacters([...characters, newCharacter()])}>+ add</Btn>}>
        {characters.map((c, i) => (
          <div key={i} style={card}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
              <input value={c.name} onChange={(e) => updChar(i, 'name', e.target.value)} placeholder="name (snake_case)" style={{ ...ctl, flex: 1 }} />
              <input value={c.referenceLabel} onChange={(e) => updChar(i, 'referenceLabel', e.target.value)} placeholder="@ref" style={{ ...ctl, width: 78 }} />
              <span style={x} onClick={() => setCharacters(characters.filter((_, j) => j !== i))}>✕</span>
            </div>
            <Area label="base" value={c.base} onChange={(v) => updChar(i, 'base', v)} />
            <Area label="features" value={c.features} onChange={(v) => updChar(i, 'features', v)} />
            <Area label="physics" value={c.physics} onChange={(v) => updChar(i, 'physics', v)} />
          </div>
        ))}
      </Section>

      <Section title="production_notes">
        <Inp label="avoid (required baseline)" value={production.avoid} onChange={(v) => pn('avoid', v)} ph="Jitter, bent or distorted limbs." linking={linking} path="production.avoid" />
        <Inp label="audio_design" value={production.audioDesign} onChange={(v) => pn('audioDesign', v)} linking={linking} path="production.audioDesign" />
        <Inp label="lighting (overall)" value={production.lighting} onChange={(v) => pn('lighting', v)} linking={linking} path="production.lighting" />
        <Area label="critical_constraint" value={production.criticalConstraint} onChange={(v) => pn('criticalConstraint', v)} linking={linking} path="production.criticalConstraint" />
        <Area label="subtext" value={production.subtext} onChange={(v) => pn('subtext', v)} linking={linking} path="production.subtext" />
      </Section>
    </div>
  )
}
