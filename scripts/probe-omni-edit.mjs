// Gemini Omni Flash probe session — answers the unknowns in docs/v2v-workflow-plan-2026-07-02.md
// before we trust the provisional registry constants. Costs ~$5-8 on the fal account.
//
//   FAL_KEY=id:secret node scripts/probe-omni-edit.mjs
//   (optional) FAL_ADMIN_KEY=... too — logs the real billed credit delta per probe
//
// Probes: P1 t2v baseline+codec · P2 /edit chained off P1's fal URL (no re-upload) ·
// P3 /edit on an uploaded 1080p source (resolution/audio/length preservation) ·
// P4 /edit on a 1:1 source (aspect behavior) · P5 1.5s source (min length) ·
// P6 15s source (over-max: reject or truncate) · billing noted per step when admin key present.
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fal } from '@fal-ai/client'
import ffmpegPath from 'ffmpeg-static'

const KEY = process.env.FAL_KEY || process.argv[2]
if (!KEY) {
  console.error('usage: FAL_KEY=id:secret node scripts/probe-omni-edit.mjs')
  process.exit(1)
}
fal.config({ credentials: KEY })
const ADMIN = process.env.FAL_ADMIN_KEY

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, 'probe-out')
await mkdir(OUT, { recursive: true })

const FF = ffmpegPath
const sh = (args) =>
  new Promise((resolve) => {
    const ps = spawn(FF, args)
    let err = ''
    ps.stderr.on('data', (d) => (err += d))
    ps.on('close', (code) => resolve({ code, err }))
  })

// parse `ffmpeg -i` stderr — enough metadata to answer the probe questions without ffprobe
async function probeFile(file) {
  const { err } = await sh(['-hide_banner', '-i', file])
  const dm = err.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/)
  const duration = dm ? +dm[1] * 3600 + +dm[2] * 60 + +dm[3] : 0
  const vm = err.match(/Video:\s*([^,]+),[^,]*,\s*(\d+)x(\d+)/)
  const fm = err.match(/(\d+(?:\.\d+)?)\s*fps/)
  const am = err.match(/Audio:\s*([^,]+),\s*(\d+) Hz,\s*([^,]+)/)
  return {
    duration: Math.round(duration * 100) / 100,
    codec: vm?.[1]?.trim() ?? '?',
    w: vm ? +vm[2] : 0,
    h: vm ? +vm[3] : 0,
    fps: fm ? +fm[1] : 0,
    audio: am ? `${am[1].trim()} ${am[2]}Hz ${am[3].trim()}` : 'NONE'
  }
}

// synthetic sources: SMPTE bars + a 440Hz tone — free, deterministic, unambiguous in outputs
async function makeClip(name, w, h, secs, fps = 30) {
  const p = join(OUT, name)
  const { code, err } = await sh([
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `smptebars=size=${w}x${h}:rate=${fps}`,
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', String(secs),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-shortest', '-y', p
  ])
  if (code !== 0) throw new Error(`ffmpeg synth failed: ${err.slice(-200)}`)
  return p
}

async function upload(path) {
  const buf = await readFile(path)
  return await fal.storage.upload(new File([buf], path.split(/[\\/]/).pop(), { type: 'video/mp4' }))
}

async function credit() {
  if (!ADMIN) return null
  try {
    const r = await fetch('https://api.fal.ai/v1/account/billing?expand=credits', { headers: { Authorization: `Key ${ADMIN}` } })
    const d = await r.json()
    return d?.credits?.current_balance ?? null
  } catch {
    return null
  }
}

const results = []
async function step(id, what, fn) {
  const before = await credit()
  const t0 = Date.now()
  console.log(`\n=== ${id}: ${what}`)
  try {
    const r = await fn()
    const after = await credit()
    const cost = before != null && after != null ? Math.round((before - after) * 1000) / 1000 : null
    results.push({ id, what, ok: true, secs: Math.round((Date.now() - t0) / 1000), cost, ...r })
    console.log(`    ok in ${Math.round((Date.now() - t0) / 1000)}s${cost != null ? ` · billed ~$${cost}` : ''}`, r)
  } catch (e) {
    const after = await credit()
    const cost = before != null && after != null ? Math.round((before - after) * 1000) / 1000 : null
    const error = String(e?.body?.detail ? JSON.stringify(e.body.detail) : e.message ?? e).slice(0, 500)
    results.push({ id, what, ok: false, cost, error })
    console.log(`    FAILED (this may itself be the answer): ${error}`)
  }
}

async function gen(endpoint, input, outName) {
  const res = await fal.subscribe(endpoint, { input, logs: false })
  const out = res.data ?? res
  const url = out?.video?.url ?? out?.video_url ?? out?.url
  if (!url) throw new Error('no video url in result: ' + JSON.stringify(out).slice(0, 300))
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
  const p = join(OUT, outName)
  await writeFile(p, bytes)
  const meta = await probeFile(p)
  return { url, file: outName, meta, raw: JSON.stringify(out).slice(0, 400) }
}

console.log('synthesizing test sources…')
const src1080 = await makeClip('src_1080p_6s.mp4', 1920, 1080, 6)
const srcSquare = await makeClip('src_1x1_4s.mp4', 640, 640, 4)
const srcShort = await makeClip('src_1.5s.mp4', 1280, 720, 1.5)
const srcLong = await makeClip('src_15s.mp4', 1280, 720, 15)

let p1
await step('P1', 't2v 3s baseline (output codec/fps/audio)', async () => {
  p1 = await gen('google/gemini-omni-flash', { prompt: 'A single red ball rolling slowly across a white table. No dialogue, quiet room tone.', duration: 3, aspect_ratio: '16:9' }, 'p1_t2v.mp4')
  return p1
})

if (p1) {
  await step('P2', '/edit chained straight off P1 fal URL (no re-upload) + length preservation', () =>
    gen('google/gemini-omni-flash/edit', { prompt: 'Make the ball blue. Keep everything else the same.', video_url: p1.url }, 'p2_edit_chain.mp4')
  )
}

await step('P3', '/edit on UPLOADED 1080p 6s source (resolution + audio + length preservation)', async () => {
  const url = await upload(src1080)
  return gen('google/gemini-omni-flash/edit', { prompt: 'Make the color bars pastel. Keep everything else the same.', video_url: url }, 'p3_edit_1080p.mp4')
})

await step('P4', '/edit on 1:1 source (aspect behavior)', async () => {
  const url = await upload(srcSquare)
  return gen('google/gemini-omni-flash/edit', { prompt: 'Make it look like film grain. Keep everything else the same.', video_url: url }, 'p4_edit_1x1.mp4')
})

await step('P5', '/edit on 1.5s source (minimum input length)', async () => {
  const url = await upload(srcShort)
  return gen('google/gemini-omni-flash/edit', { prompt: 'Invert the colors. Keep everything else the same.', video_url: url }, 'p5_edit_short.mp4')
})

await step('P6', '/edit on 15s source (over-max: reject or truncate?)', async () => {
  const url = await upload(srcLong)
  return gen('google/gemini-omni-flash/edit', { prompt: 'Make it black and white. Keep everything else the same.', video_url: url }, 'p6_edit_15s.mp4')
})

await writeFile(join(OUT, 'results.json'), JSON.stringify(results, null, 2))
console.log('\n\n==== SUMMARY (paste into docs/v2v-workflow-plan-2026-07-02.md) ====')
for (const r of results) {
  if (r.ok) console.log(`- ${r.id} ${r.what}: ${r.meta.w}x${r.meta.h} ${r.meta.codec} ${r.meta.fps}fps ${r.meta.duration}s audio[${r.meta.audio}]${r.cost != null ? ` billed ~$${r.cost}` : ''}`)
  else console.log(`- ${r.id} ${r.what}: FAILED — ${r.error}${r.cost != null ? ` (billed ~$${r.cost})` : ''}`)
}
console.log(`\nfiles + results.json in ${OUT}`)
fal.config({ credentials: '' })
