// The setup wizard's map (list 36): every service the app can use, page by page, and what each
// one GIVES. His words: "A install and login wizard that lets users log into all the servies in a
// single login wizard the LLM, the video the image it outlines all the serves that each will
// provide and guies them for the login" (09-21). His answers 09-30: every service the app has, no
// "recommended" tag.
//
// Nothing here is written by hand twice: what a service gives is read off the same registries the
// pickers read (video engines, image models and their suppliers, audio and voice engines, the
// Co-Director's engines, the local models). A model added to a registry shows up here by itself.
import { MODELS, CODIR_ENGINES, type CodirCli } from '../shared/models'
import { PICKABLE_IMAGE_MODELS } from '../shared/imageModels'
import { AUDIO_MODELS, VOICE_MODELS } from '../shared/audioModels'
import { LOCAL_MODELS } from '../shared/localModels'
import type { KeySupplier } from './keySuppliers'
import type { BridgeServiceId } from '../shared/types'

export type SetupVia =
  | { key: KeySupplier['id'] } // an API key: get it on their page, paste, save
  | { bridge: BridgeServiceId } // a login on the Bridge (their site, his browser)
  | { cli: CodirCli } // a command-line tool on this machine that holds his login
  | { local: true } // runs on this PC: no account, set up in the Models card

export interface SetupService {
  id: string // unique on its page
  name: string
  gives: string[] // what it provides on THIS page
  via: SetupVia
}
export interface SetupPage {
  id: 'codir' | 'video' | 'image' | 'audio' | 'watch'
  title: string
  about: string
  inline?: boolean // what a service gives is a list of names: shown on one line, not one a line
  services: SetupService[]
}

const bare = (label: string): string => label.replace(/\s*\([^)]*\)\s*$/, '') // "Seedance 2 (ModelArk)" → "Seedance 2"
const uniq = (xs: string[]): string[] => [...new Set(xs)]

// which key (or Bridge login) a registry's supplier name means
const VIDEO_KEY: Record<string, KeySupplier['id']> = { fal: 'fal', modelark: 'ark', astria: 'astria', venice: 'venice', google: 'google', higgsfield: 'higgsfield' }
const IMAGE_KEY: Record<string, KeySupplier['id']> = { fal: 'fal', ark: 'ark', google: 'google', venice: 'venice' }
const AUDIO_KEY: Record<string, KeySupplier['id']> = { fal: 'fal', elevenlabs: 'eleven', google: 'google' }
const KEY_NAME: Record<KeySupplier['id'], string> = { fal: 'fal.ai', ark: 'BytePlus ModelArk', astria: 'Astria', venice: 'Venice', google: 'Google AI', eleven: 'ElevenLabs', higgsfield: 'Higgsfield (platform key)', anthropic: 'Anthropic', deepseek: 'DeepSeek', civitai: 'Civitai' }
const BRIDGE_NAME: Record<string, string> = { higgsfield: 'Higgsfield', magnific: 'Magnific', artlist: 'Artlist', runway: 'Runway', pika: 'Pika', elevenlabs: 'ElevenLabs' }
const NOTHING_YET = 'a login only: no engine in the app runs on it yet'
const local = (category: string): string[] => LOCAL_MODELS.filter((m) => m.category === category && !m.variantOf).map((m) => m.label)
const onThisPc = (gives: string[]): SetupService[] => (gives.length ? [{ id: 'local', name: 'On this PC', gives, via: { local: true } }] : [])

export function setupPages(): SetupPage[] {
  // ---- the Co-Director: one row per engine ----
  const codir: SetupService[] = CODIR_ENGINES.map((e) => ({
    id: e.id,
    name: e.label,
    gives: [`runs the Co-Director on ${e.says}`],
    via: e.cli ? { cli: e.cli } : { key: e.key === 'veniceKey' ? 'venice' : e.key === 'deepseekKey' ? 'deepseek' : 'anthropic' }
  }))

  // ---- video: the engines each key, login or this PC renders ----
  const engines = Object.values(MODELS).filter((m) => !m.hidden)
  const video: SetupService[] = []
  for (const [provider, key] of Object.entries(VIDEO_KEY)) {
    const gives = uniq(engines.filter((m) => (m.provider ?? 'fal') === provider).map((m) => bare(m.label)))
    if (gives.length) video.push({ id: key, name: KEY_NAME[key], gives, via: { key } })
  }
  for (const svc of ['higgsfield', 'runway', 'magnific', 'pika', 'artlist'] as const) {
    const gives = uniq(engines.filter((m) => m.provider === 'mcp' && m.mcpService === svc).map((m) => bare(m.label)))
    video.push({ id: `bridge-${svc}`, name: `${BRIDGE_NAME[svc]} login`, gives: gives.length ? gives : [NOTHING_YET], via: { bridge: svc } })
  }
  video.push(...onThisPc(local('video')))

  // ---- image: Image Edit's models by supplier, Image Gen on this PC, the LoRA shelf ----
  const image: SetupService[] = []
  for (const [via, key] of Object.entries(IMAGE_KEY)) {
    const gives = PICKABLE_IMAGE_MODELS.filter((m) => m.vias.some((v) => v.id === via && !v.bridge)).map((m) => m.label)
    if (gives.length) image.push({ id: key, name: KEY_NAME[key], gives, via: { key } })
  }
  for (const svc of ['higgsfield', 'runway', 'pika'] as const) {
    const gives = PICKABLE_IMAGE_MODELS.filter((m) => m.vias.some((v) => v.bridge === svc)).map((m) => m.label)
    if (gives.length) image.push({ id: `bridge-${svc}`, name: `${BRIDGE_NAME[svc]} login`, gives, via: { bridge: svc } })
  }
  image.push(...onThisPc(local('image')))
  image.push({ id: 'civitai', name: KEY_NAME.civitai, gives: ['LoRA downloads for the LoRA shelf'], via: { key: 'civitai' } })

  // ---- voice and music: Score, SFX Gen and Voice, by supplier ----
  const all = [...Object.values(AUDIO_MODELS), ...Object.values(VOICE_MODELS)].filter((m) => !m.hidden)
  const KIND: Record<string, string> = { music: 'music', sfx: 'sound fx', voice: 'voice' }
  const sounds = (provider: string): string[] =>
    (['music', 'sfx', 'voice'] as const)
      .map((k) => [KIND[k], all.filter((m) => m.provider === provider && m.kind === k).map((m) => bare(m.label))] as const)
      .filter(([, list]) => list.length)
      .map(([k, list]) => `${k}: ${uniq(list).join(', ')}`)
  const audio: SetupService[] = []
  for (const [provider, key] of Object.entries(AUDIO_KEY)) {
    const gives = sounds(provider)
    if (gives.length) audio.push({ id: key, name: KEY_NAME[key], gives, via: { key } })
  }
  audio.push({ id: 'bridge-elevenlabs', name: `${BRIDGE_NAME.elevenlabs} login`, gives: [NOTHING_YET], via: { bridge: 'elevenlabs' } })
  audio.push(...onThisPc(sounds('local')))

  // ---- watching: who looks at a take or a cut for the Co-Director and Score compose ----
  const watch: SetupService[] = [
    { id: 'google', name: KEY_NAME.google, gives: ['Gemini watches your takes and cuts, with motion and sound: the Co-Director’s watch, and Score compose'], via: { key: 'google' } }
  ]

  return [
    { id: 'codir', title: 'co-director', about: 'The AI that works in the project with you. One of these runs it.', services: codir },
    { id: 'video', title: 'video', about: 'What makes the takes in Clip Gen and Video Edit.', inline: true, services: video },
    { id: 'image', title: 'image', about: 'What makes and edits pictures in Image Edit and Image Gen.', inline: true, services: image },
    { id: 'audio', title: 'voice and music', about: 'What makes music in Score, sound effects in SFX Gen and speech in Voice.', services: audio },
    { id: 'watch', title: 'watching', about: 'Without it, the Co-Director’s own engine reads still frames: no motion, no sound.', services: watch }
  ]
}
