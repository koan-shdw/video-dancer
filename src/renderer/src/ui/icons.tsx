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
  Camera,
  Clapperboard,
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
  Copy,
  Trash2,
  Upload,
  ImageDown,
  FileMusic,
  FolderInput,
  FolderOpen,
  ListVideo,
  Link2,
  Palette,
  Star,
  CircleDot,
  RotateCcw,
  Zap,
  ZoomIn,
  ZoomOut,
  Eye
} from 'lucide-react'

export function Ic({ i: I, size = 13, style }: { i: LucideIcon; size?: number; style?: React.CSSProperties }): React.JSX.Element {
  return <I size={size} strokeWidth={1.75} style={{ verticalAlign: '-2px', flex: '0 0 auto', ...style }} />
}
