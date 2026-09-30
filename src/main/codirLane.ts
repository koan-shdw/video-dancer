// The Co-Director's lane: WHICH engine an exchange (and every sub-call, the watch fallback, score
// compose, the Bridge interpreter) runs on, read from Settings. Two kinds exist underneath:
//   'api'    — a Messages request on a KEY. Anthropic's, or another supplier's with the key tagged;
//              claudeWire.ts reads the tag, so nothing downstream needs to know (Venice: list 14,
//              DeepSeek: list 35).
//   'bridge' — a command-line tool on this machine that holds his login. Claude Code, or (list 35)
//              OpenAI's Codex on a ChatGPT login, or Google's Gemini CLI. The model id says which
//              tool (shared/models cliOfModel); codirBridge.ts sends each to its own runner.
import type { Settings } from '@koan/vidancer-ui/shared/types'
import { VENICE_TAG, DEEPSEEK_TAG } from './claudeWire'
import { resolveCodirModel, resolveVeniceModel, resolveDeepseekModel } from './codir'
import { resolveBridgeModel, bridgeOneShot } from './codirBridge'
import { resolveCodexModel, resolveGeminiModel } from './codirCli'

export interface CodirLane {
  engine: 'api' | 'bridge'
  apiKey?: string
  model: string
  noKey: string
}

export function claudeLane(s: Settings): CodirLane {
  if (s.codirEngine === 'bridge') return { engine: 'bridge', model: resolveBridgeModel(s.codirBridgeModel as string | undefined), noKey: '' }
  if (s.codirEngine === 'codex') return { engine: 'bridge', model: resolveCodexModel(s.codirCodexModel as string | undefined), noKey: '' }
  if (s.codirEngine === 'gemini') return { engine: 'bridge', model: resolveGeminiModel(s.codirGeminiModel as string | undefined), noKey: '' }
  if (s.codirEngine === 'venice')
    return { engine: 'api', apiKey: s.veniceKey ? VENICE_TAG + s.veniceKey : undefined, model: resolveVeniceModel(s.codirVeniceModel as string | undefined), noKey: 'No Venice key saved — the Co-Director is set to Venice: paste the key in Settings (or pick another engine).' }
  if (s.codirEngine === 'deepseek')
    return { engine: 'api', apiKey: s.deepseekKey ? DEEPSEEK_TAG + s.deepseekKey : undefined, model: resolveDeepseekModel(s.codirDeepseekModel as string | undefined), noKey: 'No DeepSeek key saved — the Co-Director is set to DeepSeek: paste the key in Settings (or pick another engine).' }
  return { engine: 'api', apiKey: s.anthropicKey, model: resolveCodirModel(s.codirModel as string | undefined), noKey: 'No Anthropic key saved — paste one in Settings (or switch the Co-Director to bridge).' }
}

// a CLI lane's one-shot (text in, text out) for the lanes that ride the Co-Director's engine.
// images = files the model has to SEE (the watch lane's still frames).
export const oneShotOf = (lane: CodirLane): ((prompt: string, signal?: AbortSignal, images?: string[]) => ReturnType<typeof bridgeOneShot>) | undefined =>
  lane.engine === 'bridge' ? (prompt, signal, images) => bridgeOneShot({ prompt, signal, model: lane.model, images }) : undefined

// the model that READS STILL FRAMES on a key lane (the watch lane's fallback). It has to see:
// DeepSeek's strongest cannot, so on that key the frames go to the one that can.
export const seeingModel = (lane: CodirLane): string => (lane.apiKey?.startsWith(DEEPSEEK_TAG) ? 'deepseek-flash' : lane.model)

// Anthropic's web search and fetch tools exist on Anthropic's own wire only; the CLI engines carry
// their own (list 29). Venice's and DeepSeek's wires have neither.
export const laneHasWeb = (s: Settings): boolean => s.codirEngine !== 'venice' && s.codirEngine !== 'deepseek'
