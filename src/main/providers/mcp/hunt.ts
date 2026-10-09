// Defensive payload hunting shared by every Bridge adapter — MCP servers' response shapes are
// undocumented, so field names are hunted by key anywhere in the result (structuredContent
// first, then every text-content JSON). Born in higgsfieldMcp.ts, shared when Runway arrived.
import type { McpToolResult } from '../../bridge/mcpClient'

export function payloadObjects(r: McpToolResult): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  if (r.structuredContent) out.push(r.structuredContent)
  for (const c of r.content ?? []) {
    if (c.type === 'text' && c.text) {
      try {
        out.push(JSON.parse(c.text) as Record<string, unknown>)
      } catch {
        // plain prose content — the string hunters still see it via payloadText
      }
    }
  }
  return out
}

export function payloadText(r: McpToolResult): string {
  return [JSON.stringify(r.structuredContent ?? {}), ...(r.content ?? []).map((c) => c.text ?? '')].join('\n')
}

export function huntString(o: unknown, keys: string[], depth = 0): string | undefined {
  if (depth > 6 || o === null || typeof o !== 'object') return undefined
  const obj = o as Record<string, unknown>
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v) return v
  }
  for (const v of Object.values(obj)) {
    const hit = huntString(v, keys, depth + 1)
    if (hit) return hit
  }
  return undefined
}

export function hunt(r: McpToolResult, keys: string[]): string | undefined {
  for (const o of payloadObjects(r)) {
    const hit = huntString(o, keys)
    if (hit) return hit
  }
  return undefined
}

// A RESULT link is hunted only in what a reply did not repeat back of the request: Higgsfield's job
// carries params.medias with every uploaded input's link, and the first .mp4 there was taken as the
// take (audit 2026-10-09 M15)
const ECHO_KEYS = new Set(['params', 'input', 'inputs', 'request', 'arguments', 'args'])
const isJson = (t: string): boolean => {
  try {
    JSON.parse(t)
    return true
  } catch {
    return false
  }
}
export function resultObjects(r: McpToolResult): Record<string, unknown>[] {
  return payloadObjects(r).map((o) => JSON.parse(JSON.stringify(o, (k, v: unknown) => (ECHO_KEYS.has(k) ? undefined : v))) as Record<string, unknown>)
}
export function resultText(r: McpToolResult): string {
  const prose = (r.content ?? []).filter((c) => c.type === 'text' && c.text && !isJson(c.text)).map((c) => c.text ?? '')
  return [...resultObjects(r).map((o) => JSON.stringify(o)), ...prose].join('\n')
}
export function huntResult(r: McpToolResult, keys: string[]): string | undefined {
  for (const o of resultObjects(r)) {
    const hit = huntString(o, keys)
    if (hit) return hit
  }
  return undefined
}

// error detail → the provider's own words, NEVER raw JSON in a queue row (user order
// 2026-09-01). Digs message strings recursively (Pika nests JSON-in-string three deep:
// statusMessage → HTTPStatusError message → ark error.message); when nothing readable exists
// the row says so and points at main.log, which always carries the full reply.
const FALLBACK = 'the provider reported a failure — full reply in main.log'
export function humanDetail(detail: string): string {
  const dig = (s: string, depth: number): string | null => {
    const m = s.match(/\{[\s\S]*\}/)
    if (!m || depth > 3) return null
    try {
      const o = JSON.parse(m[0].replace(/\\"/g, '"')) as Record<string, unknown>
      const msg = huntString(o, ['statusMessage', 'message', 'detail', 'error_description', 'reason'])
      const code = huntString(o, ['code', 'error_code', 'type'])
      if (msg) {
        const deeper = dig(msg, depth + 1) ?? msg.replace(/\{[\s\S]*\}/, '').trim()
        const text = deeper || msg
        return code && !text.includes(code) ? `${text} (${code})` : text
      }
      return code ?? null
    } catch {
      return null
    }
  }
  if (!detail.includes('{')) return detail.slice(0, 300)
  const dug = dig(detail, 0)
  if (dug) return dug.slice(0, 300)
  const stripped = detail.replace(/\{[\s\S]*\}/, '').trim()
  return (stripped || FALLBACK).slice(0, 300)
}
