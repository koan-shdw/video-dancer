import { useEffect, useRef, useState } from 'react'
import { EmptyState } from '../ui/EmptyState'
import { useStore } from '../store'
import { Ic, Link2 } from '../ui/icons'
import { fieldChrome, useFieldFocus, type FieldMeta } from './ClipFields'

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

function Inp(props: { label: string; value: string; onChange: (v: string) => void; ph?: string; path?: string; meta?: FieldMeta }): React.JSX.Element {
  const { focused, onFocus } = useFieldFocus(props.meta, props.path)
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={lb}>{props.label}</div>
      <input
        value={props.value}
        onFocus={onFocus}
        onChange={(e) => {
          props.onChange(e.target.value)
          if (props.path) props.meta?.onUserEdit(props.path)
        }}
        placeholder={props.ph}
        style={{ ...ctl, ...fieldChrome(props.meta, props.path, focused) }}
      />
    </div>
  )
}
function Area(props: { label: string; value: string; onChange: (v: string) => void; ph?: string; path?: string; meta?: FieldMeta }): React.JSX.Element {
  const { focused, onFocus } = useFieldFocus(props.meta, props.path)
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={lb}>{props.label}</div>
      <textarea
        value={props.value}
        onFocus={onFocus}
        onChange={(e) => {
          props.onChange(e.target.value)
          if (props.path) props.meta?.onUserEdit(props.path)
        }}
        placeholder={props.ph}
        rows={2}
        style={{ ...ctl, resize: 'vertical', ...fieldChrome(props.meta, props.path, focused) }}
      />
    </div>
  )
}

// the STYLE SHEET panel (dockable): ONE style sheet's fields — the sheet itself lives in the Bin
// (🎨 tile, same citizenship as char sheets). A style links into any clip's same field via the
// field's ⛓ picker — styles sit pinned above the clips there and stack just like clip links; the
// sheet's text is spliced in before the clip's own, live at render. The Co-Director creates and
// edits these too (its writes show tinted until you edit them by hand).
export function StyleSheetPanel(): React.JSX.Element {
  const project = useStore((s) => s.project)
  const editorStyleId = useStore((s) => s.editorStyleId)
  const style = useStore((s) => (s.editorStyleId ? s.project?.styles.find((x) => x.id === s.editorStyleId) : undefined))
  const saveStyle = useStore((s) => s.saveStyle)
  const undoTick = useStore((s) => s.undoTick)

  const [name, setName] = useState('')
  const [scene, setScene] = useState<SceneFields>({ title: '', referenceHandling: '', style: '', visualFeel: '' })
  const [production, setProduction] = useState<ProductionFields>({ audioDesign: '', lighting: '', subtext: '', criticalConstraint: '', avoid: '' })
  const [enhancedPaths, setEnhancedPaths] = useState<string[]>([])
  const loadingRef = useRef(false) // true while populating from the store → suppress the autosave

  useEffect(() => {
    const s = useStore.getState().project?.styles.find((x) => x.id === editorStyleId)
    if (!s) return
    loadingRef.current = true
    setName(s.name)
    setScene({ ...s.scene })
    setProduction({ ...s.production })
    setEnhancedPaths(s.enhanced ?? [])
    // undoTick re-pulls restored values after undo/redo; Co-Director writes also bump it
  }, [editorStyleId, undoTick])

  // debounced autosave, same rhythm as the clip editor's form
  useEffect(() => {
    if (!editorStyleId) return
    if (loadingRef.current) {
      loadingRef.current = false
      return
    }
    const id = editorStyleId
    const t = window.setTimeout(() => {
      void saveStyle(id, { name, scene, production, enhanced: enhancedPaths })
    }, 600)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, scene, production, enhancedPaths, editorStyleId])

  const meta: FieldMeta | undefined = editorStyleId
    ? {
        owner: { kind: 'style', id: editorStyleId },
        enhanced: enhancedPaths,
        onUserEdit: (path) => setEnhancedPaths((a) => (a.includes(path) ? a.filter((p) => p !== path) : a))
      }
    : undefined

  const sc = (k: keyof SceneFields, v: string): void => setScene((s) => ({ ...s, [k]: v }))
  const pn = (k: keyof ProductionFields, v: string): void => setProduction((p) => ({ ...p, [k]: v }))

  if (!project) {
    return <EmptyState>open a project to define style sheets</EmptyState>
  }
  if (!style) {
    return <EmptyState>double-click a 🎨 style sheet in the Bin — or create one there</EmptyState>
  }

  return (
    <div className="vd-panel vd-scroll" style={{ padding: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 12 }}>
        A style sheet is a universal reference for the generative fields — not tied to any clip. Link it into a clip via the{' '}
        <Ic i={Link2} size={10} /> icon next to a field: style sheets sit at the top of the picker and stack with clip links; the
        sheet&apos;s text is spliced in before the clip&apos;s own, live at render. The Co-Director can build these for you.
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={lb}>style sheet name</div>
        <input value={name} onChange={(e) => setName(e.target.value)} style={ctl} />
      </div>
      <div style={secTitle}>scene</div>
      <Inp label="title" value={scene.title} onChange={(v) => sc('title', v)} path="scene.title" meta={meta} />
      <Area label="reference_handling — name poses to AVOID" value={scene.referenceHandling} onChange={(v) => sc('referenceHandling', v)} path="scene.referenceHandling" meta={meta} />
      <Inp label="style" value={scene.style} onChange={(v) => sc('style', v)} path="scene.style" meta={meta} />
      <Inp label="visual_feel" value={scene.visualFeel} onChange={(v) => sc('visualFeel', v)} path="scene.visualFeel" meta={meta} />
      <div style={{ ...secTitle, marginTop: 12 }}>production_notes</div>
      <Inp label="avoid (required baseline)" value={production.avoid} onChange={(v) => pn('avoid', v)} ph="Jitter, bent or distorted limbs." path="production.avoid" meta={meta} />
      <Inp label="audio_design" value={production.audioDesign} onChange={(v) => pn('audioDesign', v)} path="production.audioDesign" meta={meta} />
      <Inp label="lighting (overall)" value={production.lighting} onChange={(v) => pn('lighting', v)} path="production.lighting" meta={meta} />
      <Area label="critical_constraint" value={production.criticalConstraint} onChange={(v) => pn('criticalConstraint', v)} path="production.criticalConstraint" meta={meta} />
      <Area label="subtext" value={production.subtext} onChange={(v) => pn('subtext', v)} path="production.subtext" meta={meta} />
      <Inp label="animation_style" value={production.animationStyle ?? ''} onChange={(v) => pn('animationStyle', v)} ph="e.g. stop-motion holds and pops, no smooth tweening" path="production.animationStyle" meta={meta} />
    </div>
  )
}
