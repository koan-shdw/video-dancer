import { useState } from 'react'
import { useStore } from '../store'
import { Thumbnail } from '../Thumbnail'
import { MIME_CLIP, MIME_MOVE, MIME_TAKE } from '../lib/dragDrop'
import { clipSeed } from '../lib/clipMeta'
import { modelFor } from '../../../shared/models'
import { Foldered, type MenuEntry } from './Foldered'
import { textPrompt, confirmDialog } from '../prompt'

// ---- Bin: clips as icon tiles — folders + right-click actions; drop a take here to clone ----
export function BinPanel({ rootFolder }: { rootFolder?: string }): React.JSX.Element {
  const project = useStore((s) => s.project)
  const selectedClipId = useStore((s) => s.selectedClipId)
  const selectClip = useStore((s) => s.selectClip)
  const cloneTakeToClip = useStore((s) => s.cloneTakeToClip)
  const createClip = useStore((s) => s.createClip)
  const renameClip = useStore((s) => s.renameClip)
  const duplicateClip = useStore((s) => s.duplicateClip)
  const deleteClip = useStore((s) => s.deleteClip)
  const [over, setOver] = useState(false)
  const clips = project?.clips ?? []
  const firstImage = (c: Clip): string | undefined => {
    const id = c.promptData.imageIds?.[0]
    return id ? project?.images.find((i) => i.id === id)?.file : undefined
  }

  const clipMenu = (c: Clip): MenuEntry[] => {
    const uses = (project?.timeline ?? []).filter((it) => it.clipId === c.id).length
    return [
      {
        label: '✎ rename',
        onClick: async () => {
          const n = await textPrompt('Rename clip', c.name)
          if (n && n.trim()) void renameClip(c.id, n.trim())
        }
      },
      { label: '⧉ duplicate', onClick: () => void duplicateClip(c.id) },
      {
        label: '🗑 delete',
        danger: true,
        onClick: async () => {
          if (uses === 0 || (await confirmDialog(`"${c.name}" is on the timeline (${uses}×). Delete it and remove those instances?`)))
            void deleteClip(c.id)
        }
      }
    ]
  }
  const renderClip = (c: Clip): React.ReactNode => (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(MIME_CLIP, c.id)
        e.dataTransfer.setData(MIME_MOVE, JSON.stringify({ kind: 'bin', id: c.id }))
      }}
      title="drag onto the timeline · right-click for actions"
      style={{ borderRadius: 7, outline: c.takes.length === 0 ? '1px dashed var(--amber-dim)' : 'none', outlineOffset: 1 }}
    >
      <Thumbnail
        file={firstImage(c)}
        label={`${c.name} · ${c.takes.length ? c.takes.length + 't' : '▦'}`}
        placeholder={c.name}
        w={96}
        h={60}
        active={c.id === selectedClipId}
        onClick={() => selectClip(c.id)}
      />
    </div>
  )

  return (
    <div
      className="vd-panel vd-scroll"
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types || []).includes(MIME_TAKE)) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        const d = e.dataTransfer.getData(MIME_TAKE)
        if (!d) return
        e.preventDefault()
        setOver(false)
        try {
          const o = JSON.parse(d) as { clipId?: string; takeId?: string }
          if (o.clipId && o.takeId) void cloneTakeToClip(o.clipId, o.takeId)
        } catch (err) {
          console.error('[bin drop] parse failed', err)
        }
      }}
      style={{ outline: over ? '2px dashed var(--amber)' : 'none', outlineOffset: -2 }}
    >
      {project && (
        <span className="btn vd-hbtn" style={{ display: 'inline-block', marginBottom: 8 }} onClick={() => void createClip()}>
          + New clip
        </span>
      )}
      {!project && <p className="vd-hint">No project open. Use New / Open at the top.</p>}
      {project && clips.length === 0 && <p className="vd-hint">No clips yet — render one or hit “+ New clip”.</p>}
      {project && <Foldered kind="bin" items={clips} renderItem={renderClip} itemMenu={clipMenu} root={rootFolder ?? null} />}
      {(() => {
        const sel = clips.find((c) => c.id === selectedClipId)
        if (!sel) return null
        const titleOfId = (id: string): string | undefined => project?.images.find((i) => i.id === id)?.title
        const refs = (sel.promptData.imageIds ?? []).map(titleOfId).filter(Boolean).join(', ')
        const seed = clipSeed(sel)
        const state = sel.takes.length === 0 ? 'storyboard · no render' : `${sel.takes.length} take${sel.takes.length > 1 ? 's' : ''} · rendered`
        return (
          <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--line)', fontSize: 11, color: 'var(--muted)' }}>
            <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)', marginBottom: 4 }}>details</div>
            <div style={{ color: '#e8e8ee', fontWeight: 600 }}>{sel.name}</div>
            <div>
              {modelFor(sel.promptData.engine).label} · {sel.promptData.duration}s · {state}
              {seed != null ? ` · seed ${seed}` : ''}
            </div>
            {refs && <div>refs: {refs}</div>}
          </div>
        )
      })()}
    </div>
  )
}
