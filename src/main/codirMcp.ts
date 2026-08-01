// Co-Director bridge back-channel — a minimal MCP server over localhost HTTP (Streamable HTTP,
// plain-JSON responses, which the Claude Code client accepts). It exists ONLY while a bridge
// exchange runs: fresh random port + bearer token per exchange, bound to 127.0.0.1, closed in the
// exchange's finally. It exposes the SAME TOOLS/runTool as the API engine, so every guard rail
// (add-only refs, beat placeholder carry-over, undoable writes) is shared, never cloned.
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { randomBytes } from 'crypto'
import { TOOLS, runTool, liveDetail } from './codir'
import type { ProjectDelta, CoDirLiveWrite } from '../shared/types'

export interface CodirMcpBinding {
  onStatus: (text: string) => void
  onWrote: (text: string) => void
  onLive?: (live: CoDirLiveWrite) => void // Director's Room live stage (optional — older callers skip it)
  pushDelta: (d: ProjectDelta) => void
}

export interface CodirMcpServer {
  port: number
  token: string
  close: () => void
}

interface RpcMsg {
  jsonrpc?: string
  id?: number | string | null
  method?: string
  params?: Record<string, unknown>
}

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })

export function startCodirMcp(bind: CodirMcpBinding): Promise<CodirMcpServer> {
  const token = randomBytes(24).toString('hex')

  // one JSON-RPC message → its response object, or null for notifications (no id → no response)
  async function handle(msg: RpcMsg): Promise<Record<string, unknown> | null> {
    const id = msg.id
    if (id === undefined || id === null || !msg.method) return null
    const reply = (result: unknown): Record<string, unknown> => ({ jsonrpc: '2.0', id, result })
    switch (msg.method) {
      case 'initialize':
        return reply({
          protocolVersion: (msg.params?.protocolVersion as string) || '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'vidancer', version: '1' }
        })
      case 'ping':
        return reply({})
      case 'tools/list':
        return reply({ tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })) })
      case 'tools/call': {
        const name = String(msg.params?.name ?? '')
        const args = (msg.params?.arguments as Record<string, unknown>) ?? {}
        bind.onStatus(`writing: ${name.replace(/_/g, ' ')}…`)
        const live = liveDetail(name, args)
        if (live) bind.onLive?.(live)
        let out: string
        try {
          out = await runTool(name, args, bind.pushDelta)
        } catch (e) {
          out = `ERROR: ${e instanceof Error ? e.message : String(e)}`
        }
        bind.onWrote(out)
        return reply({ content: [{ type: 'text', text: out }], isError: out.startsWith('ERROR') })
      }
      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `unknown method ${msg.method}` } }
    }
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      // per-exchange bearer token: the ONLY client that knows it is the CLI we just spawned
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401).end()
        return
      }
      if (req.method === 'GET') {
        // no server-initiated messages — the client treats 405 as "no SSE stream offered"
        res.writeHead(405, { allow: 'POST, DELETE' }).end()
        return
      }
      if (req.method === 'DELETE') {
        res.writeHead(200).end()
        return
      }
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST, DELETE' }).end()
        return
      }
      try {
        const parsed = JSON.parse(await readBody(req)) as RpcMsg | RpcMsg[]
        const batch = Array.isArray(parsed)
        const responses = (await Promise.all((batch ? parsed : [parsed]).map(handle))).filter((r): r is Record<string, unknown> => r !== null)
        if (!responses.length) {
          res.writeHead(202).end() // notifications only
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(batch ? responses : responses[0]))
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: e instanceof Error ? e.message : 'parse error' } }))
      }
    })()
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        server.close()
        reject(new Error('MCP server bound without a port'))
        return
      }
      resolve({ port: addr.port, token, close: () => server.close() })
    })
  })
}
