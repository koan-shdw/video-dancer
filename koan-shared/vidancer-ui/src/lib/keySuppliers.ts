import { vd } from '../api'

// The suppliers whose work runs on an API key: what each key is in Settings, where a key is made,
// and the free call that checks one. One table, three readers: Settings, the Welcome card, and the
// key steps that open when a job needs a key that isn't saved (list 37).
export interface KeySupplier {
  id: 'fal' | 'ark' | 'astria' | 'venice' | 'google' | 'eleven' | 'higgsfield' | 'anthropic' | 'deepseek'
  label: string
  setting: 'falKey' | 'arkKey' | 'astriaKey' | 'veniceKey' | 'googleKey' | 'elevenKey' | 'hfKey' | 'anthropicKey' | 'deepseekKey'
  named: RegExp // how main's "No … key" messages name it — the one grammar every no-key error shares
  url: string // their key page
  where: string // what that page is, and where the key sits on it
  placeholder: string
  test?: (key: string) => Promise<{ ok: boolean; error?: string }> // an authenticated call that spends nothing
}

export const KEY_SUPPLIERS: KeySupplier[] = [
  { id: 'fal', label: 'fal.ai', setting: 'falKey', named: /\bfal key\b/i, url: 'https://fal.ai/dashboard/keys', where: 'opens fal.ai — Dashboard → Keys → Add key', placeholder: 'paste fal key' },
  {
    id: 'ark',
    label: 'BytePlus ModelArk',
    setting: 'arkKey',
    named: /\bModelArk key\b/i,
    url: 'https://console.byteplus.com/ark',
    where: 'opens the BytePlus console — activate Seedance (and Seedream 5.0, for Image Edit) under ModelArk, then create an API key',
    placeholder: 'paste ModelArk key',
    test: (k) => vd().arkValidate(k)
  },
  { id: 'astria', label: 'Astria', setting: 'astriaKey', named: /\bAstria key\b/i, url: 'https://www.astria.ai/users/edit#api', where: 'opens astria.ai — your API key lives under Account → API', placeholder: 'paste Astria key', test: (k) => vd().astriaValidate(k) },
  { id: 'venice', label: 'Venice', setting: 'veniceKey', named: /\bVenice key\b/i, url: 'https://venice.ai/settings/api', where: 'opens venice.ai — API keys live under Settings → API', placeholder: 'paste Venice key', test: (k) => vd().veniceValidate(k) },
  { id: 'google', label: 'Google AI (Gemini)', setting: 'googleKey', named: /\bGoogle( AI)? key\b/i, url: 'https://aistudio.google.com/apikey', where: 'opens Google AI Studio — Get API key', placeholder: 'paste Google AI key', test: (k) => vd().googleValidate(k) },
  { id: 'eleven', label: 'ElevenLabs', setting: 'elevenKey', named: /\bElevenLabs key\b/i, url: 'https://elevenlabs.io/app/settings/api-keys', where: 'opens elevenlabs.io — Profile → API keys', placeholder: 'paste ElevenLabs key', test: (k) => vd().elevenValidate(k) },
  {
    id: 'higgsfield',
    label: 'Higgsfield',
    setting: 'hfKey',
    named: /\bHiggsfield key\b/i,
    url: 'https://cloud.higgsfield.ai/',
    where: 'opens cloud.higgsfield.ai — create a key under API keys (Creator plan includes API access)',
    placeholder: 'paste api-key:api-secret',
    test: (k) => vd().hfValidate(k)
  },
  // "No API key saved for the Co-Director" is the same missing key, said by the sub-call lane
  { id: 'anthropic', label: 'Anthropic', setting: 'anthropicKey', named: /\bAnthropic key\b|\bAPI key saved for the Co-Director\b/i, url: 'https://platform.claude.com/settings/keys', where: 'opens the Claude Console — Settings → API keys → Create key', placeholder: 'paste Anthropic key' },
  // list 35: the Co-Director's DeepSeek engine
  { id: 'deepseek', label: 'DeepSeek', setting: 'deepseekKey', named: /\bDeepSeek key\b/i, url: 'https://platform.deepseek.com/api_keys', where: 'opens the DeepSeek platform — API keys → Create new API key', placeholder: 'paste DeepSeek key', test: (k) => vd().deepseekValidate(k) }
]

export const keySupplier = (id: KeySupplier['id']): KeySupplier => KEY_SUPPLIERS.find((s) => s.id === id)!

// an error that means "this needs a key you haven't saved" → whose key. Every such message from
// main opens with "No <supplier> key" (or carries it after a job's name): one grammar, read here.
export function missingKeyOf(text: string): KeySupplier | null {
  const m = text.match(/\bNo [^—.\n]{0,60}?key\b[^—.\n]{0,40}/i)
  return m ? (KEY_SUPPLIERS.find((s) => s.named.test(m[0])) ?? null) : null
}
