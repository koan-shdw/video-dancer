import { useEffect } from 'react'
import { create } from 'zustand'
import { vd } from '../api'
import { useStore } from '../store'
import { codirEngineRow, type CodirCli, type CodirEngineId } from '../shared/models'
import type { Settings } from '../shared/types'

export type AccountInfo = { found: boolean; loggedIn?: boolean; account?: string; version?: string; detail: string }
export type ConnectionModel = { id: string; label: string; minCli?: string; efforts?: string[] }
type Check = { state: 'checking' | 'verified' | 'failed'; text: string }
export const useConnections = create<{
  settings: Settings | null; info: Partial<Record<CodirCli, AccountInfo>>; models: Partial<Record<CodirEngineId, ConnectionModel[]>>;
  busy: CodirCli | null; error: string; checks: Record<string, Check | undefined>
}>(() => ({ settings: null, info: {}, models: {}, busy: null, error: '', checks: {} }))

let loading: Promise<void> | null = null
let settingsVersion = 0
export function refreshConnections(force = false): Promise<void> {
  if (loading) return force ? loading.then(() => refreshConnections(true)) : loading
  loading = (async () => {
    try {
      const version = settingsVersion
      const settings = await vd().getSettings()
      if (version === settingsVersion) useConnections.setState({ settings })
      const clis = ['claude', 'codex', 'gemini'] as const
      await Promise.all(clis.map(async cli => {
        try {
          const info = cli === 'claude' ? await vd().codirBridgeStatus(force) : await vd().codirCliStatus(cli, force)
          useConnections.setState(s => ({ info: { ...s.info, [cli]: info ?? { found: false, detail: 'Connection unavailable.' } } }))
        } catch { useConnections.setState(s => ({ info: { ...s.info, [cli]: { found: false, detail: 'Could not check this connection. Try again.' } } })) }
      }))
      const readers: [CodirEngineId, () => Promise<ConnectionModel[]>][] = [
        ['api', () => vd().codirModels()], ['bridge', () => vd().codirBridgeModels()], ['codex', () => vd().codirCliModels('codex')],
        ['gemini', () => vd().codirCliModels('gemini')], ['deepseek', () => vd().codirDeepseekModels()], ['venice', () => vd().codirVeniceModels()], ['openai', () => vd().codirOpenaiModels()]
      ]
      await Promise.all(readers.map(async ([id, read]) => {
        try { const models = await read(); useConnections.setState(s => ({ models: { ...s.models, [id]: models ?? [] } })) } catch { /* account row exposes failed connections */ }
      }))
    } catch (e) { useConnections.setState({ error: errorText(e) }) }
  })().finally(() => { loading = null })
  return loading
}
const errorText = (e: unknown): string => e instanceof Error ? e.message : String(e)
export function useConnectionSync(): void {
  const rev = useStore(s => s.settingsRev)
  useEffect(() => { void refreshConnections() }, [rev])
}
export async function saveConnectionSettings(patch: Partial<Settings>): Promise<void> {
  ++settingsVersion
  const settings = await vd().setSettings(patch)
  ++settingsVersion
  useConnections.setState({ settings })
  useStore.setState(s => ({ settingsRev: s.settingsRev + 1 }))
}
export function setKeyCheck(setting: string, check?: Check): void {
  useConnections.setState(s => ({ checks: { ...s.checks, [setting]: check } }))
}
export function connectionReady(): boolean {
  const s = useConnections.getState()
  if (!s.settings) return false
  const engine = codirEngineRow(s.settings.codirEngine)
  return engine.key ? !!s.settings[engine.key] : s.info[engine.cli!]?.loggedIn === true && s.busy !== engine.cli
}
export async function accountAction(cli: CodirCli, action: 'login' | 'logout' | 'switch'): Promise<void> {
  if (useConnections.getState().busy) return
  useConnections.setState({ busy: cli, error: '' })
  try {
    if (action !== 'login') {
      if (cli === 'gemini') throw Error('Manage this login in Gemini CLI.')
      const result = await vd().codirCliLogout(cli)
      useConnections.setState(s => ({ info: { ...s.info, [cli]: result } }))
      if (!result.ok) throw Error(result.out || 'Logout did not finish. Check the connection and try again.')
    }
    if (action !== 'logout') {
      const result = cli === 'claude' ? await vd().codirBridgeLogin() : await vd().codirCliLogin(cli)
      useConnections.setState(s => ({ info: { ...s.info, [cli]: result } }))
      if (!result.ok) throw Error(result.out || 'Sign-in was cancelled or did not finish. Try again.')
    }
  } catch (e) { useConnections.setState({ error: errorText(e) }) }
  finally {
    await refreshConnections(true)
    useConnections.setState({ busy: null })
    useStore.setState(s => ({ settingsRev: s.settingsRev + 1 }))
  }
}
