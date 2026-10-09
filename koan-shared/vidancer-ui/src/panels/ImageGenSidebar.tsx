import { useEffect, useRef, useState } from 'react'
import { TileZoomSlider, useCtrlWheelZoom, LORA_DEFAULT } from '../lib/tileZoom'
import { useStore } from '../store'
import { vd } from '../api'
import { EmptyState } from '../ui/EmptyState'
import { ContextMenu, type MenuEntry } from '@koan/shared'
import { ctl } from '../ui/controls'
import { toast } from '../ui/Toast'
import { KREA_BASES } from '../lib/civitActions'
import { LORA_BASE_RE, loraFamilyOf } from '../shared/loraFamilies'
import { openCivitExamples } from '../panelBus'
import type { LoraCatalogItem } from '../shared/types'

// ---- the LoRA side panel (docs/KREA2-LOCAL-SPEC-2026-09-08.md §5, widened 2026-09-22 by
// MINIMAX-H3-LOCAL-SPEC §4.2 to every local engine): the panel's right column, where Image Edit
// keeps its results tree. Three sources under one head: `local` = the shelf folder + his picked
// folders read in place, `civit` = the Civitai browser filtered to the family, `official` = the
// family's Hugging Face scan. Every row ends in ONE button: `use` (on disk) or `download` / `install`.
// Image Gen mounts it for Krea 2; Clip Gen mounts it for LTX 2.5 and MiniMax H3. ----

export interface LoraFamilyDef {
  key: 'krea2' | 'ltx' | 'h3'
  label: string
  civitBases: string[] // Civitai's baseModel labels for this family
  baseRe: RegExp // a local row whose base chip does NOT match shows amber (in his folder, tagged for another model)
  official?: 'ltx' | 'h3' // the Hugging Face scan the official tab runs; absent = no tab
}
export const LORA_FAMILIES: Record<'krea2' | 'ltx' | 'h3', LoraFamilyDef> = {
  krea2: { key: 'krea2', label: 'Krea 2', civitBases: KREA_BASES, baseRe: LORA_BASE_RE.krea2 },
  ltx: { key: 'ltx', label: 'LTX 2.5', civitBases: ['LTXV 2.5', 'LTXV 2.3'], baseRe: LORA_BASE_RE.ltx, official: 'ltx' },
  h3: { key: 'h3', label: 'MiniMax H3', civitBases: ['MiniMax H3'], baseRe: LORA_BASE_RE.h3, official: 'h3' }
}
const FAMILY_KEYS = Object.keys(LORA_FAMILIES) as LoraFamilyDef['key'][]

// folder rows are shared with the panels (trigger chips over the prompt read them) — one wire
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
  // a Models card / official-tab install lands in the shelf folder — a local root now
  vd().onLorasDone((p) => {
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
// list 48 (his ask 09-29: "text and inuse should wrap under when its made this short"): a lora row
// wraps; its text and button ride one body that drops under the picture once the row is narrower
// than the picture plus BODY_MIN
const BODY_MIN = 160
const rowWrap: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '5px 2px 5px 6px', borderBottom: '1px solid var(--line)' }
const bodyWrap: React.CSSProperties = { flex: `1 1 ${BODY_MIN}px`, minWidth: 0 }
const fmtBytes = (n: number): string => (n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(1)} GB` : `${Math.round(n / (1 << 20))} MB`)

type Tab = 'local' | 'civit' | 'official'

export function LoraSidebar(props: {
  family: LoraFamilyDef
  picks: { name: string; weight: number }[] // the card's slots (rel paths)
  onUse: (rel: string) => void // → a slot
  onUnuse: (rel: string) => void
  searchSeed?: string // the PNG reader's "search civit" hands a name over
  onSearchSeedUsed?: () => void
}): React.JSX.Element {
  const fam = props.family
  const [tab, setTab] = useState<Tab>('local')
  const [q, setQ] = useState('')
  const rows = useFolderLoras()
  const [folders, setFolders] = useState<LoraFolder[]>([])
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
  // official (the shelf's Hugging Face scan per family; installs land in the shelf folder)
  const [official, setOfficial] = useState<LoraCatalogItem[] | null>(null)
  const [officialErr, setOfficialErr] = useState('')
  const [inst, setInst] = useState<Record<string, { pct: number; note?: string }>>({})
  const [instErr, setInstErr] = useState<Record<string, string>>({})

  // the key is read again on every settings save: one pasted after this opened unblocks downloads
  // (audit 2026-10-09 L34)
  const settingsRev = useStore((s) => s.settingsRev)
  useEffect(() => {
    void vd()
      .getSettings()
      .then((s) => setHasKey(!!(s?.civitaiKey as string | undefined)?.trim()))
  }, [settingsRev])
  useEffect(() => {
    void vd().imageGenFolders().then(setFolders)
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
    const offLP = vd().onLorasProgress((p) => setInst((s) => ({ ...s, [p.file]: { pct: p.pct, note: p.note } })))
    const offLD = vd().onLorasDone((p) => {
      setInst((s) => {
        const n = { ...s }
        delete n[p.file]
        return n
      })
      if (!p.ok && p.error && p.error !== 'canceled') setInstErr((e) => ({ ...e, [p.file]: p.error! }))
    })
    return () => {
      offScan()
      offP()
      offD()
      offF()
      offLP()
      offLD()
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
    const r = await vd().imageGenCivit({ type: 'LORA', baseModels: fam.civitBases, query: q, sort, favorites: fav, cursor: more ? cursor : undefined, limit: 40 })
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
  }, [tab, q, sort, fav, fam.key])
  // the official scan: once per family per mount, on the first visit
  useEffect(() => {
    if (tab !== 'official' || !fam.official) return
    setOfficial(null)
    setOfficialErr('')
    void vd()
      .lorasOfficial(fam.official)
      .then((r) => {
        if (r.ok) setOfficial(r.items ?? [])
        else {
          setOfficial([])
          setOfficialErr(r.error ?? 'Hugging Face is unreachable')
        }
      })
  }, [tab, fam.official])
  // a family switch (Clip Gen's engine change) resets the tab when the new family has no official scan
  useEffect(() => {
    if (tab === 'official' && !fam.official) setTab('local')
  }, [fam.official, tab])

  const pickFolder = async (): Promise<void> => {
    const next = await vd().imageGenPickFolder(fam.key)
    if (next) {
      setFolders(next)
      refreshFolderLoras()
    }
  }
  const picked = (rel: string): boolean => props.picks.some((p) => p.name === rel)
  const familyOf = (r: FolderLoraRow): LoraFamilyDef['key'] | undefined => loraFamilyOf(r, folders) // one rule, shared with the Co-Director's tools
  const installedFor = (it: { sha256?: string; file: string }): FolderLoraRow | undefined => rows.find((r) => (it.sha256 && r.sha256 === it.sha256) || r.file.toLowerCase() === it.file.toLowerCase())

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
      ...FAMILY_KEYS.map(
        (k) =>
          ({
            label: <>{familyOf(row) === k ? '✓ ' : ''}family: {LORA_FAMILIES[k].label}</>,
            title: "this lora shows in that model's side panel from now on",
            onClick: () => void vd().imageGenLoraTag(row.root, row.rel, k).then(refreshFolderLoras)
          }) as MenuEntry
      )
    ]
  }
  const civitMenu = (it: CivitVersionRow): MenuEntry[] => [{ label: <>↗ open on civitai</>, onClick: () => void vd().openExternal(it.homepage) }, examplesEntry(it.versionId, it.name, it.homepage)]

  const qq = q.trim().toLowerCase()
  // the LOCAL tab shows THIS model's loras (his call 2026-09-23: one side panel, takes the model).
  // A row's family: his right-click tag → his folder (P5 catch 2026-09-09: a file he filed under
  // KREA 2 came back tagged ZImageTurbo by Civitai — the folder outranks the tag) → a shelf row's
  // base model → unknown, which shows under every model until he tags it.
  const myFolders = folders.filter((f) => f.family === fam.key)
  const localRows = rows.filter((r) => {
    const k = familyOf(r)
    return (!k || k === fam.key) && (!qq || `${r.name} ${r.file} ${r.triggerWords.join(' ')}`.toLowerCase().includes(qq))
  })
  const officialRows = (official ?? []).filter((it) => !qq || `${it.name} ${it.file}`.toLowerCase().includes(qq))

  // preview size: the Library's tile-zoom grammar on list rows (slider in the head, ctrl+scroll over the list), remembered in settings
  const thumb = useStore((s) => s.tileZoom.lora ?? LORA_DEFAULT)
  const listRef = useRef<HTMLDivElement | null>(null)
  useCtrlWheelZoom(listRef, 'lora')

  const headBtn = (k: Tab, label: string, title: string): React.JSX.Element => (
    <span className="btn vd-hbtn" onClick={() => setTab(k)} title={title} style={{ flex: 1, textAlign: 'center', ...(tab === k ? { background: 'var(--amber)', color: 'var(--on-accent)' } : {}) }}>
      {label}
    </span>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div style={{ padding: '8px 8px 4px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div className="lb" title={`loras for ${fam.label} — your folders, Civitai${fam.official ? ', the official ones' : ''}`} style={{ flex: 1 }}>loras</div>
          <TileZoomSlider kind="lora" width={64} />
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          {headBtn('local', 'local', 'the loras in your folders and the app shelf — read in place, never copied')}
          {headBtn('civit', 'civit', `browse Civitai — ${fam.label} loras only`)}
          {fam.official && headBtn('official', 'official', fam.key === 'h3' ? 'every Hugging Face repo publishing H3 loras, most downloaded first — installs into the app shelf' : 'the Lightricks adapters, scanned live from Hugging Face — installs into the app shelf')}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === 'local' ? 'filter your loras…' : tab === 'civit' ? 'search civitai…' : 'filter the official ones…'} style={{ ...ctl, width: '100%' }} />
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
        {tab === 'local' && myFolders.length === 0 && localRows.length === 0 && (
          <div onClick={() => void pickFolder()} style={{ cursor: 'pointer' }} title={`pick the folder your ${fam.label} loras live in`}>
            <EmptyState bare>no lora folder — click to set one</EmptyState>
          </div>
        )}
        {tab === 'local' && (myFolders.length > 0 || localRows.length > 0) && (
          <>
            {scan && (
              <div style={{ fontSize: 10, color: 'var(--dim)', marginBottom: 6 }}>
                reading {scan.done}/{scan.total} — words and previews arrive as they are found
              </div>
            )}
            {myFolders.map((f) => (
              <div key={f.path} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 4 }} title={`${f.path}\nyour ${fam.label} folder — every lora in it shows here`}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.path.split(/[\\/]/).filter(Boolean).pop()} · {rows.filter((r) => r.root === f.path).length}
                </span>
                <span
                  title="forget this folder — the files stay where they are"
                  onClick={() => void vd().imageGenForgetFolder(f.path).then((n) => { setFolders(n); refreshFolderLoras() })}
                  style={{ cursor: 'pointer', color: 'var(--dim)' }}
                >
                  ✕
                </span>
              </div>
            ))}
            {localRows.length === 0 && <p className="vd-hint">{qq ? 'nothing matches' : `no ${fam.label} loras in your folders yet`}</p>}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {localRows.map((r) => {
                const on = picked(r.rel)
                return (
                  <LocalRow
                    key={`${r.root}|${r.rel}`}
                    row={r}
                    size={thumb}
                    on={on}
                    baseRe={fam.baseRe}
                    onUse={() => (on ? props.onUnuse(r.rel) : props.onUse(r.rel))}
                    onMenu={(x, y) => setMenu({ x, y, entries: localMenu(r) })}
                  />
                )
              })}
            </div>
            <span className="btn koan-hbtn" onClick={() => void pickFolder()} style={{ display: 'inline-block', marginTop: 8, fontFamily: 'var(--mono)', fontSize: 11 }} title={`add a ${fam.label} lora folder`}>
              ＋ folder
            </span>
          </>
        )}

        {tab === 'civit' && (
          <>
            {civitErr && <div style={{ fontSize: 10.5, color: 'var(--bad)', marginBottom: 6 }}>✕ {civitErr}</div>}
            {civit === null && !civitErr && <p className="vd-hint">searching…</p>}
            {civit && civit.length === 0 && !civitErr && <p className="vd-hint">nothing on Civitai for that — {fam.label} loras only</p>}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {(civit ?? []).map((it) => {
                const has = installedFor(it)
                const job = dl[it.key]
                const on = has ? picked(has.rel) : false
                return (
                  <div
                    key={it.key}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setMenu({ x: e.clientX, y: e.clientY, entries: civitMenu(it) })
                    }}
                    title="right-click = its page · examples"
                    style={{ ...rowWrap, borderLeft: on ? '2px solid var(--amber)' : '2px solid transparent' }}
                  >
                    <ScrollThumb images={it.images} size={thumb} />
                    <div data-lora-body style={bodyWrap}>
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
                        ) : has ? (
                          <span className="btn koan-hbtn" onClick={() => (on ? props.onUnuse(has.rel) : props.onUse(has.rel))} style={{ fontFamily: 'var(--mono)', fontSize: 11 }} title={on ? 'in a slot — click to remove' : 'put it in a slot'}>
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
                              void vd().imageGenCivitDownload(it, fam.key)
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

        {tab === 'official' && fam.official && (
          <>
            {officialErr && <div style={{ fontSize: 10.5, color: 'var(--bad)', marginBottom: 6 }}>✕ {officialErr}</div>}
            {official === null && !officialErr && <p className="vd-hint">reading Hugging Face…</p>}
            {official && officialRows.length === 0 && !officialErr && <p className="vd-hint">{qq ? 'nothing matches' : `no official ${fam.label} loras found`}</p>}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {officialRows.map((it) => {
                const has = installedFor(it)
                const job = inst[it.file]
                const on = has ? picked(has.rel) : false
                return (
                  <OfficialRow
                    key={it.key}
                    it={it}
                    size={thumb}
                    on={on}
                    job={job}
                    err={instErr[it.file]}
                    installed={!!has}
                    onUse={() => has && (on ? props.onUnuse(has.rel) : props.onUse(has.rel))}
                    onInstall={() => {
                      setInstErr((e) => { const n = { ...e }; delete n[it.file]; return n })
                      setInst((s) => ({ ...s, [it.file]: { pct: 0 } }))
                      void vd().lorasInstall(it).then((r) => {
                        if (!r.ok) {
                          setInst((s) => { const n = { ...s }; delete n[it.file]; return n })
                          setInstErr((e) => ({ ...e, [it.file]: r.error ?? 'install failed' }))
                        }
                      })
                    }}
                    onCancel={() => void vd().lorasCancel(it.file)}
                  />
                )
              })}
            </div>
          </>
        )}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menu.entries} onClose={() => setMenu(null)} />}
    </div>
  )
}

// Image Gen's mount, unchanged for its callers: the Krea 2 family
export function ImageGenSidebar(props: { picks: { name: string; weight: number }[]; onUse: (rel: string) => void; onUnuse: (rel: string) => void; searchSeed?: string; onSearchSeedUsed?: () => void }): React.JSX.Element {
  return <LoraSidebar family={LORA_FAMILIES.krea2} {...props} />
}

function LocalRow({ row, on, size, baseRe, onUse, onMenu }: { row: FolderLoraRow; on: boolean; size: number; baseRe: RegExp; onUse: () => void; onMenu: (x: number, y: number) => void }): React.JSX.Element {
  const data = useThumb(row.thumb)
  const foreign = !!row.baseModel && !baseRe.test(row.baseModel)
  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e.clientX, e.clientY)
      }}
      style={{ ...rowWrap, borderLeft: on ? '2px solid var(--amber)' : '2px solid transparent' }}
      title={`${row.rel}\nright-click = its page · examples · family · reveal`}
    >
      <span style={{ width: size, height: size, flex: '0 0 auto', borderRadius: 4, overflow: 'hidden', background: 'var(--field)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {data ? <img src={data} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <span style={{ fontSize: 14, color: 'var(--dim)' }}>▦</span>}
      </span>
      <div data-lora-body style={{ ...bodyWrap, display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: 'var(--txt-hi)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 3, alignItems: 'center' }}>
            <span style={{ ...chip, ...(foreign ? { color: 'var(--amber)' } : {}) }} title={foreign ? 'Civitai tags it for another model — your folder or your tag puts it here' : undefined}>{row.baseModel ? row.baseModel : row.looked ? 'untagged' : 'reading…'}</span>
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
    </div>
  )
}

// an official (Hugging Face) row: the shelf's catalog row at sidebar scale — install → progress →
// use; the file lands in the app shelf, which the local tab lists
function OfficialRow(p: { it: LoraCatalogItem; size: number; on: boolean; job?: { pct: number; note?: string }; err?: string; installed: boolean; onUse: () => void; onInstall: () => void; onCancel: () => void }): React.JSX.Element {
  const data = useThumb(p.it.thumb)
  const it = p.it
  return (
    <div style={{ ...rowWrap, borderLeft: p.on ? '2px solid var(--amber)' : '2px solid transparent' }} title={it.file}>
      <span style={{ width: p.size, height: p.size, flex: '0 0 auto', borderRadius: 4, overflow: 'hidden', background: 'var(--field)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {data ? <img src={data} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <span style={{ fontSize: 14, color: 'var(--dim)' }}>▦</span>}
      </span>
      <div data-lora-body style={bodyWrap}>
        <div style={{ fontSize: 11, color: 'var(--txt-hi)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.name}>
          {it.name}
        </div>
        <div style={{ fontSize: 9.5, color: 'var(--dim)', fontFamily: 'var(--mono)', display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
          {it.author && <span>{it.author}</span>}
          {it.downloads != null && <span>↓ {it.downloads.toLocaleString()}</span>}
          {it.bytes ? <span>{fmtBytes(it.bytes)}</span> : null}
          {it.homepage && (
            <span style={{ cursor: 'pointer', color: 'var(--gold)' }} onClick={() => void vd().openExternal(it.homepage!)} title="open on huggingface.co">
              ↗
            </span>
          )}
        </div>
        <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
          {p.job ? (
            <>
              <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{p.job.note ?? (p.job.pct < 0 ? 'verifying…' : `${p.job.pct}%`)}</span>
              <span className="btn vd-hbtn" onClick={p.onCancel} title="cancel — the partial file is removed">✕</span>
            </>
          ) : p.installed ? (
            <span className="btn koan-hbtn" onClick={p.onUse} style={{ fontFamily: 'var(--mono)', fontSize: 11 }} title={p.on ? 'in a slot — click to remove' : 'put it in a slot'}>
              {p.on ? 'in use' : 'use'}
            </span>
          ) : (
            <span className="btn koan-hbtn" onClick={p.onInstall} style={{ fontFamily: 'var(--mono)', fontSize: 11 }} title={`install once into the app shelf${it.bytes ? ` — ${fmtBytes(it.bytes)}` : ''}`}>
              {p.err ? 'retry' : 'install'}
            </span>
          )}
          {p.err && <span style={{ fontSize: 9.5, color: 'var(--bad)' }} title={p.err}>✕ {p.err.slice(0, 60)}</span>}
        </div>
      </div>
    </div>
  )
}
