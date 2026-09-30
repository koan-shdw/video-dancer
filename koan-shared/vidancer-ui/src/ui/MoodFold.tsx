import { useEffect, useState } from 'react'
import { vd } from '../api'
import { useStore } from '../store'
import { toast } from './Toast'
import { confirmDialog } from '../prompt'
import { ContextMenu, dropPath } from '@koan/shared'

// ---- the MOODS fold (MOODS-VMD-SPEC-2026-09-08 §5): one row ABOVE the INTENSITY pill in the
// Co-Director panel and the Director's Room (never the tether). Collapsed = `⌃ MOODS` + the
// active names. Open = a chip per installed mood (off · on · pinned), right-click for pin / edit /
// export / delete, bottom row `+ new` · `⇪ add`, drop a .vmd or a skill to add. A skill (.md,
// folder, .zip, .skill) goes to the Co-Director, who opens it, reads it and adds it (list 54). ----

const HEAVY = 30000 // tokens — the size guard warns above this (director: warn, don't cap)
const NO_PINS: string[] = [] // one stable empty array for the "no pins yet" case

export function MoodFold(): React.JSX.Element {
  const moods = useStore((s) => s.moods)
  const moodsOn = useStore((s) => s.moodsOn)
  const open = useStore((s) => s.moodsFoldOpen)
  const setOpen = useStore((s) => s.setMoodsFoldOpen)
  const refresh = useStore((s) => s.refreshMoods)
  const toggleOn = useStore((s) => s.toggleMoodOn)
  const setPinned = useStore((s) => s.setMoodPinned)
  // select the stored array itself — a `?? []` INSIDE the selector makes a fresh array every read,
  // which React's store subscription reads as endless change ("Maximum update depth", 2026-09-08)
  const pinnedRaw = useStore((s) => s.project?.codir.moodsPinned)
  const pinned = pinnedRaw ?? NO_PINS
  const codirSendText = useStore((s) => s.codirSendText)
  const [menu, setMenu] = useState<{ x: number; y: number; slug: string } | null>(null)
  const [shareMenu, setShareMenu] = useState<{ x: number; y: number } | null>(null) // ⇩ share: pick a mood, save its .vmd
  const [over, setOver] = useState(false)

  useEffect(() => {
    void refresh()
    // the Co-Director's save_mood writes from main — re-read the moment the library changes
    return vd().onMoodsChanged?.(() => void refresh())
  }, [refresh])

  const active = moods.filter((m) => moodsOn.includes(m.slug) || pinned.includes(m.slug))
  const activeTokens = active.reduce((s, m) => s + m.tokens, 0)

  const addFiles = async (paths: string[]): Promise<void> => {
    const r = paths.length ? await vd().moodImportPaths(paths) : await vd().moodImport()
    for (const e of r.errors) toast(e, { kind: 'error' })
    if (r.slugs.length) toast(`added ${r.slugs.length} MOOD${r.slugs.length > 1 ? 'S' : ''}`, { kind: 'ok' })
    await refresh()
    // a skill is the Co-Director's to take in: he opens it, reads it, writes its header, adds it
    const skills = r.skills ?? []
    if (skills.length) {
      const many = skills.length > 1
      void codirSendText(
        `(app: the user added ${many ? 'skills' : 'a skill'} to the MOODS fold — that is their ok to import. For each path: read_skill it, then import_skill it with a header you write from what you read. If a MOOD of that name is already installed, ask before replacing. Then say in a few short lines what you added, its size, what was left out, and whether it overlaps a MOOD that is already installed.)\nImport ${many ? 'these skills' : 'this skill'} as a MOOD:\n${skills.join('\n')}`
      )
      setOpen(true)
    }
  }
  const newMood = (): void => {
    codirSendText(
      '(app: the user pressed + new in the MOODS fold. Interview them briefly — the name, the trigger phrases (what they would say to mean it), the look and its lineage, the named anchors, a locked opening phrase and a closing suffix if the style wants one, banned words, output rules, two example prompts. Keep it to a few short questions at a time. When it is settled, call save_mood with both halves written in full.)\nI want to make a new MOOD.'
    )
    setOpen(true)
  }

  return (
    <div
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        const paths = Array.from(e.dataTransfer.files)
          .map((f) => dropPath(f) ?? '')
          .filter(Boolean)
        if (paths.length) {
          e.preventDefault()
          void addFiles(paths)
        }
      }}
      style={{ borderTop: '1px solid var(--line)', padding: '3px 6px 0', ...(over ? { outline: '1px dashed var(--amber)', outlineOffset: -2 } : {}) }}
    >
      {/* the collapsed row: chevron · MOODS · active names · count */}
      <div onClick={() => setOpen(!open)} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none', minHeight: 18 }} title={open ? 'fold MOODS' : 'MOODS — the style briefs the Co-Director can put on'}>
        <span style={{ fontSize: 10, color: 'var(--dim)', width: 10, textAlign: 'center' }}>{open ? '⌄' : '⌃'}</span>
        <span style={{ fontSize: 9, letterSpacing: 1, color: 'var(--dim)' }}>MOODS</span>
        <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
          {active.map((m) => (
            <span key={m.slug} style={{ fontSize: 8.5, letterSpacing: 0.5, color: 'var(--amber)', fontFamily: 'var(--mono)' }}>
              {m.name}
              {pinned.includes(m.slug) ? ' 📌' : ''}
            </span>
          ))}
        </span>
        <span style={{ fontSize: 9, color: activeTokens > HEAVY ? 'var(--bad)' : 'var(--dim)', fontFamily: 'var(--mono)' }} title={activeTokens > HEAVY ? 'heavy — every exchange carries this' : 'tokens the active MOODS add to every exchange (cached after the first)'}>
          {active.length ? `${active.length} on · ~${Math.round(activeTokens / 1000)}k` : `${moods.length}`}
        </span>
      </div>

      {open && (
        <div style={{ padding: '4px 0 4px' }}>
          {moods.length === 0 ? (
            <div style={{ fontSize: 10.5, color: 'var(--dim)', padding: '2px 0 4px' }}>no MOODS — add one, or press + new and I&apos;ll make one with you.</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
              {moods.map((m) => {
                const on = moodsOn.includes(m.slug)
                const pin = pinned.includes(m.slug)
                const lit = on || pin
                return (
                  <span
                    key={m.slug}
                    className="btn vd-hbtn"
                    onClick={() => toggleOn(m.slug)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setMenu({ x: e.clientX, y: e.clientY, slug: m.slug })
                    }}
                    title={`${m.description || m.name}\n~${Math.round(m.tokens / 1000)}k tokens${m.tokens > HEAVY ? ' — heavy' : ''} · by ${m.author || 'unknown'}${m.triggers.length ? `\nsay: ${m.triggers.slice(0, 5).join(' · ')}` : ''}\nclick = on/off for this session · right-click = pin, edit, export, delete`}
                    style={{
                      fontFamily: 'var(--mono)',
                      letterSpacing: 0.5,
                      textTransform: 'uppercase',
                      ...(lit ? { background: 'var(--amber)', borderColor: 'var(--amber)', color: 'var(--on-accent)' } : {}),
                      ...(m.tokens > HEAVY && !lit ? { borderColor: 'var(--bad)' } : {})
                    }}
                  >
                    {m.name}
                    {pin ? ' 📌' : ''}
                  </span>
                )
              })}
            </div>
          )}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span className="btn vd-hbtn" onClick={newMood} title="make a new MOOD with the Co-Director — a short interview, then he writes the file">
              + new
            </span>
            <span className="btn vd-hbtn" onClick={() => void addFiles([])} title="add a .vmd, or a skill (.md, .zip, .skill — or drop its folder here): the Co-Director opens a skill, reads it and adds it to the set">
              ⇪ add
            </span>
            <span
              className="btn vd-hbtn"
              style={moods.length ? undefined : { opacity: 0.4, cursor: 'default' }}
              onClick={(e) => moods.length && setShareMenu({ x: e.clientX, y: e.clientY })}
              title="share a MOOD — pick one, save its .vmd file anywhere (send it, post it, drop it in another install)"
            >
              ⇩ share
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--dim)' }}>#name in the prompt = once</span>
          </div>
          {shareMenu && (
            <ContextMenu
              x={shareMenu.x}
              y={shareMenu.y}
              entries={moods.map((m) => ({
                label: <>{m.name}{m.author ? <span style={{ color: 'var(--dim)', fontSize: 10 }}> · {m.author}</span> : null}</>,
                onClick: () => void vd().moodExport(m.slug).then((ok) => ok && toast(`shared ${m.name} — saved as ${m.slug}.vmd`, { kind: 'ok' }))
              }))}
              onClose={() => setShareMenu(null)}
            />
          )}
        </div>
      )}

      {menu &&
        (() => {
          const m = moods.find((x) => x.slug === menu.slug)
          if (!m) return null
          const pin = pinned.includes(m.slug)
          return (
            <ContextMenu
              x={menu.x}
              y={menu.y}
              entries={[
                {
                  label: pin ? '📌 unpin' : '📌 pin to this project',
                  onClick: () => void setPinned(m.slug, !pin)
                },
                { label: '✎ edit (open the file)', onClick: () => void vd().moodReveal(m.slug) },
                { label: '⇩ export', onClick: () => void vd().moodExport(m.slug) },
                { label: '', sep: true },
                {
                  label: '✕ delete',
                  danger: true,
                  onClick: async () => {
                    if (await confirmDialog(`Delete MOOD ${m.name}? The file is removed from the library.`, { confirmLabel: 'Delete', danger: true })) {
                      await vd().moodDelete(m.slug)
                      if (pin) await setPinned(m.slug, false)
                      await refresh()
                    }
                  }
                }
              ]}
              onClose={() => setMenu(null)}
            />
          )
        })()}
    </div>
  )
}

// the "it comes up" chip: a typed trigger phrase of an installed, OFF mood → offer it (never auto-on)
export function MoodSuggest({ text }: { text: string }): React.JSX.Element | null {
  const moods = useStore((s) => s.moods)
  const moodsOn = useStore((s) => s.moodsOn)
  const toggleOn = useStore((s) => s.toggleMoodOn)
  // select the stored array itself — a `?? []` INSIDE the selector makes a fresh array every read,
  // which React's store subscription reads as endless change ("Maximum update depth", 2026-09-08)
  const pinnedRaw = useStore((s) => s.project?.codir.moodsPinned)
  const pinned = pinnedRaw ?? NO_PINS
  const [dismissed, setDismissed] = useState<string[]>([])
  const low = text.toLowerCase()
  if (low.length < 4) return null
  const hit = moods.find((m) => !moodsOn.includes(m.slug) && !pinned.includes(m.slug) && !dismissed.includes(m.slug) && m.triggers.some((t) => t.length >= 3 && low.includes(t.toLowerCase())))
  if (!hit) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--dim)', padding: '2px 0' }}>
      <span>
        MOOD <b style={{ color: 'var(--amber)', fontFamily: 'var(--mono)' }}>{hit.name}</b> matches
      </span>
      <span className="btn vd-hbtn" onClick={() => toggleOn(hit.slug)} title="switch it on for this session">
        ✓ turn on
      </span>
      <span className="btn vd-hbtn" onClick={() => setDismissed((d) => [...d, hit.slug])} title="not this time">
        ✕
      </span>
    </div>
  )
}
