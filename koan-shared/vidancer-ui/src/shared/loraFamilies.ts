// LoRA families (MINIMAX-H3-LOCAL-SPEC §4.2): one side panel, the model picks the family. The rule
// lives here because two seats read it: the side panel, and the Co-Director's image gen tools
// (list 27), which offer it the same loras the panel offers him.
export type LoraFamilyKey = 'krea2' | 'ltx' | 'h3'

// what Civitai (or an installer) calls each family's base model
export const LORA_BASE_RE: Record<LoraFamilyKey, RegExp> = { krea2: /krea\s*2/i, ltx: /^LTXV/i, h3: /minimax\s*h3/i }

// A row's family: his right-click tag → his folder (P5 catch 2026-09-09: a file he filed under
// KREA 2 came back tagged ZImageTurbo by Civitai — the folder outranks the tag) → its base model
// → unknown, which shows under every model until he tags it.
export function loraFamilyOf(row: { tag?: LoraFamilyKey; root: string; baseModel?: string }, folders: { path: string; family: LoraFamilyKey }[]): LoraFamilyKey | undefined {
  if (row.tag) return row.tag
  const folder = folders.find((f) => f.path === row.root)
  if (folder) return folder.family
  return (Object.keys(LORA_BASE_RE) as LoraFamilyKey[]).find((k) => !!row.baseModel && LORA_BASE_RE[k].test(row.baseModel))
}
