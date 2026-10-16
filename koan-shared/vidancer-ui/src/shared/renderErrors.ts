import { MODELS } from './models'
import { IMAGE_MODELS } from './imageModels'

// list 47: a failed render says what went wrong in ONE plain line. Every supplier error the app
// makes has one shape — `error (STATUS) @ SUPPLIER/WHERE: DETAIL — our hint :: sent fields: …` —
// and DETAIL is often the supplier's raw JSON. plainError reads that shape and says it the way a
// person would, with the fix where there is one. The raw line is never lost: it stays on the
// row's tooltip, in the log, and in the project's failure list.

const SUPPLIERS: Record<string, string> = { modelark: 'ModelArk', venice: 'Venice', astria: 'Astria', higgsfield: 'Higgsfield', google: 'Google', 'bridge-mcp': 'the Bridge' }

// the supplier's own sentence, out of whatever it answered with (JSON, cut-off JSON, or words)
function said(detail: string): { code: string; message: string } {
  const d = detail.trim()
  if (d.startsWith('{') || d.startsWith('[')) {
    try {
      const parsed = JSON.parse(d) as unknown
      // fal's validation errors are a bare list: [{ loc, msg, type }]
      const j = (Array.isArray(parsed) ? { detail: parsed } : parsed) as Record<string, any>
      const e = j.error
      const items = (Array.isArray(j.detail) ? j.detail : []) as { msg?: string; type?: string }[]
      const det = items.length ? items.map((x) => x?.msg).filter(Boolean).join('; ') : j.detail
      const message = (typeof e === 'string' ? e : e?.message) ?? j.message ?? (typeof det === 'string' ? det : '')
      // the kind of error: their code, or (fal's list) each item's type — "content_policy_violation" lives there
      return { code: String((typeof e === 'object' && e?.code) || j.code || items.map((x) => x?.type).filter(Boolean).join(' ')), message: String(message || '') }
    } catch {
      // a reply cut off mid-JSON (the app keeps 300 characters): pull the two fields out by hand
      return { code: d.match(/"code"\s*:\s*"([^"]+)/)?.[1] ?? '', message: d.match(/"(?:message|detail|msg)"\s*:\s*"((?:[^"\\]|\\.)*)/)?.[1]?.replace(/\\"/g, '"') ?? '' }
    }
  }
  return { code: '', message: d }
}

// a supplier's model id → the name the app shows for it ("dreamina-seedance-2-5-260628" → Seedance 2.5)
function modelName(id: string): string {
  if (!id) return 'This model'
  const video = Object.values(MODELS).find((m) => JSON.stringify(m.endpoints ?? {}).includes(`"${id}"`))
  if (video) return video.label.replace(/\s*\(.*\)$/, '')
  const image = IMAGE_MODELS.find((m) => JSON.stringify(m.vias ?? []).includes(`"${id}"`))
  return image ? image.label : 'This model'
}

const firstSentence = (s: string, n = 150): string => {
  const one = s.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0]
  return one.length > n ? one.slice(0, n).trimEnd() + '…' : one
}
const stop = (s: string): string => (/[.!?…]$/.test(s) ? s : s + '.')

// a job the supplier TOOK before it failed here (a poll gave up, a download failed, the project
// changed): it may still finish and bill, so it is never sent again and the row never says "run it
// again" (audit 2026-10-09 H4). `recovers` = a recovery entry holds it (renders, scores, voices, enhances).
export function acceptedError(raw: string, recovers: boolean): string {
  const why = plainError(raw).replace(/,? then run it again\.$/i, '.').replace(/\s*Run it again[^.]*\.$/i, '')
  return `${why} The supplier has this job (or may have), so it is not sent again: ${recovers ? 'the app keeps checking and adds it when it finishes.' : 'it may still finish and be charged. Check the supplier before you run it again.'}`
}

export function plainError(raw: string): string {
  const text = (raw ?? '').trim()
  const m = text.match(/error \(([^)]+)\) @ ([^\s:]+)(?::\s*([\s\S]*))?/)
  if (!m) return stop(firstSentence(text || 'unknown error', 200)) // not a supplier error: already words
  const status = m[1]
  const who = SUPPLIERS[m[2].split('/')[0]] ?? 'fal' // a fal error names its endpoint (bytedance/…, google/…), never "fal"
  // our own hint and the list of sent field names are not the supplier's words
  const detail = (m[3] ?? '').replace(/\s*:: sent fields:[\s\S]*$/, '').replace(/\s+—\s+(usually|check|out of|a file is|Venice’s)[\s\S]*$/, '')
  const { code, message } = said(detail)
  const words = firstSentence(message)
  const n = Number(status)

  // a model that is not switched on for the account (ModelArk's ModelNotOpen): the fix is one click on their side
  const notOpen = /ModelNotOpen/i.test(code) || /has not activated the model/i.test(message)
  if (notOpen) return `${modelName(message.match(/model\s+([\w.-]+\d)/i)?.[1] ?? '')} isn't switched on for this ${who} account. Activate it in ${who === 'ModelArk' ? 'the Ark Console' : 'their console'}.`
  if (/content.?polic|moderat|sensitive|safety|nsfw|violat|flagged|not allowed|real (human|person)/i.test(`${code} ${message}`)) return `${who} refused the content${words ? `: ${stop(words)}` : '.'}`
  if (n === 402 || /insufficient|balance|out of credit|quota|not enough credit/i.test(`${code} ${message}`)) return `Out of credit on ${who}. Top up, then run it again.`
  if (n === 401) return `${who} refused the key. Check it in Settings.`
  if (n === 403) return who === 'fal' ? 'fal refused it: the key or the credit. Check Settings and your fal balance.' : `${who} refused the key, or this model isn't switched on for the account.`
  if (n === 413) return `A file is too big for ${who}. Trim the window or use a smaller ref.`
  if (n === 422 && who === 'Venice') return 'Venice refused the media: its public Seedance API takes no people in refs.'
  if (n === 429) return `${who} is busy right now. Run it again in a moment.`
  if (n >= 500) return `${who} had a problem on its side (${status}). Run it again.`
  if (status === 'network' || /fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT/i.test(detail)) return `Couldn't reach ${who}. Check the connection and run it again.`
  return words ? `${who} refused it: ${stop(words)}` : `${who} refused it (${status}).`
}
