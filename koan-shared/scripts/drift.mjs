#!/usr/bin/env node
// drift.mjs — the twin-file drift checker (koan-shared SPEC, phase 0).
// Diffs each named pair with the per-app nouns normalized; exit 1 on any drift.
// Run: node vi-dancer/koan-shared/scripts/drift.mjs   (from I:\DEV)
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const VI = (p) => resolve(ROOT, 'vi-dancer', p)
const SD = (p) => resolve(ROOT, 'sprite-dancer', 'app', p)

// noun map: left (vi-dancer) form → canonical; right (sprite) form → canonical
const normalize = (s) =>
  s
    .replace(/window\.vidancer/g, 'window.__APP__')
    .replace(/window\.spritedancer/g, 'window.__APP__')
    .replace(/vd-hbtn/g, '__hbtn__')
    .replace(/sd-hbtn/g, '__hbtn__')
    .replace(/vd-chip/g, '__chip__')
    .replace(/sd-chip/g, '__chip__')
    .replace(/\bvidancer\b/g, '__app__')
    .replace(/\bspritedancer\b/g, '__app__')
    .replace(/from '\.\.\/prompt'/g, "from '__confirm__'")
    .replace(/from '\.\.\/ui\/confirm'/g, "from '__confirm__'")
    .replace(/\r\n/g, '\n')

// pairs meant to be twins TODAY. Files that differ per app ON PURPOSE are not listed.
// (Phase 1+2 moved Section/ContextMenu/tokens/loraShelf/LoraShelf/LoraPicker into
// @koan/shared — nothing to drift there anymore. These are the NEXT cargo candidates;
// DRIFT here = reconcile before any move, per SPEC phase-0 law.)
const PAIRS = [
  ['src/renderer/src/ui/controls.tsx', 'src/renderer/src/ui/controls.tsx'],
  ['src/renderer/src/ui/EmptyState.tsx', 'src/renderer/src/ui/EmptyState.tsx'],
  ['src/renderer/src/ui/Modal.tsx', 'src/renderer/src/ui/Modal.tsx'],
  ['src/renderer/src/ui/icons.tsx', 'src/renderer/src/ui/icons.tsx']
]

let drift = 0
for (const [l, r] of PAIRS) {
  const lp = VI(l)
  const rp = SD(r)
  if (!existsSync(lp) || !existsSync(rp)) {
    console.log(`MISSING  ${l}  (vi:${existsSync(lp)} sd:${existsSync(rp)})`)
    drift++
    continue
  }
  const a = normalize(readFileSync(lp, 'utf8')).split('\n')
  const b = normalize(readFileSync(rp, 'utf8')).split('\n')
  const diffs = []
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    if ((a[i] ?? '') !== (b[i] ?? '')) diffs.push(i + 1)
  }
  if (diffs.length === 0) console.log(`OK       ${l}`)
  else {
    drift++
    console.log(`DRIFT    ${l} — ${diffs.length} differing line(s), first at ${diffs[0]}`)
    for (const i of diffs.slice(0, 6)) {
      console.log(`  vi:${String(i).padStart(4)}  ${(a[i - 1] ?? '∅').slice(0, 110)}`)
      console.log(`  sd:${String(i).padStart(4)}  ${(b[i - 1] ?? '∅').slice(0, 110)}`)
    }
  }
}
console.log(drift ? `\n${drift} pair(s) drifted` : '\nall twins aligned')
process.exit(drift ? 1 : 0)
