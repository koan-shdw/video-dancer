// list 43 (docs/COMMUNITY-MOODS-SPEC-2026-10-01.md): the community MOODS — a public repo of .vmd files
// (MOODS-VMD-SPEC §8), listed by its index.json (built by the repo's own workflow), installed with one
// click, the maker credited by the file's author line. Sharing is a pull request, the GitHub way: the
// app writes the file and opens the repo's upload page; the repo's owner merges what everyone sees.
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { app, shell } from 'electron'
import { COMMUNITY_REPO, shareBlock, type CommunityMood } from '@koan/vidancer-ui/shared/communityMoods'
import { buildVmd, installVmd, parseVmd, readMood, type MoodInfo } from './moods'

const RAW = `https://raw.githubusercontent.com/${COMMUNITY_REPO}/main`
export const COMMUNITY_UPLOAD = `https://github.com/${COMMUNITY_REPO}/upload/main/moods`
const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/
const MAX_BYTES = 2 * 1024 * 1024 // a MOOD is text: the biggest shipped one is 72 KB
type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>

const str = (v: unknown, n: number): string => (typeof v === 'string' ? v.slice(0, n) : '')
// an entry of the list, read defensively: the index is a file on the internet
function entryOf(x: unknown): CommunityMood | null {
  const o = (x ?? {}) as Record<string, unknown>
  const slug = str(o.slug, 60)
  if (!SLUG.test(slug)) return null
  return {
    slug,
    name: str(o.name, 80) || slug,
    author: str(o.author, 80),
    description: str(o.description, 600),
    tags: Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === 'string').slice(0, 12).map((t) => t.slice(0, 40)) : [],
    version: str(o.version, 20) || '1.0',
    bytes: typeof o.bytes === 'number' && o.bytes > 0 ? o.bytes : 0
  }
}

async function get(url: string, f: Fetch): Promise<Response | string> {
  try {
    return await f(url, { signal: AbortSignal.timeout(15000) })
  } catch {
    return 'no connection to GitHub'
  }
}

export async function communityList(f: Fetch = fetch): Promise<{ ok: true; moods: CommunityMood[] } | { ok: false; error: string }> {
  const r = await get(`${RAW}/index.json`, f)
  if (typeof r === 'string') return { ok: false, error: r }
  if (r.status === 404) return { ok: false, error: 'the community repo is not up yet' }
  if (!r.ok) return { ok: false, error: `GitHub answered ${r.status}` }
  const j = (await r.json().catch(() => null)) as { moods?: unknown } | null
  const moods = (Array.isArray(j?.moods) ? j.moods : []).map(entryOf).filter((x): x is CommunityMood => !!x)
  return { ok: true, moods: moods.sort((a, b) => a.name.localeCompare(b.name)) }
}

// one click: the file, checked (size, a vmd header), into the library switched off like any added MOOD
export async function communityInstall(slug: string, replace = false, f: Fetch = fetch): Promise<{ ok: true; info: MoodInfo; replaced: boolean } | { ok: false; error: string }> {
  if (!SLUG.test(slug)) return { ok: false, error: 'not a MOOD name' }
  const r = await get(`${RAW}/moods/${slug}.vmd`, f)
  if (typeof r === 'string') return { ok: false, error: r }
  if (r.status === 404) return { ok: false, error: 'that MOOD is gone from the community list' }
  if (!r.ok) return { ok: false, error: `GitHub answered ${r.status}` }
  if (Number(r.headers.get('content-length') ?? 0) > MAX_BYTES) return { ok: false, error: 'too big to be a MOOD (over 2 MB)' }
  const text = await r.text()
  if (text.length > MAX_BYTES) return { ok: false, error: 'too big to be a MOOD (over 2 MB)' }
  if (!/^---\r?\n[\s\S]*?\bvmd:/.test(text)) return { ok: false, error: 'that file is not a MOOD (no vmd header)' }
  try {
    return { ok: true, ...(await installVmd(slug, text, replace)) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// share = a pull request: the .vmd (his name as its maker when it has none) lands in the share folder,
// Explorer shows it, and the repo's upload page opens; GitHub forks the repo and opens the pull request
export async function communityShare(slug: string, me: string): Promise<{ ok: true; file: string } | { ok: false; error: string }> {
  const m = await readMood(slug)
  if (!m) return { ok: false, error: 'that MOOD is gone from the library' }
  const why = shareBlock(m, me)
  if (why) return { ok: false, error: why }
  const text = m.author.trim() ? m.text : buildVmd({ ...parseVmd(m.text).header, author: me.trim() }, m.howToWrite, m.whatToKnow)
  const dir = join(app.getPath('userData'), 'moods-share')
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${slug}.vmd`)
  await writeFile(file, text, 'utf-8')
  shell.showItemInFolder(file)
  await shell.openExternal(COMMUNITY_UPLOAD)
  return { ok: true, file }
}
