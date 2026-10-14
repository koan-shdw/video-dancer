import { vd } from '../api'
import { useEffect, useRef, useState } from 'react'
import { EmptyState } from '../ui/EmptyState'
import { useStore } from '../store'
import { mediaUrl } from '../media'
import { MIME_IMAGE, MIME_IMAGES, MIME_EDITNODE } from '../lib/dragDrop'
import { PICKABLE_IMAGE_MODELS, imageModelFor, imageViaFor, REGION_LINE } from '../shared/imageModels'
import { confirmDialog, alertDialog } from '../prompt'
import { ctl } from '../ui/controls'
import { Ic, Check, Copy, Crop, Trash2, Star, CircleDot, Pencil } from '../ui/icons'
import { Dropdown, aspectLabel } from '@koan/shared'
import { FloatPick } from '../ui/FloatPick'
import { ResizeHandle } from '../ui/ResizeHandle'
import { useFitPreview } from '../lib/fitPreview'
import { TakeTree, EditorSide, useTakeThumbW, type TakeTreeItem } from '../ui/TakeTree'
import { Section } from '@koan/shared'
import { openInEntry } from '../lib/externalEditor'
import { mentionMatches as mentionMatchesOf } from '../lib/disabledItems'
import { ContextMenu, type MenuEntry } from '@koan/shared'
import { type CropBox, cropPixels, fullCropBox, moveCropBox, resizeCropBox, zoomCropBox } from '../lib/imageCrop'

let compareMemo = false // the compare switch, remembered for the app session

// localStorage can be FORBIDDEN (a data: page — the browser test harness, CI 2026-09-19): the
// remembered model / dials then just fall back to their defaults, the panel still renders
const lsMem = new Map<string, string>()
const lsRead = (k: string): string | null => {
  try {
    return localStorage.getItem(k)
  } catch {
    return lsMem.get(k) ?? null
  }
}
const lsWrite = (k: string, v: string): void => {
  lsMem.set(k, v)
  try {
    localStorage.setItem(k, v)
  } catch {
    /* storage disabled — the in-memory copy carries the session */
  }
}

// ---- Image Editor: Nano Banana edit/generate with a persisted results TREE ----
// Double-click a Library image → edit it here. Every Generate runs FROM the selected node and
// appends its outputs as children. NOTHING reaches the Library until a node is tagged (★).
// DRAW LAYER: a non-destructive pen overlay per tree view (guide marks — "camera follows this
// line"). Visible = composited into the base image the model receives; hidden = not sent.

// ---- draw layer: pen strokes in NATURAL image pixels, keyed per (root image, tree node) so every
// view keeps its own marks. Session memory only (module-level — survives panel remounts, gone on
// app restart); never written into the source image on disk.
type Stroke = { color: string; width: number; pts: [number, number][] }
const DRAWINGS = new Map<string, Stroke[]>()
const DRAW_COLORS = ['#ffffff', '#000000', '#ff3b30', '#33d17a', '#3584e4', '#f6d32d']

// ---- SELECT (UI-ROUND-SPEC-2026-09-19 §6.3): ONE region per view, in NATURAL image pixels, session
// memory exactly like the draw layer. box = its two corners · lasso = the freehand polygon.
type Selection = { kind: 'box' | 'lasso'; pts: [number, number][] }
const SELECTIONS = new Map<string, Selection>()
const selPolygon = (s: Selection): [number, number][] => {
  if (s.kind === 'lasso') return s.pts
  const [[x0, y0], [x1, y1]] = [s.pts[0], s.pts[s.pts.length - 1]]
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
}
const selUsable = (s: Selection | undefined): s is Selection => {
  if (!s || s.pts.length < 2) return false
  const p = selPolygon(s)
  const xs = p.map((q) => q[0])
  const ys = p.map((q) => q[1])
  return Math.max(...xs) - Math.min(...xs) > 8 && Math.max(...ys) - Math.min(...ys) > 8 && (s.kind === 'box' || s.pts.length > 3)
}
const tracePolygon = (ctx: CanvasRenderingContext2D, p: [number, number][]): void => {
  ctx.beginPath()
  ctx.moveTo(p[0][0], p[0][1])
  for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1])
  ctx.closePath()
}
// the mask the model (GPT Image 2) or main's paste-back reads: white inside, black outside, the
// image's exact pixel size. Literal colors — never theme variables.
async function maskPngFor(w: number, h: number, s: Selection): Promise<Uint8Array | undefined> {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) return undefined
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#ffffff'
  tracePolygon(ctx, selPolygon(s))
  ctx.fill()
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'))
  return blob ? new Uint8Array(await blob.arrayBuffer()) : undefined
}
// what a `drawn` model is shown: the selection's closed outline in pure red, as one more stroke
const outlineStroke = (s: Selection, w: number, h: number): Stroke => {
  const p = selPolygon(s)
  return { color: '#ff0000', width: Math.max(4, Math.round(Math.max(w, h) / 300)), pts: [...p, p[0]] }
}

// ---- crop tool: Photoshop-style "scale the layer inside a fixed frame" ----
// The frame is the image's own size and never changes; dragging a handle OUTWARD grows the layer
// past the frame (opposite edge anchored), and whatever hangs outside is cropped on apply. The
// layer can never get smaller than the frame (scale-up only) — this is the border-noise fixer.
// `layer` lives in NATURAL image px: frame = [0,W]×[0,H]; invariants lx≤0, ly≤0, lx+lw≥W, ly+lh≥H.
const CROP_HANDLES: { hx: string; fx: number; fy: number; cursor: string }[] = [
  { hx: 'nw', fx: 0, fy: 0, cursor: 'nwse-resize' },
  { hx: 'n', fx: 0.5, fy: 0, cursor: 'ns-resize' },
  { hx: 'ne', fx: 1, fy: 0, cursor: 'nesw-resize' },
  { hx: 'e', fx: 1, fy: 0.5, cursor: 'ew-resize' },
  { hx: 'se', fx: 1, fy: 1, cursor: 'nwse-resize' },
  { hx: 's', fx: 0.5, fy: 1, cursor: 'ns-resize' },
  { hx: 'sw', fx: 0, fy: 1, cursor: 'nesw-resize' },
  { hx: 'w', fx: 0, fy: 0.5, cursor: 'ew-resize' }
]

function paintStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[]): void {
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const s of strokes) {
    if (s.pts.length === 0) continue
    ctx.strokeStyle = s.color
    ctx.lineWidth = s.width
    ctx.beginPath()
    ctx.moveTo(s.pts[0][0], s.pts[0][1])
    for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i][0], s.pts[i][1])
    if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] + 0.01, s.pts[0][1]) // a click = a dot
    ctx.stroke()
  }
}

// flatten base image + strokes to the PNG bytes the model receives (drawn pixels are literal colors
// on purpose — theme variables must never leak into model input)
async function compositeDraw(file: string, strokes: Stroke[]): Promise<Uint8Array | undefined> {
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous' // media:// serves CORS * — the canvas stays untainted
    img.src = mediaUrl(file)
    await new Promise<void>((res, rej) => {
      img.onload = () => res()
      img.onerror = () => rej(new Error('image load failed'))
    })
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const ctx = c.getContext('2d')
    if (!ctx) return undefined
    ctx.drawImage(img, 0, 0)
    paintStrokes(ctx, strokes)
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'))
    return blob ? new Uint8Array(await blob.arrayBuffer()) : undefined
  } catch {
    return undefined
  }
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
  const [promptH, setPromptH] = useState(0) // 0 = natural (rows=2); the handle above grows it UPWARD
  const [refIds, setRefIds] = useState<string[]>([])
  const [variants, setVariants] = useState(1)
  const [aspect, setAspect] = useState('auto')
  const [seed, setSeed] = useState('')
  const [selNodeId, setSelNodeId] = useState<string | null>(null) // null = the root image
  const [closedSecs, setClosedSecs] = useState<Set<string>>(new Set()) // folded cards
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [compareOn, setCompareOnState] = useState(compareMemo) // survives panel close / reopen for the session
  const setCompareOn = (v: boolean): void => {
    compareMemo = v
    setCompareOnState(v)
  }
  const [treeMenu, setTreeMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null)
  const [refDrag, setRefDrag] = useState(false)
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [titleDraft, setTitleDraft] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)
  // draw layer
  const [drawOn, setDrawOn] = useState(false) // visible = pen armed AND composited into the upload
  const [penColor, setPenColor] = useState(DRAW_COLORS[2]) // red default — visible on most footage
  const [penWidth, setPenWidth] = useState(6)
  const [drawRev, setDrawRev] = useState(0) // bumped per stroke edit → repaint
  const [ovBox, setOvBox] = useState<{ l: number; t: number; w: number; h: number } | null>(null) // canvas tracks the img's on-screen box
  const drawCanvasRef = useRef<HTMLCanvasElement>(null)
  // SELECT tool (UI-ROUND-SPEC §6.3): armed = the overlay takes the pointer; the selection itself
  // outlives the tool (it stays drawn, and rides every generate, until cleared)
  const [selectOn, setSelectOn] = useState(false)
  const [selShape, setSelShape] = useState<'box' | 'lasso'>('box')
  const [selRev, setSelRev] = useState(0)
  const selCanvasRef = useRef<HTMLCanvasElement>(null)
  const selDrag = useRef(false)
  const baseImgRef = useRef<HTMLImageElement>(null)
  const liveStroke = useRef<Stroke | null>(null)
  // crop tool (lib/imageCrop: a box over the picture) — mutually exclusive with the draw layer
  const [cropOn, setCropOn] = useState(false)
  const [cropBox, setCropBox] = useState<CropBox | null>(null)
  const [cropBusy, setCropBusy] = useState(false)
  const cropBusyRef = useRef(false)
  const cropCanvasRef = useRef<HTMLCanvasElement>(null)
  const cropDrag = useRef<{ hx: string; startX: number; startY: number; box: CropBox } | null>(null)
  const cropImage = useStore((s) => s.cropImage)
  const previewH = useStore((s) => s.previewH.imageEdit)
  const setPreviewH = useStore((s) => s.setPreviewH)
  const canvasBoxRef = useRef<HTMLDivElement>(null)
  const thumbW = useTakeThumbW() // the take cards' size: the tree zoom slider + ctrl+scroll, persisted

  // MODEL · VIA — Clip Gen's grammar (UI-ROUND-SPEC §6.2): the pick + who serves it, remembered
  // (VIA per model, like Clip Gen's per-family memory); size / quality are the model's own dials
  const [modelId, setModelIdState] = useState<string>(() => lsRead('vd.imgedit.model') ?? 'nano-banana-pro') // first pick = Pro (his call 09-22)
  const saved = imageModelFor(modelId)
  const model = saved.retired ? imageModelFor('nano-banana-pro') : saved // list 11: a retired pick moves on to Pro
  const lsGet = (k: string): string | null => lsRead(`vd.imgedit.${k}.${model.id}`)
  const [dialRev, setDialRev] = useState(0) // localStorage-backed dials re-read on change
  void dialRev
  const via = ((): string => {
    const saved = lsGet('via')
    return model.vias.some((v) => v.id === saved && v.ready) ? saved! : (model.vias.find((v) => v.ready)?.id ?? 'fal')
  })()
  const viaRow = imageViaFor(model, via)
  const sizes = viaRow?.resolutions ?? model.resolutions // list 10: a supplier can have its own size dial
  const resolution = sizes ? (sizes.includes(lsGet('size') ?? '') ? lsGet('size')! : sizes[0]) : undefined
  const quality = model.qualities ? (model.qualities.includes(lsGet('quality') ?? '') ? lsGet('quality')! : model.qualities[0]) : undefined
  const background = model.backgrounds ? (model.backgrounds.includes(lsGet('background') ?? '') ? lsGet('background')! : model.backgrounds[0]) : undefined // list 8
  // Nano Banana 2.1's thinking dial; a supplier that takes none greys it with its reason
  const thinking = model.thinking ? (model.thinking.includes(lsGet('thinking') ?? '') ? lsGet('thinking')! : model.thinking[0]) : undefined
  const thinkingOff = !model.thinking ? `${model.label} has no thinking setting` : viaRow?.noThinking
  const sentThinking = thinkingOff ? undefined : thinking
  const setDial = (k: 'via' | 'size' | 'quality' | 'background' | 'thinking', v: string): void => {
    lsWrite(`vd.imgedit.${k}.${model.id}`, v)
    setDialRev((n) => n + 1)
  }
  const setModelId = (id: string): void => {
    lsWrite('vd.imgedit.model', id)
    setModelIdState(id)
  }
  const rootImage = editorImageId ? project?.images.find((i) => i.id === editorImageId) : undefined
  const session = project?.editSessions.find((s) => s.rootImageId === (editorImageId ?? ''))
  const nodes = session?.nodes ?? []
  const selNode = selNodeId ? nodes.find((n) => n.id === selNodeId) : undefined
  const numOf = new Map(nodes.map((n, i) => [n.id, i + 1])) // T1, T2… in the order they were made
  const takeName = (id: string | null | undefined): string => (id && numOf.has(id) ? `T${numOf.get(id)}` : 'the original')
  const libImages = project?.images ?? []
  const imgOf = (id: string): ProjImage | undefined => libImages.find((i) => i.id === id)

  // what the canvas shows: the selected node's image, else the TRUE original (the root row says
  // "original" — the image's current face may be a primary tree version, viewable via its own node)
  const canvasFile = selNode?.file ?? session?.originalFile ?? rootImage?.file
  // COMPARE (UI-ROUND-SPEC-2026-09-19 §4): base = the image the selected result was MADE FROM — its
  // parent node, or the original for a first-level result (the tree's own word: "set as base").
  // The canvas box keeps the live img as its direct child (the draw / crop overlays measure
  // img.offsetLeft against it); compare just pads the box's left half and hangs the base there.
  const baseNode = selNode?.parentId ? nodes.find((n) => n.id === selNode.parentId) : undefined
  const baseFile = selNode ? (baseNode ? baseNode.file : (session?.originalFile ?? rootImage?.file)) : undefined
  const comparing = compareOn && !!baseFile
  const cropSource = `${project?.dir}\0${editorImageId}\0${canvasFile}`
  const cropSourceRef = useRef(cropSource)
  cropSourceRef.current = cropSource
  const fromScratch = editorImageId === '' // "✨ new image" session (no base)

  // ---- draw layer mechanics ----
  const drawKey = `${editorImageId ?? ''}:${selNodeId ?? 'root'}`
  const strokes = DRAWINGS.get(drawKey) ?? []
  // keep the overlay canvas glued to the img's rendered box AND its backing store at natural size
  const syncDraw = (): void => {
    const img = baseImgRef.current
    const c = drawCanvasRef.current
    if (!img || !img.naturalWidth) {
      setOvBox(null)
      return
    }
    // the img fills the box with object-fit: contain (list 11: a small image grows to fit too), so
    // the overlays ride the PICTURE inside it, not the element
    const s = Math.min(img.offsetWidth / img.naturalWidth, img.offsetHeight / img.naturalHeight)
    const w = img.naturalWidth * s
    const h = img.naturalHeight * s
    setOvBox({ l: img.offsetLeft + (img.offsetWidth - w) / 2, t: img.offsetTop + (img.offsetHeight - h) / 2, w, h })
    if (!c) return
    if (c.width !== img.naturalWidth || c.height !== img.naturalHeight) {
      c.width = img.naturalWidth
      c.height = img.naturalHeight
    }
    const ctx = c.getContext('2d')
    if (ctx) {
      ctx.clearRect(0, 0, c.width, c.height)
      paintStrokes(ctx, DRAWINGS.get(drawKey) ?? [])
    }
  }
  useEffect(syncDraw, [drawKey, drawRev, drawOn, canvasFile, comparing]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const img = baseImgRef.current
    if (!img) return
    const ro = new ResizeObserver(() => syncDraw())
    ro.observe(img)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasFile, drawOn])
  // the canvas box fits the image's height, no black bars (lib/fitPreview, shared with the Video Editor)
  const fitPreview = useFitPreview(
    canvasBoxRef,
    () => (baseImgRef.current?.naturalWidth ? { w: baseImgRef.current.naturalWidth, h: baseImgRef.current.naturalHeight } : null),
    'imageEdit',
    canvasFile,
    comparing
  )
  const toNat = (e: React.PointerEvent): [number, number] | null => {
    const c = drawCanvasRef.current
    if (!c) return null
    const r = c.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return null
    return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height]
  }
  const penDown = (e: React.PointerEvent): void => {
    const pt = toNat(e)
    if (!pt) return
    e.currentTarget.setPointerCapture(e.pointerId)
    liveStroke.current = { color: penColor, width: penWidth, pts: [pt] }
    DRAWINGS.set(drawKey, [...(DRAWINGS.get(drawKey) ?? []), liveStroke.current])
    setDrawRev((n) => n + 1)
  }
  const penMove = (e: React.PointerEvent): void => {
    const s = liveStroke.current
    const pt = toNat(e)
    if (!s || !pt) return
    s.pts.push(pt)
    // incremental segment paint — no full-clear per point
    const ctx = drawCanvasRef.current?.getContext('2d')
    if (ctx && s.pts.length > 1) {
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = s.color
      ctx.lineWidth = s.width
      const a = s.pts[s.pts.length - 2]
      const b = s.pts[s.pts.length - 1]
      ctx.beginPath()
      ctx.moveTo(a[0], a[1])
      ctx.lineTo(b[0], b[1])
      ctx.stroke()
    }
  }
  const penUp = (): void => {
    liveStroke.current = null
  }
  const clearDrawing = (): void => {
    DRAWINGS.delete(drawKey)
    setDrawRev((n) => n + 1)
  }

  // ---- SELECT mechanics: the overlay rides the img's box like the draw canvas; its backing store is
  // the image's natural size, so the selection is stored in the SAME pixels the mask is cut in ----
  const selection = SELECTIONS.get(drawKey)
  const hasSelection = selUsable(selection)
  const selNat = (e: React.PointerEvent): [number, number] | null => {
    const c = selCanvasRef.current
    if (!c) return null
    const r = c.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return null
    const cl = (v: number, hi: number): number => Math.max(0, Math.min(hi, v))
    return [cl(((e.clientX - r.left) / r.width) * c.width, c.width), cl(((e.clientY - r.top) / r.height) * c.height, c.height)]
  }
  const selDown = (e: React.PointerEvent): void => {
    const pt = selNat(e)
    if (!pt) return
    e.currentTarget.setPointerCapture(e.pointerId)
    selDrag.current = true
    SELECTIONS.set(drawKey, { kind: selShape, pts: [pt, pt] })
    setSelRev((n) => n + 1)
  }
  const selMove = (e: React.PointerEvent): void => {
    if (!selDrag.current) return
    const s = SELECTIONS.get(drawKey)
    const pt = selNat(e)
    if (!s || !pt) return
    if (s.kind === 'box') s.pts[1] = pt
    else s.pts.push(pt)
    setSelRev((n) => n + 1)
  }
  const selUp = (): void => {
    if (!selDrag.current) return
    selDrag.current = false
    if (!selUsable(SELECTIONS.get(drawKey))) SELECTIONS.delete(drawKey) // a click / a sliver = no selection
    setSelRev((n) => n + 1)
  }
  const clearSelection = (): void => {
    SELECTIONS.delete(drawKey)
    setSelRev((n) => n + 1)
  }
  // paint: everything OUTSIDE the selection dims, the edge is a dashed amber line (screen chrome —
  // the model never sees this canvas; what it sees is built in generate())
  useEffect(() => {
    const c = selCanvasRef.current
    const img = baseImgRef.current
    if (!c || !img?.naturalWidth) return
    if (c.width !== img.naturalWidth || c.height !== img.naturalHeight) {
      c.width = img.naturalWidth
      c.height = img.naturalHeight
    }
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, c.width, c.height)
    const s = SELECTIONS.get(drawKey)
    if (!s || s.pts.length < 2) return
    const poly = selPolygon(s)
    ctx.fillStyle = 'rgba(0,0,0,.5)'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    tracePolygon(ctx, poly)
    ctx.fill()
    ctx.restore()
    const k = c.width / Math.max(1, ovBox?.w ?? c.width) // natural px per screen px → a steady 1.5 px line
    ctx.lineWidth = 1.5 * k
    ctx.setLineDash([6 * k, 4 * k])
    ctx.strokeStyle = '#f5a524'
    tracePolygon(ctx, poly)
    ctx.stroke()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selRev, drawKey, ovBox, selectOn, canvasFile])

  // ---- crop tool mechanics ----
  const startCrop = (): void => {
    const img = baseImgRef.current
    if (!img?.naturalWidth || cropBusyRef.current) return
    setDrawOn(false) // one overlay at a time
    setSelectOn(false)
    setCropBox(fullCropBox(img.naturalWidth, img.naturalHeight))
    setCropOn(true)
    setStatus('crop: drag the edges or corners (Shift keeps the shape) · drag inside to move it · scroll to zoom · Enter = apply · Esc = cancel')
  }
  const cancelCrop = (): void => {
    if (cropBusyRef.current) return
    cropDrag.current = null
    setCropOn(false)
    setCropBox(null)
    setStatus('')
  }
  // the shade canvas rides the img's box: everything outside the crop box is dimmed
  const syncCrop = (): void => {
    const img = baseImgRef.current
    const c = cropCanvasRef.current
    if (!img?.naturalWidth || !c || !cropBox) return
    const W = img.naturalWidth
    const H = img.naturalHeight
    if (c.width !== W || c.height !== H) {
      c.width = W
      c.height = H
    }
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = 'rgba(0,0,0,.6)'
    ctx.fillRect(0, 0, W, H)
    ctx.clearRect(cropBox.x, cropBox.y, cropBox.w, cropBox.h)
  }
  useEffect(syncCrop, [cropBox, cropOn, ovBox]) // eslint-disable-line react-hooks/exhaustive-deps
  // viewing a different node (or image) mid-crop → the crop no longer targets what's on screen
  useEffect(() => {
    cropDrag.current = null
    setCropOn(false)
    setCropBox(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cropSource])
  const onCropHandleDown = (e: React.PointerEvent, hx: string): void => {
    if (!cropBox || cropBusyRef.current || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    cropDrag.current = { hx, startX: e.clientX, startY: e.clientY, box: cropBox }
  }
  const onCropHandleMove = (e: React.PointerEvent): void => {
    const d = cropDrag.current
    const img = baseImgRef.current
    if (!d || !img?.naturalWidth || !ovBox || cropBusyRef.current) return
    const W = img.naturalWidth
    const H = img.naturalHeight
    const dx = (e.clientX - d.startX) * (W / ovBox.w) // screen → natural px
    const dy = (e.clientY - d.startY) * (H / ovBox.h)
    setCropBox(d.hx === 'move' ? moveCropBox(d.box, W, H, dx, dy) : resizeCropBox(d.box, W, H, d.hx, dx, dy, e.shiftKey))
  }
  const onCropHandleUp = (): void => {
    cropDrag.current = null
  }
  const onCropCancel = (): void => {
    if (cropDrag.current) setCropBox(cropDrag.current.box)
    cropDrag.current = null
  }
  // A native non-passive listener prevents wheel zoom from scrolling the editor too. Scroll up =
  // zoom in = a smaller box around the cursor.
  useEffect(() => {
    const host = canvasBoxRef.current
    if (!cropOn || !host) return
    const wheel = (e: WheelEvent): void => {
      const img = baseImgRef.current, c = cropCanvasRef.current
      if (!img?.naturalWidth || !c) return
      e.preventDefault()
      if (cropBusyRef.current || cropDrag.current) return
      const r = c.getBoundingClientRect()
      if (!r.width || !r.height) return
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1)
      setCropBox(b => b && zoomCropBox(b, img.naturalWidth, img.naturalHeight, Math.exp(-delta * .002), (e.clientX - r.left) * img.naturalWidth / r.width, (e.clientY - r.top) * img.naturalHeight / r.height))
    }
    host.addEventListener('wheel', wheel, { passive: false })
    return () => host.removeEventListener('wheel', wheel)
  }, [cropOn])
  // bake the box's own pixels, at their own size → a tree node that main also makes ◉ primary,
  // so every clip using the image gets the cropped version
  const applyCrop = async (): Promise<void> => {
    const imgEl = baseImgRef.current
    if (!cropBox || !canvasFile || !imgEl?.naturalWidth || editorImageId == null || cropBusyRef.current) return
    const W = imgEl.naturalWidth
    const H = imgEl.naturalHeight
    const px = cropPixels(cropBox, W, H)
    if (px.w >= W && px.h >= H) return cancelCrop() // the whole picture = nothing cropped
    cropDrag.current = null
    cropBusyRef.current = true
    setCropBusy(true)
    const source = cropSource
    try {
      const c = document.createElement('canvas')
      c.width = px.w
      c.height = px.h
      const ctx = c.getContext('2d')
      if (!ctx) throw new Error('canvas unavailable')
      ctx.drawImage(imgEl, px.x, px.y, px.w, px.h, 0, 0, px.w, px.h)
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'))
      if (!blob) throw new Error('png encode failed')
      const bytes = new Uint8Array(await blob.arrayBuffer())
      if (cropSourceRef.current !== source) return
      const label = `crop · ${px.w}×${px.h} · ${px.x}, ${px.y}`
      const nodeId = await cropImage(editorImageId, selNodeId, bytes, label)
      if (cropSourceRef.current !== source) return
      if (nodeId) {
        setCropOn(false)
        setCropBox(null)
        setSelNodeId(nodeId)
        setStatus(rootImage ? '✓ cropped — set as ◉ primary, clips using this image follow (Ctrl+Z or ◉ on the original to revert)' : '✓ cropped — added to the tree')
      } else setStatus('✕ crop save failed')
    } catch (e) {
      if (cropSourceRef.current === source) setStatus('✕ crop failed: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      cropBusyRef.current = false
      setCropBusy(false)
    }
  }
  // Enter applies, Esc cancels — only while the crop overlay is up and focus isn't in a field
  useEffect(() => {
    if (!cropOn) return
    const onKey = (e: KeyboardEvent): void => {
      if (document.querySelector('[aria-modal="true"]')) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        if (e.key === 'Escape') cancelCrop()
        else void applyCrop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cropOn, cropBox, cropBusy])
  // bake the marks into a Library copy — the route to the VIDEO model: attach the copy to a clip
  // as a ref (ref2v) and let reference_handling explain the marks. Never an i2v start frame — i2v
  // reproduces the first frame literally, arrows and all.
  const saveAnnotated = async (): Promise<void> => {
    if (!canvasFile || strokes.length === 0) return
    const bytes = await compositeDraw(canvasFile, strokes)
    if (!bytes) {
      setStatus('✕ could not bake the drawing')
      return
    }
    const base = (rootImage?.title ?? '@sketch').replace(/^@/, '')
    const id = await useStore.getState().saveFrame(bytes, `${base} annotated`)
    setStatus(id ? '✓ annotated copy saved to Library — attach it to a clip as a ref so the video model sees it' : '✕ save failed')
  }

  // progress line from main
  useEffect(() => vd().onImageProgress((m) => setStatus(m)), [])
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
  const setPrimary = useStore((s) => s.setPrimaryNode)
  // does this node's subtree contain the primary version? (its branch can't be deleted while it does)
  const subtreeHasPrimary = (rootId: string): boolean => {
    if (!session?.primaryNodeId) return false
    const doomed = new Set([rootId])
    let grew = true
    while (grew) {
      grew = false
      for (const n of nodes)
        if (n.parentId && doomed.has(n.parentId) && !doomed.has(n.id)) {
          doomed.add(n.id)
          grew = true
        }
    }
    return doomed.has(session.primaryNodeId)
  }
  const tryDeleteBranch = async (nodeId: string): Promise<void> => {
    if (!session) return
    if (subtreeHasPrimary(nodeId)) {
      await alertDialog('This branch holds the PRIMARY version of the image — pick another primary (or revert to the original) first.')
      return
    }
    // one click used to delete a whole branch of paid edits with no question (audit 2026-10-09 H2)
    const kids = nodes.filter((n) => n.parentId === nodeId).length
    if (!(await confirmDialog(`Delete this version${kids ? ' and its whole branch' : ''}? (undoable — Ctrl+Z)`, { confirmLabel: 'Delete', danger: true }))) return
    void deleteBranch(session.id, nodeId)
  }
  const deleteRoot = async (): Promise<void> => {
    if (!rootImage) return
    const uses = usesOf(rootImage.id)
    const treeSize = nodes.length
    const msg = `Delete ${rootImage.title}?${uses ? ` It's referenced by ${uses} clip(s).` : ''}${treeSize ? ` Its edit tree (${treeSize} result${treeSize > 1 ? 's' : ''}) goes with it — tagged Library images survive.` : ''}`
    if (await confirmDialog(msg, { confirmLabel: 'Delete', danger: true })) void deleteImage(rootImage.id) // editor clears itself via applyDelta
  }
  // right-click a take card (UI-ROUND-SPEC §2 + his 10-11 call): the old row buttons — ◉ primary,
  // ★ save to the Library, delete branch — join open in ▸ · reveal file
  const openTakeMenu = (e: React.MouseEvent, id: string | null): void => {
    const node = id ? nodes.find((n) => n.id === id) : undefined
    const file = node ? node.file : (session?.originalFile ?? rootImage?.file)
    if (!file) return
    const isPrimary = node ? session?.primaryNodeId === node.id : !session?.primaryNodeId
    const entries: MenuEntry[] = []
    if (session && rootImage && !isPrimary)
      entries.push({
        label: <><Ic i={CircleDot} size={12} /> make primary</>,
        title: node ? 'its thumbnail AND every clip using the image switch to this version; the tree keeps everything' : 'the ORIGINAL becomes the image’s face again (clips follow; the tree keeps everything)',
        onClick: () => void setPrimary(session.id, node?.id ?? null).then((ok) => ok && setStatus(node ? '◉ primary set — clips now use this version' : '◉ original is primary again'))
      })
    if (session && node && !node.keptImageId)
      entries.push({ label: <><Ic i={Star} size={12} /> save to Library</>, title: 'this result becomes a new @image (dragging the card onto the Library works too)', onClick: () => void tagNode(session.id, node.id).then((nid) => nid && setStatus('★ saved to Library')) })
    entries.push(openInEntry(file, rootImage?.title ?? 'image', rootImage?.id), { label: <>reveal file</>, onClick: () => void vd().revealFile(file) })
    if (node) entries.push({ label: '', sep: true }, { label: <><Ic i={Trash2} size={12} /> delete branch</>, danger: true, onClick: () => void tryDeleteBranch(node.id) })
    setTreeMenu({ x: e.clientX, y: e.clientY, entries })
  }
  // reset per-editor-target state when the target changes — opening lands on the PRIMARY version
  // (the face the Library thumb shows), falling back to the original when none is set
  useEffect(() => {
    setSelNodeId(session?.primaryNodeId ?? null)
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

  // a supplier with its own ratio list offers only those; 'auto' stays on an edit (the app sends
  // the nearest ratio when the supplier can't match the base by itself)
  const ownAspects = fromScratch ? model.aspectRatiosGenerate : model.aspectRatiosEdit
  const aspects = viaRow?.aspects ? ownAspects.filter((a) => (a === 'auto' && !fromScratch) || viaRow.aspects!.includes(a)) : ownAspects
  const estCost = (viaRow?.price ?? model.price)({ resolution, quality, thinking: sentThinking, refs: refIds.length }) * variants
  // list 9 / 50: a Bridge supplier spends its plan's credits, not dollars
  const viaCredits = viaRow?.bridge ? viaRow.credits?.({ resolution }) : undefined
  const costLabel = viaRow?.bridge ? (viaCredits != null ? `~${+(viaCredits * variants).toFixed(2)} ${viaRow.label.replace(' Bridge', '')} credits` : `${viaRow.label.replace(' Bridge', '')} plan credits`) : `~$${estCost.toFixed(3)}`
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
    ? mentionMatchesOf(libImages, mention.query)
    : []

  // 58 (2026-09-29): Image Edit renders go through the shared queue — the Video Editor's grammar:
  // ▶ generate now runs at once (several at a time, capped per provider), ＋ queue runs in order.
  // Press again for another render; each one lands in the tree when it finishes.
  const generate = async (lane: 'queue' | 'now' = 'now'): Promise<void> => {
    if (!prompt.trim()) return setStatus('write the instruction first')
    if (editorImageId == null) return
    if (refIds.length + 1 > model.maxImages) return setStatus(`error: ${model.label} takes ${model.maxImages} images at most (base + refs) — remove ${refIds.length + 1 - model.maxImages}`)
    setBusy(true)
    // SELECT: the mask (white inside) always rides — GPT Image 2 takes it as a real mask, main's
    // paste-back reads it for every other model. A `drawn` model is also SHOWN the outline.
    const sel = SELECTIONS.get(drawKey)
    const natW = baseImgRef.current?.naturalWidth ?? 0
    const natH = baseImgRef.current?.naturalHeight ?? 0
    let maskPng: Uint8Array | undefined
    if (selUsable(sel) && canvasFile && natW && natH) {
      maskPng = await maskPngFor(natW, natH, sel)
      if (!maskPng) {
        setBusy(false)
        return setStatus('error: couldn’t build the selection mask')
      }
    }
    // draw layer visible + has marks (and / or the selection's outline) → flatten into the base the model receives
    let basePng: Uint8Array | undefined
    const sendStrokes = [...(drawOn ? strokes : []), ...(maskPng && selUsable(sel) && model.region === 'drawn' ? [outlineStroke(sel, natW, natH)] : [])]
    if (canvasFile && sendStrokes.length > 0) {
      setStatus('flattening draw layer…')
      basePng = await compositeDraw(canvasFile, sendStrokes)
      if (!basePng) {
        setBusy(false)
        return setStatus('error: couldn’t flatten the draw layer')
      }
    }
    setBusy(false)
    const dispatch = lane === 'now' ? useStore.getState().renderNow : useStore.getState().enqueueRender
    dispatch({
      kind: 'image',
      label: `${rootImage?.title ?? 'new image'} · image edit`,
      thumb: canvasFile ?? undefined,
      engineLabel: model.label,
      estCost: estCost > 0 ? estCost : undefined,
      payload: {
        rootImageId: editorImageId,
        parentNodeId: selNodeId,
        prompt: prompt.trim(),
        refIds,
        numImages: variants,
        seed: !model.seed || seed.trim() === '' ? undefined : parseInt(seed, 10) || undefined,
        aspectRatio: aspect,
        basePng,
        model: model.id,
        via,
        resolution,
        quality,
        background,
        thinking: sentThinking,
        maskPng
      }
    })
    setStatus(lane === 'now' ? 'sent ✓ — it lands in the tree when done (Queue window shows it)' : 'queued ✓ — runs in order (Queue window)')
  }

  // completion watcher (the Video Editor's): a finished image job for THIS image selects its first
  // fresh node, as a direct render used to
  const queue = useStore((s) => s.queue)
  useEffect(() => {
    const job = queue.find((j) => j.kind === 'image' && j.status === 'done' && !j.consumed)
    if (!job) return
    useStore.getState().consumeJob(job.id)
    const p = job.payload as { rootImageId?: string }
    if (p.rootImageId === editorImageId && job.resultNodeId) {
      setSelNodeId(job.resultNodeId)
      setStatus('done ✓ — results added to the tree')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue])

  if (!project || editorImageId == null) {
    // images FLOAT in the empty panel to be chosen from (the empty-panel grammar, 2026-09-01)
    const imgs = project?.images ?? []
    return (
      <EmptyState>
        {imgs.length > 0 ? (
          <>
            no image open — double-click one
            <FloatPick items={imgs.map((im) => ({ id: im.id, label: im.title, file: im.file }))} onOpen={(id) => useStore.getState().setEditorImage(id)} hint="double-click to edit it here" />
          </>
        ) : (
          <>double-click a Library image to edit it here</>
        )}
      </EmptyState>
    )
  }

  const baseName = takeName(selNode?.id)
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
  const treeItems: TakeTreeItem[] = nodes.map((n) => {
    const primary = session?.primaryNodeId === n.id
    const story = `${imageModelFor(n.model).label} · ${n.via ?? 'fal'}${n.region === 'mask' ? ' · selection: real mask' : n.region === 'pasted' ? ' · selection: only that area kept' : n.region ? ` · ${n.region}` : ''}`
    return {
      id: n.id,
      parentId: n.parentId,
      file: n.file,
      num: numOf.get(n.id) ?? 0,
      line: `${imageModelFor(n.model).label}${n.via ? ` · ${n.via}` : ''}`,
      prompt: n.prompt,
      primary,
      kept: !!n.keptImageId,
      refs: n.refIds.map((rid) => imgOf(rid)).filter((im): im is ProjImage => !!im).map((im) => ({ file: im.file, title: im.title })),
      title: `${primary ? '◉ PRIMARY — clips use this version everywhere\n' : ''}${n.prompt}\n${story}\n\nclick = view + details · drag onto the Library to save as a new @image · right-click = ◉ primary / save / open in / delete`
    }
  })

  return (
    <div className="vd-panel" style={{ display: 'flex', height: '100%', background: 'var(--bg0)' }}>
      {/* ---- left: the canvas big · the cards · the pinned footer (Image Gen's frame, shared with the Video Editor) ---- */}
      <div className="vd-inspector" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div ref={canvasBoxRef} style={{ flex: '0 0 auto', height: previewH, minHeight: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', position: 'relative', boxSizing: 'border-box', paddingLeft: comparing ? '50%' : 0 }}>
          {/* compare: the BASE, view-only, in the padded left half — same height, same contain fit */}
          {comparing && baseFile && (
            <div style={{ position: 'absolute', left: 0, top: 0, width: '50%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid var(--line2)', boxSizing: 'border-box' }}>
              <img src={mediaUrl(baseFile)} draggable={false} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              <div style={{ position: 'absolute', top: 6, left: 8, fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--muted)', background: 'rgba(0,0,0,.55)', padding: '2px 6px', borderRadius: 4 }}>
                base — {baseNode ? `"${baseNode.prompt.slice(0, 50)}"` : 'original'}
              </div>
            </div>
          )}
          {canvasFile ? (
            <img ref={baseImgRef} src={mediaUrl(canvasFile)} crossOrigin="anonymous" draggable={false} alt="" onLoad={() => {
              fitPreview()
              syncDraw()
            }} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : (
            <span style={{ color: 'var(--dim)', fontSize: 12 }}>✨ from-scratch session — write a prompt and Generate</span>
          )}
          {/* the draw layer rides EXACTLY on the img's rendered box; backing store is natural pixels */}
          {canvasFile && drawOn && ovBox && (
            <canvas
              ref={drawCanvasRef}
              onPointerDown={penDown}
              onPointerMove={penMove}
              onPointerUp={penUp}
              onPointerCancel={penUp}
              style={{ position: 'absolute', left: ovBox.l, top: ovBox.t, width: ovBox.w, height: ovBox.h, cursor: 'crosshair', touchAction: 'none', zIndex: 2 }}
            />
          )}
          {/* SELECT overlay: shown while the tool is armed OR a selection exists; it only takes the
              pointer while armed, so draw marks and the selection can live on one view */}
          {canvasFile && ovBox && (selectOn || hasSelection) && !cropOn && (
            <canvas
              ref={selCanvasRef}
              onPointerDown={selDown}
              onPointerMove={selMove}
              onPointerUp={selUp}
              onPointerCancel={selUp}
              style={{ position: 'absolute', left: ovBox.l, top: ovBox.t, width: ovBox.w, height: ovBox.h, cursor: selectOn ? 'crosshair' : 'default', pointerEvents: selectOn ? 'auto' : 'none', touchAction: 'none', zIndex: 3 }}
            />
          )}
          {/* crop overlay (Photoshop's crop): the picture stays put, outside the box is shaded, the box
              drags, its 8 handles move its sides and corners */}
          {canvasFile && cropOn && cropBox && ovBox && baseImgRef.current?.naturalWidth ? (() => {
            const kx = ovBox.w / baseImgRef.current.naturalWidth
            const ky = ovBox.h / baseImgRef.current.naturalHeight
            const bx = ovBox.l + cropBox.x * kx, by = ovBox.t + cropBox.y * ky, bw = cropBox.w * kx, bh = cropBox.h * ky
            const drag = (hx: string) => ({
              onPointerDown: (e: React.PointerEvent) => onCropHandleDown(e, hx),
              onPointerMove: onCropHandleMove,
              onPointerUp: onCropHandleUp,
              onPointerCancel: onCropCancel,
              onLostPointerCapture: onCropHandleUp
            })
            return (
              <>
                <canvas ref={cropCanvasRef} aria-hidden style={{ position: 'absolute', left: ovBox.l, top: ovBox.t, width: ovBox.w, height: ovBox.h, zIndex: 2, pointerEvents: 'none' }} />
                <div
                  aria-label="Crop box"
                  {...drag('move')}
                  title="drag to move the crop · scroll to zoom"
                  style={{ position: 'absolute', left: bx, top: by, width: bw, height: bh, zIndex: 3, cursor: cropBusy ? 'wait' : 'move', touchAction: 'none', outline: '1px dashed var(--amber)', outlineOffset: -1 }}
                />
                {CROP_HANDLES.map((h) => (
                  <div
                    key={h.hx}
                    aria-label={`Crop ${h.hx} handle`}
                    {...drag(h.hx)}
                    title="drag to move this side of the crop · Shift keeps the shape"
                    style={{
                      position: 'absolute',
                      left: bx + h.fx * bw - 6,
                      top: by + h.fy * bh - 6,
                      width: 12,
                      height: 12,
                      background: 'var(--amber)',
                      border: '1px solid rgba(0,0,0,.6)',
                      borderRadius: 3,
                      cursor: h.cursor,
                      touchAction: 'none',
                      zIndex: 4
                    }}
                  />
                ))}
              </>
            )
          })() : null}
          <div style={{ position: 'absolute', top: 6, left: comparing ? 'calc(50% + 8px)' : 8, fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--muted)', background: 'rgba(0,0,0,.55)', padding: '2px 6px', borderRadius: 4 }}>
            {comparing ? 'result — ' : ''}
            {selNode ? `${baseName} · "${selNode.prompt.slice(0, 60)}"` : rootImage ? `${rootImage.title} (${session?.primaryNodeId ? '◉ primary' : 'original'})` : 'new image'}
          </div>
          {/* draw toolbar — pen colors, width, clear, and the layer toggle */}
          {canvasFile && (
            <div style={{ position: 'absolute', top: 6, right: 8, display: 'flex', gap: 6, alignItems: 'center', background: 'rgba(0,0,0,.55)', padding: '3px 6px', borderRadius: 5, zIndex: 5 }}>
              {cropOn && cropBox && baseImgRef.current?.naturalWidth ? (
                <span aria-label="Crop size" style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
                  {(({ w, h }) => `${w} × ${h}`)(cropPixels(cropBox, baseImgRef.current.naturalWidth, baseImgRef.current.naturalHeight))}
                </span>
              ) : null}
              {/* compare — the toolbar's own toggle grammar (crop / draw); greyed with the reason when there is no base */}
              <span
                className="btn vd-hbtn"
                onClick={() => baseFile && setCompareOn(!compareOn)}
                style={{ ...(comparing ? { background: 'var(--amber)', color: 'var(--on-accent)' } : {}), ...(baseFile ? {} : { opacity: 0.45, cursor: 'not-allowed' }) }}
                title={!baseFile ? 'pick a result in the tree to compare — the original has no base' : comparing ? 'compare ON — base left, result right; click to go back to one image' : 'compare — see the base image next to this result'}
              >
                compare
              </span>
              {/* select — box / lasso. The selection rides every generate until cleared (§6.3) */}
              {selectOn && (
                <>
                  {(['box', 'lasso'] as const).map((sh) => (
                    <span key={sh} className="btn vd-hbtn" onClick={() => setSelShape(sh)} style={selShape === sh ? { outline: '1px solid var(--amber)' } : { opacity: 0.7 }} title={sh === 'box' ? 'drag a box' : 'draw a freehand loop — it closes when you let go'}>
                      {sh}
                    </span>
                  ))}
                </>
              )}
              {hasSelection && (
                <span className="btn vd-hbtn" onClick={clearSelection} title="clear the selection — edits go back to the whole image">
                  clear
                </span>
              )}
              <span
                className="btn vd-hbtn"
                onClick={() => {
                  if (!selectOn) {
                    if (cropOn) cancelCrop() // one tool holds the pointer at a time
                    setDrawOn(false)
                  }
                  setSelectOn((v) => !v)
                }}
                style={selectOn ? { background: 'var(--amber)', color: 'var(--on-accent)' } : hasSelection ? { outline: '1px solid var(--amber)' } : undefined}
                title={
                  selectOn
                    ? 'select ON — drag on the image; the edit happens only inside your selection'
                    : hasSelection
                      ? 'a selection is set — only that area changes on generate; click to redraw it'
                      : 'select the area the edit should happen in — the model still sees the whole image'
                }
              >
                select
              </span>
              {cropOn && (
                <button className="btn vd-hbtn" disabled={cropBusy} onClick={startCrop} title="back to the whole picture">reset</button>
              )}
              {cropOn && (
                <span
                  className="btn vd-hbtn"
                  onClick={() => void applyCrop()}
                  title="apply (Enter) — bakes the crop at the image's own size; the result becomes the image's ◉ primary face (clips follow, Ctrl+Z reverts)"
                  style={{ opacity: cropBusy ? 0.5 : 1, pointerEvents: cropBusy ? 'none' : 'auto' }}
                >
                  <Ic i={Check} size={11} /> {cropBusy ? 'applying…' : 'apply'}
                </span>
              )}
              <span
                className="btn vd-hbtn"
                onClick={() => (cropOn ? cancelCrop() : startCrop())}
                style={cropOn ? { background: 'var(--amber)', color: 'var(--on-accent)' } : undefined}
                title={
                  cropOn
                    ? 'cancel crop (Esc)'
                    : 'crop: drag the edges or corners, drag inside to move, scroll to zoom; the result is the box’s own pixels'
                }
              >
                <Ic i={Crop} size={11} /> crop
              </span>
              {drawOn && (
                <>
                  {DRAW_COLORS.map((c) => (
                    <span
                      key={c}
                      onClick={() => setPenColor(c)}
                      title="pen color"
                      style={{ width: 14, height: 14, borderRadius: 7, background: c, cursor: 'pointer', flex: '0 0 auto', border: penColor === c ? '2px solid var(--amber)' : '1px solid rgba(255,255,255,.35)' }}
                    />
                  ))}
                  <input
                    type="range"
                    min={2}
                    max={40}
                    value={penWidth}
                    onChange={(e) => setPenWidth(parseInt(e.target.value, 10))}
                    title={`pen width — ${penWidth}px`}
                    style={{ width: 70, accentColor: 'var(--amber)' }}
                  />
                  <span className="btn vd-hbtn" onClick={clearDrawing} title="clear all marks on this view" style={{ opacity: strokes.length ? 1 : 0.4 }}>
                    <Ic i={Trash2} size={11} />
                  </span>
                  <span
                    className="btn vd-hbtn"
                    onClick={() => void saveAnnotated()}
                    title="bake the marks into a copy saved to the Library — attach that copy to a clip as a reference and the VIDEO model sees your guidance (ref2v only; never use it as an i2v start frame)"
                    style={{ opacity: strokes.length ? 1 : 0.4 }}
                  >
                    <Ic i={Copy} size={11} /> → lib
                  </span>
                </>
              )}
              <span
                className="btn vd-hbtn"
                onClick={() => {
                  if (!drawOn && cropOn) cancelCrop() // one overlay at a time
                  if (!drawOn) setSelectOn(false) // the pen takes the pointer back from select
                  setDrawOn((v) => !v)
                }}
                style={drawOn ? { background: 'var(--amber)', color: 'var(--on-accent)' } : undefined}
                title={
                  drawOn
                    ? 'draw layer ON — marks are visible and SENT to the model with Generate; click to hide (hidden = not sent)'
                    : 'draw on the image — pen marks guide the model ("camera follows this line", arrows, regions); only sent while visible'
                }
              >
                <Ic i={Pencil} size={11} /> draw{strokes.length ? ` (${strokes.length})` : ''}
              </span>
            </div>
          )}
        </div>

        {/* the canvas height — the house resize handle, persisted (one resize app-wide, his order 2026-09-09) */}
        <ResizeHandle value={previewH} maxOf={() => (canvasBoxRef.current?.parentElement?.clientHeight ?? 800) - 160} onChange={(h) => setPreviewH('imageEdit', h)} title="drag to resize the canvas" />
        <div className="vd-scroll" style={{ flex: 1, minHeight: 0, padding: 10, position: 'relative' }}>
          {/* ---- MODEL card: MODEL · VIA — Clip Gen's grammar (§6.2), each dial under its label. Dials a model lacks stay, greyed with the reason ---- */}
          {sec('model', 'model', <>
          <div className="field" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '0 0 auto' }}>
              <div className="lb">model</div>
              <Dropdown value={model.id} options={PICKABLE_IMAGE_MODELS.map((m) => ({ value: m.id, label: m.label }))} onChange={setModelId} title="the model that makes the edit" />
            </div>
            <div style={{ flex: '0 0 auto' }}>
              <div className="lb">via</div>
              <Dropdown
                value={via}
                options={model.vias.map((v) => ({ value: v.id, label: v.label, disabled: !v.ready, title: v.ready ? undefined : v.reason }))}
                onChange={(v) => setDial('via', v)}
                disabled={model.vias.length < 2}
                title={model.vias.length < 2 ? `${model.label} has one supplier` : 'who serves this model'}
              />
            </div>
            <div style={{ flex: '0 0 auto' }}>
              <div className="lb">size</div>
              <Dropdown
                value={resolution ?? '—'}
                options={(sizes ?? ['—']).map((r) => ({ value: r, label: r }))}
                onChange={(v) => setDial('size', v)}
                disabled={!sizes}
                title={sizes ? 'output size — bigger costs more' : `${model.label} has no size dial`}
              />
            </div>
            <div style={{ flex: '0 0 auto' }}>
              <div className="lb">quality</div>
              <Dropdown
                value={quality ?? '—'}
                options={(model.qualities ?? ['—']).map((q) => ({ value: q, label: q }))}
                onChange={(v) => setDial('quality', v)}
                disabled={!model.qualities}
                title={model.qualities ? `render quality — ${model.qualities[0]} is the default; lower is cheaper and faster` : `${model.label} has no quality dial`}
              />
            </div>
            <div style={{ flex: '0 0 auto' }}>
              <div className="lb">background</div>
              <Dropdown
                value={background ?? '—'}
                options={(model.backgrounds ?? ['—']).map((b) => ({ value: b, label: b }))}
                onChange={(v) => setDial('background', v)}
                disabled={!model.backgrounds}
                title={model.backgrounds ? 'the background — transparent gives a see-through PNG, like a sticker' : `${model.label} has no background dial`}
              />
            </div>
            <div style={{ flex: '0 0 auto' }}>
              <div className="lb">thinking</div>
              <Dropdown
                value={thinkingOff ? '—' : (thinking ?? '—')}
                options={(thinkingOff ? ['—'] : model.thinking!).map((t) => ({ value: t, label: t }))}
                onChange={(v) => setDial('thinking', v)}
                disabled={!!thinkingOff}
                title={thinkingOff ?? 'how hard the model thinks before it draws: high follows the prompt closest and costs a little more'}
              />
            </div>
          </div>
          <div className="field" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 2 }}>
            <div style={{ flex: '0 0 auto' }}>
              <div className="lb">aspect</div>
              <Dropdown
                value={hasSelection && canvasFile ? 'auto' : aspect}
                options={(aspects.includes(aspect) ? aspects : [aspect, ...aspects]).map((a) => ({ value: a, label: aspectLabel(a) }))}
                onChange={setAspect}
                disabled={hasSelection && !!canvasFile}
                title={hasSelection && canvasFile ? 'a selection keeps the image’s own shape — clear it to change the aspect' : 'the shape of the result'}
              />
            </div>
            <div style={{ flex: '0 0 auto' }}>
              <div className="lb">variants</div>
              <Dropdown value={String(variants)} options={Array.from({ length: model.maxVariants }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} onChange={(v) => setVariants(parseInt(v, 10))} title="how many variants each generate makes — every one is its own take" />
            </div>
            <div style={{ flex: '0 0 auto' }} title={model.seed ? 'blank = random every time · a number = the same noise every time' : `${model.label} has no seed`}>
              <div className="lb">seed</div>
              <input value={model.seed ? seed : ''} onChange={(e) => setSeed(e.target.value)} placeholder="—" disabled={!model.seed} style={{ ...ctl, width: 92, opacity: model.seed ? 1 : 0.45 }} />
            </div>
          </div>
          </>)}

          {/* ---- PROMPT card: the refs above the change (Clip Gen's order) ---- */}
          {sec('prompt', 'prompt', <>
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
              // the whole Library selection comes along, in its order (addRef caps at the model's maximum);
              // only the grabbed tile used to land (audit 2026-10-09 L25)
              let ids: string[] = []
              try {
                const many = JSON.parse(e.dataTransfer.getData(MIME_IMAGES) || '[]') as unknown
                if (Array.isArray(many)) ids = many.filter((x): x is string => typeof x === 'string' && libImages.some((i) => i.id === x))
              } catch {
                /* not a selection drag */
              }
              if (!ids.length) {
                const im = libImages.find((i) => i.file === f)
                if (im) ids = [im.id]
              }
              for (const id of ids) addRef(id)
            }}
            style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 6, padding: 4, borderRadius: 6, outline: refDrag ? '1px dashed var(--amber)' : '1px dashed transparent' }}
          >
            <span className="lb" style={{ margin: 0 }}>refs</span>
            <style>{`@keyframes vd-ref-float { 0% { transform: translateY(0) } 50% { transform: translateY(-3px) } 100% { transform: translateY(0) } }`}</style>
            {refIds.map((id, i) => {
              const im = imgOf(id)
              if (!im) return null
              // the SAME square chip grammar as Clip Gen's prompt refs (user order 2026-09-01)
              return (
                <span key={id} style={{ display: 'inline-block', animation: `vd-ref-float ${5 + (i % 3)}s ease-in-out infinite` }}>
                  <span
                    title={`${im.title} — image ref`}
                    style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: 4, borderRadius: 5, border: '1px solid var(--line2)', background: 'var(--raised2)', transform: `rotate(${(((i * 37) % 5) - 2) * 0.6}deg)`, userSelect: 'none' }}
                  >
                    <span style={{ position: 'relative' }}>
                      <img src={mediaUrl(im.file)} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 3, display: 'block' }} />
                      <span
                        title="remove this ref"
                        style={{ position: 'absolute', top: -5, right: -5, width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 8, fontSize: 8, color: 'var(--dim)', cursor: 'pointer' }}
                        onClick={() => setRefIds((p) => p.filter((x) => x !== id))}
                      >
                        ✕
                      </span>
                    </span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: 'var(--gold)', maxWidth: 78, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{im.title}</span>
                  </span>
                </span>
              )
            })}
            <span title="drag Library images here · or type @ in the prompt" style={{ width: 64, height: 64, borderRadius: 5, border: '1px dashed var(--line2)', background: 'var(--field)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: 'var(--dim)' }}>＋ drag</span>
            {refWarn && <span style={{ fontSize: 9, color: 'var(--amber)' }}>⚠ identity fidelity drops with many images</span>}
          </div>
          <div className="lb" title="say what changes — type @ to add a Library image as a reference">{fromScratch ? 'image' : 'change'}</div>
          {/* bottom-pinned box: the handle above drags UP to grow it (the Co-Director fix, same grammar) */}
          <ResizeHandle value={promptH || 54} min={54} invert maxOf={() => Math.min(320, window.innerHeight * 0.4)} onChange={setPromptH} title="drag up to grow the prompt box" />
          <textarea
            ref={taRef}
            value={prompt}
            onChange={onPrompt}
            onBlur={() => setTimeout(() => setMention(null), 150)}
            placeholder={fromScratch ? 'describe the image to generate…' : 'describe the change — type @ to add a reference'}
            rows={2}
            style={{ ...ctl, width: '100%', resize: 'none', ...(promptH ? { height: promptH } : {}) }}
          />
          {mentionMatches.length > 0 && (
            <div style={{ position: 'absolute', zIndex: 20, left: 8, right: 8, background: 'var(--bg2)', border: '1px solid var(--line2)', borderRadius: 4, maxHeight: 140, overflow: 'auto' }}>
              {mentionMatches.map((im) => (
                <div
                  key={im.id}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pickMention(im)
                  }}
                  style={{ padding: '5px 9px', fontFamily: 'var(--mono)', fontSize: 12, cursor: 'pointer', color: 'var(--gold)' }}
                >
                  {im.title}
                </div>
              ))}
            </div>
          )}

          {/* what a selection adds to the wire — shown, never hidden (WORKFLOW law 5) */}
          {hasSelection && canvasFile && (
            <p className="vd-hint" style={{ margin: '6px 0 0', color: 'var(--amber-dim)' }}>
              {model.region === 'mask'
                ? `selection set — ${model.label} gets it as a real mask; only that area changes`
                : `selection set — sent after your prompt: "${REGION_LINE}" · then only the selected area is kept, your original pixels everywhere else`}
            </p>
          )}
          </>)}
        </div>

        {/* sticky footer — Clip Gen's: the hero + ＋ Queue + the live status line */}
        <div style={{ flex: '0 0 auto', borderTop: '1px solid var(--line)', padding: '8px 10px', background: 'var(--bg2)' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <span
              className="btn"
              style={{ flex: 1, textAlign: 'center', opacity: busy || !prompt.trim() ? 0.5 : 1, pointerEvents: busy ? 'none' : 'auto' }}
              onClick={() => void generate('now')}
              title={!prompt.trim() ? 'write the change first' : `${selNode ? `generate from ${baseName}` : 'generate from the original image'} — runs now; press again for another · results join the tree; right-click a take to save it to the Library`}
            >
              {`▶ Generate now (adds ${variants > 1 ? `${variants} takes` : 'a take'}${rootImage || selNode ? ` under ${baseName}` : ''}) · ${model.label} · ${costLabel}`}
            </span>
            <span
              className="btn"
              style={{ flex: '0 0 auto', textAlign: 'center', opacity: busy || !prompt.trim() ? 0.5 : 1, pointerEvents: busy ? 'none' : 'auto' }}
              onClick={() => void generate('queue')}
              title={!prompt.trim() ? 'write the change first' : 'add to the render queue — runs in order, one at a time'}
            >
              ＋ Queue
            </span>
          </div>
          <p className="vd-hint" style={{ margin: '5px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: status.startsWith('error') ? 'var(--bad)' : 'var(--muted)' }} title={status}>
            {status || `${viaRow?.label ?? via}${resolution ? ` · ${resolution}` : ''} · ${variants} variant${variants > 1 ? 's' : ''}${rootImage || selNode ? ` · from ${baseName}` : ''}`}
          </p>
        </div>
      </div>

      {/* ---- right: the image + its take tree; the details pin to the bottom (the editors' shared sidebar, his call 10-11) ---- */}
      <EditorSide
        label="image editor"
        head={
          rootImage ? (
            <>
              <input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => e.key === 'Enter' && commitTitle()}
                placeholder="@title"
                title="the image's @title"
                style={{ ...ctl, width: '100%' }}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <span className="btn vd-hbtn" onClick={() => void duplicateImage(rootImage.id)} title="duplicate — copy this image in the Library (tree not copied)">
                  <Ic i={Copy} size={12} />
                </span>
                <span className="btn vd-hbtn" style={{ color: 'var(--bad)' }} onClick={() => void deleteRoot()} title="delete this image AND its edit tree (tagged Library results survive)">
                  <Ic i={Trash2} size={12} />
                </span>
              </div>
              {rootImage.editedFrom && (
                <div style={{ fontSize: 9, color: 'var(--dim)', marginTop: 4 }}>
                  edited from {imgOf(rootImage.editedFrom)?.title ?? 'a deleted image'}
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 10, color: 'var(--dim)' }}>new image</div>
          )
        }
        foot={(() => {
          const dPrompt = selNode ? selNode.prompt : rootImage?.genPrompt ?? ''
          if (!selNode && !dPrompt) return null // root with no recorded prompt → nothing to show
          return (
            <div style={{ flex: '0 0 auto', borderTop: '1px solid var(--line)', padding: 8, fontSize: 11, color: 'var(--muted)', background: 'var(--bg2)' }}>
              <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--dim)', marginBottom: 4 }}>
                details {selNode ? '' : '— original'}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--body)', whiteSpace: 'pre-wrap', maxHeight: 96, overflow: 'auto', marginBottom: 5, lineHeight: 1.45 }}>
                {dPrompt || '(no prompt recorded)'}
              </div>
              <div style={{ fontSize: 9, color: 'var(--dim)', marginBottom: 6 }}>
                {selNode ? (
                  <>
                    {selNode.seed != null ? `seed ${selNode.seed} · ` : ''}
                    {selNode.refIds.length} ref{selNode.refIds.length === 1 ? '' : 's'}
                    {selNode.keptImageId ? ' · ★ in Library' : ''}
                    {session?.primaryNodeId === selNode.id ? ' · ◉ primary' : ''}
                  </>
                ) : (
                  'the prompt that generated this image'
                )}
              </div>
              {dPrompt && (
                <span
                  className="btn vd-hbtn"
                  onClick={() => {
                    setPrompt(dPrompt)
                    setStatus('prompt loaded from that result — edit and Generate')
                  }}
                  title="copy this prompt into the prompt box (refs stay as they are)"
                >
                  → send to prompt
                </span>
              )}
            </div>
          )
        })()}
      >
        {treeMenu && <ContextMenu x={treeMenu.x} y={treeMenu.y} entries={treeMenu.entries} onClose={() => setTreeMenu(null)} />}
        <TakeTree
          root={rootImage ? { file: session?.originalFile ?? rootImage.file, name: rootImage.title, primary: !session?.primaryNodeId && nodes.length > 0, title: 'the original — click to view it and generate from it · right-click = ◉ primary / open in / reveal' } : null}
          items={treeItems}
          selectedId={selNodeId}
          thumbW={thumbW}
          onSelect={setSelNodeId}
          onMenu={openTakeMenu}
          onDrag={(e, id) => {
            if (!session) return
            e.dataTransfer.setData(MIME_EDITNODE, JSON.stringify({ sessionId: session.id, nodeId: id }))
            e.dataTransfer.effectAllowed = 'copy'
          }}
          empty="no takes yet · Generate to grow the tree"
        />
      </EditorSide>
    </div>
  )
}
