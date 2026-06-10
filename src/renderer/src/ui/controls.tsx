import { color, radius } from './tokens'

// the shared input/select/textarea inline style — previously copy-pasted in five files
export const ctl: React.CSSProperties = {
  background: color.field,
  color: color.body,
  border: '1px solid #33333c',
  borderRadius: radius.sm,
  padding: '5px 7px',
  fontSize: 12
}
