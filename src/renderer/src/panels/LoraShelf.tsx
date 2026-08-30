// LoRA shelf (LTX-SPEC §7, probes P5/P6 passed 2026-08-30) — the Models card's loras section.
// Three sources, one folder: OFFICIAL (live Lightricks HF scan — new adapters appear on their
// own), CIVITAI (live browser; downloads need the user's key — checked fresh per click, never a
// stale gate), OWN (files dropped in models/loras/). Installed rows group by MODEL FAMILY
// (user order 2026-08-30, built for MiniMax H3 landing later): sidecar baseModel → family
// group; untagged local files sit in their own group and right-click sets the family — never
// guessed from a filename. Rows follow the card's grammar; trigger words ride the sidecar into
// Clip Gen's picker chips — they are load-bearing (P6: without them a style LoRA renders invisible).
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Section } from '../ui/Section'
import { ContextMenu } from '../ui/ContextMenu'
import { confirmDialog } from '../prompt'
import { Ic, Sparkles, Trash2 } from '../ui/icons'
import { spacing, radius, font } from '../ui/tokens'

const fmtBytes = (n: number): string => (n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(1)} GB` : n >= 1 << 20 ? `${Math.round(n / (1 << 20))} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const chip: React.CSSProperties = { fontFamily: font.mono, fontSize: 10, color: 'var(--muted)', border: '1px solid var(--line)', borderRadius: radius.sm, padding: '1px 5px', whiteSpace: 'nowrap' }
const baseChip = (base?: string): React.JSX.Element | null => (base ? <span style={chip}>{/2\.3/.test(base) ? '2.3 · compatible' : base.replace(/^LTXV /, '')}</span> : null)

// family = which ENGINE's renders can use the file. Every LTXV base is the LTX family; new
// families (MiniMax H3) enter this map when their engine lands — one line, rows regroup themselves.
const familyOf = (base?: string): string => (base ? (/^LTXV/i.test(base) ? 'LTX' : base) : 'untagged')
const TAG_CHOICES = ['LTXV 2.5', 'LTXV 2.3']

// remote thumbs come through main as data URLs (renderer CSP blocks remote img-src by design);
// resolved once per URL for the session. Hover ~0.6s = a large preview beside the cursor.
const thumbData = new Map<string, string | null>()
function LoraThumb({ url }: { url?: string }): React.JSX.Element {
  const [data, setData] = useState<string | null>(url ? (thumbData.get(url) ?? null) : null)
  const [preview, setPreview] = useState<{ x: number; y: number } | null>(null)
  const hoverT = useRef<number>(0)
  useEffect(() => {
    if (!url || thumbData.has(url)) return
    let dead = false
    void window.vidancer.lorasThumb(url).then((d) => {
      thumbData.set(url, d)
      if (!dead) setData(d)
    })
    return () => {
      dead = true
    }
  }, [url])
  useEffect(() => () => window.clearTimeout(hoverT.current), [])
  return (
    <span
      onMouseEnter={(e) => {
        if (!data) return
        const { clientX: x, clientY: y } = e
        hoverT.current = window.setTimeout(() => setPreview({ x, y }), 600)
      }}
      onMouseLeave={() => {
        window.clearTimeout(hoverT.current)
        setPreview(null)
      }}
      style={{ width: 28, height: 28, flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', borderRadius: radius.sm, color: 'var(--muted)', overflow: 'hidden' }}
    >
      {data ? <img src={data} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <Ic i={Sparkles} size={14} />}
      {preview &&
        data &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              left: Math.min(preview.x + 16, window.innerWidth - 296),
              top: Math.min(preview.y - 40, window.innerHeight - 296),
              zIndex: 1000,
              pointerEvents: 'none',
              background: 'var(--bg2)',
              border: '1px solid var(--line2)',
              borderRadius: 6,
              padding: 4,
              boxShadow: '0 12px 32px rgba(0,0,0,.55)'
            }}
          >
            <img src={data} alt="" style={{ width: 280, height: 280, objectFit: 'cover', display: 'block', borderRadius: 4 }} />
          </div>,
          document.body
        )}
    </span>
  )
}

export function LoraShelf(props: { open: boolean; onToggle: () => void }): React.JSX.Element {
  const [installed, setInstalled] = useState<LoraRow[]>([])
  const [jobs, setJobs] = useState<Record<string, { pct: number; note?: string }>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [official, setOfficial] = useState<LoraCatalogItem[] | null>(null) // null = reading
  const [officialErr, setOfficialErr] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'downloads' | 'newest'>('downloads')
  const [results, setResults] = useState<LoraCatalogItem[] | null>(null)
  const [civitaiErr, setCivitaiErr] = useState('')
  const [favorites, setFavorites] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)
  // installed-list management (built for the H3-era long shelf): search + source filter
  const [shelfQuery, setShelfQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<'' | 'hf' | 'civitai' | 'local'>('')
  const [openFams, setOpenFams] = useState<Set<string>>(new Set()) // family groups: all open by default; set holds the CLOSED ones
  const [tagMenu, setTagMenu] = useState<{ x: number; y: number; file: string } | null>(null)

  const refresh = (): void => {
    void window.vidancer.lorasList().then((l) => {
      setInstalled(l.installed)
      setJobs(Object.fromEntries(l.jobs.map((j) => [j.file, { pct: j.pct }])))
      setErrors(l.errors)
      setLoaded(true)
    })
  }
  const search = (q: string, s: 'downloads' | 'newest'): void => {
    setCivitaiErr('')
    setResults(null)
    void window.vidancer.lorasCivitai(q, s).then((r) => {
      if (r.ok) setResults(r.items ?? [])
      else {
        setResults([])
        setCivitaiErr(r.error ?? 'Civitai is unreachable')
      }
    })
  }
  useEffect(() => {
    refresh()
    search('', 'downloads')
    void window.vidancer.lorasOfficial().then((r) => {
      if (r.ok) setOfficial(r.items ?? [])
      else {
        setOfficial([])
        setOfficialErr(r.error ?? 'Hugging Face is unreachable')
      }
    })
    void window.vidancer.getSettings().then((s) => setFavorites((s?.loraFavorites as string[] | undefined) ?? []))
    const offP = window.vidancer.onLorasProgress((p) => setJobs((s) => ({ ...s, [p.file]: { pct: p.pct, note: p.note } })))
    const offD = window.vidancer.onLorasDone((p) => {
      setJobs((s) => {
        const n = { ...s }
        delete n[p.file]
        return n
      })
      setErrors((s) => ({ ...s, [p.file]: p.ok ? '' : (p.error ?? 'download failed') }))
      refresh()
    })
    return () => {
      offP()
      offD()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // debounced live search — typing settles for 400ms before the wire fires
  const debounce = useRef<number>(0)
  const onQuery = (q: string): void => {
    setQuery(q)
    window.clearTimeout(debounce.current)
    debounce.current = window.setTimeout(() => search(q, sort), 400)
  }
  const onSort = (s: 'downloads' | 'newest'): void => {
    setSort(s)
    search(query, s)
  }

  const toggleFav = (key: string): void => {
    const next = favorites.includes(key) ? favorites.filter((k) => k !== key) : [...favorites, key]
    setFavorites(next)
    void window.vidancer.setSettings({ loraFavorites: next })
  }
  const install = (it: LoraCatalogItem): void => {
    // the key gate lives at CLICK time, read fresh — a paste in Settings must count immediately
    // (2026-08-30 field catch: a mount-time check went stale and hid the button)
    void window.vidancer.getSettings().then((s) => {
      if (it.source === 'civitai' && !s?.civitaiKey) {
        setErrors((e) => ({ ...e, [it.file]: 'Civitai downloads need a key — paste one in Settings' }))
        return
      }
      setErrors((e) => ({ ...e, [it.file]: '' }))
      setJobs((j) => ({ ...j, [it.file]: { pct: 0 } }))
      void window.vidancer.lorasInstall(it).then((r) => {
        if (!r.ok) {
          setJobs((j) => {
            const n = { ...j }
            delete n[it.file]
            return n
          })
          setErrors((e) => ({ ...e, [it.file]: r.error ?? 'install failed' }))
        }
      })
    })
  }
  const del = async (row: LoraRow): Promise<void> => {
    if (!(await confirmDialog(`Delete ${row.sidecar?.name ?? row.file} — frees ${fmtBytes(row.bytes)}, re-downloadable any time.`, { confirmLabel: 'Delete', danger: true }))) return
    await window.vidancer.lorasDelete(row.file)
    refresh()
  }

  const installedFiles = new Set(installed.map((r) => r.file))

  // ---- shared state slot: download / progress / ✓ installed — morphs in place ----
  const stateSlot = (it: LoraCatalogItem): React.JSX.Element => {
    const job = jobs[it.file]
    const err = errors[it.file]
    if (installedFiles.has(it.file)) return <span style={{ fontFamily: font.mono, fontSize: 11, color: 'var(--ok)' }}>✓ installed</span>
    if (job)
      return (
        <>
          <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--field)', border: '1px solid var(--line)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.max(2, Math.min(100, job.pct))}%`, background: 'var(--amber)', transition: 'width .3s' }} />
          </div>
          <span title={job.note} style={{ fontFamily: font.mono, fontSize: 10, color: 'var(--muted)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {job.note ?? (job.pct < 0 ? '⏳' : `${job.pct}%`)}
          </span>
          <span onClick={() => void window.vidancer.lorasCancel(it.file)} title="cancel — the partial file is removed" style={{ color: 'var(--dim)', cursor: 'pointer', fontSize: 11 }}>
            ✕
          </span>
        </>
      )
    return (
      <span className="btn vd-hbtn" onClick={() => install(it)} title={`download once${it.bytes ? ` — ${fmtBytes(it.bytes)}` : ''}${it.source === 'civitai' ? ' · needs your Civitai key (Settings)' : ''}`} style={{ fontFamily: font.mono, whiteSpace: 'nowrap' }}>
      ⬇ {err ? 'retry' : 'install'}
        {it.bytes ? ` · ${fmtBytes(it.bytes)}` : ''}
      </span>
    )
  }

  // ---- one row grammar for catalog + installed rows ----
  const thumbSlot = (thumb?: string): React.JSX.Element => <LoraThumb url={thumb} />
  const rowStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: `${spacing.sm}px ${spacing.lg}px`, minHeight: 46, padding: `${spacing.sm}px 0`, borderBottom: '1px solid var(--line)' }
  // sub-group header — the Section legend recipe at row scale, with the same ▸/▾ fold glyph
  const subHead = (label: React.ReactNode, right: string, key?: string): React.JSX.Element => (
    <div
      onClick={key ? () => setOpenFams((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n }) : undefined}
      title={key ? (openFams.has(key) ? 'expand' : 'collapse') : undefined}
      style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: font.mono, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--muted)', margin: `${spacing.lg}px 0 ${spacing.xs}px`, cursor: key ? 'pointer' : 'default', userSelect: 'none' }}
    >
      {key && <span style={{ width: 10 }}>{openFams.has(key) ? '▸' : '▾'}</span>}
      {label}
      <span style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0, color: 'var(--dim)' }}>{right}</span>
    </div>
  )

  const catalogRow = (it: LoraCatalogItem, fav: boolean): React.JSX.Element => (
    <div key={it.key} style={rowStyle}>
      {thumbSlot(it.thumb)}
      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md }}>
          <span
            onClick={() => toggleFav(it.key)}
            title={fav ? 'unpin from the top' : 'pin to the top'}
            style={{ cursor: 'pointer', color: fav ? 'var(--amber)' : 'var(--dim)', fontSize: 12, flex: '0 0 auto' }}
          >
            {fav ? '★' : '☆'}
          </span>
          <span style={{ fontFamily: font.mono, fontSize: 12, color: 'var(--txt-hi)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>{it.name}</span>
          {it.homepage && (
            <span onClick={() => void window.vidancer.openExternal(it.homepage!)} title={it.homepage} style={{ ...chip, cursor: 'pointer', color: 'var(--amber)', flex: '0 0 auto' }}>
              ↗ {it.source === 'hf' ? 'huggingface' : 'civitai'}
            </span>
          )}
          {baseChip(it.baseModel)}
        </div>
        <div style={{ fontSize: 11, lineHeight: 1.35, color: errors[it.file] ? 'var(--bad)' : 'var(--dim)' }} title={errors[it.file] || undefined}>
          {errors[it.file] ||
            [it.author, it.downloads != null ? `${it.downloads.toLocaleString()} downloads` : '', it.triggerWords.length ? `triggers: ${it.triggerWords.join(', ')}` : ''].filter(Boolean).join(' · ') ||
            ' '}
        </div>
      </div>
      <div style={{ width: 200, flex: '0 0 auto', marginLeft: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.md }}>{stateSlot(it)}</div>
    </div>
  )

  const installedRow = (r: LoraRow): React.JSX.Element => (
    <div key={r.file} style={rowStyle} onContextMenu={(e) => { e.preventDefault(); setTagMenu({ x: e.clientX, y: e.clientY, file: r.file }) }}>
      {thumbSlot(r.sidecar?.thumb)}
      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md }}>
          <span style={{ fontFamily: font.mono, fontSize: 12, color: 'var(--txt-hi)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }} title={r.file}>
            {r.sidecar?.name ?? r.file}
          </span>
          <span style={chip}>{r.sidecar?.source === 'hf' ? 'official' : (r.sidecar?.source ?? 'local')}</span>
          {baseChip(r.sidecar?.baseModel)}
          {r.sidecar?.homepage && (
            <span onClick={() => void window.vidancer.openExternal(r.sidecar!.homepage!)} title={r.sidecar.homepage} style={{ ...chip, cursor: 'pointer', color: 'var(--amber)' }}>
              ↗
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, lineHeight: 1.35, color: 'var(--dim)' }}>
          {r.sidecar?.triggerWords?.length ? `triggers: ${r.sidecar.triggerWords.join(', ')}` : 'no trigger words on record — the file still works, prompts just carry no switch'}
        </div>
      </div>
      <div style={{ width: 200, flex: '0 0 auto', marginLeft: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.md }}>
        <span style={{ fontFamily: font.mono, fontSize: 11, color: 'var(--ok)' }}>✓ ready · {fmtBytes(r.bytes)}</span>
        <span onClick={() => void del(r)} title={`delete — frees ${fmtBytes(r.bytes)}, re-downloadable any time`} style={{ color: 'var(--dim)', cursor: 'pointer' }}>
          <Ic i={Trash2} size={12} />
        </span>
      </div>
    </div>
  )

  const gb = installed.reduce((a, r) => a + r.bytes, 0)
  const favSort = (items: LoraCatalogItem[]): LoraCatalogItem[] => [...items].sort((a, b) => Number(favorites.includes(b.key)) - Number(favorites.includes(a.key)))

  // installed rows → filter (search + source) → family groups
  const q = shelfQuery.trim().toLowerCase()
  const filtered = installed.filter((r) => {
    if (sourceFilter && (r.sidecar?.source ?? 'local') !== sourceFilter) return false
    if (!q) return true
    const hay = [r.file, r.sidecar?.name ?? '', ...(r.sidecar?.triggerWords ?? [])].join(' ').toLowerCase()
    return hay.includes(q)
  })
  const families = new Map<string, LoraRow[]>()
  for (const r of filtered) {
    const fam = familyOf(r.sidecar?.baseModel)
    families.set(fam, [...(families.get(fam) ?? []), r])
  }
  const famOrder = [...families.keys()].sort((a, b) => (a === 'untagged' ? 1 : b === 'untagged' ? -1 : a.localeCompare(b)))
  const srcChip = (v: '' | 'hf' | 'civitai' | 'local', label: string): React.JSX.Element => (
    <span
      key={v}
      onClick={() => setSourceFilter(v)}
      style={{ ...chip, cursor: 'pointer', ...(sourceFilter === v ? { color: 'var(--amber)', borderColor: 'var(--amber)' } : {}) }}
    >
      {label}
    </span>
  )

  return (
    <Section
      title="loras"
      collapsible
      open={props.open}
      onToggle={props.onToggle}
      right={<span style={{ fontFamily: font.mono, fontSize: 10, color: 'var(--dim)' }}>{loaded ? `${installed.length} installed${gb ? ` · ${fmtBytes(gb)}` : ''}` : '…'}</span>}
    >
      {/* ---- installed: disk is the truth; search + source filter carry the long shelf ---- */}
      {loaded && installed.length > 0 && (
        <div style={{ display: 'flex', gap: spacing.md, alignItems: 'center', marginBottom: spacing.sm }}>
          <input
            value={shelfQuery}
            onChange={(e) => setShelfQuery(e.target.value)}
            placeholder="filter installed — name or trigger word"
            spellCheck={false}
            style={{ flex: 1, fontFamily: font.mono, fontSize: 11, background: 'var(--field)', border: '1px solid var(--line)', borderRadius: radius.sm, color: 'var(--txt-hi)', padding: '4px 8px' }}
          />
          {srcChip('', 'all')}
          {srcChip('hf', 'official')}
          {srcChip('civitai', 'civitai')}
          {srcChip('local', 'own')}
        </div>
      )}
      {famOrder.map((fam) => (
        <div key={fam}>
          {subHead(
            fam === 'untagged' ? <span title="dropped-in files with no family on record — right-click a row to set it">untagged</span> : fam,
            `${families.get(fam)!.length}`,
            `fam:${fam}`
          )}
          {!openFams.has(`fam:${fam}`) && families.get(fam)!.map(installedRow)}
        </div>
      ))}
      {loaded && installed.length > 0 && filtered.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--dim)', padding: `${spacing.sm}px 0` }}>nothing matches the filter</div>
      )}
      {loaded && installed.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--dim)', padding: `${spacing.sm}px 0` }}>
          none installed yet — install one below, or drop a .safetensors into models/loras/. Picked LoRAs render in Clip Gen (LTX only).
        </div>
      )}
      {tagMenu && (
        <ContextMenu
          x={tagMenu.x}
          y={tagMenu.y}
          entries={TAG_CHOICES.map((b) => ({
            label: `family: ${b}`,
            onClick: () => void window.vidancer.lorasTag(tagMenu.file, b).then(refresh)
          }))}
          onClose={() => setTagMenu(null)}
        />
      )}

      {/* ---- official: live Lightricks scan — new adapters appear here on their own ---- */}
      {subHead(
        <span>
          official — Lightricks adapters <span style={{ color: 'var(--dim)', textTransform: 'none', letterSpacing: 0 }}>(scanned live from their Hugging Face)</span>
        </span>,
        official ? `${official.length}` : '…',
        'official'
      )}
      {!openFams.has('official') &&
        (official === null ? (
          <div style={{ fontSize: 11, color: 'var(--dim)', padding: `${spacing.sm}px 0` }}>reading…</div>
        ) : officialErr ? (
          <div style={{ fontSize: 11, color: 'var(--bad)', padding: `${spacing.sm}px 0` }}>{officialErr}</div>
        ) : (
          favSort(official).map((it) => catalogRow(it, favorites.includes(it.key)))
        ))}

      {/* ---- civitai: live browser; the key check runs fresh at install click ---- */}
      {subHead('browse civitai', results ? `${results.length}` : '…', 'civitai')}
      {!openFams.has('civitai') && (
        <>
          <div style={{ display: 'flex', gap: spacing.md, alignItems: 'center', marginBottom: spacing.sm }}>
            <input
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="search LTX loras — styles, motions, characters"
              spellCheck={false}
              style={{ flex: 1, fontFamily: font.mono, fontSize: 11, background: 'var(--field)', border: '1px solid var(--line)', borderRadius: radius.sm, color: 'var(--txt-hi)', padding: '4px 8px' }}
            />
            <select value={sort} onChange={(e) => onSort(e.target.value as 'downloads' | 'newest')} style={{ fontFamily: font.mono, fontSize: 11, background: 'var(--field)', border: '1px solid var(--line)', borderRadius: radius.sm, color: 'var(--txt-hi)', padding: '4px 6px' }}>
              <option value="downloads">most downloaded</option>
              <option value="newest">newest</option>
            </select>
          </div>
          {results === null ? (
            <div style={{ fontSize: 11, color: 'var(--dim)', padding: `${spacing.sm}px 0` }}>searching…</div>
          ) : civitaiErr ? (
            <div style={{ fontSize: 11, color: 'var(--bad)', padding: `${spacing.sm}px 0` }}>{civitaiErr}</div>
          ) : results.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--dim)', padding: `${spacing.sm}px 0` }}>nothing matched — Civitai has no LTX lora under that name yet</div>
          ) : (
            favSort(results).map((it) => catalogRow(it, favorites.includes(it.key)))
          )}
        </>
      )}
    </Section>
  )
}
