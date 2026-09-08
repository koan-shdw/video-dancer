import { useStore } from '../store'

// INTENSITY (director, 2026-09-08 — the word on the face is INTENSITY; the store key stays
// codirHeat): a five-step meter in a centred pill. Click 5 and 1→5 light, click 3 and 1→3
// light; the lit run shows ONE gradient blue→red flowing across the whole row (each button
// reveals its slice), unlit = plain button grammar; click the lit level again = auto.
// Lives on the tether, the docked Co-Director panel, and the Director's Room.
type Heat = 'auto' | 1 | 2 | 3 | 4 | 5
const W = 26 // button width
const GAP = 3
const ROW = W * 5 + GAP * 4
const GRADIENT = 'linear-gradient(90deg, #3b82f6 0%, #14b8a6 25%, #eab308 50%, #f97316 75%, #ef4444 100%)'

export function HeatMeter({ align = 'center' }: { align?: 'center' | 'left' | 'right' }): React.JSX.Element {
  const heat = useStore((s) => s.codirHeat)
  const setHeat = useStore((s) => s.setCodirHeat)
  const level = heat === 'auto' ? 0 : heat
  return (
    <div style={{ display: 'flex', justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start' }}>
      <span
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '3px 10px', borderRadius: 999, border: '1px solid var(--line2)', background: 'var(--raised)' }}
        title="INTENSITY — how hard he writes field text (never how much): 1 plain → 5 maximum force · click the lit level again = auto"
      >
        <span style={{ fontSize: 9, letterSpacing: 1, color: 'var(--dim)' }}>INTENSITY</span>
        <span style={{ display: 'inline-flex', gap: GAP }}>
          {([1, 2, 3, 4, 5] as const).map((n) => {
            const lit = n <= level
            return (
              <span
                key={n}
                className="btn vd-hbtn"
                onClick={() => setHeat(n === heat ? 'auto' : (n as Heat))}
                style={{
                  width: W,
                  boxSizing: 'border-box',
                  textAlign: 'center',
                  padding: '1px 0',
                  ...(lit
                    ? {
                        // one gradient across the row: every lit button shows its own slice of it
                        backgroundImage: GRADIENT,
                        backgroundSize: `${ROW}px 100%`,
                        backgroundPosition: `-${(n - 1) * (W + GAP)}px 0`,
                        backgroundRepeat: 'no-repeat',
                        borderColor: 'transparent',
                        color: '#111',
                        fontWeight: 700
                      }
                    : {})
                }}
              >
                {n}
              </span>
            )
          })}
        </span>
        <span style={{ fontSize: 9, color: 'var(--dim)', minWidth: 24 }}>{heat === 'auto' ? 'auto' : ''}</span>
      </span>
    </div>
  )
}
