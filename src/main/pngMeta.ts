// PNG settings reader (KREA2-LOCAL-SPEC §8): what another ComfyUI (or A1111) baked into a PNG —
// the prompt that ran, the sampler numbers, the loras and the checkpoint. No dependency: PNG
// chunks are 12 bytes + body; tEXt / zTXt (inflate) / iTXt carry the text.
import { readFile } from 'fs/promises'
import { inflateSync } from 'zlib'

export interface PngLoraUse {
  name: string // as the graph named it (path relative to a lora root, or an A1111 tag name)
  weight: number
}
export interface PngSettings {
  source: 'comfy' | 'a1111' | 'none'
  prompt: string
  negative?: string
  model?: string
  width?: number
  height?: number
  seed?: number
  steps?: number
  cfg?: number
  sampler?: string
  scheduler?: string
  loras: PngLoraUse[]
}

function chunks(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {}
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return out
  let i = 8
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i)
    const type = buf.toString('latin1', i + 4, i + 8)
    const body = buf.subarray(i + 8, i + 8 + len)
    i += 12 + len
    if (type === 'IHDR') {
      out.__w = String(body.readUInt32BE(0))
      out.__h = String(body.readUInt32BE(4))
      continue
    }
    if (type === 'IEND') break
    if (type !== 'tEXt' && type !== 'zTXt' && type !== 'iTXt') continue
    const z = body.indexOf(0)
    if (z < 0) continue
    const key = body.toString('latin1', 0, z)
    try {
      if (type === 'tEXt') out[key] = body.toString('utf8', z + 1)
      else if (type === 'zTXt') out[key] = inflateSync(body.subarray(z + 2)).toString('utf8')
      else {
        // iTXt: compression flag, method, language\0, translated\0, text
        const comp = body[z + 1]
        let p = z + 3
        p = body.indexOf(0, p) + 1
        p = body.indexOf(0, p) + 1
        const txt = body.subarray(p)
        out[key] = comp === 1 ? inflateSync(txt).toString('utf8') : txt.toString('utf8')
      }
    } catch {
      /* a broken chunk is skipped, the rest still reads */
    }
  }
  return out
}

type Node = { class_type?: string; inputs?: Record<string, unknown> }
type Graph = Record<string, Node>
const isLink = (v: unknown): v is [string, number] => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string'

// walk the inputs of a node upstream and collect every STRING that reaches it through text
// nodes — the prompt exactly as the encoder received it (concatenated trigger words included)
function textOf(g: Graph, nid: string, seen = new Set<string>()): string {
  if (seen.has(nid)) return ''
  seen.add(nid)
  const n = g[nid]
  if (!n?.inputs) return ''
  const ct = n.class_type ?? ''
  const inp = n.inputs
  const str = (k: string): string => {
    const v = inp[k]
    if (typeof v === 'string') return v
    if (isLink(v)) return textOf(g, v[0], seen)
    return ''
  }
  if (ct === 'StringConcatenate') {
    const d = typeof inp.delimiter === 'string' ? inp.delimiter : ''
    return [str('string_a'), str('string_b')].filter(Boolean).join(d)
  }
  if (ct === 'ComfySwitchNode') {
    const sw = inp.switch
    const pick = sw === true ? 'on_true' : sw === false ? 'on_false' : ''
    if (pick) return str(pick)
    return str('on_false') || str('on_true')
  }
  if (ct === 'PrimitiveStringMultiline' || ct === 'PrimitiveString' || ct === 'String' || ct === 'Text Multiline' || ct === 'CR Text') return str('value') || str('text') || str('string')
  if (ct === 'PreviewAny' || ct === 'ShowText|pysssss') return str('source') || str('text')
  if (ct === 'TextGenerate') return str('prompt') // a refined prompt — the input text is the closest truth
  for (const k of ['text', 'prompt', 'string', 'value', 'text_g', 'positive']) {
    const v = str(k)
    if (v) return v
  }
  return ''
}

function fromComfy(graph: Graph, meta: Record<string, string>): PngSettings {
  const out: PngSettings = { source: 'comfy', prompt: '', loras: [] }
  // samplers: pick the one that feeds a decode/save (the last executed one wins on ties)
  const samplers = Object.entries(graph).filter(([, n]) => n.class_type === 'KSampler' || n.class_type === 'KSamplerAdvanced' || n.class_type === 'SamplerCustomAdvanced' || n.class_type === 'SamplerCustom')
  const [sid, samp] = samplers[samplers.length - 1] ?? []
  if (samp?.inputs) {
    const i = samp.inputs
    const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)
    out.seed = num(i.seed) ?? num(i.noise_seed)
    if (out.seed === undefined && isLink(i.noise)) out.seed = num(graph[i.noise[0]]?.inputs?.noise_seed)
    out.steps = num(i.steps)
    out.cfg = num(i.cfg)
    if (typeof i.sampler_name === 'string') out.sampler = i.sampler_name
    else if (isLink(i.sampler)) out.sampler = String(graph[i.sampler[0]]?.inputs?.sampler_name ?? '')
    if (typeof i.scheduler === 'string') out.scheduler = i.scheduler
    // prompt = whatever text reaches the positive conditioning; negative likewise unless zeroed
    const pos = isLink(i.positive) ? i.positive[0] : isLink(i.guider) ? ((): string | undefined => {
      const gu = graph[i.guider[0]]?.inputs
      return isLink(gu?.positive) ? gu.positive[0] : undefined
    })() : undefined
    const neg = isLink(i.negative) ? i.negative[0] : undefined
    if (pos) out.prompt = textOf(graph, pos)
    if (neg && graph[neg]?.class_type !== 'ConditioningZeroOut') {
      const t = textOf(graph, neg)
      if (t.trim()) out.negative = t
    }
    // size: the latent the sampler started from, else the file's own pixels
    const lat = isLink(i.latent_image) ? graph[i.latent_image[0]] : undefined
    if (lat?.inputs && typeof lat.inputs.width === 'number' && typeof lat.inputs.height === 'number') {
      out.width = lat.inputs.width
      out.height = lat.inputs.height
    }
  }
  if (!out.prompt) {
    // no sampler chain we understand — the longest text node is the best guess, said as such
    const texts = Object.values(graph)
      .filter((n) => n.class_type === 'CLIPTextEncode' || n.class_type === 'Krea2EditGroundedEncode' || n.class_type === 'TextEncodeKrea2OstrisEdit')
      .map((n) => (typeof n.inputs?.text === 'string' ? n.inputs.text : typeof n.inputs?.prompt === 'string' ? n.inputs.prompt : ''))
      .filter(Boolean)
    out.prompt = texts.sort((a, b) => b.length - a.length)[0] ?? ''
  }
  void sid
  // loras: every loader node, plus each "on" entry of rgthree's Power Lora Loader
  for (const n of Object.values(graph)) {
    const ct = n.class_type ?? ''
    const i = n.inputs ?? {}
    if (ct === 'LoraLoaderModelOnly' || ct === 'LoraLoader' || ct === 'LoraLoaderBlockWeight') {
      if (typeof i.lora_name === 'string') out.loras.push({ name: i.lora_name, weight: typeof i.strength_model === 'number' ? i.strength_model : 1 })
    } else if (ct === 'Power Lora Loader (rgthree)') {
      for (const [k, v] of Object.entries(i)) {
        if (!k.startsWith('lora_') || !v || typeof v !== 'object') continue
        const e = v as { on?: boolean; lora?: string; strength?: number }
        if (e.on && typeof e.lora === 'string') out.loras.push({ name: e.lora, weight: typeof e.strength === 'number' ? e.strength : 1 })
      }
    } else if (ct === 'UNETLoader' && typeof i.unet_name === 'string') out.model = i.unet_name
    else if ((ct === 'CheckpointLoaderSimple' || ct === 'CheckpointLoader') && typeof i.ckpt_name === 'string') out.model = i.ckpt_name
    else if (ct === 'UnetLoaderGGUF' && typeof i.unet_name === 'string') out.model = i.unet_name
  }
  if (!out.width && meta.__w) {
    out.width = Number(meta.__w)
    out.height = Number(meta.__h)
  }
  return out
}

function fromA1111(text: string, meta: Record<string, string>): PngSettings {
  const out: PngSettings = { source: 'a1111', prompt: '', loras: [] }
  const negAt = text.indexOf('\nNegative prompt:')
  const stepsAt = text.search(/\n(Steps|Sampler|Seed|Size|Model): /)
  const head = text.slice(0, negAt >= 0 ? negAt : stepsAt >= 0 ? stepsAt : text.length)
  out.prompt = head.trim()
  if (negAt >= 0) out.negative = text.slice(negAt + 17, stepsAt >= 0 ? stepsAt : text.length).trim()
  const tail = stepsAt >= 0 ? text.slice(stepsAt) : ''
  const kv = (k: string): string | undefined => tail.match(new RegExp(`(?:^|, |\\n)${k}: ([^,\\n]+)`))?.[1]?.trim()
  const n = (v?: string): number | undefined => (v && !Number.isNaN(Number(v)) ? Number(v) : undefined)
  out.steps = n(kv('Steps'))
  out.cfg = n(kv('CFG scale'))
  out.seed = n(kv('Seed'))
  out.sampler = kv('Sampler')
  out.scheduler = kv('Schedule type')
  out.model = kv('Model')
  const size = kv('Size')?.match(/(\d+)x(\d+)/)
  if (size) {
    out.width = Number(size[1])
    out.height = Number(size[2])
  }
  // <lora:name:weight> tags in the prompt are the loras that ran
  for (const m of out.prompt.matchAll(/<lora:([^:>]+)(?::([\d.]+))?>/g)) out.loras.push({ name: m[1], weight: m[2] ? Number(m[2]) : 1 })
  out.prompt = out.prompt.replace(/<lora:[^>]+>/g, '').replace(/\s{2,}/g, ' ').trim()
  if (!out.width && meta.__w) {
    out.width = Number(meta.__w)
    out.height = Number(meta.__h)
  }
  return out
}

export async function readPngSettings(path: string): Promise<PngSettings> {
  const buf = await readFile(path)
  const meta = chunks(buf)
  // the API graph is the truth; the UI `workflow` only when there is no `prompt` chunk
  if (meta.prompt) {
    try {
      return fromComfy(JSON.parse(meta.prompt) as Graph, meta)
    } catch {
      /* fall through */
    }
  }
  if (meta.parameters) return fromA1111(meta.parameters, meta)
  if (meta.workflow) {
    try {
      // UI graph → a rough API graph: nodes carry widgets_values in schema order, which we can't
      // map without the node definitions; read what is unambiguous (loader names, text widgets)
      const w = JSON.parse(meta.workflow) as { nodes?: { type?: string; widgets_values?: unknown[] }[] }
      const out: PngSettings = { source: 'comfy', prompt: '', loras: [] }
      const texts: string[] = []
      for (const nd of w.nodes ?? []) {
        const wv = nd.widgets_values ?? []
        if ((nd.type === 'LoraLoaderModelOnly' || nd.type === 'LoraLoader') && typeof wv[0] === 'string') out.loras.push({ name: wv[0], weight: typeof wv[1] === 'number' ? wv[1] : 1 })
        else if ((nd.type === 'UNETLoader' || nd.type === 'CheckpointLoaderSimple') && typeof wv[0] === 'string') out.model = wv[0]
        else if ((nd.type === 'CLIPTextEncode' || nd.type === 'PrimitiveStringMultiline') && typeof wv[0] === 'string' && wv[0].trim()) texts.push(wv[0])
        else if (nd.type === 'KSampler' && typeof wv[0] === 'number') {
          out.seed = wv[0]
          out.steps = typeof wv[2] === 'number' ? wv[2] : undefined
          out.cfg = typeof wv[3] === 'number' ? wv[3] : undefined
          out.sampler = typeof wv[4] === 'string' ? wv[4] : undefined
          out.scheduler = typeof wv[5] === 'string' ? wv[5] : undefined
        }
      }
      out.prompt = texts.sort((a, b) => b.length - a.length)[0] ?? ''
      if (meta.__w) {
        out.width = Number(meta.__w)
        out.height = Number(meta.__h)
      }
      return out
    } catch {
      /* fall through */
    }
  }
  return { source: 'none', prompt: '', loras: [], ...(meta.__w ? { width: Number(meta.__w), height: Number(meta.__h) } : {}) }
}
