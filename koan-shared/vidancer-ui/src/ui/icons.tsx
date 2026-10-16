// The app's icon vocabulary — ONE curated set (lucide), one glyph per action, no collisions.
// Use <Ic i={Play}/> in text-flow spans (buttons/labels): it locks size/stroke and baseline.
// Rule of thumb: chrome actions = lucide; data-ish glyphs (▾ ▸ ✕ chips like C/T, ⊢/⊣) stay text.
import type { LucideIcon } from 'lucide-react'
export {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Repeat,
  Film,
  Scissors,
  Magnet,
  Music,
  Volume2,
  VolumeX,
  Cable,
  Camera,
  Check,
  ChevronUp,
  ChevronDown,
  Clapperboard,
  Crop,
  ImagePlay,
  Maximize2,
  Minimize2,
  Monitor,
  Settings2,
  HelpCircle,
  Info,
  Plus,
  Sparkles,
  Wand2,
  Pencil,
  PenTool,
  Copy,
  Trash2,
  Upload,
  ImageDown,
  FileMusic,
  FolderInput,
  FolderOutput,
  FolderOpen,
  ListVideo,
  Link2,
  Link2Off,
  Palette,
  Star,
  CircleDot,
  RotateCcw,
  Theater,
  Zap,
  ZoomIn,
  ZoomOut,
  Eye
} from 'lucide-react'

export function Ic({ i: I, size = 13, style }: { i: LucideIcon; size?: number; style?: React.CSSProperties }): React.JSX.Element {
  return <I size={size} strokeWidth={1.75} style={{ verticalAlign: '-2px', flex: '0 0 auto', ...style }} />
}

// ---- the KOAN drawn icons (bible ch. 03, decision #4): the library's first entries in this app.
// Same contract as lucide (24-box, currentColor, stroke from Ic) so <Ic i={Person}/> just works.
// person = character plate · scene = scene plate (SHEET-GEN-SPEC-2026-09-08). ----
type DrawnProps = { size?: number | string; strokeWidth?: number | string; style?: React.CSSProperties; className?: string }
const drawn = (paths: React.ReactNode): LucideIcon =>
  (({ size = 24, strokeWidth = 1.75, style, className }: DrawnProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={style} className={className}>
      {paths}
    </svg>
  )) as unknown as LucideIcon
// head sits a touch left, the shoulders one open stroke — drawn, not geometric
export const Person: LucideIcon = drawn(
  <>
    <circle cx="11.6" cy="7.2" r="3.6" />
    <path d="M4.2 20.5c.6-4.6 3.6-7 7.6-7s7 2.4 7.8 7" />
  </>
)
// a folder: the tab one open stroke, the body a soft box — the Library's folder rows (his
// order 2026-09-09: our own line art, not the emoji)
export const FolderIcon: LucideIcon = drawn(
  <>
    <path d="M3.2 8.4V6.3c0-.8.6-1.4 1.4-1.4h4.3l2.1 2.2h8.4c.8 0 1.4.6 1.4 1.4v1.9" />
    <path d="M3.2 8.4h17.6l-.9 9.6c-.1.8-.7 1.4-1.5 1.4H5.4c-.8 0-1.4-.6-1.5-1.4z" />
  </>
)
// a score: one note — a tilted head, a stem, a flag that leans; drawn, not a font glyph
export const ScoreIcon: LucideIcon = drawn(
  <>
    <ellipse cx="8.6" cy="17.2" rx="3.4" ry="2.5" transform="rotate(-18 8.6 17.2)" />
    <path d="M11.7 16.4V4.6" />
    <path d="M11.7 4.6c2.2.9 4.6 2.2 5.2 4.8.3 1.3-.2 2.6-1.1 3.6" />
  </>
)
// a frame, a ridge, a low sun
export const Scene: LucideIcon = drawn(
  <>
    <rect x="3" y="4.5" width="18" height="15" rx="1.5" />
    <path d="M3.4 17.2l5.2-6 3.6 3.9 2.6-2.7 6.3 5.2" />
    <circle cx="16.4" cy="8.6" r="1.4" />
  </>
)
