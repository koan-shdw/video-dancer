// The one lucide wrapper — vertical alignment + stroke the KOAN way (bible ch. 03).
import type { LucideIcon } from 'lucide-react'

export function Ic({ i: I, size = 13, style }: { i: LucideIcon; size?: number; style?: React.CSSProperties }): React.JSX.Element {
  return <I size={size} strokeWidth={1.75} style={{ verticalAlign: '-2px', flex: '0 0 auto', ...style }} />
}
