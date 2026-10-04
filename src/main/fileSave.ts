import { rename, writeFile } from 'fs/promises'
import { basename } from 'path'

// Cloud-sync clients can share writes while briefly blocking file replacement on Windows.
// Retry replacement first. If it stays locked, save in place and retain the complete temp copy.
const SWAP_LOCKED = new Set(['EPERM', 'EBUSY', 'EACCES'])
const SWAP_WAITS = [40, 80, 160, 320, 640, 1000, 1500, 2000]
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
