// list 6 (KEEPERS-SPEC-2026-09-29): a keeper is a FLAG, Lightroom's pick — a take set holds as many as
// you like. keeperIds = every keeper, in the order they were flagged; keeperTakeId keeps its old meaning
// for every reader, the take that PLAYS: the keeper flagged last, else the newest take that isn't
// disabled. An old project's saved keeper is its one flag. Main and every takes row read this file.
export interface KeeperSet {
  takes: { id: string; disabled?: boolean }[]
  keeperTakeId?: string
  keeperIds?: string[]
}

export const keepersOf = (o: Pick<KeeperSet, 'keeperIds' | 'keeperTakeId'> | null | undefined): string[] =>
  o ? (o.keeperIds ?? (o.keeperTakeId ? [o.keeperTakeId] : [])) : []

export const isKeeper = (o: Pick<KeeperSet, 'keeperIds' | 'keeperTakeId'> | null | undefined, takeId: string): boolean => keepersOf(o).includes(takeId)

// the take that plays: the keeper flagged last, else the newest take that isn't disabled
export function playingOf(o: KeeperSet): string | undefined {
  const k = keepersOf(o).filter((id) => o.takes.some((t) => t.id === id))
  if (k.length) return k[k.length - 1]
  const pool = o.takes.filter((t) => !t.disabled)
  const src = pool.length ? pool : o.takes
  return src[src.length - 1]?.id
}

// flag (on), unflag (off) or toggle (null — a mixed set all turns on). `play` = the take that must
// end up playing (a click flags it AND plays it: it moves to the end). Returns the new flag list.
export function flagged(o: KeeperSet, ids: string[], on: boolean | null, play?: string): string[] {
  const has = (id: string): boolean => o.takes.some((t) => t.id === id)
  const cur = keepersOf(o).filter(has)
  const want = on ?? !ids.every((id) => cur.includes(id))
  let next = want ? [...cur, ...ids.filter((id) => has(id) && !cur.includes(id))] : cur.filter((id) => !ids.includes(id))
  if (want && play && has(play)) next = [...next.filter((id) => id !== play), play]
  return next
}

// write the flags and the take that plays onto the set (in place)
export function applyKeepers(o: KeeperSet, ids: string[]): void {
  o.keeperIds = ids.filter((id) => o.takes.some((t) => t.id === id))
  o.keeperTakeId = playingOf(o)
}
