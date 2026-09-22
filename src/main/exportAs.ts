// EXPORT AS (TODO-2026-09-22 §21). His words: "ability to right click any media in library of clip
// takes and export as, jimage video, etc". One save box with a format list; the format he picks
// there decides the file. Same format as the source = a plain copy; a different one = the bundled
// ffmpeg converts at the highest quality. Pure half; index.ts owns the dialog + IPC.
import { execFile } from 'child_process'
import { copyFile } from 'fs/promises'
import { extname } from 'path'
import { FFMPEG } from './export'

export type ExportKind = 'image' | 'video' | 'audio'

// the save box's format list per kind (his call 09-22: mine stands until he names his own)
export const EXPORT_FILTERS: Record<ExportKind, { name: string; extensions: string[] }[]> = {
  image: [
    { name: 'PNG image', extensions: ['png'] },
    { name: 'JPEG image', extensions: ['jpg'] },
    { name: 'WebP image', extensions: ['webp'] }
  ],
  video: [
    { name: 'MP4 video', extensions: ['mp4'] },
    { name: 'QuickTime video', extensions: ['mov'] },
    { name: 'GIF animation', extensions: ['gif'] }
  ],
  audio: [
    { name: 'WAV audio', extensions: ['wav'] },
    { name: 'MP3 audio', extensions: ['mp3'] }
  ]
}

// ffmpeg arguments per target format — highest quality always (the product law)
function convertArgs(src: string, dest: string): string[] {
  const ext = extname(dest).toLowerCase()
  const head = ['-y', '-v', 'error', '-i', src]
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return [...head, '-frames:v', '1', '-q:v', '1', dest]
    case '.png':
      return [...head, '-frames:v', '1', '-compression_level', '6', dest]
    case '.webp':
      return [...head, '-frames:v', '1', '-quality', '100', '-compression_level', '6', dest]
    case '.gif':
      // one palette for the whole clip, no dithering — the closest a GIF gets to the source
      return [...head, '-vf', 'split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=none', '-loop', '0', dest]
    case '.mp4':
    case '.mov':
      // mp4 ↔ mov is the same h264/aac inside a different box: remux, no re-encode, nothing lost
      return [...head, '-c', 'copy', '-movflags', '+faststart', dest]
    case '.wav':
      return [...head, '-vn', '-c:a', 'pcm_s16le', dest]
    case '.mp3':
      return [...head, '-vn', '-c:a', 'libmp3lame', '-b:a', '320k', dest]
    default:
      return [...head, dest]
  }
}

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) =>
    execFile(FFMPEG, args, { windowsHide: true, timeout: 600_000, maxBuffer: 8 * 1024 * 1024 }, (err, _so, se) =>
      err ? reject(new Error(String(se || err.message).trim().split('\n').pop() || 'ffmpeg failed')) : resolve()
    )
  )
}

// copy when the format is the source's own, convert otherwise
export async function exportAs(src: string, dest: string): Promise<void> {
  const same = extname(src).toLowerCase().replace(/^\.jpeg$/, '.jpg') === extname(dest).toLowerCase().replace(/^\.jpeg$/, '.jpg')
  if (same) await copyFile(src, dest)
  else await ffmpeg(convertArgs(src, dest))
}
