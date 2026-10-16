import { useEffect, useRef, type RefObject } from 'react'

const dialogs: HTMLElement[] = []
export const hasOpenDialog = (): boolean => dialogs.length > 0
const top = (): HTMLElement | undefined => dialogs[dialogs.length - 1]
const focusable = (el: HTMLElement): HTMLElement[] => Array.from(el.querySelectorAll<HTMLElement>(
  'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
)).filter((x) => !x.hidden && x.getClientRects().length > 0)

export function useDialogFocus(ref: RefObject<HTMLElement>, onEscape: () => void): void {
  const escape = useRef(onEscape)
  escape.current = onEscape
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const previous = document.activeElement as HTMLElement | null
    dialogs.push(el)
    const first = (): HTMLElement => focusable(el)[0] ?? el
    if (!el.contains(document.activeElement)) first().focus()
    const focus = (e: FocusEvent): void => {
      if (top() === el && !el.contains(e.target as Node)) first().focus()
    }
    const key = (e: KeyboardEvent): void => {
      if (top() !== el) return
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopImmediatePropagation(); escape.current(); return
      }
      if (e.key !== 'Tab') return
      const items = focusable(el)
      const i = items.indexOf(document.activeElement as HTMLElement)
      if (!items.length || (e.shiftKey ? i <= 0 : i < 0 || i === items.length - 1)) {
        e.preventDefault()
        ;(e.shiftKey ? items[items.length - 1] ?? el : items[0] ?? el).focus()
      }
    }
    window.addEventListener('keydown', key, true)
    document.addEventListener('focusin', focus)
    return () => {
      window.removeEventListener('keydown', key, true)
      document.removeEventListener('focusin', focus)
      const wasTop = top() === el
      const index = dialogs.indexOf(el)
      if (index >= 0) dialogs.splice(index, 1)
      if (wasTop && previous?.isConnected) previous.focus()
    }
  }, [ref])
}
