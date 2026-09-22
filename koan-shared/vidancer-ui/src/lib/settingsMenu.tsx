import type { MenuEntry } from '@koan/shared'
import { baseSupported } from './civitActions'

// ONE menu for "settings read from an image" (law 11): Image Gen's `drop png or a civit like` box and
// the Watched panel's civit tiles build the same rows. CIVIT-LIKES-SPEC-2026-09-09 moved it here from
// ImageGen.tsx; CIVIT-DRAG-SPEC-2026-09-19 gave it: → send both · get + use · the greyed wrong-base
// row · the caller's tail (import / open on civitai) · and, LAST, his words: "get Co-Director to
// make this as a prompt".

export type MenuLora = PngSettings['loras'][number]

export interface SettingsMenuActions {
  sendToPrompt: (prompt: string) => void
  useLora: (rel: string, weight?: number) => void
  searchCivit: (name: string) => void // the PNG lane's only handle on a lora it does not have (no version id)
  getLora?: (l: MenuLora) => void // the civit lane: download it, then into a slot
  tail?: MenuEntry[] // import · open on civitai — under the settings
  toCoDirector?: () => void // always the last row before close
}

const baseOf = (name: string): string => name.split(/[\\/]/).pop()?.replace(/\.safetensors$/i, '') ?? name

// a lora the image used → a file in his folders: by Civitai version id first (the civit lane
// knows it), then by name (the PNG lane's only handle)
export function loraFolderMatch(l: { name: string; versionId?: number }, folderRows: FolderLoraRow[]): FolderLoraRow | undefined {
  if (l.versionId) {
    const byId = folderRows.find((x) => x.civitKey === `civitai:${l.versionId}` || !!x.civitKey?.endsWith(`:${l.versionId}`))
    if (byId) return byId
  }
  const base = baseOf(l.name).toLowerCase()
  return folderRows.find((x) => x.file.toLowerCase() === `${base}.safetensors` || x.name.toLowerCase() === base)
}

// what one lora row can do. His folder outranks the tag: a file he already has is always `use`.
// Not there: a lora made for another base is SKIPPED (his call 2026-09-19) — never loaded, never
// downloaded; one Civitai can name by version id is `get`; the PNG lane can only `search`.
type LoraState = { kind: 'use'; rel: string } | { kind: 'get' } | { kind: 'search' } | { kind: 'wrongBase'; base: string }
export function loraState(l: MenuLora, folderRows: FolderLoraRow[], canGet: boolean): LoraState {
  const inFolder = loraFolderMatch(l, folderRows)
  if (inFolder) return { kind: 'use', rel: inFolder.rel }
  if (!baseSupported(l.baseModel)) return { kind: 'wrongBase', base: l.baseModel! }
  return l.versionId && canGet ? { kind: 'get' } : { kind: 'search' }
}

export function buildSettingsMenu(s: PngSettings, folderRows: FolderLoraRow[], a: SettingsMenuActions, head: MenuEntry[] = []): MenuEntry[] {
  const entries: MenuEntry[] = [...head]
  if (head.length) entries.push({ sep: true, label: '' })
  const what = s.source === 'civit' ? 'this image' : 'that PNG'
  const states = s.loras.map((l) => loraState(l, folderRows, !!a.getLora))
  // the loras `send both` takes: usable ones, in the image's own order, the first two (two slots)
  const usable = s.loras.map((l, i) => ({ l, st: states[i] })).filter((x) => x.st.kind === 'use' || x.st.kind === 'get')
  if (s.prompt.trim() && usable.length) {
    const n = Math.min(2, usable.length)
    entries.push({
      label: (
        <>
          → send both{' '}
          <span style={{ color: 'var(--dim)', fontSize: 10 }}>
            — the prompt + {n === 1 ? 'its lora' : `the first ${n} loras`}
            {usable.length > 2 ? ` (${usable.length - 2} more stay listed here)` : ''}
          </span>
        </>
      ),
      onClick: () => {
        a.sendToPrompt(s.prompt)
        for (const { l, st } of usable.slice(0, 2)) {
          if (st.kind === 'use') a.useLora(st.rel, l.weight)
          else a.getLora?.(l)
        }
      }
    })
  }
  if (s.prompt.trim()) {
    entries.push({
      label: (
        <>
          → send to prompt{' '}
          <span style={{ color: 'var(--dim)', fontSize: 10 }}>
            — {s.prompt.slice(0, 48)}
            {s.prompt.length > 48 ? '…' : ''}
          </span>
        </>
      ),
      onClick: () => a.sendToPrompt(s.prompt)
    })
  } else entries.push({ label: <>{s.source === 'civit' ? 'no prompt shared for this image' : `no prompt found in ${what}${s.source === 'none' ? ' — no ComfyUI or A1111 metadata' : ''}`}</>, disabled: true })
  if (s.loras.length) {
    entries.push({ sep: true, label: '' })
    s.loras.forEach((l, i) => {
      const base = baseOf(l.name)
      const st = states[i]
      const word = st.kind === 'use' ? 'use' : st.kind === 'get' ? 'get + use' : st.kind === 'search' ? 'search civit' : `made for ${st.base} — Krea 2 can't load it`
      entries.push({
        label: (
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', opacity: st.kind === 'wrongBase' ? 0.5 : 1 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
              {base} × {l.weight}
            </span>
            <span style={{ fontSize: 10, color: st.kind === 'use' ? 'var(--ok)' : st.kind === 'wrongBase' ? 'var(--dim)' : 'var(--amber)' }}>{word}</span>
          </span>
        ),
        disabled: st.kind === 'wrongBase',
        title: st.kind === 'get' ? 'not in your folders — downloads it now, then drops it into a slot' : st.kind === 'wrongBase' ? 'skipped: this lora was trained for another model' : undefined,
        onClick: st.kind === 'wrongBase' ? undefined : () => (st.kind === 'use' ? a.useLora(st.rel, l.weight) : st.kind === 'get' ? a.getLora?.(l) : a.searchCivit(base))
      })
    })
  } else entries.push({ label: <span style={{ color: 'var(--dim)' }}>no loras in {what}</span>, disabled: true })
  if (s.model || s.seed != null) {
    entries.push({ sep: true, label: '' })
    entries.push({
      label: (
        <span style={{ color: 'var(--dim)', fontSize: 10 }}>
          {[s.model ? `model ${s.model.split(/[\\/]/).pop()}` : '', s.seed != null ? `seed ${s.seed}` : '', s.width ? `${s.width}×${s.height}` : ''].filter(Boolean).join(' · ')} — shown, not applied
        </span>
      ),
      disabled: true
    })
  }
  if (a.tail?.length || a.toCoDirector) entries.push({ sep: true, label: '' })
  if (a.tail?.length) entries.push(...a.tail)
  if (a.toCoDirector) entries.push({ label: <>get Co-Director to make this as a prompt</>, title: 'imports the image into the Library, puts it in the Co-Director’s box with the ask — you press send', onClick: a.toCoDirector })
  entries.push({ label: <>close</> })
  return entries
}
