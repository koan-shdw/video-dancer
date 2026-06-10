import { newCharacter } from '../emitYaml'

const ctl: React.CSSProperties = {
  background: '#101014',
  color: '#cfcfd6',
  border: '1px solid #33333c',
  borderRadius: 4,
  padding: '5px 7px',
  fontSize: 12,
  width: '100%'
}
const lb: React.CSSProperties = { fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)', marginBottom: 3 }
const card: React.CSSProperties = { border: '1px solid var(--line)', borderRadius: 5, padding: 8, marginBottom: 6, background: 'var(--panel)' }
const x: React.CSSProperties = { cursor: 'pointer', color: 'var(--dim)', padding: '0 4px' }

function Inp(props: { label: string; value: string; onChange: (v: string) => void; ph?: string }): React.JSX.Element {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={lb}>{props.label}</div>
      <input value={props.value} onChange={(e) => props.onChange(e.target.value)} placeholder={props.ph} style={ctl} />
    </div>
  )
}
function Area(props: { label: string; value: string; onChange: (v: string) => void; ph?: string }): React.JSX.Element {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={lb}>{props.label}</div>
      <textarea value={props.value} onChange={(e) => props.onChange(e.target.value)} placeholder={props.ph} rows={2} style={{ ...ctl, resize: 'vertical' }} />
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
}): React.JSX.Element {
  const { scene, setScene, characters, setCharacters, production, setProduction } = props
  const sc = (k: keyof SceneFields, v: string): void => setScene({ ...scene, [k]: v })
  const pn = (k: keyof ProductionFields, v: string): void => setProduction({ ...production, [k]: v })
  const updChar = (i: number, k: keyof CharacterField, v: string): void =>
    setCharacters(characters.map((c, j) => (j === i ? { ...c, [k]: v } : c)))

  return (
    <div style={{ borderTop: '1px solid var(--line)', marginTop: 8, paddingTop: 8 }}>
      <Section title="scene">
        <Inp label="title" value={scene.title} onChange={(v) => sc('title', v)} />
        <Area label="reference_handling — name poses to AVOID" value={scene.referenceHandling} onChange={(v) => sc('referenceHandling', v)} />
        <Inp label="style" value={scene.style} onChange={(v) => sc('style', v)} />
        <Inp label="visual_feel" value={scene.visualFeel} onChange={(v) => sc('visualFeel', v)} />
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
        <Inp label="avoid (required baseline)" value={production.avoid} onChange={(v) => pn('avoid', v)} ph="Jitter, bent or distorted limbs." />
        <Inp label="audio_design" value={production.audioDesign} onChange={(v) => pn('audioDesign', v)} />
        <Inp label="lighting (overall)" value={production.lighting} onChange={(v) => pn('lighting', v)} />
        <Area label="critical_constraint" value={production.criticalConstraint} onChange={(v) => pn('criticalConstraint', v)} />
        <Area label="subtext" value={production.subtext} onChange={(v) => pn('subtext', v)} />
      </Section>
    </div>
  )
}
