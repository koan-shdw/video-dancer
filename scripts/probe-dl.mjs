// Standalone repro of modelStore's chunked downloader (verbatim logic) + sha256 verify.
// Usage: node probe-dl.mjs <url> <dest> <expected-sha256> [--single]
import { createWriteStream, createReadStream } from 'fs'
import { open, rename, rm } from 'fs/promises'
import { Readable } from 'stream'
import { createHash } from 'crypto'

const [url, dest, expect] = process.argv.slice(2)
const single = process.argv.includes('--single')
const CHUNK = 32 * 1024 * 1024
const WIRES = 8

async function streamRange(u, part, start, end, bump) {
  const want = end - start + 1
  let lastErr
  for (let attempt = 0; attempt < 2; attempt++) {
    let written = 0
    try {
      const res = await fetch(u, { headers: { Range: `bytes=${start}-${end}` } })
      if (res.status !== 206 || !res.body) throw new Error(`range failed: HTTP ${res.status}`)
      const cr = res.headers.get('content-range')
      if (!cr || !cr.startsWith(`bytes ${start}-${end}/`)) console.log(`[dl] MISMATCHED content-range: asked ${start}-${end}, got ${cr}`)
      const out = createWriteStream(part, { flags: 'r+', start })
      const body = Readable.fromWeb(res.body)
      try {
        await new Promise((resolve, reject) => {
          body.on('data', (c) => { written += c.length; bump(c.length) })
          body.on('error', reject)
          out.on('error', reject)
          out.on('finish', resolve)
          body.pipe(out)
        })
      } finally {
        out.destroy()
        body.destroy()
      }
      if (written !== want) throw new Error(`range incomplete (${written}/${want})`)
      return
    } catch (e) {
      bump(-written)
      lastErr = e
      console.log(`[dl] chunk ${start} attempt ${attempt} failed: ${e.message}`)
    }
  }
  throw lastErr
}

async function main() {
  const probe = await fetch(url, { headers: { Range: 'bytes=0-0' } })
  const denom = probe.headers.get('content-range')?.split('/')[1]
  const total = denom ? Number(denom) : 0
  await probe.arrayBuffer().catch(() => {})
  console.log(`[dl] total ${total} bytes, mode: ${single ? 'single' : `chunked x${WIRES}`}`)
  const part = `${dest}.part`
  const t0 = Date.now()
  let got = 0
  const bump = (n) => { got += n }
  if (single) {
    const res = await fetch(url)
    const out = createWriteStream(part)
    const body = Readable.fromWeb(res.body)
    await new Promise((res2, rej) => { body.on('data', (c) => bump(c.length)); body.on('error', rej); out.on('error', rej); out.on('finish', res2); body.pipe(out) })
  } else {
    const fh = await open(part, 'w')
    await fh.truncate(total)
    await fh.close()
    const chunks = []
    for (let s = 0; s < total; s += CHUNK) chunks.push({ start: s, end: Math.min(s + CHUNK, total) - 1 })
    let next = 0
    let failed = null
    const worker = async () => {
      while (!failed) {
        const i = next++
        if (i >= chunks.length) return
        try { await streamRange(url, part, chunks[i].start, chunks[i].end, bump) } catch (e) { failed = failed ?? e; return }
      }
    }
    await Promise.all(Array.from({ length: Math.min(WIRES, chunks.length) }, () => worker()))
    if (failed) throw failed
  }
  console.log(`[dl] got ${got} in ${((Date.now() - t0) / 1000).toFixed(1)}s (${(got / 1e6 / ((Date.now() - t0) / 1000)).toFixed(1)} MB/s)`)
  await rm(dest, { force: true })
  await rename(part, dest)
  const h = createHash('sha256')
  await new Promise((res2, rej) => { const s = createReadStream(dest); s.on('data', (c) => h.update(c)); s.on('end', res2); s.on('error', rej) })
  const hex = h.digest('hex')
  console.log(`[dl] sha256 ${hex}`)
  console.log(hex === expect ? '[dl] VERIFIED OK' : `[dl] CORRUPT (expected ${expect})`)
}
main().catch((e) => { console.error('[dl] fatal:', e.message); process.exit(1) })
