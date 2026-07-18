import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { Modal } from '../ui/Modal'
import { Ic, Link2, Palette, Plus, Trash2 } from '../ui/icons'

const ctl: React.CSSProperties = {
  background: 'var(--bg)',
  color: 'var(--txt-hi)',
  border: '1px solid var(--line2)',
  borderRadius: 5,
  padding: '6px 8px',
  fontSize: 12,
  width: '100%'
}
const lb: React.CSSProperties = { fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)', marginBottom: 3 }
const secTitle: React.CSSProperties = { ...lb, margin: '0 0 6px', color: 'var(--amber)' }

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

// the Project Style window: named, clip-independent bundles of the universal generative fields
// (scene + production). A style links into any clip's same field via the field's ⛓ picker — styles
// sit pinned above the clips there and stack just like clip links do.
export function ProjectStylesModal({ initialStyleId, onClose }: { initialStyleId?: string; onClose: () => void }): React.JSX.Element {
  const styles = useStore((s) => s.project?.styles ?? [])
  const createStyle = useStore((s) => s.createStyle)
  const saveStyle = useStore((s) => s.saveStyle)
  const deleteStyle = useStore((s) => s.deleteStyle)
  const undoTick = useStore((s) => s.undoTick)

  const [selectedId, setSelectedId] = useState<string | null>(initialStyleId ?? styles[0]?.id ?? null)
  const [name, setName] = useState('')
  const [scene, setScene] = useState<SceneFields>({ title: '', referenceHandling: '', style: '', visualFeel: '' })
  const [production, setProduction] = useState<ProductionFields>({ audioDesign: '', lighting: '', subtext: '', criticalConstraint: '', avoid: '' })
  const loadingRef = useRef(false) // true while populating from the store → suppress the autosave

  // undo/redo (or a delete) can pull the selected style out from under the form — re-anchor
  const selected = styles.find((s) => s.id === selectedId) ?? null
  useEffect(() => {
    if (!selected) setSelectedId(styles[0]?.id ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, styles])

  useEffect(() => {
    const s = useStore.getState().project?.styles.find((x) => x.id === selectedId)
    if (!s) return
    loadingRef.current = true
    setName(s.name)
    setScene({ ...s.scene })
    setProduction({ ...s.production })
    // undoTick re-pulls the restored values into the form after undo/redo
  }, [selectedId, undoTick])

  // debounced autosave, same rhythm as the clip editor's form
  useEffect(() => {
    if (!selectedId) return
    if (loadingRef.current) {
      loadingRef.current = false
      return
    }
    const id = selectedId
    const t = window.setTimeout(() => {
      void saveStyle(id, { name, scene, production })
    }, 600)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, scene, production, selectedId])

  const add = async (): Promise<void> => {
    const id = await createStyle()
    if (id) setSelectedId(id)
  }
  const sc = (k: keyof SceneFields, v: string): void => setScene((s) => ({ ...s, [k]: v }))
  const pn = (k: keyof ProductionFields, v: string): void => setProduction((p) => ({ ...p, [k]: v }))

  return (
    <Modal
      title={
        <>
          <Ic i={Palette} size={14} /> Project Styles
        </>
      }
      width={680}
      onClose={onClose}
    >
      <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 12 }}>
        A style is a universal reference for the generative fields — not tied to any clip. Link one into a clip via the{' '}
        <Ic i={Link2} size={10} /> icon next to a field: styles sit at the top of the picker and stack with clip links; the
        style&apos;s text is spliced in before the clip&apos;s own, live at render.
      </div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div style={{ width: 180, flex: '0 0 auto' }}>
          <span className="btn" style={{ marginBottom: 8, display: 'inline-flex' }} onClick={() => void add()}>
            <Ic i={Plus} size={11} /> new style
          </span>
          {styles.length === 0 && <div style={{ fontSize: 11, color: 'var(--dim)' }}>no styles yet</div>}
          {styles.map((s) => (
            <div
              key={s.id}
              onClick={() => setSelectedId(s.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 8px',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12,
                marginBottom: 2,
                background: s.id === selectedId ? 'color-mix(in srgb, var(--amber) 15%, transparent)' : 'transparent'
              }}
            >
              <Ic i={Palette} size={11} />
              <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
              <span
                className="btn vd-hbtn"
                title="delete style (links to it just stop resolving)"
                onClick={(e) => {
                  e.stopPropagation()
                  void deleteStyle(s.id)
                }}
              >
                <Ic i={Trash2} size={10} />
              </span>
            </div>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {!selected ? (
            <div style={{ fontSize: 12, color: 'var(--dim)', padding: '20px 0', textAlign: 'center' }}>
              create a style to define universal field values — e.g. a &quot;Visual Feel&quot; every clip can link
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 10 }}>
                <div style={lb}>style name</div>
                <input value={name} onChange={(e) => setName(e.target.value)} style={ctl} />
              </div>
              <div style={secTitle}>scene</div>
              <Inp label="title" value={scene.title} onChange={(v) => sc('title', v)} />
              <Area label="reference_handling — name poses to AVOID" value={scene.referenceHandling} onChange={(v) => sc('referenceHandling', v)} />
              <Inp label="style" value={scene.style} onChange={(v) => sc('style', v)} />
              <Inp label="visual_feel" value={scene.visualFeel} onChange={(v) => sc('visualFeel', v)} />
              <div style={{ ...secTitle, marginTop: 12 }}>production_notes</div>
              <Inp label="avoid (required baseline)" value={production.avoid} onChange={(v) => pn('avoid', v)} ph="Jitter, bent or distorted limbs." />
              <Inp label="audio_design" value={production.audioDesign} onChange={(v) => pn('audioDesign', v)} />
              <Inp label="lighting (overall)" value={production.lighting} onChange={(v) => pn('lighting', v)} />
              <Area label="critical_constraint" value={production.criticalConstraint} onChange={(v) => pn('criticalConstraint', v)} />
              <Area label="subtext" value={production.subtext} onChange={(v) => pn('subtext', v)} />
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
