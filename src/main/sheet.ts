// SHEET GEN (docs/SHEET-GEN-SPEC-2026-09-08.md) — the pure halves: the contract that seeds a
// sheet clip's fields, and the harvest that turns a capture take into pulled views + a
// reference sheet. Port of the screen_test.py (ffmpeg only, no Python): find the REAL
// cuts by scene score (the model never lands them on the 3s grid), pull the middle frame of
// each segment, stack four of them with a 12px black cross gutter. project.ts owns the
// registration (clip creation, Library entries); nothing here touches `current`.
import { spawn } from 'child_process'
import { stat } from 'fs/promises'
import { join } from 'path'
import { FFMPEG } from './export'
import type { PromptData, SheetMode, ProjImage } from '@koan/vidancer-ui/shared/types'

// ---- the contract → fields (his Screen Test skill, condensed; the user edits any of it in Clip Gen) ----
export function sheetSeed(mode: SheetMode, source: ProjImage, base: PromptData): PromptData {
  const tag = source.title
  const who = tag.replace(/^@/, '') || 'the character'
  const common = {
    ...base,
    mode: 'ref2v' as const,
    engine: 'seedance25' as const, // highest-quality default; the card's MODEL dropdown swaps it
    imageIds: [source.id],
    duration: '15',
    resolution: '720p',
    generateAudio: true
  }
  if (mode === 'scene') {
    return {
      ...common,
      aspectRatio: '16:9',
      freeform: '',
      scene: {
        title: `${who} — scene plates`,
        referenceHandling: `${tag} is the environment anchor — its architecture, materials, light, palette and rendering are kept exactly. DO NOT show any person or creature from ${tag}: the space is empty. Change only the viewpoint per shot. All staging is decided by the storyboard.`,
        style: `Exactly the rendering of ${tag} — same line, same highlight behavior, same palette, same grain. The environment alone, empty of people.`,
        visualFeel: 'Calm, still, fully displayed — a location survey. Even readable light. Hard cuts between shots, no dissolves, no camera movement inside a shot.'
      },
      characters: [],
      beats: [
        { id: 'sb1', name: 'wide', length: 3, camera: 'Locked wide establishing, eye level. Static.', action: 'The empty space, whole room or exterior in frame with margin. Nothing moves but air.', lighting: 'The scene\'s own light, even and readable.' },
        { id: 'sb2', name: 'reverse', length: 3, camera: 'Locked wide from the opposite side. Static.', action: 'The same space from its far end — the reverse angle of shot one. Empty.', lighting: 'Same light, seen from behind.' },
        { id: 'sb3', name: 'low', length: 3, camera: 'Locked low angle, ground level, looking across. Static.', action: 'Floor, surfaces and materials read close; the space recedes. Empty.', lighting: 'Key rakes across the surfaces for texture.' },
        { id: 'sb4', name: 'high', length: 3, camera: 'Locked high angle, near top-down. Static.', action: 'The layout of the space read from above. Empty.', lighting: 'Even, no direction.' },
        { id: 'sb5', name: 'threshold', length: 3, camera: 'Locked medium on a doorway, window or edge of the space. Static.', action: 'One threshold of the space, clean end frame. Empty.', lighting: 'Light from beyond the threshold, soft.' }
      ],
      production: {
        audioDesign: 'No music. Minimal room tone only — this is a survey, keep it quiet.',
        lighting: 'The scene\'s own lighting, held identical across all five shots.',
        subtext: '',
        criticalConstraint: `The exact render of ${tag} is preserved. NO people, NO creatures, NO figures in any shot. Five locked static views joined by hard cuts. Identical space across cuts.`,
        avoid: 'people, characters, figures, silhouettes, camera movement, dissolves, motion blur, set dressing that is not in the reference, jitter, flicker, photoreal or CGI look if the reference is drawn, text, subtitles, music',
        animationStyle: 'Calm, near-still, held on twos, no interpolation smoothing.'
      }
    }
  }
  if (mode === 'expression') {
    return {
      ...common,
      aspectRatio: '3:4',
      freeform: '',
      scene: {
        title: `${who} — expressions`,
        referenceHandling: `${tag} is a pulled frame of ${who} already in this model's own texture — match its rendering EXACTLY: line, highlight behavior, palette, grain. Face lifted to camera. Only the expression changes between shots; nothing else. All staging is decided by the storyboard.`,
        style: `Exactly the rendering of ${tag}. Tight frontal head-and-shoulders on a neutral seamless grey studio background.`,
        visualFeel: 'Identical framing and identical even key on every cut. Held expressions pushed to their extreme. Hard cuts, no dissolves, no camera movement.'
      },
      characters: [
        {
          name: who,
          referenceLabel: tag,
          base: `${who}, exactly as ${tag}.`,
          features: `Every identity mark on the face (name them here — a scar, a mark, an ornament) must appear in every shot, same position, shape and size; never fades, moves, shrinks or disappears.`,
          physics: 'Micro-motion inside each hold only — breath, brow twitch, hair drift, a tear. No head turns.',
          emotionalState: 'Five emotions, each held and pushed to its extreme. Each shot names what it IS and what it is NOT.'
        }
      ],
      beats: [
        { id: 'sb1', name: 'joy', length: 3, camera: 'Locked tight frontal head-and-shoulders. Static.', action: 'Pure warm joy — NOT smugness, NOT a sneer. Held.', lighting: 'Even frontal key, soft fill.', sfx: 'one soft exhale under room tone' },
        { id: 'sb2', name: 'anger', length: 3, camera: 'Locked, identical framing. Static.', action: 'Anger at its peak — NOT confusion, NOT sadness. Held.', lighting: 'Identical key.', sfx: 'one low growl' },
        { id: 'sb3', name: 'grief', length: 3, camera: 'Locked, identical framing. Static.', action: 'Grief — NOT sleepiness, NOT boredom. A tear allowed. Held.', lighting: 'Identical key.', sfx: 'one shaky breath' },
        { id: 'sb4', name: 'laughter', length: 3, camera: 'Locked, identical framing. Static.', action: 'Open laughter — NOT a polite smile. Held.', lighting: 'Identical key.', sfx: 'one short laugh' },
        { id: 'sb5', name: 'peak', length: 3, camera: 'Locked, identical framing. Static.', action: `${who}'s peak state (name it here: berserk rage, cold command, terror) — NOT the generic read. Clean end frame.`, lighting: 'Identical key.', sfx: 'one matching vocalization' }
      ],
      production: {
        audioDesign: 'No music. Room tone and one matching vocalization per hold.',
        lighting: 'One even frontal key, soft fill — identical on every cut.',
        subtext: '',
        criticalConstraint: `Exact render of ${tag} preserved. Identical framing on all five cuts. Identity marks present in every shot. Only the expression changes.`,
        avoid: 'head turns, camera movement, dissolves, framing changes, identity drift between cuts, missing or moving identity marks, extra limbs, warped faces, jitter, flicker, text, subtitles, music',
        animationStyle: 'Held expressions, micro-motion only, held on twos, no interpolation smoothing.'
      }
    }
  }
  // character — the five-view turnaround
  return {
    ...common,
    aspectRatio: '3:4',
    freeform: '',
    scene: {
      title: `${who} — turnaround`,
      referenceHandling: `${tag} is the identity AND style anchor — keep the design and its exact rendering: line, highlight behavior, palette, grain. Change ONLY three things: the pose (calm standing model-sheet views instead of ${tag}'s pose), the background (strip ${tag}'s environment — neutral seamless grey studio), and the framing per view. All staging is decided by the storyboard.`,
      style: `Exactly the rendering of ${tag}. A flat character on a neutral seamless grey studio background, full body.`,
      visualFeel: 'Calm, still, fully displayed — a model sheet. Even readable light. Hard cuts between views, no dissolves, no camera movement inside a view.'
    },
    characters: [
      {
        name: who,
        referenceLabel: tag,
        base: `${who}, exactly as ${tag}.`,
        features: `Every distinguishing feature and signature prop of ${tag}, identical across all five shots. (If a prop is outsized: state its size against the body, and: if it reads as human-scale, the shot is wrong. If skin or costume is strongly coloured: render that colour as-is on grey — do not lighten, grey out or desaturate. If ${tag} crops the body: design the missing part in proportion, standing.)`,
        physics: 'Calm standing, near-still, micro-motion only — breathing, cloth drift. No combat.',
        movement: 'Character and gear identical across all five shots; only the viewpoint changes.'
      }
    ],
    beats: [
      { id: 'sb1', name: 'front', length: 3, camera: 'Locked full-body FRONT, eye level. Static.', action: `${who} stands calm, whole figure and prop in frame with margin. Breath only.`, lighting: 'Even frontal key, soft fill, faint cool rim on grey.' },
      { id: 'sb2', name: 'side', length: 3, camera: 'Locked full-body SIDE, clean 90-degree profile. Static.', action: `${who} in the same stance, seen exactly from the side. Breath only.`, lighting: 'Key rakes across for highlight behavior.' },
      { id: 'sb3', name: 'back', length: 3, camera: 'Locked full-body BACK. Static.', action: `${who} from behind, same stance. Breath only.`, lighting: 'Even key, faint cool rim.' },
      { id: 'sb4', name: 'face', length: 3, camera: 'Locked tight FACE close-up, head and shoulders. Static.', action: `${who}'s face lifted to camera, composed. Breath only.`, lighting: 'Even frontal key, soft fill.' },
      { id: 'sb5', name: 'detail', length: 3, camera: 'Locked DETAIL close-up. Static.', action: `The one element of ${who} that must never drift (name it here — hands, crest, headdress, weapon). Clean end frame.`, lighting: 'Even key, texture readable.' }
    ],
    production: {
      audioDesign: 'No music. Minimal room tone and one soft breath — this is a test, keep it quiet.',
      lighting: 'Even frontal key, soft fill, faint cool rim on neutral grey — held across all five views.',
      subtext: '',
      criticalConstraint: `The exact render of ${tag} is preserved. Neutral seamless grey studio. Five locked static views joined by hard cuts. Identical character and gear across every cut.`,
      avoid: `camera movement, dissolves, ${tag}'s environment, dramatic hero angles, combat, motion blur, photoreal, CGI, 3D, smooth interpolation, jitter, warped limbs, flicker, identity drift between cuts, extra limbs, set dressing, text, subtitles, music`,
      animationStyle: 'Calm, near-still, held on twos, no interpolation smoothing.'
    }
  }
}

// ---- the harvest ----
export interface SheetLayout {
  w: number
  h: number
  qw: number
  qh: number
}
const GUTTER = 12
// 3:4 canvas (character / expression) — his measured spec; 16:9 canvas for scene plates
export function sheetLayout(mode: SheetMode): SheetLayout {
  const [w, h] = mode === 'scene' ? [1920, 1080] : [1080, 1440]
  return { w, h, qw: (w - GUTTER) / 2, qh: (h - GUTTER) / 2 }
}

function ff(args: string[]): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const ps = spawn(FFMPEG, ['-hide_banner', ...args])
    let out = ''
    let err = ''
    ps.stdout?.on('data', (d: Buffer) => (out += d.toString()))
    ps.stderr?.on('data', (d: Buffer) => (err += d.toString()))
    ps.on('close', (code) => resolve({ code: code ?? 1, out, err }))
    ps.on('error', (e) => resolve({ code: 1, out, err: String(e) }))
  })
}

// fps + duration from ffmpeg's own banner (no ffprobe in the bundle)
export async function probeVideo(file: string): Promise<{ fps: number; duration: number; frames: number }> {
  const r = await ff(['-i', file])
  const dm = r.err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  const duration = dm ? Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]) : 0
  const fm = r.err.match(/(\d+(?:\.\d+)?)\s*fps/)
  const fps = fm ? Number(fm[1]) : 24
  return { fps, duration, frames: Math.round(duration * fps) }
}

// the (segments-1) hard cuts: rank per-frame scene scores, take the biggest jumps with a minimum
// spacing, ignore the clip edges. Absolute thresholds fail on grey-on-grey turnarounds.
export async function detectCuts(file: string, segments: number, fps: number, totalFrames: number, minSepS = 1.0, edgeS = 0.5): Promise<number[]> {
  const r = await ff(['-v', 'error', '-i', file, '-vf', "select='gte(scene,0)',metadata=print:file=-", '-f', 'null', '-'])
  const scores: [number, number][] = []
  let n: number | null = null
  for (const line of r.out.split('\n')) {
    const fm = line.match(/frame:(\d+)/)
    if (fm) n = Number(fm[1])
    const sm = line.match(/lavfi\.scene_score=([0-9.]+)/)
    if (sm && n != null) scores.push([Number(sm[1]), n])
  }
  const edge = Math.round(edgeS * fps)
  const minSep = Math.round(minSepS * fps)
  const ranked = scores.filter(([, i]) => i >= edge && i <= totalFrames - edge).sort((a, b) => b[0] - a[0])
  const picked: number[] = []
  for (const [, i] of ranked) {
    if (picked.every((p) => Math.abs(i - p) >= minSep)) picked.push(i)
    if (picked.length === segments - 1) break
  }
  return picked.sort((a, b) => a - b)
}

export function segmentBounds(cuts: number[], segments: number, fps: number, totalFrames: number, segLen = 3): [number, number][] {
  if (cuts.length !== segments - 1) {
    const seg = Math.round(segLen * fps) // fewer cuts than expected → the fixed grid
    return Array.from({ length: segments }, (_, i) => [i * seg, Math.min((i + 1) * seg, totalFrames) - 1] as [number, number])
  }
  const edges = [0, ...cuts, totalFrames]
  return edges.slice(0, -1).map((s, i) => [s, edges[i + 1] - 1] as [number, number])
}

// one frame per segment: the middle, clear of both cuts
export function middleFrames(bounds: [number, number][], fps: number, guardS = 0.35): number[] {
  const g = Math.round(guardS * fps)
  return bounds.map(([s, e]) => {
    let lo = s + g
    let hi = e - g
    if (hi < lo) [lo, hi] = [s, e]
    return Math.floor((lo + hi) / 2)
  })
}

export async function pullFrame(file: string, frameIdx: number, outPng: string): Promise<boolean> {
  const r = await ff(['-y', '-v', 'error', '-i', file, '-vf', `select=eq(n\\,${frameIdx})`, '-vsync', 'vfr', '-frames:v', '1', outPng])
  if (r.code !== 0) return false
  try {
    return (await stat(outPng)).size > 100
  } catch {
    return false
  }
}

// four stills → the sheet: cover-fit into quadrants, black cross gutter, no outer border
export async function stackSheet(stills: string[], layout: SheetLayout, outPng: string): Promise<boolean> {
  if (stills.length !== 4) return false
  const fit = `scale=${layout.qw}:${layout.qh}:force_original_aspect_ratio=increase,crop=${layout.qw}:${layout.qh},setsar=1,format=rgb24`
  const fc =
    `[0:v]${fit}[a];[1:v]${fit}[b];[2:v]${fit}[c];[3:v]${fit}[d];` +
    `color=c=black:s=${GUTTER}x${layout.qh}:d=1,format=rgb24[vg1];color=c=black:s=${GUTTER}x${layout.qh}:d=1,format=rgb24[vg2];` +
    `color=c=black:s=${layout.w}x${GUTTER}:d=1,format=rgb24[hg];` +
    `[a][vg1][b]hstack=inputs=3[top];[c][vg2][d]hstack=inputs=3[bot];[top][hg][bot]vstack=inputs=3[out]`
  const args = ['-y', '-v', 'error']
  for (const p of stills) args.push('-i', p)
  args.push('-filter_complex', fc, '-map', '[out]', '-frames:v', '1', outPng)
  const r = await ff(args)
  if (r.code !== 0) return false
  try {
    return (await stat(outPng)).size > 100
  } catch {
    return false
  }
}

// the whole harvest for one take → { views: five pngs (in view order), sheet: png } inside outDir.
// pick = which 1-based views fill TL,TR,BL,BR (default front · back · face · detail = 1,3,4,5).
export async function harvestTake(takeFile: string, mode: SheetMode, outDir: string, stem: string, pick: number[] = [1, 3, 4, 5]): Promise<{ views: string[]; sheet: string; frames: number[] } | { error: string }> {
  const segments = 5
  const info = await probeVideo(takeFile)
  if (!info.duration) return { error: 'could not read the take (ffmpeg saw no duration)' }
  const cuts = await detectCuts(takeFile, segments, info.fps, info.frames)
  const bounds = segmentBounds(cuts, segments, info.fps, info.frames)
  const frames = middleFrames(bounds, info.fps)
  const views: string[] = []
  for (let i = 0; i < frames.length; i++) {
    const f = Math.min(frames[i], Math.max(info.frames - 1, 0))
    const png = join(outDir, `${stem}_view${i + 1}.png`)
    if (!(await pullFrame(takeFile, f, png))) return { error: `frame pull failed on view ${i + 1}` }
    views.push(png)
  }
  const chosen = pick.map((n) => views[n - 1]).filter(Boolean)
  const sheet = join(outDir, `${stem}_sheet.png`)
  if (!(await stackSheet(chosen, sheetLayout(mode), sheet))) return { error: 'sheet stack failed (four stills → grid)' }
  return { views, sheet, frames }
}
