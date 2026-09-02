// LoRA picker (bible 12.10) — the pick-and-weight surface, ONE COPY (koan-shared SPEC).
// Mounted per gen surface: vi-dancer's clip panel, sprite's moveset rows (resolved picks —
// defaults come down pre-filled, an edit makes the row's own list) and Defaults panel.
// Stable board: always visible, greyed with the reason off-LTX, picks KEPT. Trigger chips are
// LOAD-BEARING (P6: without the words a style LoRA renders invisible) — hosts pass the insert
// target; surfaces without a prompt field pass none and get no chips.
import { useEffect, useState } from 'react'
import type { LoraRow } from '../types'
import { getKoanBridge } from './bridge'
import { ContextMenu } from './ContextMenu'

// installed shelf rows, shared across every mounted picker (a moveset is many rows — one wire
// read, not one per row); refreshed when a shelf install lands. Sidecars ride in for the chips.
let shelfCache: LoraRow[] = []
const shelfSubs = new Set<(rows: LoraRow[]) => void>()
let shelfWired = false
function wireShelf(): void {
  if (shelfWired) return
  shelfWired = true
  const pull = (): void => {
    void getKoanBridge()
      .api.lorasList()
      .then((l) => {
        shelfCache = l.installed
        shelfSubs.forEach((s) => s(shelfCache))
      })
  }
  pull()
  getKoanBridge().api.onLorasDone(pull)
}
function useShelfRows(): LoraRow[] {
  const [rows, setRows] = useState<LoraRow[]>(shelfCache)
  useEffect(() => {
    wireShelf()
    setRows(shelfCache)
    const sub = (r: LoraRow[]): void => setRows(r)
    shelfSubs.add(sub)
    return () => void shelfSubs.delete(sub)
  }, [])
  return rows
}

export function LoraPicker(props: {
  value: { name: string; weight: number }[] // the RESOLVED picks this surface shows
  isLtx: boolean // resolved engine is the local LTX — off it the block greys, picks kept
  onChange: (loras: { name: string; weight: number }[]) => void // writes the surface's own list
  overridden?: boolean // row surfaces: this row carries its own list — shows the ↺ default chip
  onReset?: () => void // row surfaces: drop the override, defaults flow back
  triggerHaystack?: string // text the ✓ check reads (the prompt/action field)
  onInsertTrigger?: (word: string) => void // tap-to-insert into the prompt/action
  buttonClass?: string // host app's own button face for + lora (KOAN.img: 'ki-btn', its V1 CLIP standard)
  wide?: boolean // host asks for the full-width row: button edge to edge, each pick a 30px row, slider filling
  dblClickResets?: boolean // host law (KOAN.img 2026-09-02): double-click on the weight slider resets it to 0
}): React.JSX.Element {
  const shelfRows = useShelfRows()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const loras = props.value
  const grey = props.isLtx ? {} : { opacity: 0.4, pointerEvents: 'none' as const }
  const offTitle = 'loras render on the local LTX engine only — fal engines ignore them'
  const activeWords = props.onInsertTrigger ? loras.flatMap((l) => shelfRows.find((r) => r.file === l.name)?.sidecar?.triggerWords ?? []) : []
  return (
    <div style={{ margin: '8px 0 2px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, ...grey }} title={props.isLtx ? undefined : offTitle}>
        {/* the house add-button face — amber-filled, lowercase (case law 2026-09-01: ALL
            buttons lowercase, one look) */}
        <span
          className={props.buttonClass ?? 'btn koan-hbtn'}
          style={
            props.buttonClass
              ? { whiteSpace: 'nowrap', ...(props.wide ? { display: 'block', width: '100%', boxSizing: 'border-box' as const, textAlign: 'center' as const } : {}) }
              : { fontFamily: 'var(--mono)', fontSize: 11, whiteSpace: 'nowrap' }
          }
          title={shelfRows.length ? 'add a lora — picks chain in order' : 'no loras installed — opens the Models shelf'}
          onClick={(e) => {
            e.stopPropagation()
            const { clientX: x, clientY: y } = e
            // empty-picker law: a pick popover never opens over nothing — front the shelf instead
            void getKoanBridge()
              .api.lorasList()
              .then((l) => {
                shelfCache = l.installed
                shelfSubs.forEach((s) => s(shelfCache))
                if (!l.installed.length) getKoanBridge().openModels()
                else setMenu({ x, y })
              })
          }}
        >
          ＋ lora
        </span>
        {loras.map((l, i) => (
          <span key={l.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid var(--line)', borderRadius: 4, padding: '2px 6px', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--txt-hi)', ...(props.wide ? { width: '100%', boxSizing: 'border-box' as const, height: 30, padding: '0 8px', fontSize: 11, gap: 8 } : {}) }}>
            <span style={{ ...(props.wide ? { flex: '0 1 auto', maxWidth: '50%' } : { maxWidth: 140 }), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.name}>
              {shelfRows.find((r) => r.file === l.name)?.sidecar?.name ?? l.name.replace(/\.safetensors$/, '')}
            </span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={l.weight}
              title={`weight ${l.weight.toFixed(2)} — 1 = full strength; stacked styles dilute each other at equal weights`}
              onChange={(e) => props.onChange(loras.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)))}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => {
                e.stopPropagation()
                if (props.dblClickResets) props.onChange(loras.map((x, j) => (j === i ? { ...x, weight: 0 } : x)))
              }}
              style={props.wide ? { flex: 1, minWidth: 40 } : { width: 60 }}
            />
            <span style={{ color: 'var(--muted)', minWidth: 26, textAlign: 'right' }}>{l.weight.toFixed(2)}</span>
            <span onClick={(e) => { e.stopPropagation(); props.onChange(loras.filter((_, j) => j !== i)) }} title="remove" style={{ color: 'var(--dim)', cursor: 'pointer' }}>
              ✕
            </span>
          </span>
        ))}
        {props.overridden && props.onReset && (
          <span
            onClick={(e) => { e.stopPropagation(); props.onReset!() }}
            title="drop this row's own picks — the project defaults flow back"
            style={{ fontFamily: 'var(--mono)', fontSize: 10, border: '1px solid var(--line)', borderRadius: 4, padding: '1px 5px', cursor: 'pointer', color: 'var(--dim)', whiteSpace: 'nowrap' }}
          >
            ↺ default
          </span>
        )}
      </div>
      {props.isLtx && props.onInsertTrigger && activeWords.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5, marginTop: 4 }}>
          {[...new Set(activeWords)].map((w) => {
            const present = (props.triggerHaystack ?? '').toLowerCase().includes(w.toLowerCase())
            return (
              <span
                key={w}
                onClick={(e) => {
                  e.stopPropagation()
                  if (!present) props.onInsertTrigger!(w)
                }}
                title={present ? 'already in the prompt' : 'tap to add — the lora barely fires without its trigger'}
                style={{ fontFamily: 'var(--mono)', fontSize: 9, border: '1px solid var(--line)', borderRadius: 4, padding: '1px 5px', cursor: present ? 'default' : 'pointer', color: present ? 'var(--ok)' : 'var(--amber)', whiteSpace: 'nowrap' }}
              >
                {present ? '✓ ' : '＋ '}
                {w}
              </span>
            )
          })}
        </div>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          entries={shelfRows
            .filter((r) => !loras.some((l) => l.name === r.file))
            .map((r) => ({
              label: r.sidecar?.name ?? r.file.replace(/\.safetensors$/, ''),
              onClick: () => props.onChange([...loras, { name: r.file, weight: 1 }])
            }))
            .concat(shelfRows.every((r) => loras.some((l) => l.name === r.file)) ? [{ label: 'every installed lora is already picked', onClick: () => getKoanBridge().openModels() }] : [])}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
