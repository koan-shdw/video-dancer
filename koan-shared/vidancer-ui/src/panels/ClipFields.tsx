import { useState } from 'react'
import { useStore } from '../store'
import { tetherAttr } from '../lib/tether'
import { newCharacter } from '../emitYaml'
import { ctl as ctlBase } from '../ui/controls'
import { mediaUrl } from '../media'
import { openLibraryPanel } from '../panelBus'
import { MIME_IMAGE } from '../lib/dragDrop'
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
  pickList: { id: string; name: string; kind: 'style' | 'clip'; disabled?: boolean }[] // styles first (pinned above the clips); disabled ones dim, last in their group
  addLink: (path: string, id: string) => void
  removeLink: (path: string, id: string) => void
  overrides: Record<string, string[]> // path → source ids the FIELD replaces (faded chips)
  pushOverride: (path: string, id: string) => void // double-click a chip: its text joins the field, field replaces it
  revertOverride: (path: string, id: string) => void // click the faded chip: field clears, link live again
  openLink: (id: string) => void // style → Style Sheet panel; clip → that clip in the editor (right-click a chip)
}

// LIVE-linked characters borrowed from other clips — the source clip's CURRENT character block
// (matched by name) renders into this clip; each field can carry optional override text that's
// appended after the source's value (same splice rule as the other field links).
export type CharLinking = {
  links: CharacterLink[]
  resolve: (l: CharacterLink) => CharacterField | undefined
  clipName: (id: string) => string
  pickList: { clipId: string; clipName: string; charName: string; disabled?: boolean }[]
  add: (l: CharacterLink) => void
  remove: (l: CharacterLink) => void
  setOverride: (l: CharacterLink, patch: Partial<CharacterField>) => void
  replaceField: (l: CharacterLink, k: CharLinkTextKey) => void // double-click the chip: field REPLACES the source
  revertField: (l: CharacterLink, k: CharLinkTextKey) => void // click the faded chip: clear the field, link live again
  open: (clipId: string) => void
}

// one field row of a LINKED character: the source's live value as a chip + the local box.
// Normally the box APPENDS after the chip. Double-click the chip → the chip's text is pushed
// into the box, the chip fades, and the box REPLACES the source for this field; click the
// faded chip → the box clears and the link is live again.
function LinkedField(props: { label: string; srcVal?: string; val: string; replaced: boolean; onChange: (v: string) => void; onPush: () => void; onRevert: () => void }): React.JSX.Element {
  const hasSrc = !!props.srcVal?.trim()
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
        <span style={{ ...lb, marginBottom: 0 }}>{props.label}</span>
        {hasSrc || props.replaced ? (
          <span
            onClick={props.replaced ? props.onRevert : undefined}
            onDoubleClick={props.replaced ? undefined : props.onPush}
            title={
              props.replaced
                ? `overridden — the field below replaces this text\n\nclick → back to the link (clears the field)\n\nsource: ${props.srcVal?.trim() || '(empty)'}`
                : `${props.srcVal}\n\ndouble-click → push this text into the field; the field then REPLACES the link`
            }
            style={{ marginLeft: 'auto', maxWidth: 260, padding: '1px 6px', borderRadius: 4, border: '1px solid var(--line2)', background: 'var(--raised2)', color: 'var(--dim)', fontFamily: 'var(--mono)', fontSize: 10.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer', opacity: props.replaced ? 0.45 : 1 }}
          >
            <Ic i={Link2} size={10} /> {props.srcVal?.trim() || '(source empty)'}
          </span>
        ) : (
          <span style={{ marginLeft: 'auto', fontSize: 9.5, color: 'var(--dim)' }}>(source empty)</span>
        )}
      </div>
      <textarea
        value={props.val}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.replaced ? 'replaces the linked field…' : 'add text after the linked field…'}
        rows={1}
        style={{ ...ctl, resize: 'vertical' }}
      />
    </div>
  )
}

function CharLinkPicker({ linking }: { linking: CharLinking }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const candidates = linking.pickList.filter((p) => !linking.links.some((l) => l.clipId === p.clipId && l.charName === p.charName))
  return (
    <span style={{ position: 'relative' }}>
      <span className="btn vd-hbtn" title="live-link a character from another clip — that clip's CURRENT character block renders here (edits there flow through)" onClick={() => setOpen((v) => !v)}>
        <Ic i={Link2} size={11} /> from clip
      </span>
      {open && (
        <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 40, marginTop: 2, minWidth: 210, maxHeight: 220, overflow: 'auto', background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 4 }}>
          {candidates.length === 0 && <div style={{ padding: '5px 9px', color: 'var(--dim)', fontSize: 11 }}>no characters in other clips</div>}
          {candidates.map((p) => (
            <div
              key={p.clipId + ':' + p.charName}
              onMouseDown={(e) => {
                e.preventDefault()
                linking.add({ clipId: p.clipId, charName: p.charName })
                setOpen(false)
              }}
              title={p.disabled ? 'disabled in the Bin — still linkable' : undefined}
              style={{ padding: '5px 9px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 280, opacity: p.disabled ? 0.45 : 1 }}
            >
              <Ic i={Link2} size={11} /> {p.clipName} · <span style={{ color: 'var(--gold)' }}>{p.charName}</span>
            </div>
          ))}
        </div>
      )}
    </span>
  )
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
  const pickRow = (c: { id: string; name: string; kind: 'style' | 'clip'; disabled?: boolean }): React.JSX.Element => (
    <div
      key={c.id}
      onMouseDown={(e) => {
        e.preventDefault()
        linking.addLink(path, c.id)
        setOpen(false)
      }}
      title={(linking.preview(c.id, path) || '(empty)') + (c.disabled ? '\n(disabled in the Bin — still linkable)' : '')}
      style={{ padding: '5px 9px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260, opacity: c.disabled ? 0.45 : 1 }}
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
        const ovr = (linking.overrides[path] ?? []).includes(id)
        return (
          <span
            key={id}
            onClick={ovr ? () => linking.revertOverride(path, id) : undefined}
            onDoubleClick={ovr ? undefined : () => linking.pushOverride(path, id)}
            onContextMenu={(e) => {
              e.preventDefault()
              linking.openLink(id)
            }}
            title={
              ovr
                ? `overridden — the field replaces ${shown}'s text\n\nclick → back to the link (clears the field)\nright-click → open ${shown}${isStyle ? ' in its Style Sheet' : ''}\n\n${shown}'s ${fieldName}: ${val || '(empty)'}`
                : `double-click → push this text into the field; the field then REPLACES this link\nright-click → open ${shown}${isStyle ? ' in its Style Sheet' : ''}\n\n${shown}'s ${fieldName}: ${val || '(empty)'}`
            }
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
              whiteSpace: 'nowrap',
              opacity: ovr ? 0.45 : 1
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

// a STABLE empty fallback for store selectors. `?? []` inside a selector mints a fresh array on
// every snapshot read while project is null — React's store sync sees an eternally-changed
// snapshot and loops to "maximum update depth" (this exact bug crashed Clip Gen on load).
const NO_IMAGES: ProjImage[] = []

// a character's reference image as a LINK FIELD (not free text): click = pick a Library image,
// drag one in = link it, ✕ = clear. Still stores the @title string in referenceLabel, so the
// YAML output and every existing clip are unchanged — old text just renders as a chip now.
function CharRef({ value, onChange }: { value: string; onChange: (v: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [over, setOver] = useState(false)
  const images = useStore((s) => s.project?.images ?? NO_IMAGES)
  const im = images.find((i) => i.title === value.trim())
  return (
    <span
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes(MIME_IMAGE)) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        const f = e.dataTransfer.getData(MIME_IMAGE)
        setOver(false)
        if (!f) return
        e.preventDefault()
        const hit = images.find((i) => i.file === f)
        if (hit) onChange(hit.title)
      }}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', borderRadius: 4, outline: over ? '1px dashed var(--amber)' : 'none', outlineOffset: 2 }}
    >
      {value.trim() ? (
        <span
          onClick={() => (images.length ? setOpen((v) => !v) : openLibraryPanel())}
          title={im ? `${value} — this character's reference image · click to pick another` : images.length ? `"${value}" doesn't match any Library image — click to pick one` : 'no Library images yet — click opens the Library'}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 5px', borderRadius: 4, border: '1px solid var(--line2)', background: 'var(--raised2)', cursor: 'pointer', maxWidth: 150 }}
        >
          {im && <img src={mediaUrl(im.file)} alt="" style={{ width: 26, height: 17, objectFit: 'cover', borderRadius: 2, flex: '0 0 auto' }} />}
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: im ? 'var(--gold)' : 'var(--bad)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</span>
          <span
            title="unlink"
            onClick={(e) => {
              e.stopPropagation()
              onChange('')
            }}
            style={{ cursor: 'pointer', color: 'var(--dim)', padding: '0 1px' }}
          >
            ✕
          </span>
        </span>
      ) : (
        <span className="btn vd-hbtn" onClick={() => (images.length ? setOpen((v) => !v) : openLibraryPanel())} title={images.length ? "link a Library image as this character's reference — click to pick, or drag an image here" : 'no Library images yet — click opens the Library'}>
          <Ic i={Link2} size={11} /> @ref
        </span>
      )}
      {open && images.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 40, marginTop: 2, minWidth: 210, maxHeight: 230, overflow: 'auto', background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 4 }}>
          {images.map((x2) => (
            <div
              key={x2.id}
              onMouseDown={(e) => {
                e.preventDefault()
                onChange(x2.title)
                setOpen(false)
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', cursor: 'pointer' }}
            >
              <img src={mediaUrl(x2.file)} alt="" style={{ width: 34, height: 22, objectFit: 'cover', borderRadius: 2, flex: '0 0 auto' }} />
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--gold)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x2.title}</span>
            </div>
          ))}
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

// linked-field placeholder: appending while any chip is live, replacing once every chip is overridden
function linkedPh(linking: FieldLinking | undefined, path: string | undefined, ph?: string): string | undefined {
  const stack = (linking && path && linking.links[path]) || []
  if (!stack.length) return ph
  const ovr = (linking && path && linking.overrides[path]) || []
  return stack.some((id) => !ovr.includes(id)) ? 'add text after the linked field…' : 'replaces the linked field…'
}

function Inp(props: { label: string; value: string; onChange: (v: string) => void; ph?: string; linking?: FieldLinking; path?: string; meta?: FieldMeta }): React.JSX.Element {
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
        placeholder={linkedPh(props.linking, props.path, props.ph)}
        style={{ ...ctl, ...fieldChrome(props.meta, props.path, focused) }}
        {...(props.meta && props.path ? tetherAttr(props.meta.owner.kind, props.meta.owner.id, props.path) : {})}
      />
    </div>
  )
}
function Area(props: { label: string; value: string; onChange: (v: string) => void; ph?: string; linking?: FieldLinking; path?: string; meta?: FieldMeta }): React.JSX.Element {
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
        placeholder={linkedPh(props.linking, props.path, props.ph)}
        rows={2}
        style={{ ...ctl, resize: 'vertical', ...fieldChrome(props.meta, props.path, focused) }}
        {...(props.meta && props.path ? tetherAttr(props.meta.owner.kind, props.meta.owner.id, props.path) : {})}
      />
    </div>
  )
}
function Section(props: { title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
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
  charLinking?: CharLinking // LIVE-linked characters from other clips
  meta?: FieldMeta // Co-Director chrome: focus tracking + enhanced tint + manual-edit clearing
}): React.JSX.Element {
  const { scene, setScene, characters, setCharacters, production, setProduction, linking, charLinking, meta } = props
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
      {/* section titles are tether HOLDERS — park the window on "scene" and the whole section is "this one" */}
      <Section title={<span {...(meta ? tetherAttr(meta.owner.kind, meta.owner.id, 'scene') : {})}>scene</span>}>
        <Inp label="title" value={scene.title} onChange={(v) => sc('title', v)} linking={linking} path="scene.title" meta={meta} />
        <Area label="reference_handling — name poses to AVOID" value={scene.referenceHandling} onChange={(v) => sc('referenceHandling', v)} linking={linking} path="scene.referenceHandling" meta={meta} />
        <Inp label="style" value={scene.style} onChange={(v) => sc('style', v)} linking={linking} path="scene.style" meta={meta} />
        <Inp label="visual_feel" value={scene.visualFeel} onChange={(v) => sc('visualFeel', v)} linking={linking} path="scene.visualFeel" meta={meta} />
      </Section>

      <Section
        title={<span {...(meta ? tetherAttr(meta.owner.kind, meta.owner.id, 'characters') : {})}>{`characters (${(charLinking?.links.length ?? 0) + characters.length})`}</span>}
        action={
          <>
            {charLinking && <CharLinkPicker linking={charLinking} />}
            <Btn onClick={() => setCharacters([...characters, newCharacter()])}>+ add</Btn>
          </>
        }
      >
        {/* live-linked characters render FIRST (they splice before your own at emit time): every
            field shows the SOURCE's live value as a chip + a local box whose text appends after it */}
        {charLinking?.links.map((l) => {
          const src = charLinking.resolve(l)
          const o = l.override ?? {}
          const set = (patch: Partial<CharacterField>): void => charLinking.setOverride(l, patch)
          return (
            <div key={l.clipId + ':' + l.charName} style={{ ...card, borderColor: src ? 'var(--amber-dim)' : 'var(--bad)' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                <Ic i={Link2} size={12} />
                <span
                  onDoubleClick={() => charLinking.open(l.clipId)}
                  title={
                    src
                      ? `LIVE from "${charLinking.clipName(l.clipId)}" — that clip's current "${l.charName}" renders here · double-click = open the source clip`
                      : `"${l.charName}" no longer exists in "${charLinking.clipName(l.clipId)}" — this link resolves to nothing`
                  }
                  style={{ flex: 1, minWidth: 0, fontFamily: 'var(--mono)', fontSize: 11.5, color: src ? 'var(--txt-hi)' : 'var(--bad)', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                >
                  {l.charName} <span style={{ color: 'var(--dim)' }}>— live from {charLinking.clipName(l.clipId)}</span>
                </span>
                {/* @ref: the source's by default; picking one HERE replaces it for this clip */}
                <CharRef value={o.referenceLabel ?? ''} onChange={(v) => set({ referenceLabel: v })} />
                <span style={x} title="unlink this character (your appended text goes with it)" onClick={() => charLinking.remove(l)}>✕</span>
              </div>
              {src && !(o.referenceLabel ?? '').trim() && src.referenceLabel.trim() && (
                <div style={{ fontSize: 9, color: 'var(--dim)', margin: '-2px 0 6px' }}>ref: {src.referenceLabel} (from source — pick one above to replace)</div>
              )}
              {src && (
                <>
                  {(
                    [
                      ['base', 'base', src.base, o.base],
                      ['features', 'features', src.features, o.features],
                      ['physics', 'physics', src.physics, o.physics],
                      ['movement_in_this_scene', 'movement', src.movement, o.movement],
                      ['emotional_state', 'emotionalState', src.emotionalState, o.emotionalState],
                      ['state_in_this_scene', 'stateInThisScene', src.stateInThisScene, o.stateInThisScene],
                      ['power_this_scene', 'power', src.power, o.power]
                    ] as [string, CharLinkTextKey, string | undefined, string | undefined][]
                  ).map(([label, k, srcVal, val]) => (
                    <LinkedField
                      key={k}
                      label={label}
                      srcVal={srcVal}
                      val={val ?? ''}
                      replaced={!!l.replaced?.includes(k)}
                      onChange={(v) => set({ [k]: v })}
                      onPush={() => charLinking.replaceField(l, k)}
                      onRevert={() => charLinking.revertField(l, k)}
                    />
                  ))}
                </>
              )}
            </div>
          )
        })}
        {characters.map((c, i) => (
          <div key={i} style={{ ...card, ...(charsEnhanced ? { borderColor: 'var(--amber-dim)', background: 'color-mix(in srgb, var(--amber) 5%, var(--panel))' } : {}) }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
              <input value={c.name} onChange={(e) => updChar(i, 'name', e.target.value)} placeholder="name (snake_case)" style={{ ...ctl, flex: 1 }} />
              <CharRef value={c.referenceLabel} onChange={(v) => updChar(i, 'referenceLabel', v)} />
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

      <Section title={<span {...(meta ? tetherAttr(meta.owner.kind, meta.owner.id, 'production') : {})}>production_notes</span>}>
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
