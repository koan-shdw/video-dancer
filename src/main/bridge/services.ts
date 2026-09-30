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
  auth?: 'key' // a KEY service (VENICE-SPEC §6): no MCP, no OAuth — the API key saved in Settings IS the login
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
    creditUnit: 'credits'
    // list 34: his try 09-30 was refused: the registration door its login server publishes
    // (auth.artlist.io/oidc/register) answers "dynamic client registration is disabled". The same
    // server reads client pages (client_id_metadata_document_supported), so the login goes in
    // through this app's public page (oauth.ts). Unproven until the page is up and he tries.
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
    creditUnit: 'chars'
    // list 34: no registration door (their login metadata, read 2026-09-30); they read client pages
    // instead (client_id_metadata_document_supported), so the login goes in through this app's
    // public page (oauth.ts). Unproven until the page is up and he tries.
  },
  {
    // list 14: Venice's Pro credit spends through its API key, so the pooled-credit picture is
    // honest without a login. Balance = GET /api_keys/rate_limits (USD × 100 = credits, their peg).
    id: 'venice',
    label: 'Venice',
    mcpUrl: '',
    site: 'https://venice.ai/settings/api',
    kind: 'video',
    creditUnit: 'credits',
    auth: 'key'
  }
]

export const bridgeService = (id: string): BridgeService | undefined => BRIDGE_SERVICES.find((s) => s.id === id)
