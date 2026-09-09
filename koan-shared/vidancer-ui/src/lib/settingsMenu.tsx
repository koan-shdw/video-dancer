import type { MenuEntry } from '@koan/shared'

// ONE menu for "settings read from an image" (law 11): Image Gen's `drop png here to read` box and the
// Watched panel's civit tiles build the same rows — send to prompt · the loras used (use / search civit)
// · the shown-never-applied line. CIVIT-LIKES-SPEC-2026-09-09 moved it here from ImageGen.tsx.

export interface SettingsMenuActions {
  sendToPrompt: (prompt: string) => void
  useLora: (rel: string) => void
  searchCivit: (name: string) => void
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

export function buildSettingsMenu(s: PngSettings, folderRows: FolderLoraRow[], a: SettingsMenuActions, head: MenuEntry[] = []): MenuEntry[] {
  const entries: MenuEntry[] = [...head]
  if (head.length) entries.push({ sep: true, label: '' })
  const what = s.source === 'civit' ? 'this image' : 'that PNG'
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
    for (const l of s.loras) {
      const base = baseOf(l.name)
      const inFolder = loraFolderMatch(l, folderRows)
      entries.push({
        label: (
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
              {base} × {l.weight}
            </span>
            <span style={{ fontSize: 10, color: inFolder ? 'var(--ok)' : 'var(--amber)' }}>{inFolder ? 'use' : 'search civit'}</span>
          </span>
        ),
        onClick: () => (inFolder ? a.useLora(inFolder.rel) : a.searchCivit(base))
      })
    }
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
  entries.push({ label: <>close</> })
  return entries
}
