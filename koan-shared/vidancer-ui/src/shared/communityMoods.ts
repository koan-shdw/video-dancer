// list 43 (vi-dancer docs/COMMUNITY-MOODS-SPEC-2026-10-01.md): the community MOODS' shared facts — the
// repo, one entry of its list, and why a MOOD can't go to the community as his (main refuses it, the
// MOODS fold greys the entry with the same words)
export const COMMUNITY_REPO = 'koan-shdw/vidancer-moods'

export interface CommunityMood {
  slug: string
  name: string
  author: string // the maker, credited
  description: string
  tags: string[]
  version: string
  bytes: number
}

export function shareBlock(m: { name: string; author: string; foreign?: boolean }, me: string): string | undefined {
  if (m.foreign) return `${m.name} was made from someone else's skill: it is not yours to share`
  if (!me.trim()) return 'set your name on MOODS in Settings first: the community credits the maker'
  if (m.author.trim() && m.author.trim().toLowerCase() !== me.trim().toLowerCase()) return `${m.name} is by ${m.author}: only its maker shares it`
  return undefined
}
