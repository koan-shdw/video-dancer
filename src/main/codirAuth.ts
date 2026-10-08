import { mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

// Each CLI owns a Video Dancer profile. Never copy or clear the user's global CLI credentials.
export function accountEnv(provider: 'claude' | 'codex'): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const name of [
    'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS',
    'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_REFRESH_TOKEN', 'CLAUDE_CODE_OAUTH_SCOPES',
    'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDECODE',
    'OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'OPENAI_BASE_URL',
    'OPENAI_IDENTITY_TOKEN_FILE', 'OPENAI_WORKLOAD_IDENTITY_PROVIDER'
  ]) delete env[name]
  const profile = join(app.getPath('userData'), 'llm-accounts', provider)
  mkdirSync(profile, { recursive: true, mode: 0o700 })
  if (provider === 'codex') env.CODEX_HOME = profile
  else env.CLAUDE_CONFIG_DIR = profile
  return env
}
