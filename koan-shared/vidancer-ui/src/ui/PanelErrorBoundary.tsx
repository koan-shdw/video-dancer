import { vd } from '../api'
import { Component, type ErrorInfo, type ReactNode } from 'react'

// One panel throwing must not white-screen the whole dockview layout — each registered panel
// is wrapped in this boundary; the rest of the workspace keeps working.
export class PanelErrorBoundary extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[panel:${this.props.name}] crashed:`, error, info.componentStack)
    // the COMPONENT stack is the part the main log was missing — without it a "maximum update
    // depth" points at React internals instead of the component whose effect loops
    void vd().logRenderer?.(`[panel:${this.props.name}] crashed: ${String(error?.message ?? error)}\ncomponent stack:${info.componentStack ?? ' (none)'}`)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="vd-panel" style={{ padding: 14, fontSize: 12, color: 'var(--muted)' }}>
          <div style={{ color: 'var(--bad)', fontWeight: 600, marginBottom: 6 }}>⚠ {this.props.name} crashed</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, marginBottom: 10, whiteSpace: 'pre-wrap' }}>
            {String(this.state.error?.message ?? this.state.error)}
          </div>
          <span className="btn vd-hbtn" onClick={() => this.setState({ error: null })}>
            ↻ retry
          </span>
        </div>
      )
    }
    return this.props.children
  }
}
