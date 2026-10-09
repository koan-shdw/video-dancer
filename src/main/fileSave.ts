import { readFile, rename, writeFile } from 'fs/promises'
import { basename } from 'path'

// Cloud-sync clients can share writes while briefly blocking file replacement on Windows.
// Retry replacement first. If it stays locked, save in place and retain the complete temp copy.
const SWAP_LOCKED = new Set(['EPERM', 'EBUSY', 'EACCES'])
const SWAP_WAITS = [40, 80, 160, 320, 640, 1000, 1500, 2000]

// The read a save builds on. A MISSING file is the only "empty" (null). A lock that outlasts the
// waits, or any other error, THROWS, so no caller saves a fresh list over a file it could not read
// (audit 2026-10-09 batch 1: the settings, spend ledger and learned-rules wipes).
export async function readIfExists(file: string): Promise<string | null> {
  for (let i = 0; ; i++) {
    try {
      return await readFile(file, 'utf-8')
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? ''
      if (code === 'ENOENT') return null
      if (!SWAP_LOCKED.has(code) || i >= SWAP_WAITS.length) throw e
      await new Promise((r) => setTimeout(r, SWAP_WAITS[i]))
    }
  }
}

// tmp + swap: a crash mid-write never leaves a cut file for the next read to choke on
export async function writeAtomic(file: string, text: string): Promise<void> {
  await writeFile(file + '.tmp', text, 'utf-8')
  await swapIn(file + '.tmp', file, text)
}
export async function swapIn(tmp: string, dest: string, data: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await rename(tmp, dest)
      return
    } catch (e) {
      if (!SWAP_LOCKED.has((e as NodeJS.ErrnoException).code ?? '')) throw e
      if (i >= SWAP_WAITS.length) break
      await new Promise((r) => setTimeout(r, SWAP_WAITS[i]))
    }
  }
  await writeFile(dest, data, 'utf-8')
  console.warn(`[save] ${basename(dest)} stayed locked for the swap (cloud sync?) — saved in place, ${basename(tmp)} kept as the safety copy`)
}
