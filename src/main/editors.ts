// OPEN IN AN EXTERNAL EDITOR (UI-ROUND-SPEC-2026-09-19 §2). His words: "right click edit images an
// choose to open them in an external editpor with ability to select from installed editors including
// photoshop" · "external editor new, make it look for the new file too some time it might save as a
// PDF" · "prompt when user goes back to vdacer saying 'a new edit was made, want to import it?'"
//
// The app opens a COPY (the original never changes — renders are immutable, WORKFLOW law 3), watches
// the copy AND same-name files in other formats beside it (Photoshop forces a PSD the moment layers
// exist), and asks on return. Yes = a NEW Library image. This file is the pure half: finding
// editors, staging + launching, the watch ledger, format conversion. index.ts owns IPC + settings.
import { execFile, spawn } from 'child_process'
import { existsSync } from 'fs'
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'fs/promises'
import { basename, extname, join } from 'path'
import { FFMPEG } from './export'

export interface ExternalEditor {
  id: string // stable key: the exe path, lower-cased
  name: string
  exe: string
}

// ---- finding installed editors ----
// Windows: the App Paths registry is where installers register their exe (Photoshop, Illustrator,
// Paint… all proven there on his machine). The per-user "open with" list is NOT used — it is full
// of junk (PickerHost, chrome, electron). One `reg query /s` per hive, cached for the session.
const KNOWN_WIN: { match: RegExp; name: string }[] = [
  { match: /^photoshop\.exe$/i, name: 'Photoshop' },
  { match: /^illustrator\.exe$/i, name: 'Illustrator' },
  { match: /^affinity ?photo.*\.exe$|^photo\.exe$/i, name: 'Affinity Photo' },
  { match: /^gimp(-[\d.]+)?\.exe$/i, name: 'GIMP' },
  { match: /^krita\.exe$/i, name: 'Krita' },
  { match: /^paintdotnet\.exe$/i, name: 'Paint.NET' },
  { match: /^clipstudiopaint\.exe$/i, name: 'Clip Studio Paint' },
  { match: /^mspaint\.exe$/i, name: 'Paint' }
]
const KNOWN_MAC: { match: RegExp; name: string }[] = [
  { match: /^Adobe Photoshop/i, name: 'Photoshop' },
  { match: /^Adobe Illustrator/i, name: 'Illustrator' },
  { match: /^Affinity Photo/i, name: 'Affinity Photo' },
  { match: /^GIMP/i, name: 'GIMP' },
  { match: /^krita/i, name: 'Krita' },
  { match: /^Pixelmator/i, name: 'Pixelmator' },
  { match: /^Preview\.app$/i, name: 'Preview' }
]

const regQuery = (hive: string): Promise<string> =>
  new Promise((resolve) =>
    execFile('reg.exe', ['query', `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths`, '/s', '/ve'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 8000 }, (_e, out) => resolve(out ?? ''))
  )

let found: ExternalEditor[] | null = null
async function findInstalled(): Promise<ExternalEditor[]> {
  if (found) return found
  const out: ExternalEditor[] = []
  const add = (name: string, exe: string): void => {
    const id = exe.toLowerCase()
    if (!out.some((e) => e.id === id || e.name === name)) out.push({ id, name, exe })
  }
  if (process.platform === 'win32') {
    for (const hive of ['HKLM', 'HKCU']) {
      let key = ''
      for (const raw of (await regQuery(hive)).split(/\r?\n/)) {
        const line = raw.trim()
        if (/^HKEY_/i.test(line)) key = line.split('\\').pop() ?? ''
        else if (key && /REG_(EXPAND_)?SZ/.test(line)) {
          // the value NAME is localized ("(Default)", "(既定)") — only the tail after REG_SZ counts
          const exe = line.split(/REG_(?:EXPAND_)?SZ/)[1]?.trim().replace(/^"|"$/g, '') ?? ''
          const k = KNOWN_WIN.find((x) => x.match.test(key))
          if (k && exe && (existsSync(exe) || /\\WindowsApps\\/i.test(exe))) add(k.name, exe)
          key = ''
        }
      }
    }
  } else if (process.platform === 'darwin') {
    const roots = ['/Applications', '/System/Applications']
    for (const root of roots) {
      let names: string[] = []
      try {
        names = await readdir(root)
      } catch {
        continue
      }
      for (const n of names) {
        const k = KNOWN_MAC.find((x) => x.match.test(n))
        if (!k) continue
        if (n.endsWith('.app')) add(k.name, join(root, n))
        else {
          // Adobe nests the .app inside a same-name folder
          const inner = (await readdir(join(root, n)).catch(() => [] as string[])).find((x) => x.endsWith('.app') && k.match.test(x))
          if (inner) add(k.name, join(root, n, inner))
        }
      }
    }
  }
  // the table's order is the menu's order (Photoshop first — the one he named), not the registry's
  const rank = (n: string): number => [...KNOWN_WIN, ...KNOWN_MAC].findIndex((k) => k.name === n)
  out.sort((a, b) => rank(a.name) - rank(b.name))
  found = out
  return out
}

// found editors + his own picks; the one he used last lists first
export async function listEditors(own: { name: string; exe: string }[] = [], lastId?: string): Promise<ExternalEditor[]> {
  const all = [...(await findInstalled())]
  for (const o of own) {
    const id = o.exe.toLowerCase()
    if (existsSync(o.exe) && !all.some((e) => e.id === id)) all.push({ id, name: o.name, exe: o.exe })
  }
  return lastId ? [...all.filter((e) => e.id === lastId), ...all.filter((e) => e.id !== lastId)] : all
}

function launch(editor: ExternalEditor, file: string): void {
  if (process.platform === 'darwin') {
    spawn('open', ['-a', editor.exe, file], { detached: true, stdio: 'ignore' }).unref()
    return
  }
  // a packaged (WindowsApps) exe cannot be started by its real path — its execution alias can
  const exe = /\\WindowsApps\\/i.test(editor.exe) ? basename(editor.exe) : editor.exe
  spawn(exe, [file], { detached: true, stdio: 'ignore', windowsHide: false }).unref()
}

// ---- the watch ledger: <project>/external-edits/watch.json ----
export interface EditWatch {
  id: string
  copy: string // the file the editor was handed
  stem: string // its name without the extension — siblings in other formats share it
  sourceTitle: string
  editedFrom?: string // Library image id, when the source was one
  editor: string
  seen: Record<string, number> // file → mtimeMs already answered for (or the copy's baseline)
}
const WATCH_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.psd', '.psb', '.tif', '.tiff', '.pdf']
const editsDir = (projectDir: string): string => join(projectDir, 'external-edits')
const ledgerPath = (projectDir: string): string => join(editsDir(projectDir), 'watch.json')
async function readLedger(projectDir: string): Promise<EditWatch[]> {
  try {
    const j = JSON.parse(await readFile(ledgerPath(projectDir), 'utf-8')) as { watches?: EditWatch[] }
    return Array.isArray(j.watches) ? j.watches : []
  } catch {
    return []
  }
}
async function writeLedger(projectDir: string, watches: EditWatch[]): Promise<void> {
  await mkdir(editsDir(projectDir), { recursive: true })
  await writeFile(ledgerPath(projectDir), JSON.stringify({ watches: watches.slice(-50) }, null, 2), 'utf-8')
}

// copy → ledger → launch. Returns the copy's path.
export async function startEdit(projectDir: string, srcFile: string, o: { sourceTitle: string; editedFrom?: string }, editor: ExternalEditor): Promise<string> {
  const dir = editsDir(projectDir)
  await mkdir(dir, { recursive: true })
  const base = `${o.sourceTitle.replace(/^@/, '').replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').trim() || 'image'} edit`
  const taken = new Set((await readdir(dir)).map((n) => n.slice(0, n.length - extname(n).length).toLowerCase()))
  let n = 1
  while (taken.has(`${base} ${n}`.toLowerCase())) n++
  const stem = `${base} ${n}`
  const copy = join(dir, stem + (extname(srcFile) || '.png'))
  await copyFile(srcFile, copy)
  const watches = await readLedger(projectDir)
  watches.push({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, copy, stem, sourceTitle: o.sourceTitle, editedFrom: o.editedFrom, editor: editor.name, seen: { [copy]: (await stat(copy)).mtimeMs } })
  await writeLedger(projectDir, watches)
  launch(editor, copy)
  return copy
}

export interface PendingEdit {
  watchId: string
  file: string
  name: string
  editor: string
  mtime: number
}
// every watch whose copy changed, or that grew a same-name sibling, since it was last answered for.
// One entry per watch: its NEWEST saved file. A file still being written (mtime under a second
// old) waits for the next check.
export async function pendingEdits(projectDir: string): Promise<PendingEdit[]> {
  const dir = editsDir(projectDir)
  if (!existsSync(dir)) return []
  const watches = await readLedger(projectDir)
  if (!watches.length) return []
  const names = await readdir(dir).catch(() => [] as string[])
  const out: PendingEdit[] = []
  for (const w of watches) {
    let newest: PendingEdit | null = null
    for (const n of names) {
      const ext = extname(n).toLowerCase()
      if (!WATCH_EXTS.includes(ext) || n.slice(0, n.length - ext.length).toLowerCase() !== w.stem.toLowerCase()) continue
      const file = join(dir, n)
      const m = (await stat(file).catch(() => null))?.mtimeMs
      if (m == null || Date.now() - m < 900) continue
      if (m <= (w.seen[file] ?? 0) + 1) continue
      if (!newest || m > newest.mtime) newest = { watchId: w.id, file, name: n, editor: w.editor, mtime: m }
    }
    if (newest) out.push(newest)
  }
  return out
}

// answered (imported or declined): every same-name file as it stands now counts as seen, so only
// the NEXT save asks again
export async function markAnswered(projectDir: string, watchId: string): Promise<EditWatch | null> {
  const watches = await readLedger(projectDir)
  const w = watches.find((x) => x.id === watchId)
  if (!w) return null
  const dir = editsDir(projectDir)
  for (const n of await readdir(dir).catch(() => [] as string[])) {
    const ext = extname(n).toLowerCase()
    if (!WATCH_EXTS.includes(ext) || n.slice(0, n.length - ext.length).toLowerCase() !== w.stem.toLowerCase()) continue
    const file = join(dir, n)
    const m = (await stat(file).catch(() => null))?.mtimeMs
    if (m != null) w.seen[file] = m
  }
  await writeLedger(projectDir, watches)
  return w
}
export async function watchById(projectDir: string, watchId: string): Promise<EditWatch | null> {
  return (await readLedger(projectDir)).find((x) => x.id === watchId) ?? null
}

// ---- formats: what the Library can take as is, what ffmpeg flattens, what nobody here can read ----
export async function toImportable(file: string): Promise<string> {
  const ext = extname(file).toLowerCase()
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) return file
  if (ext === '.pdf') throw new Error("saved as PDF — the app can't read that, export a PNG")
  // PSD / PSB / TIFF: the flattened picture, via the bundled ffmpeg
  const out = file.slice(0, file.length - ext.length) + '.import.png'
  await new Promise<void>((resolve, reject) =>
    execFile(FFMPEG, ['-y', '-v', 'error', '-i', file, '-frames:v', '1', out], { windowsHide: true, timeout: 120_000 }, (err, _so, se) =>
      err ? reject(new Error(`couldn't read ${basename(file)} — ${String(se || err.message).trim().split('\n').pop()?.slice(0, 200)}. Save it with "maximize compatibility" on, or export a PNG`)) : resolve()
    )
  )
  return out
}
