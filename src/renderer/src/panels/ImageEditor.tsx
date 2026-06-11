import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { mediaUrl } from '../media'
import { Thumbnail } from '../Thumbnail'
import { MIME_IMAGE } from '../lib/dragDrop'
import { NANO_BANANA } from '../../../shared/imageModels'
import { confirmDialog } from '../prompt'
import { ctl } from '../ui/controls'

// ---- Image Editor (Phase 1): Nano Banana edit/generate with a persisted results TREE ----
// Double-click a Library image → edit it here. Every Generate runs FROM the selected node and
// appends its outputs as children. NOTHING reaches the Library until a node is tagged (★).
// Phase 2 adds the drawing tools (guide marks); the canvas is view-only for now.

interface TreeRow {
  node: EditNode
  depth: number
  childCount: number // direct children
  hiddenCount: number // descendants hidden because this row is collapsed
}

// flatten the tree depth-first so children render under their parent, indented;
// collapsed nodes keep their subtree out of the rows (but report how much is hidden)
function treeRows(nodes: EditNode[], collapsed: Set<string>): TreeRow[] {
  const byParent = new Map<string | null, EditNode[]>()
  for (const n of nodes) {
    const k = n.parentId
    const arr = byParent.get(k) ?? []
    arr.push(n)
    byParent.set(k, arr)
  }
  const subtreeSize = (id: string): number =>
    (byParent.get(id) ?? []).reduce((sum, c) => sum + 1 + subtreeSize(c.id), 0)
  const out: TreeRow[] = []
  const walk = (parentId: string | null, depth: number): void => {
    for (const n of byParent.get(parentId) ?? []) {
      const kids = byParent.get(n.id) ?? []
      const isCollapsed = collapsed.has(n.id)
      out.push({ node: n, depth, childCount: kids.length, hiddenCount: isCollapsed ? subtreeSize(n.id) : 0 })
      if (!isCollapsed) walk(n.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

export function ImageEditorPanel(): React.JSX.Element {
  const project = useStore((s) => s.project)
  const editorImageId = useStore((s) => s.editorImageId)
  const applyDelta = useStore((s) => s.applyDelta)
  const tagNode = useStore((s) => s.tagEditNode)
  const deleteBranch = useStore((s) => s.deleteEditBranch)
  const renameImage = useStore((s) => s.renameImage)
  const duplicateImage = useStore((s) => s.duplicateImage)
  const deleteImage = useStore((s) => s.deleteImage)

  const [prompt, setPrompt] = useState('')
  const [refIds, setRefIds] = useState<string[]>([])
  const [variants, setVariants] = useState(1)
  const [aspect, setAspect] = useState('auto')
  const [seed, setSeed] = useState('')
  const [selNodeId, setSelNodeId] = useState<string | null>(null) // null = the root image
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set()) // tree rows folded shut
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [refDrag, setRefDrag] = useState(false)
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [titleDraft, setTitleDraft] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)

  const model = NANO_BANANA
  const rootImage = editorImageId ? project?.images.find((i) => i.id === editorImageId) : undefined
  const session = project?.editSessions.find((s) => s.rootImageId === (editorImageId ?? ''))
  const nodes = session?.nodes ?? []
  const selNode = selNodeId ? nodes.find((n) => n.id === selNodeId) : undefined
  const rows = useMemo(() => treeRows(nodes, collapsed), [nodes, collapsed])
  const toggleCollapsed = (id: string): void =>
    setCollapsed((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const libImages = project?.images ?? []
  const imgOf = (id: string): ProjImage | undefined => libImages.find((i) => i.id === id)

  // what the canvas shows: the selected node's image, else the root
  const canvasFile = selNode?.file ?? rootImage?.file
  const fromScratch = editorImageId === '' // "✨ new image" session (no base)

  // progress line from main
  useEffect(() => window.vidancer.onImageProgress((m) => setStatus(m)), [])
  // the image's @title — editable here, committed on blur/Enter (the editor IS the image's home)
  useEffect(() => {
    setTitleDraft(rootImage?.title ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootImage?.id, rootImage?.title])
  const commitTitle = (): void => {
    if (!rootImage || !titleDraft.trim() || titleDraft.trim() === rootImage.title) return
    void renameImage(rootImage.id, titleDraft.trim()).then((ok) => {
      if (!ok) {
        setTitleDraft(rootImage.title) // refused: @title already taken — snap back
        setStatus('✕ that @title is already taken by another image')
      }
    })
  }
  const usesOf = (id: string): number =>
    (project?.clips ?? []).filter((c) => (c.promptData.imageIds ?? []).includes(id) || c.promptData.endImageId === id).length
  const deleteRoot = async (): Promise<void> => {
    if (!rootImage) return
    const uses = usesOf(rootImage.id)
    const treeSize = nodes.length
    const msg = `Delete ${rootImage.title}?${uses ? ` It's referenced by ${uses} clip(s).` : ''}${treeSize ? ` Its edit tree (${treeSize} result${treeSize > 1 ? 's' : ''}) goes with it — tagged Library images survive.` : ''}`
    if (await confirmDialog(msg)) void deleteImage(rootImage.id) // editor clears itself via applyDelta
  }
  // reset per-editor-target state when the target changes
  useEffect(() => {
    setSelNodeId(null)
    setPrompt('')
    setRefIds([])
    setSeed('')
    setStatus('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorImageId])
  // selected node vanished (branch deleted) → fall back to root
  useEffect(() => {
    if (selNodeId && !nodes.some((n) => n.id === selNodeId)) setSelNodeId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length])

  const aspects = fromScratch ? model.aspectRatiosGenerate : model.aspectRatiosEdit
  const estCost = model.pricePerImage * variants
  const refWarn = refIds.length > model.refWarnAt - 1 // base counts toward fidelity too

  const addRef = (id: string): void => {
    if (!id || id === editorImageId) return
    setRefIds((prev) => (prev.includes(id) || prev.length >= model.maxImages - 1 ? prev : [...prev, id]))
  }
  const onPrompt = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const val = e.target.value
    setPrompt(val)
    const pos = e.target.selectionStart ?? val.length
    const m = val.slice(0, pos).match(/@(\w*)$/)
    setMention(m ? { start: pos - m[0].length, query: m[1].toLowerCase() } : null)
  }
  const pickMention = (im: ProjImage): void => {
    if (!mention) return
    const ta = taRef.current
    const pos = ta?.selectionStart ?? prompt.length
    const before = prompt.slice(0, mention.start)
    const after = prompt.slice(pos)
    setPrompt(before + im.title + ' ' + after)
    setMention(null)
    addRef(im.id)
    setTimeout(() => {
      ta?.focus()
      const c = (before + im.title + ' ').length
      ta?.setSelectionRange(c, c)
    }, 0)
  }
  const mentionMatches = mention
    ? libImages.filter((i) => i.title.toLowerCase().includes(mention.query)).slice(0, 8)
    : []

  const generate = async (): Promise<void> => {
    if (!prompt.trim()) return setStatus('write a prompt first')
    if (editorImageId == null) return
    setBusy(true)
    setStatus('starting…')
    const r = await window.vidancer.imageGenerate({
      rootImageId: editorImageId,
      parentNodeId: selNodeId,
      prompt: prompt.trim(),
      refIds,
      numImages: variants,
      seed: seed.trim() === '' ? undefined : parseInt(seed, 10) || undefined,
      aspectRatio: aspect
    })
    setBusy(false)
    if (r.ok && r.delta) {
      applyDelta(r.delta)
      if (r.nodeIds?.[0]) setSelNodeId(r.nodeIds[0]) // jump to the first fresh result
      setStatus(`done ✓ — ${r.nodeIds?.length ?? 0} result${(r.nodeIds?.length ?? 0) > 1 ? 's' : ''} added to the tree`)
      void useStore.getState().refreshCredit()
    } else {
      setStatus('error: ' + (r.error ?? 'unknown'))
    }
  }

  if (!project || editorImageId == null) {
    return (
      <div className="vd-panel vd-monitor">
        <span style={{ color: 'var(--dim)', fontSize: 12 }}>double-click a Library image to edit it here</span>
      </div>
    )
  }

  return (
    <div className="vd-panel" style={{ display: 'flex', height: '100%', background: '#0c0c0f' }}>
      {/* ---- left: canvas (Phase 1: view) + prompt/controls ---- */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, minHeight: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', position: 'relative' }}>
          {canvasFile ? (
            <img src={mediaUrl(canvasFile)} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          ) : (
            <span style={{ color: 'var(--dim)', fontSize: 12 }}>✨ from-scratch session — write a prompt and Generate</span>
          )}
          <div style={{ position: 'absolute', top: 6, left: 8, fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--muted)', background: 'rgba(0,0,0,.55)', padding: '2px 6px', borderRadius: 4 }}>
            {selNode ? `tree node — "${selNode.prompt.slice(0, 60)}"` : rootImage ? `${rootImage.title} (original)` : 'new image'}
          </div>
        </div>

        <div style={{ padding: '8px', borderTop: '1px solid var(--line)', position: 'relative' }}>
          {/* refs strip — drag Library images here or type @ in the prompt */}
          <div
            onDragOver={(e) => {
              if (Array.from(e.dataTransfer.types).includes(MIME_IMAGE)) {
                e.preventDefault()
                setRefDrag(true)
              }
            }}
            onDragLeave={() => setRefDrag(false)}
            onDrop={(e) => {
              const f = e.dataTransfer.getData(MIME_IMAGE)
              setRefDrag(false)
              if (!f) return
              e.preventDefault()
              const im = libImages.find((i) => i.file === f)
              if (im) addRef(im.id)
            }}
            style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 6, padding: 4, borderRadius: 6, outline: refDrag ? '1px dashed var(--amber)' : '1px dashed transparent' }}
          >
            <span className="lb" style={{ margin: 0 }}>refs</span>
            {refIds.map((id) => {
              const im = imgOf(id)
              return im ? (
                <Thumbnail key={id} file={im.file} label={im.title} w={52} h={34} onClear={() => setRefIds((p) => p.filter((x) => x !== id))} />
              ) : null
            })}
            {refIds.length === 0 && <span style={{ fontSize: 10, color: 'var(--dim)' }}>drag Library images here · or type @ in the prompt</span>}
            {refWarn && <span style={{ fontSize: 9, color: 'var(--amber)' }}>⚠ identity fidelity drops with many images</span>}
          </div>

          <textarea
            ref={taRef}
            value={prompt}
            onChange={onPrompt}
            onBlur={() => setTimeout(() => setMention(null), 150)}
            placeholder={fromScratch ? 'describe the image to generate…' : 'describe the change — type @ to add a reference'}
            rows={2}
            style={{ ...ctl, width: '100%', resize: 'vertical' }}
          />
          {mentionMatches.length > 0 && (
            <div style={{ position: 'absolute', zIndex: 20, left: 8, right: 8, background: '#16161a', border: '1px solid var(--line2)', borderRadius: 4, maxHeight: 140, overflow: 'auto' }}>
              {mentionMatches.map((im) => (
                <div
                  key={im.id}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pickMention(im)
                  }}
                  style={{ padding: '5px 9px', fontFamily: 'var(--mono)', fontSize: 12, cursor: 'pointer', color: '#e7c98c' }}
                >
                  {im.title}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
            <span className="lb" style={{ margin: 0 }}>aspect</span>
            <select value={aspect} onChange={(e) => setAspect(e.target.value)} style={ctl}>
              {(aspects.includes(aspect) ? aspects : [aspect, ...aspects]).map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
            <span className="lb" style={{ margin: 0 }}>variants</span>
            <select value={variants} onChange={(e) => setVariants(parseInt(e.target.value, 10))} style={ctl}>
              {Array.from({ length: model.maxVariants }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <span className="lb" style={{ margin: 0 }}>seed</span>
            <input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="—" style={{ ...ctl, width: 80 }} />
            <span
              className="btn"
              style={{ marginLeft: 'auto', opacity: busy || !prompt.trim() ? 0.5 : 1, pointerEvents: busy ? 'none' : 'auto' }}
              onClick={() => void generate()}
              title={selNode ? 'generate from the SELECTED tree node' : 'generate from the original image'}
            >
              {busy ? 'generating…' : `⚡ Generate · ~$${estCost.toFixed(3)}`}
            </span>
          </div>
          <p className="vd-hint" style={{ margin: '6px 0 0', color: status.startsWith('error') ? 'var(--bad)' : 'var(--muted)' }}>
            {status || `generating from: ${selNode ? 'selected node' : rootImage ? 'original' : 'scratch'} · results join the tree — tag ★ to send to the Library`}
          </p>
        </div>
      </div>

      {/* ---- right: the image's identity + its results TREE (permanent data of this image) ---- */}
      <div className="vd-scroll" style={{ width: 230, flex: '0 0 auto', borderLeft: '1px solid var(--line)', padding: 8, overflowY: 'auto' }}>
        {rootImage && (
          <div style={{ marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--line)' }}>
            <div className="lb">image (@title)</div>
            <input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => e.key === 'Enter' && commitTitle()}
              placeholder="@title"
              style={{ ...ctl, width: '100%' }}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <span className="btn vd-hbtn" onClick={() => void duplicateImage(rootImage.id)} title="copy this image in the Library (tree not copied)">
                ⧉ duplicate
              </span>
              <span className="btn vd-hbtn" style={{ color: 'var(--bad)' }} onClick={() => void deleteRoot()} title="delete this image AND its edit tree (tagged Library results survive)">
                🗑 delete
              </span>
            </div>
            {rootImage.editedFrom && (
              <div style={{ fontSize: 9, color: 'var(--dim)', marginTop: 4 }}>
                edited from {imgOf(rootImage.editedFrom)?.title ?? 'a deleted image'}
              </div>
            )}
          </div>
        )}
        <div className="lb">results tree — click = view + set as base</div>
        {/* root row */}
        {rootImage && (
          <div
            onClick={() => setSelNodeId(null)}
            style={{ display: 'flex', gap: 6, alignItems: 'center', padding: 4, borderRadius: 6, cursor: 'pointer', outline: selNodeId === null ? '1px solid var(--amber)' : '1px solid transparent' }}
          >
            <Thumbnail file={rootImage.file} w={56} h={36} />
            <div style={{ fontSize: 10, color: '#e8e8ee' }}>
              {rootImage.title}
              <div style={{ fontSize: 9, color: 'var(--dim)' }}>original</div>
            </div>
          </div>
        )}
        {rows.length === 0 && <p className="vd-hint">no results yet — Generate to grow the tree</p>}
        {rows.map(({ node, depth, childCount, hiddenCount }) => {
          const sel = node.id === selNodeId
          return (
            <div
              key={node.id}
              onClick={() => setSelNodeId(node.id)}
              title={node.prompt}
              style={{ display: 'flex', gap: 6, alignItems: 'flex-start', padding: 4, marginLeft: Math.min(depth, 6) * 12, borderRadius: 6, cursor: 'pointer', outline: sel ? '1px solid var(--amber)' : '1px solid transparent' }}
            >
              {/* branch fold — only nodes with children get the toggle */}
              <span
                onClick={(e) => {
                  e.stopPropagation()
                  if (childCount > 0) toggleCollapsed(node.id)
                }}
                title={childCount > 0 ? (hiddenCount ? `expand (${hiddenCount} hidden)` : 'collapse this branch') : undefined}
                style={{ width: 12, flex: '0 0 auto', textAlign: 'center', fontSize: 9, color: childCount > 0 ? 'var(--muted)' : 'transparent', cursor: childCount > 0 ? 'pointer' : 'default', paddingTop: 12 }}
              >
                {hiddenCount ? '▸' : '▾'}
              </span>
              <Thumbnail file={node.file} w={56} h={36} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 9, color: '#cfcfd6', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {node.keptImageId ? '★ ' : ''}{node.prompt}
                  {hiddenCount > 0 && <span style={{ color: 'var(--amber)' }}> +{hiddenCount} folded</span>}
                </div>
                {/* mini thumbs of the refs that made this node (the QoL ask) */}
                {node.refIds.length > 0 && (
                  <div style={{ display: 'flex', gap: 2, marginTop: 2 }}>
                    {node.refIds.slice(0, 4).map((rid) => {
                      const im = imgOf(rid)
                      return im ? <img key={rid} src={mediaUrl(im.file)} alt="" title={im.title} style={{ width: 16, height: 16, objectFit: 'cover', borderRadius: 2, border: '1px solid var(--line)' }} /> : null
                    })}
                  </div>
                )}
                {sel && session && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 3 }}>
                    {!node.keptImageId && (
                      <span
                        className="btn vd-hbtn"
                        onClick={(e) => {
                          e.stopPropagation()
                          void tagNode(session.id, node.id).then((id) => id && setStatus('★ saved to Library'))
                        }}
                        title="save this result to the Library as a new @image"
                      >
                        ★ → Library
                      </span>
                    )}
                    <span
                      className="btn vd-hbtn"
                      style={{ color: 'var(--bad)' }}
                      onClick={(e) => {
                        e.stopPropagation()
                        void deleteBranch(session.id, node.id)
                      }}
                      title="delete this node and everything generated from it (tagged Library images survive)"
                    >
                      🗑 branch
                    </span>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
