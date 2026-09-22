import { useEffect, useRef, useState } from 'react'
import { TileZoomSlider, useCtrlWheelZoom, LORA_DEFAULT } from '../lib/tileZoom'
import { useStore } from '../store'
import { vd } from '../api'
import { EmptyState } from '../ui/EmptyState'
import { ContextMenu, type MenuEntry } from '@koan/shared'
import { ctl } from '../ui/controls'
import { toast } from '../ui/Toast'
import { KREA_BASES } from '../lib/civitActions'
import { openCivitExamples } from '../panelBus'

// ---- the LoRA sidebar (docs/KREA2-LOCAL-SPEC-2026-09-08.md §5) — the Image Gen panel's right
// column, where Image Edit keeps its results tree. Two sources under one head: `local` = his
// picked folders read in place, `civit` = the Civitai browser filtered to Krea 2. Every row ends
// in ONE button: `use` (in a folder) or `download` (not yet). ----


// folder rows are shared with the panel (trigger chips over the prompt read them) — one wire
// read per refresh, not one per mount
let rowsCache: FolderLoraRow[] = []
const rowSubs = new Set<(r: FolderLoraRow[]) => void>()
let wired = false
export function refreshFolderLoras(): void {
  void vd()
    .imageGenLoras()
    .then((rows) => {
      rowsCache = rows
      rowSubs.forEach((s) => s(rows))
    })
}
function wire(): void {
  if (wired) return
  wired = true
  refreshFolderLoras()
  vd().onImageGenLoraScan((p) => {
    if (p.finished) refreshFolderLoras()
  })
  vd().onImageGenDlDone((p) => {
    if (p.ok) refreshFolderLoras()
  })
}
export function useFolderLoras(): FolderLoraRow[] {
  const [rows, setRows] = useState<FolderLoraRow[]>(rowsCache)
  useEffect(() => {
    wire()
    setRows(rowsCache)
    const sub = (r: FolderLoraRow[]): void => setRows(r)
    rowSubs.add(sub)
    return () => void rowSubs.delete(sub)
  }, [])
  return rows
}

// thumbs come through main as data URLs (CSP) — resolved once per url for the session
const thumbData = new Map<string, string | null>()
export function useThumb(url?: string): string | null {
  const [data, setData] = useState<string | null>(url ? (thumbData.get(url) ?? null) : null)
  useEffect(() => {
    if (!url) return setData(null)
    if (thumbData.has(url)) return setData(thumbData.get(url) ?? null)
    let dead = false
    void vd()
      .imageGenThumb(url)
      .then((d) => {
        thumbData.set(url, d)
        if (!dead) setData(d)
      })
    return () => {
      dead = true
    }
  }, [url])
  return data
}

// the civit thumbnail: at rest the first preview, hovered it SCROLLS through the version's
// previews (his words) — one frame per ~0.6 s
function ScrollThumb({ images, size = 56 }: { images: string[]; size?: number }): React.JSX.Element {
  const [i, setI] = useState(0)
  const [hover, setHover] = useState(false)
  const timer = useRef<number>(0)
  const data = useThumb(images[Math.min(i, Math.max(0, images.length - 1))])
  useEffect(() => {
    if (!hover || images.length < 2) return
    timer.current = window.setInterval(() => setI((x) => (x + 1) % images.length), 600)
    return () => window.clearInterval(timer.current)
  }, [hover, images.length])
  useEffect(() => {
    if (!hover) setI(0)
  }, [hover])
  return (
    <span
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={images.length > 1 ? `${images.length} previews — hover scrolls them` : undefined}
      style={{ width: size, height: size, flex: '0 0 auto', borderRadius: 4, overflow: 'hidden', background: 'var(--field)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      {data ? <img src={data} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <span style={{ fontSize: 14, color: 'var(--dim)' }}>▦</span>}
    </span>
  )
}

const chip: React.CSSProperties = { fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--muted)', border: '1px solid var(--line)', borderRadius: 3, padding: '0 4px', whiteSpace: 'nowrap' }
// trigger words WRAP (his catch 2026-09-09: the sidebar must never scroll sideways) — long usage
// notes break mid-word before they push the row wide
const wordChip: React.CSSProperties = { ...chip, color: 'var(--amber)', whiteSpace: 'normal', wordBreak: 'break-word', maxWidth: '100%' }
const fmtBytes = (n: number): string => (n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(1)} GB` : `${Math.round(n / (1 << 20))} MB`)

export function ImageGenSidebar(props: {
  picks: { name: string; weight: number }[] // the card's slots (rel paths)
  onUse: (rel: string) => void // → a slot
  onUnuse: (rel: string) => void
  searchSeed?: string // the PNG reader's "search civit" hands a name over
  onSearchSeedUsed?: () => void
}): React.JSX.Element {
  const [tab, setTab] = useState<'local' | 'civit'>('local')
  const [q, setQ] = useState('')
  const rows = useFolderLoras()
  const [folders, setFolders] = useState<string[]>([])
  const [scan, setScan] = useState<{ done: number; total: number } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null)
  // civit
  const [sort, setSort] = useState<'downloads' | 'newest'>('downloads')
  const [fav, setFav] = useState(false)
  const [hasKey, setHasKey] = useState(false)
  const [civit, setCivit] = useState<CivitVersionRow[] | null>(null)
  const [cursor, setCursor] = useState<string | undefined>()
  const [civitErr, setCivitErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [dl, setDl] = useState<Record<string, { pct: number; note?: string }>>({})
  const [dlErr, setDlErr] = useState<Record<string, string>>({})

  useEffect(() => {
    void vd().imageGenFolders().then(setFolders)
    void vd()
      .getSettings()
      .then((s) => setHasKey(!!(s?.civitaiKey as string | undefined)?.trim()))
    const offScan = vd().onImageGenLoraScan((p) => setScan(p.finished ? null : { done: p.done, total: p.total }))
    const offP = vd().onImageGenDlProgress((p) => setDl((d) => ({ ...d, [p.key]: { pct: p.pct, note: p.note } })))
    const offF = vd().onImageGenFolders((f) => setFolders(f))
    const offD = vd().onImageGenDlDone((p) => {
      void vd().imageGenFolders().then(setFolders)
      setDl((d) => {
        const n = { ...d }
        delete n[p.key]
        return n
      })
      if (!p.ok && p.error && p.error !== 'canceled') setDlErr((e) => ({ ...e, [p.key]: p.error! }))
    })
    return () => {
      offScan()
      offP()
      offD()
      offF()
    }
  }, [])
  // the PNG reader's "search civit": jump to the civit tab with the name as the query
  useEffect(() => {
    if (!props.searchSeed) return
    setTab('civit')
    setQ(props.searchSeed)
    props.onSearchSeedUsed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.searchSeed])

  const search = async (more = false): Promise<void> => {
    setBusy(true)
    setCivitErr('')
    const r = await vd().imageGenCivit({ type: 'LORA', baseModels: KREA_BASES, query: q, sort, favorites: fav, cursor: more ? cursor : undefined, limit: 40 })
    setBusy(false)
    if (!r.ok) {
      setCivitErr(r.error ?? 'failed')
      if (!more) setCivit([])
      return
    }
    setCivit((prev) => (more ? [...(prev ?? []), ...(r.items ?? [])] : (r.items ?? [])))
    setCursor(r.nextCursor)
  }
  useEffect(() => {
    if (tab !== 'civit') return
    const t = window.setTimeout(() => void search(false), q ? 350 : 0)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, q, sort, fav])

  const pickFolder = async (): Promise<void> => {
    const next = await vd().imageGenPickFolder()
    if (next) {
      setFolders(next)
      refreshFolderLoras()
    }
  }
  const picked = (rel: string): boolean => props.picks.some((p) => p.name === rel)
  const installedFor = (it: CivitVersionRow): FolderLoraRow | undefined => rows.find((r) => (it.sha256 && r.sha256 === it.sha256) || r.file.toLowerCase() === it.file.toLowerCase())

  // item 8 (THE LIST 2026-09-22): both rows get Watched's options — its page, and its posted
  // examples in their own window (a local row only when Civitai knows the file: civitKey)
  const examplesEntry = (versionId: number, name: string, homepage?: string): MenuEntry => ({
    label: <>examples</>,
    title: 'the images posted for this lora on civitai — tiles like Watched, in their own window',
    onClick: () => openCivitExamples(versionId, name, homepage)
  })
  const localMenu = (row: FolderLoraRow): MenuEntry[] => {
    const versionId = Number(row.civitKey?.split(':').pop())
    return [
      ...(row.homepage ? [{ label: <>↗ open on civitai</>, onClick: () => void vd().openExternal(row.homepage!) }] : []),
      ...(versionId ? [examplesEntry(versionId, row.name, row.homepage)] : []),
      { label: <>reveal file</>, onClick: () => void vd().revealFile(`${row.root}\\${row.rel.replace(/\//g, '\\')}`) },
      { sep: true, label: '' },
      ...(['Krea 2', 'LTXV 2.5', 'other'] as const).map(
        (b) =>
          ({
            label: <>{row.baseModel === b ? '✓ ' : ''}family: {b}</>,
            onClick: () => void vd().imageGenLoraTag(row.root, row.rel, b).then(refreshFolderLoras)
          }) as MenuEntry
      )
    ]
  }
  const civitMenu = (it: CivitVersionRow): MenuEntry[] => [{ label: <>↗ open on civitai</>, onClick: () => void vd().openExternal(it.homepage) }, examplesEntry(it.versionId, it.name, it.homepage)]

  const qq = q.trim().toLowerCase()
  // the LOCAL tab is his folder: every file in it shows (P5 catch 2026-09-09 — a file he filed under
  // KREA 2 came back tagged ZImageTurbo by Civitai; his folder outranks the tag). The base chip
  // still tells the family; only the civit tab filters to Krea 2.
  const localRows = rows.filter((r) => !qq || `${r.name} ${r.file} ${r.triggerWords.join(' ')}`.toLowerCase().includes(qq))

  // preview size: the Library's tile-zoom grammar on list rows (slider in the head, ctrl+scroll over the list), remembered in settings
  const thumb = useStore((s) => s.tileZoom.lora ?? LORA_DEFAULT)
  const listRef = useRef<HTMLDivElement | null>(null)
  useCtrlWheelZoom(listRef, 'lora')

  const headBtn = (k: 'local' | 'civit', label: string, title: string): React.JSX.Element => (
    <span className="btn vd-hbtn" onClick={() => setTab(k)} title={title} style={{ flex: 1, textAlign: 'center', ...(tab === k ? { background: 'var(--amber)', color: 'var(--on-accent)' } : {}) }}>
      {label}
    </span>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div style={{ padding: '8px 8px 4px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div className="lb" title="loras for Krea 2 — your folders, or Civitai" style={{ flex: 1 }}>loras</div>
          <TileZoomSlider kind="lora" width={64} />
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          {headBtn('local', 'local', 'the loras in your folders — read in place, never copied')}
          {headBtn('civit', 'civit', 'browse Civitai — Krea 2 loras only')}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === 'local' ? 'filter your loras…' : 'search civitai…'} style={{ ...ctl, width: '100%' }} />
        {tab === 'civit' && (
          <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {(['downloads', 'newest'] as const).map((s) => (
              <span key={s} onClick={() => setSort(s)} style={{ ...chip, cursor: 'pointer', ...(sort === s ? { color: 'var(--amber)', borderColor: 'var(--amber)' } : {}) }}>
                {s}
              </span>
            ))}
            <span
              onClick={() => hasKey && setFav((v) => !v)}
              title={hasKey ? 'only the loras you bookmarked on Civitai' : 'paste your Civitai key in Settings to see your favorites'}
              style={{ ...chip, cursor: hasKey ? 'pointer' : 'default', opacity: hasKey ? 1 : 0.45, ...(fav ? { color: 'var(--amber)', borderColor: 'var(--amber)' } : {}) }}
            >
              ★ favorites
            </span>
          </div>
        )}
      </div>

      <div ref={listRef} className="vd-scroll" style={{ flex: 1, minHeight: 0, padding: 8, overflowX: 'hidden' }}>
        {tab === 'local' && folders.length === 0 && (
          <div onClick={() => void pickFolder()} style={{ cursor: 'pointer' }} title="pick the folder your Krea 2 loras live in">
            <EmptyState bare>no lora folder — click to set one</EmptyState>
          </div>
        )}
        {tab === 'local' && folders.length > 0 && (
          <>
            {scan && (
              <div style={{ fontSize: 10, color: 'var(--dim)', marginBottom: 6 }}>
                reading {scan.done}/{scan.total} — words and previews arrive as they are found
              </div>
            )}
            {folders.map((f) => (
              <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 4 }} title={f}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.split(/[\\/]/).filter(Boolean).pop()} · {rows.filter((r) => r.root === f).length}
                </span>
                <span
                  title="forget this folder — the files stay where they are"
                  onClick={() => void vd().imageGenForgetFolder(f).then((n) => { setFolders(n); refreshFolderLoras() })}
                  style={{ cursor: 'pointer', color: 'var(--dim)' }}
                >
                  ✕
                </span>
              </div>
            ))}
            {localRows.length === 0 && <p className="vd-hint">{rows.length ? 'nothing matches' : 'no .safetensors in that folder yet'}</p>}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {localRows.map((r) => {
                const on = picked(r.rel)
                return (
                  <LocalRow
                    key={`${r.root}|${r.rel}`}
                    row={r}
                    size={thumb}
                    on={on}
                    onUse={() => (on ? props.onUnuse(r.rel) : props.onUse(r.rel))}
                    onMenu={(x, y) => setMenu({ x, y, entries: localMenu(r) })}
                  />
                )
              })}
            </div>
            <span className="btn koan-hbtn" onClick={() => void pickFolder()} style={{ display: 'inline-block', marginTop: 8, fontFamily: 'var(--mono)', fontSize: 11 }} title="add another folder">
              ＋ folder
            </span>
          </>
        )}

        {tab === 'civit' && (
          <>
            {civitErr && <div style={{ fontSize: 10.5, color: 'var(--bad)', marginBottom: 6 }}>✕ {civitErr}</div>}
            {civit === null && !civitErr && <p className="vd-hint">searching…</p>}
            {civit && civit.length === 0 && !civitErr && <p className="vd-hint">nothing on Civitai for that — Krea 2 loras only</p>}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {(civit ?? []).map((it) => {
                const inst = installedFor(it)
                const job = dl[it.key]
                const on = inst ? picked(inst.rel) : false
                return (
                  <div
                    key={it.key}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setMenu({ x: e.clientX, y: e.clientY, entries: civitMenu(it) })
                    }}
                    title="right-click = its page · examples"
                    style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 2px 5px 6px', borderBottom: '1px solid var(--line)', borderLeft: on ? '2px solid var(--amber)' : '2px solid transparent' }}
                  >
                    <ScrollThumb images={it.images} size={thumb} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: 'var(--txt-hi)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.name}>
                        {it.name}
                      </div>
                      <div style={{ fontSize: 9.5, color: 'var(--dim)', fontFamily: 'var(--mono)', display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                        {it.author && <span>{it.author}</span>}
                        {it.downloads != null && <span>↓ {it.downloads.toLocaleString()}</span>}
                        {it.bytes ? <span>{fmtBytes(it.bytes)}</span> : null}
                        <span style={{ cursor: 'pointer', color: 'var(--gold)' }} onClick={() => void vd().openExternal(it.homepage)} title="open on civitai.com">
                          ↗
                        </span>
                      </div>
                      {it.triggerWords.length > 0 && (
                        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 3 }}>
                          {it.triggerWords.slice(0, 4).map((w) => (
                            <span key={w} style={wordChip}>{w}</span>
                          ))}
                        </div>
                      )}
                      <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {job ? (
                          <>
                            <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{job.note ?? (job.pct < 0 ? 'verifying…' : `${job.pct}%`)}</span>
                            <span className="btn vd-hbtn" onClick={() => void vd().imageGenCivitCancel(it.key)} title="cancel">✕</span>
                          </>
                        ) : inst ? (
                          <span className="btn koan-hbtn" onClick={() => (on ? props.onUnuse(inst.rel) : props.onUse(inst.rel))} style={{ fontFamily: 'var(--mono)', fontSize: 11 }} title={on ? 'in a slot — click to remove' : 'put it in a slot'}>
                            {on ? 'in use' : 'use'}
                          </span>
                        ) : (
                          <span
                            className="btn koan-hbtn"
                            style={{ fontFamily: 'var(--mono)', fontSize: 11, ...(hasKey ? {} : { opacity: 0.5 }) }}
                            title={!hasKey ? 'downloads need your Civitai key — paste it in Settings' : `download once into your lora folder, in its own folder with its support files${it.bytes ? ` — ${fmtBytes(it.bytes)}` : ''}${folders.length ? '' : ' · the first download asks where'}`}
                            onClick={() => {
                              if (!hasKey) return toast('paste your Civitai key in Settings first', { kind: 'error' })
                              setDlErr((e) => { const n = { ...e }; delete n[it.key]; return n })
                              setDl((d) => ({ ...d, [it.key]: { pct: 0 } }))
                              void vd().imageGenCivitDownload(it)
                            }}
                          >
                            download
                          </span>
                        )}
                        {dlErr[it.key] && <span style={{ fontSize: 9.5, color: 'var(--bad)' }} title={dlErr[it.key]}>✕ {dlErr[it.key].slice(0, 60)}</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            {cursor && civit && civit.length > 0 && (
              <span className="btn vd-hbtn" style={{ display: 'inline-block', marginTop: 8, ...(busy ? { opacity: 0.5, pointerEvents: 'none' } : {}) }} onClick={() => void search(true)}>
                {busy ? 'loading…' : 'more'}
              </span>
            )}
          </>
        )}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menu.entries} onClose={() => setMenu(null)} />}
    </div>
  )
}

function LocalRow({ row, on, size, onUse, onMenu }: { row: FolderLoraRow; on: boolean; size: number; onUse: () => void; onMenu: (x: number, y: number) => void }): React.JSX.Element {
  const data = useThumb(row.thumb)
  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e.clientX, e.clientY)
      }}
      style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 2px 5px 6px', borderBottom: '1px solid var(--line)', borderLeft: on ? '2px solid var(--amber)' : '2px solid transparent' }}
      title={`${row.rel}\nright-click = its page · examples · family · reveal`}
    >
      <span style={{ width: size, height: size, flex: '0 0 auto', borderRadius: 4, overflow: 'hidden', background: 'var(--field)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {data ? <img src={data} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <span style={{ fontSize: 14, color: 'var(--dim)' }}>▦</span>}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: 'var(--txt-hi)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 3, alignItems: 'center' }}>
          <span style={{ ...chip, ...(row.baseModel && !/krea\s*2/i.test(row.baseModel) ? { color: 'var(--amber)' } : {}) }} title={row.baseModel && !/krea\s*2/i.test(row.baseModel) ? 'Civitai tags this for another model — it is in your folder, so it shows' : undefined}>{row.baseModel ? row.baseModel : row.looked ? 'untagged' : 'reading…'}</span>
          <span style={{ ...chip, border: 'none', padding: 0 }}>{fmtBytes(row.bytes)}</span>
          {row.triggerWords.slice(0, 3).map((w) => (
            <span key={w} style={wordChip}>{w}</span>
          ))}
        </div>
      </div>
      <span className="btn koan-hbtn" onClick={onUse} style={{ fontFamily: 'var(--mono)', fontSize: 11, flex: '0 0 auto' }} title={on ? 'in a slot — click to remove' : 'put it in a slot'}>
        {on ? 'in use' : 'use'}
      </span>
    </div>
  )
}
