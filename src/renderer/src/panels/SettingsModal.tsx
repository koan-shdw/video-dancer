import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { Modal } from '../ui/Modal'
import { Ic, Settings2 } from '../ui/icons'
import { confirmDialog } from '../prompt'
import { toast } from '../ui/Toast'

const ctl: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg)',
  color: 'var(--txt-hi)',
  border: '1px solid var(--line2)',
  borderRadius: 5,
  padding: '7px 9px',
  fontSize: 12,
  fontFamily: 'var(--mono)'
}

export function SettingsModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const refreshCredit = useStore((s) => s.refreshCredit)
  const hasProject = useStore((s) => !!s.project)
  const [falKey, setFalKey] = useState('')
  const [falAdminKey, setFalAdminKey] = useState('')
  const [astriaKey, setAstriaKey] = useState('')
  const [anthropicKey, setAnthropicKey] = useState('')
  const [status, setStatus] = useState('')
  const [cleaning, setCleaning] = useState(false)

  // sweep media files nothing references (deletes never unlink, so project folders only grow) —
  // dry-run first, then an explicit confirm with the real count/size before anything is removed
  const cleanup = async (): Promise<void> => {
    if (cleaning) return
    setCleaning(true)
    try {
      const scan = await window.vidancer.projectCleanup(false)
      if (!scan) return
      if (scan.busy) {
        toast('a render, image generation or import is running — try again when it finishes', { kind: 'error' })
        return
      }
      if (scan.files === 0) {
        toast('no unused media files found', { kind: 'ok' })
        return
      }
      const mb = (scan.bytes / (1024 * 1024)).toFixed(1)
      const ok = await confirmDialog(
        `Delete ${scan.files} unused media file${scan.files === 1 ? '' : 's'} (${mb} MB)? Nothing in the project or its undo history uses them. This cannot be undone.`,
        { confirmLabel: 'Delete', danger: true }
      )
      if (!ok) return
      const done = await window.vidancer.projectCleanup(true)
      if (done?.busy) {
        toast('a render started meanwhile — nothing was deleted, try again later', { kind: 'error' })
        return
      }
      toast(done ? `cleaned up ${done.files} file${done.files === 1 ? '' : 's'} (${(done.bytes / (1024 * 1024)).toFixed(1)} MB) ✓` : 'cleanup failed', { kind: done ? 'ok' : 'error' })
    } finally {
      setCleaning(false)
    }
  }

  useEffect(() => {
    window.vidancer.getSettings().then((s) => {
      setFalKey(s?.falKey ?? '')
      setFalAdminKey(s?.falAdminKey ?? '')
      setAstriaKey(s?.astriaKey ?? '')
      setAnthropicKey(s?.anthropicKey ?? '')
      initial.current = { falKey: s?.falKey ?? '', falAdminKey: s?.falAdminKey ?? '', astriaKey: s?.astriaKey ?? '', anthropicKey: s?.anthropicKey ?? '' }
    })
  }, [])

  // patch only the fields the user actually changed — re-saving an untouched key is pointless, and
  // if one failed to decrypt this session (field loads blank) a full save would wipe its stored blob
  const initial = useRef<{ falKey: string; falAdminKey: string; astriaKey: string; anthropicKey: string } | null>(null)
  const save = async (): Promise<void> => {
    const patch: Record<string, string> = {}
    const want = { falKey: falKey.trim(), falAdminKey: falAdminKey.trim(), astriaKey: astriaKey.trim(), anthropicKey: anthropicKey.trim() }
    for (const k of Object.keys(want) as (keyof typeof want)[]) {
      if (want[k] !== (initial.current?.[k] ?? '')) patch[k] = want[k]
    }
    if (Object.keys(patch).length) await window.vidancer.setSettings(patch)
    initial.current = want
    setStatus('saved ✓')
    void refreshCredit()
  }

  const field = (
    label: string,
    hint: string,
    value: string,
    set: (v: string) => void,
    placeholder: string,
    mb = 12
  ): React.JSX.Element => (
    <label style={{ display: 'block', marginBottom: mb }}>
      <div className="lb" style={{ marginBottom: 4 }}>
        {label} <span style={{ color: 'var(--dim)' }}>— {hint}</span>
      </div>
      <input type="password" value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} style={ctl} />
    </label>
  )

  return (
    <Modal title={<><Ic i={Settings2} size={15} /> Settings</>} width={480} onClose={onClose}>
        <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 14 }}>
          Keys are stored locally on this machine only (Electron userData) — never in the project folder or repo.
        </div>

        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, margin: '4px 0 8px' }}>
          fal.ai
        </div>
        {field('fal API key', 'video + image generation — Seedance 2, Sora 2, Nano Banana (id:secret)', falKey, setFalKey, 'paste fal key')}
        {field('fal admin key', 'reads your credit balance (account/billing scope)', falAdminKey, setFalAdminKey, 'paste fal admin key', 16)}

        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, margin: '4px 0 8px' }}>
          future features — not used yet
        </div>
        {field('Astria API key', 'NOT used by Video Dancer (image gen runs on your fal key)', astriaKey, setAstriaKey, 'paste Astria key')}
        {field('Anthropic API key', 'Claude prompt brain — coming later', anthropicKey, setAnthropicKey, 'paste Anthropic key', 18)}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="btn" onClick={save}>Save</span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{status}</span>
        </div>

        <div style={{ borderTop: '1px solid var(--line)', marginTop: 16, paddingTop: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
            project maintenance
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="btn" style={hasProject && !cleaning ? undefined : { opacity: 0.5, pointerEvents: 'none' }} onClick={() => void cleanup()}>
              {cleaning ? 'scanning…' : 'Clean up unused media'}
            </span>
            <span style={{ fontSize: 11, color: 'var(--dim)' }}>
              {hasProject ? 'deletes files no clip, image, track or undo step still uses' : 'open a project first'}
            </span>
          </div>
        </div>
    </Modal>
  )
}
