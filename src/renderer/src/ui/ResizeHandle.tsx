import { useRef } from 'react'

// drag-to-resize strip under the preview areas (Clip Gen / Video Editor): vertical drag adjusts a
// height value. Clamping happens live at drag time via maxOf — dockview can re-layout the panel
// under us, so the ceiling is read per-move, never cached.
export function ResizeHandle(props: { value: number; min?: number; maxOf?: () => number; onChange: (h: number) => void; title?: string }): React.JSX.Element {
  const start = useRef({ y: 0, h: 0 })
  const onDown = (e: React.MouseEvent): void => {
    e.preventDefault()
    start.current = { y: e.clientY, h: props.value }
    const move = (ev: MouseEvent): void => {
      const max = Math.max(props.min ?? 120, props.maxOf?.() ?? 2000)
      props.onChange(Math.max(props.min ?? 120, Math.min(max, start.current.h + (ev.clientY - start.current.y))))
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  return (
    <div
      onMouseDown={onDown}
      title={props.title ?? 'drag to resize the preview'}
      style={{ height: 9, margin: '1px 0', cursor: 'ns-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}
    >
      <div style={{ width: 44, height: 3, borderRadius: 2, background: 'var(--line2)' }} />
    </div>
  )
}
