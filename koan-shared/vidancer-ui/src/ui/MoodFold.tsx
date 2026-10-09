import { useEffect, useState } from 'react'
import { vd } from '../api'
import { useStore } from '../store'
import { toast } from './Toast'
import { confirmDialog, textPrompt } from '../prompt'
import { ContextMenu, dropPath, type MenuEntry } from '@koan/shared'
import { COMMUNITY_REPO, shareBlock, type CommunityMood } from '../shared/communityMoods'

// ---- the MOODS fold (MOODS-VMD-SPEC-2026-09-08 §5): one row ABOVE the INTENSITY pill in the
// Co-Director panel and the Director's Room (never the tether). Collapsed = `⌃ MOODS` + the
// active names. Open = a chip per installed mood (off · on · pinned), right-click for pin / edit /
// export / delete, bottom row `+ new` · `⇪ add`, drop a .vmd or a skill to add. A skill (.md,
// folder, .zip, .skill) goes to the Co-Director, who opens it, reads it and adds it (list 54).
// List 43 (COMMUNITY-MOODS-SPEC-2026-10-01): ⇣ community lists the shared MOODS (maker credited, one
// click installs), and right-click → share to the community hands a MOOD over as a pull request. ----

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
  // list 43: the community list (null = closed) and his name on MOODS (the maker a share credits)
  const [community, setCommunity] = useState<null | { loading: true } | { error: string } | { moods: CommunityMood[] }>(null)
  const settingsRev = useStore((s) => s.settingsRev)
  const [me, setMe] = useState('')
  useEffect(() => {
    void vd()
      .getSettings()
      .then((s) => setMe(String(s?.moodAuthor ?? '')))
  }, [settingsRev])
  const loadCommunity = async (): Promise<void> => {
    setCommunity({ loading: true })
    const r = await vd().moodCommunity()
    setCommunity(r.ok ? { moods: r.moods } : { error: r.error })
  }
  const install = async (c: CommunityMood, replace = false): Promise<void> => {
    const r = await vd().moodCommunityInstall(c.slug, replace)
    if (!r.ok) return void toast(r.error, { kind: 'error' })
    toast(`${replace ? 'updated' : 'installed'} ${c.name}, by ${c.author || 'unknown'} — switched off until you click it`, { kind: 'ok' })
    await refresh()
  }
  const share = async (slug: string): Promise<void> => {
    const m = moods.find((x) => x.slug === slug)
    if (!m) return
    // his test note 10-02 ("broken fix it"): with no name on MOODS the entry was greyed and only its
    // tooltip said why. Now share asks for the name once and saves it (the Settings field's value)
    let name = me.trim()
    if (!name) {
      name = ((await textPrompt('Your name on MOODS (the community credits the maker)', '')) ?? '').trim()
      if (!name) return
      await vd().setSettings({ moodAuthor: name })
      setMe(name)
      const why = shareBlock(m, name)
      if (why) return void toast(why, { kind: 'error' })
    }
    const ok = await confirmDialog(
      `Share ${m.name} to the community, credited to ${m.author.trim() || name}?\n\nOnly share MOODS you made. GitHub opens: drag ${m.slug}.vmd (Explorer shows it) onto its page and it becomes a pull request. The list shows it once it is merged.`,
      { confirmLabel: 'share' }
    )
    if (!ok) return
    const r = await vd().moodCommunityShare(slug)
    if (!r.ok) toast(r.error, { kind: 'error' })
    else toast(`${m.name}: drag ${m.slug}.vmd onto the GitHub page`, { kind: 'ok' })
  }

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
    // a name already installed (with other text) is never written over unasked (audit 2026-10-09 M7)
    const same = r.existing ?? []
    if (same.length && (await confirmDialog(`${same.map((x) => x.slug).join(', ')} ${same.length > 1 ? 'are' : 'is'} already in your MOODS. Replace ${same.length > 1 ? 'them' : 'it'} with the dropped file${same.length > 1 ? 's' : ''}? Your edits to ${same.length > 1 ? 'them' : 'it'} are lost.`, { confirmLabel: 'replace', danger: true }))) {
      const again = await vd().moodImportPaths(same.map((x) => x.path), true)
      for (const e of again.errors) toast(e, { kind: 'error' })
      if (again.slugs.length) toast(`replaced ${again.slugs.join(', ')}`, { kind: 'ok' })
    }
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
                  // his 10-02 call: "outlines unless clicked and then yelow" — a MOOD name is outlined until it is
                  // on, so the names never look like + new / add / share / community (those stay filled)
                  <span
                    key={m.slug}
                    className={lit ? 'btn vd-hbtn' : 'btn vd-hbtn ghost'}
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
                      fontWeight: 700, // on or off the same width: nothing beside it moves when it is clicked
                      ...(lit ? { border: '1px solid var(--amber)' } : {}),
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
            <span
              className="btn vd-hbtn"
              data-community-toggle
              onClick={() => (community ? setCommunity(null) : void loadCommunity())}
              title={`the community MOODS (${COMMUNITY_REPO} on GitHub): every one credited to its maker, one click installs it`}
            >
              ⇣ community
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--dim)' }}>#name in the prompt = once</span>
          </div>
          {community && (
            <div data-community style={{ borderTop: '1px dashed var(--line)', marginTop: 6, paddingTop: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: 'var(--dim)', letterSpacing: 1, marginBottom: 2 }}>
                <span>COMMUNITY</span>
                <span style={{ fontFamily: 'var(--mono)', letterSpacing: 0 }}>{COMMUNITY_REPO}</span>
                <span className="btn vd-hbtn" style={{ marginLeft: 'auto' }} onClick={() => void loadCommunity()} title="read the list again">
                  ↻
                </span>
              </div>
              {'loading' in community ? (
                <div style={{ fontSize: 10.5, color: 'var(--dim)' }}>reading the community list…</div>
              ) : 'error' in community ? (
                <div style={{ fontSize: 10.5, color: 'var(--bad)' }}>{community.error}</div>
              ) : community.moods.length === 0 ? (
                <div style={{ fontSize: 10.5, color: 'var(--dim)' }}>nothing shared yet: right-click a MOOD you made → share to the community</div>
              ) : (
                community.moods.map((c) => {
                  const mine = moods.find((x) => x.slug === c.slug)
                  const clash = !!mine && mine.author.trim().toLowerCase() !== c.author.trim().toLowerCase()
                  const state = !mine ? 'install' : clash ? 'clash' : mine.version === c.version ? 'installed' : 'update'
                  return (
                    <div
                      key={c.slug}
                      data-community-mood={c.slug}
                      title={`${c.description || c.name}${c.tags.length ? `\ntags: ${c.tags.join(' · ')}` : ''}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0', fontSize: 10.5 }}
                    >
                      <span style={{ fontFamily: 'var(--mono)', letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--txt-hi)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{c.name}</span>
                      <span style={{ color: 'var(--dim)', whiteSpace: 'nowrap' }}>
                        by {c.author || 'unknown'} · v{c.version}
                        {c.bytes ? ` · ~${Math.max(1, Math.round(c.bytes / 4000))}k tokens` : ''}
                      </span>
                      <span
                        className="btn vd-hbtn"
                        data-community-state={state}
                        style={{ marginLeft: 'auto', flex: '0 0 auto', ...(state === 'installed' || state === 'clash' ? { opacity: 0.45, cursor: 'default' } : {}) }}
                        title={
                          state === 'install'
                            ? 'install it: it lands in your MOODS switched off'
                            : state === 'update'
                              ? `the community has version ${c.version}, yours is ${mine!.version}: update replaces your copy`
                              : state === 'clash'
                                ? `your library has another MOOD called ${mine!.name} (by ${mine!.author || 'you'}): rename or delete it to install this one`
                                : 'in your MOODS, same version'
                        }
                        onClick={async () => {
                          if (state === 'install') return void install(c)
                          if (state === 'update' && (await confirmDialog(`Replace your copy of ${c.name} (version ${mine!.version}) with the community's version ${c.version}? Your edits to it are lost.`, { confirmLabel: 'update' }))) void install(c, true)
                        }}
                      >
                        {state === 'install' ? 'install' : state === 'update' ? 'update' : state === 'clash' ? 'name taken' : 'installed ✓'}
                      </span>
                    </div>
                  )
                })
              )}
            </div>
          )}
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
                // list 43: a pull request to the community repo; greyed with the reason when it isn't his to share
                ((): MenuEntry => {
                  const why = me.trim() || m.foreign ? shareBlock(m, me) : undefined // no name yet: share asks for it, then checks
                  return why ? { label: '⇡ share to the community', disabled: true, title: why } : { label: '⇡ share to the community', title: `a pull request to ${COMMUNITY_REPO}, credited to ${m.author.trim() || me.trim() || 'you (it asks your name first)'}`, onClick: () => void share(m.slug) }
                })(),
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
