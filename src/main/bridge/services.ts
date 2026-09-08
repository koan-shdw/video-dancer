// BRIDGE service descriptors — the six OAuth-MCP providers (BRIDGE-SPEC-2026-09-01 §4).
// Facts researched 2026-09-01 off each provider's own MCP page; tool names are NOT published
// for most of them — the probe captures tools/list verbatim before any engine lights up.

import type { BridgeServiceId } from '@koan/vidancer-ui/shared/types'
export type { BridgeServiceId }

export interface BridgeService {
  id: BridgeServiceId
  label: string
  mcpUrl: string
  site: string // where accounts are made (Settings/BRIDGE row links)
  kind: 'video' | 'tts' // 11L counts TTS minutes, stays out of the video totals (spec §2)
  creditUnit: string // what their balance counts — shown next to the raw number until rate tables exist
  balanceTool?: string // documented balance tool, if any (Magnific account_balance is the only proven one)
  blocked?: string // their OAuth server refuses desktop client registration (field-proven) — row greys with this
}

export const BRIDGE_SERVICES: BridgeService[] = [
  {
    id: 'higgsfield',
    label: 'Higgsfield',
    mcpUrl: 'https://mcp.higgsfield.ai/mcp',
    site: 'https://higgsfield.ai',
    kind: 'video',
    creditUnit: 'credits',
    balanceTool: 'balance' // proven in the live capture 2026-09-01 (84 tools)
  },
  {
    id: 'magnific',
    label: 'Magnific',
    mcpUrl: 'https://mcp.magnific.com',
    site: 'https://www.magnific.com',
    kind: 'video',
    creditUnit: 'credits',
    balanceTool: 'account_balance' // docs.magnific.com/modelcontextprotocol, read 2026-09-01
  },
  {
    id: 'artlist',
    label: 'Artlist',
    mcpUrl: 'https://mcp.artlist.io/mcp',
    site: 'https://artlist.io',
    kind: 'video',
    creditUnit: 'credits',
    blocked: "Artlist doesn't allow MCP yet" // DCR refused 400, field-proven 2026-09-01
  },
  {
    id: 'runway',
    label: 'Runway',
    mcpUrl: 'https://mcp.runwayml.com/mcp',
    site: 'https://runwayml.com',
    kind: 'video',
    creditUnit: 'credits',
    balanceTool: 'show_plans_and_credits' // proven in the live capture 2026-09-01 (26 tools)
  },
  {
    id: 'pika',
    label: 'Pika',
    mcpUrl: 'https://mcp.pika.me/api/mcp',
    site: 'https://pika.art',
    kind: 'video',
    creditUnit: 'credits',
    balanceTool: 'identity_balance' // proven in the live capture 2026-09-01 (75 tools)
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    mcpUrl: 'https://api.elevenlabs.io/v1/mcp',
    site: 'https://elevenlabs.io',
    kind: 'tts',
    creditUnit: 'chars',
    blocked: "ElevenLabs doesn't allow MCP yet" // no registration endpoint, field-proven 2026-09-01
  }
]

export const bridgeService = (id: string): BridgeService | undefined => BRIDGE_SERVICES.find((s) => s.id === id)
