// DISABLE-ITEMS-SPEC-2026-09-19 — the three list rules a benched (disabled) Library / Bin item obeys,
// in ONE place so no picker can drift:
//   · the @ picker never suggests it (mentionMatches) — a title typed by hand still resolves
//   · a pick popover shows it DIMMED, AT THE END, still pickable (disabledLast + dimStyle) — his call
//   · everything that already uses it keeps working (nothing here touches refs, links or playback)

// the @ picker's list — was four copies of one line (Clip Gen, Image Edit, Co-Director, Director's Room)
export function mentionMatches<T extends { title: string; disabled?: boolean }>(images: T[], query: string, max = 8): T[] {
  return images.filter((i) => !i.disabled && i.title.toLowerCase().includes(query)).slice(0, max)
}

// enabled first, disabled after — each group keeps its own order
export function disabledLast<T extends { disabled?: boolean }>(list: T[]): T[] {
  return [...list.filter((x) => !x.disabled), ...list.filter((x) => x.disabled)]
}

export const dimStyle = (disabled?: boolean): React.CSSProperties => (disabled ? { opacity: 0.45 } : {})
export const dimTitle = (disabled?: boolean): string => (disabled ? ' · disabled (right-click it in the Library / Bin → enable)' : '')
