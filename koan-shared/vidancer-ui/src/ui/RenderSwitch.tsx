import { useEffect } from 'react'
import { vd } from '../api'
import { useStore } from '../store'
import { Ic, Zap } from './icons'

// list 27 — the Co-Director's render switch. His words (09-30): "yes but needs go command and
// there needs to be a button in the UI for codirector which enables it". Off until he turns it
// on. On = the Co-Director may press render, paid renders too, and only in an exchange where his
// whole message is the single word go. Main checks both before anything fires; this is the button.
const OFF = 'OFF: the Co-Director sets renders up and you press the button. Switch it on and it may press render for you, paid renders too, but only when your whole message is the single word go.'
const ON = 'ON: the Co-Director may press render for you, paid renders too, but only when your whole message is the single word go. Click to switch it off.'

export function RenderSwitch({ style }: { style?: React.CSSProperties }): React.JSX.Element {
  const on = useStore((s) => s.codirFire)
  const setOn = useStore((s) => s.setCodirFire)
  // it persists in settings: mirror it into the store once (the panel and the Room read the store)
  useEffect(() => {
    void vd()
      .getSettings()
      .then((s) => useStore.setState({ codirFire: s?.codirFire === true }))
  }, [])
  return (
    <span className="btn vd-hbtn" role="switch" aria-checked={on} style={{ ...style, ...(on ? { color: 'var(--amber)' } : undefined) }} onClick={() => setOn(!on)} title={on ? ON : OFF}>
      <Ic i={Zap} size={11} /> renders {on ? 'on' : 'off'}
    </span>
  )
}
