// P1 probe (docs/LTX-SPEC.md §8.1) — disposable. Boots the engine the way ensureLtxWorker
// does, then: `sigs` dumps the real node signatures; `t2v --variant <id>` renders one-pass
// full-size; `i2v --image <path>` follows once t2v lands. Outputs → scripts/probe-out/.
import { spawn } from 'child_process'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import net from 'net'

const APP = join(process.env.APPDATA, 'vi-dancer')
const ENG = join(APP, 'runtime', 'envs', 'ltx-comfy-engine')
const PY = join(ENG, 'env', 'Scripts', 'python.exe')
const COMFY = join(ENG, 'ComfyUI')
const WEIGHTS = join(APP, 'models', 'video', 'ltx-2.5')
const LORAS = join(APP, 'models', 'loras')
const OUT = join(process.cwd(), 'scripts', 'probe-out')
const fwd = (p) => p.split('\\').join('/')

const VARIANTS = {
  q5: { gguf: 'ltx-2.5-22b-distilled-transformer-Q5_K_M.gguf' },
  q4: { gguf: 'ltx-2.5-22b-distilled-transformer-Q4_K_M.gguf' },
  q3: { gguf: 'ltx-2.5-22b-distilled-transformer-Q3_K_M.gguf' },
  int8: { st: 'ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors' }
}
const ENC = 'gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors'
const VVAE = 'ltx-2.5-video-vae-bf16.safetensors'
const AVAE = 'ltx-2.5-audio-vae-bf16.safetensors'

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d }
const cmd = process.argv[2] ?? 'sigs'

const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) }) })

async function boot() {
  const yaml = join(OUT, 'paths.yaml')
  const lines = ['vidancer:', `  diffusion_models: ${fwd(WEIGHTS)}`, `  text_encoders: ${fwd(WEIGHTS)}`, `  vae: ${fwd(WEIGHTS)}`, `  model_patches: ${fwd(WEIGHTS)}`, `  loras: ${fwd(LORAS)}`, '']
  writeFileSync(yaml, lines.join('\n'))
  const port = await freePort()
  mkdirSync(join(OUT, 'render'), { recursive: true })
  const extra = process.argv.includes('--fp32vae') ? ['--fp32-vae'] : []
  const ps = spawn(PY, [join(COMFY, 'main.py'), '--listen', '127.0.0.1', '--port', String(port), '--disable-auto-launch', '--extra-model-paths-config', yaml, '--output-directory', join(OUT, 'render'), '--input-directory', OUT, ...extra], { cwd: COMFY })
  let log = ''
  ps.stdout.on('data', (d) => { log = (log + d).slice(-6000); process.stdout.write(d) })
  ps.stderr.on('data', (d) => { log = (log + d).slice(-6000); process.stdout.write(d) })
  ps.on('exit', (c) => { if (c !== null && c !== 0) { console.error(`\n[probe] comfy exited ${c}`); process.exit(1) } })
  const base = `http://127.0.0.1:${port}`
  const t0 = Date.now()
  while (Date.now() - t0 < 240_000) {
    try { const r = await fetch(`${base}/system_stats`); if (r.ok) { console.log(`\n[probe] up in ${((Date.now() - t0) / 1000).toFixed(0)}s on :${port}`); return { base, ps } } } catch {}
    await new Promise((r) => setTimeout(r, 1500))
  }
  console.error('[probe] server never came up. tail:\n' + log); ps.kill(); process.exit(1)
}

const CLASSES = ['UNETLoader', 'UnetLoaderGGUF', 'CLIPLoader', 'CLIPTextEncode', 'VAELoader', 'EmptyLTXVLatentVideo', 'LTXVEmptyLatentAudio', 'LTXVConcatAVLatent', 'LTXVSeparateAVLatent', 'LTXVConditioning', 'LTXVDualCFGGuider', 'KSamplerSelect', 'ManualSigmas', 'RandomNoise', 'SamplerCustomAdvanced', 'VAEDecodeTiled', 'LTXVAudioVAEDecode', 'CreateVideo', 'SaveVideo', 'LTXVImgToVideo', 'LTXVAddGuide', 'LTXVDurationPredictor', 'LoadImage']

async function sigs(base) {
  const info = await (await fetch(`${base}/object_info`)).json()
  for (const c of CLASSES) {
    if (!info[c]) { console.log(`!! MISSING CLASS ${c}`); continue }
    const it = info[c].input
    const show = (o) => Object.entries(o ?? {}).map(([k, v]) => `${k}:${Array.isArray(v[0]) ? `[enum ${v[0].length}]` : v[0]}`).join('  ')
    console.log(`== ${c}\n   req: ${show(it.required)}\n   opt: ${show(it.optional)}`)
    for (const [k, v] of Object.entries(it.required ?? {})) if (Array.isArray(v[0]) && /name|ckpt|unet|clip|vae/i.test(k)) console.log(`   ${k} choices: ${v[0].filter((x) => /ltx|gemma/i.test(x)).join(' | ') || '(none of ours)'}`)
  }
}

const SIGMAS = '1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0'
const PROMPT = "A wide shot of a lone lighthouse keeper walking along a rain-soaked stone pier at dusk, waves crashing against the rocks below. The keeper, an older man in a heavy yellow oilskin coat, moves slowly toward the lighthouse door, one hand holding his hood against the wind. The camera tracks alongside him at a steady pace, rain streaking through the frame. Cold blue-grey light from the storm mixes with the warm orange glow spilling from the lighthouse doorway. The sound of heavy rain, crashing waves, and wind gusts fills the scene, with the low creak of the iron door as he reaches it."
const NEG = 'pc game, console game, video game, cartoon, childish, ugly'

function t2vGraph(variant, seed, w, h, frames, fps, audio) {
  const v = VARIANTS[variant]
  const g = {
    unet: v.gguf ? { class_type: 'UnetLoaderGGUF', inputs: { unet_name: v.gguf } } : { class_type: 'UNETLoader', inputs: { unet_name: v.st, weight_dtype: 'default' } },
    clip: { class_type: 'CLIPLoader', inputs: { clip_name: ENC, type: 'ltxv', device: 'default' } },
    pos: { class_type: 'CLIPTextEncode', inputs: { text: PROMPT, clip: ['clip', 0] } },
    neg: { class_type: 'CLIPTextEncode', inputs: { text: NEG, clip: ['clip', 0] } },
    vvae: { class_type: 'VAELoader', inputs: { vae_name: VVAE } },
    avae: { class_type: 'VAELoader', inputs: { vae_name: AVAE } },
    vlat: { class_type: 'EmptyLTXVLatentVideo', inputs: { width: w, height: h, length: frames, batch_size: 1 } },
    alat: { class_type: 'LTXVEmptyLatentAudio', inputs: { frames_number: frames, frame_rate: fps, batch_size: 1, audio_vae: ['avae', 0] } },
    cat: { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['vlat', 0], audio_latent: ['alat', 0] } },
    cond: { class_type: 'LTXVConditioning', inputs: { positive: ['pos', 0], negative: ['neg', 0], frame_rate: fps } },
    guider: { class_type: 'LTXVDualCFGGuider', inputs: { model: ['unet', 0], positive: ['cond', 0], negative: ['cond', 1], video_cfg: 1, audio_cfg: 1 } },
    sampler: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler_ancestral' } },
    sigmas: { class_type: 'ManualSigmas', inputs: { sigmas: SIGMAS } },
    noise: { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    samp: { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['noise', 0], guider: ['guider', 0], sampler: ['sampler', 0], sigmas: ['sigmas', 0], latent_image: ['cat', 0] } },
    sep: { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['samp', 0] } },
    dec: { class_type: 'VAEDecodeTiled', inputs: { samples: ['sep', 0], vae: ['vvae', 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 16 } },
    save: { class_type: 'SaveVideo', inputs: { video: ['vid', 0], filename_prefix: `probe_t2v_${variant}_s${seed}`, format: 'auto', codec: 'auto' } }
  }
  if (audio) {
    g.adec = { class_type: 'LTXVAudioVAEDecode', inputs: { samples: ['sep', 1], audio_vae: ['avae', 0] } }
    g.vid = { class_type: 'CreateVideo', inputs: { images: ['dec', 0], fps, audio: ['adec', 0], bit_depth: 8 } }
  } else {
    g.vid = { class_type: 'CreateVideo', inputs: { images: ['dec', 0], fps, bit_depth: 8 } }
  }
  return g
}

function vramSampler() {
  let peak = 0
  const timer = setInterval(() => {
    try {
      const ps = spawn('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'])
      let s = ''
      ps.stdout.on('data', (d) => (s += d))
      ps.on('exit', () => { const n = parseInt(s); if (n > peak) peak = n })
    } catch {}
  }, 2000)
  return { stop: () => { clearInterval(timer); return peak } }
}

async function render(base, graph, label) {
  const t0 = Date.now()
  const vram = vramSampler()
  const r = await fetch(`${base}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: graph }) })
  const j = await r.json()
  if (!r.ok || j.error) { console.error(`[${label}] REJECTED:`, JSON.stringify(j, null, 2).slice(0, 3000)); vram.stop(); return null }
  const id = j.prompt_id
  console.log(`[${label}] queued ${id}`)
  for (;;) {
    await new Promise((res) => setTimeout(res, 3000))
    const h = await (await fetch(`${base}/history/${id}`)).json()
    const entry = h[id]
    if (!entry) continue
    if (entry.status?.status_str === 'error') {
      const msgs = (entry.status.messages ?? []).filter((m) => m[0] === 'execution_error').map((m) => `${m[1]?.node_type}: ${m[1]?.exception_message}`)
      console.error(`[${label}] FAILED: ${msgs.join(' | ').slice(0, 2000)}`)
      vram.stop(); return null
    }
    if (entry.status?.completed) {
      const secs = (Date.now() - t0) / 1000
      const peak = vram.stop()
      const files = Object.values(entry.outputs ?? {}).flatMap((o) => [...(o.images ?? []), ...(o.video ?? [])]).map((f) => f.filename)
      console.log(`[${label}] DONE in ${secs.toFixed(0)}s, peak VRAM ${(peak / 1024).toFixed(1)} GB, files: ${files.join(', ')}`)
      return { secs, peak, files }
    }
  }
}

async function main() {
  if (!existsSync(PY)) { console.error('engine missing'); process.exit(1) }
  const { base, ps } = await boot()
  try {
    if (cmd === 'sigs') await sigs(base)
    if (cmd === 'audioprobe') {
      // empty audio latent -> audio VAE decode -> mux with blank frames; the SaveVideo
      // sanitizer's non-finite count is the verdict: >0 = the decoder itself breaks
      const g = {
        avae: { class_type: 'VAELoader', inputs: { vae_name: AVAE } },
        alat: { class_type: 'LTXVEmptyLatentAudio', inputs: { frames_number: 49, frame_rate: 24, batch_size: 1, audio_vae: ['avae', 0] } },
        adec: { class_type: 'LTXVAudioVAEDecode', inputs: { samples: ['alat', 0], audio_vae: ['avae', 0] } },
        img: { class_type: 'EmptyImage', inputs: { width: 256, height: 256, batch_size: 49, color: 0 } },
        vid: { class_type: 'CreateVideo', inputs: { images: ['img', 0], fps: 24, audio: ['adec', 0], bit_depth: 8 } },
        save: { class_type: 'SaveVideo', inputs: { video: ['vid', 0], filename_prefix: 'probe_audio_empty', format: 'auto', codec: 'auto' } }
      }
      await render(base, g, 'audioprobe empty-latent')
    }
    if (cmd === 't2v') {
      const variant = arg('variant', 'q5')
      const seed = Number(arg('seed', 7))
      const fps = Number(arg('fps', 24))
      const secs = Number(arg('secs', 5))
      const frames = secs * fps + 1
      const audio = arg('audio', 'on') !== 'off'
      const [w, h] = arg('size', '1280x736').split('x').map(Number)
      await render(base, t2vGraph(variant, seed, w, h, frames, fps, audio), `t2v ${variant} ${w}x${h} ${frames}f`)
    }
  } finally { ps.kill(); setTimeout(() => process.exit(0), 500) }
}
main()
