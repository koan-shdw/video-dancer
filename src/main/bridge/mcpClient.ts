// Minimal MCP client over Streamable HTTP — the mirror of codirMcp.ts (our hand-rolled MCP
// SERVER): plain fetch + JSON-RPC, no SDK dependency. Hosted servers answer a POST with either
// application/json (one message) or text/event-stream (messages as SSE events); both are handled.
// Auth is a bearer token owned by the caller (bridge/index.ts refreshes it); a 401 here throws
// BridgeAuthError so the manager can re-auth instead of failing the job.

export interface McpTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export interface McpToolResult {
  content?: { type: string; text?: string; data?: string; mimeType?: string; [k: string]: unknown }[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
  [k: string]: unknown
}

export class BridgeAuthError extends Error {
  wwwAuthenticate?: string
  constructor(message: string, wwwAuthenticate?: string) {
    super(message)
    this.name = 'BridgeAuthError'
    this.wwwAuthenticate = wwwAuthenticate
  }
}

interface RpcResponse {
  jsonrpc?: string
  id?: number | string | null
  result?: Record<string, unknown>
  error?: { code?: number; message?: string; data?: unknown }
}

const PROTOCOL_VERSION = '2025-06-18'

export class McpClient {
  private url: string
  private token: () => string // read the CURRENT access token per request (refresh swaps it mid-session)
  private sessionId: string | null = null
  private nextId = 1
  private initialized = false

  constructor(url: string, token: () => string) {
    this.url = url
    this.token = token
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${this.token()}`,
      'MCP-Protocol-Version': PROTOCOL_VERSION
    }
    if (this.sessionId) h['Mcp-Session-Id'] = this.sessionId
    return h
  }

  // one request → its matching JSON-RPC response (SSE streams are read until that id shows up)
  private async rpc(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = this.nextId++
    const res = await fetch(this.url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} })
    })
    if (res.status === 401 || res.status === 403)
      throw new BridgeAuthError(`auth rejected (${res.status}) @ ${method}`, res.headers.get('www-authenticate') ?? undefined)
    if (!res.ok) throw new Error(`error (${res.status}) @ bridge-mcp/${method}: ${(await res.text().catch(() => '')).slice(0, 300)}`)
    const sid = res.headers.get('mcp-session-id')
    if (sid) this.sessionId = sid

    const ctype = res.headers.get('content-type') ?? ''
    let msg: RpcResponse | undefined
    if (ctype.includes('text/event-stream')) {
      msg = await readSseUntil(res, id)
    } else {
      const body = (await res.json()) as RpcResponse | RpcResponse[]
      msg = Array.isArray(body) ? body.find((m) => m.id === id) : body
    }
    if (!msg) throw new Error(`error @ bridge-mcp/${method}: no response message for request ${id}`)
    if (msg.error) throw new Error(`error (${msg.error.code ?? 'rpc'}) @ bridge-mcp/${method}: ${msg.error.message ?? 'unknown'}`)
    return msg.result ?? {}
  }

  // fire-and-forget notification (no id → servers answer 202 with no body)
  private async notify(method: string): Promise<void> {
    await fetch(this.url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: '2.0', method })
    }).catch(() => undefined)
  }

  async initialize(): Promise<{ serverName?: string; serverVersion?: string }> {
    const r = await this.rpc('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'video-dancer', version: '1' }
    })
    this.initialized = true
    await this.notify('notifications/initialized')
    const info = r.serverInfo as { name?: string; version?: string } | undefined
    return { serverName: info?.name, serverVersion: info?.version }
  }

  private async ensureInit(): Promise<void> {
    if (!this.initialized) await this.initialize()
  }

  async listTools(): Promise<McpTool[]> {
    await this.ensureInit()
    // page through cursors — a 58-tool server (Pika) may not fit one page
    const tools: McpTool[] = []
    let cursor: string | undefined
    do {
      const r = await this.rpc('tools/list', cursor ? { cursor } : {})
      tools.push(...((r.tools as McpTool[] | undefined) ?? []))
      cursor = r.nextCursor as string | undefined
    } while (cursor)
    return tools
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    await this.ensureInit()
    return (await this.rpc('tools/call', { name, arguments: args })) as McpToolResult
  }

  // a session invalidated server-side must not poison the client — drop and re-init next call
  reset(): void {
    this.sessionId = null
    this.initialized = false
    this.nextId = 1
  }
}

// read an SSE body until the JSON-RPC response with the wanted id arrives (servers may interleave
// progress notifications first); the stream is cancelled once we have it
async function readSseUntil(res: Response, id: number): Promise<RpcResponse | undefined> {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return undefined
      buf += decoder.decode(value, { stream: true })
      // SSE frames are blank-line separated; each frame's data: lines join to one JSON message
      let sep: number
      while ((sep = buf.search(/\r?\n\r?\n/)) !== -1) {
        const frame = buf.slice(0, sep)
        buf = buf.slice(sep).replace(/^\r?\n\r?\n/, '')
        const data = frame
          .split(/\r?\n/)
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n')
        if (!data) continue
        try {
          const msg = JSON.parse(data) as RpcResponse | RpcResponse[]
          const hit = Array.isArray(msg) ? msg.find((m) => m.id === id) : msg.id === id ? msg : undefined
          if (hit) return hit
        } catch {
          // non-JSON event (keepalive) — skip
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}
