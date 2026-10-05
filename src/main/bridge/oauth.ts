// BRIDGE OAuth — the login half of the MCP lane (BRIDGE-SPEC-2026-09-01 §3.1). Standard MCP
// authorization: RFC 9728 protected-resource metadata → RFC 8414 server metadata → RFC 7591
// dynamic client registration → authorization-code + PKCE (S256) with the user's REAL browser
// (shell.openExternal, his brief) and a loopback redirect on 127.0.0.1. Hand-rolled on node http
// + fetch + crypto, same house style as codirMcp.ts — no SDK dependency.
//
// OPEN per provider until probed: whether their server accepts DCR + a loopback redirect from a
// desktop client at all. A refusal surfaces as a plain error on the BRIDGE row, never a crash.
//
// list 34 (2026-09-30): a login server that registers nobody on the spot may still read a CLIENT ID
// METADATA DOCUMENT (MCP authorization spec 2025-11-25): the client_id is an https URL and the
// server fetches the JSON behind it. Artlist (its registration door answers "dynamic client
// registration is disabled") and ElevenLabs (no door at all) both say they do. The document is
// this app's public page; his call 09-30: "github for now, we will eventually have shdw.work".

import { createServer, type Server } from 'http'
import { createHash, randomBytes } from 'crypto'
import { shell } from 'electron'

export interface BridgeAuth {
  // discovery + registration results (kept so refresh + re-login skip re-discovery)
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint?: string
  clientId: string
  clientSecret?: string
  scope?: string
  resource: string // RFC 8707 resource indicator = the MCP endpoint URL
  // the living tokens
  accessToken: string
  refreshToken?: string
  expiresAt?: number // epoch ms; absent = unknown (treat as long-lived, re-auth on 401)
}

interface AsMetadata {
  issuer?: string
  authorization_endpoint?: string
  token_endpoint?: string
  registration_endpoint?: string
  scopes_supported?: string[]
  code_challenge_methods_supported?: string[]
  client_id_metadata_document_supported?: boolean
}

const b64url = (b: Buffer): string => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!r.ok) return null
    return (await r.json()) as Record<string, unknown>
  } catch {
    return null
  }
}

// ----- this app's public page (the Client ID Metadata Document) -----
// The URL IS the client id, so it can never move without every such login being made again. The
// file lives in the PUBLIC repo (koan-shdw/video-dancer, oauth/client.json) and is served by its
// GitHub page. A login server matches the redirect exactly, so the loopback ports are fixed here
// and listed there: test-bridge-login.cjs holds the two copies to each other.
export const CLIENT_PAGE_URL = 'https://koan-shdw.github.io/video-dancer/oauth/client.json'
export const CLIENT_PAGE_PORTS = [47600, 47601, 47602]
export const clientPage = (): Record<string, unknown> => ({
  client_id: CLIENT_PAGE_URL,
  client_name: 'Video Dancer',
  client_uri: 'https://github.com/koan-shdw/video-dancer',
  redirect_uris: CLIENT_PAGE_PORTS.flatMap((port) => [`http://127.0.0.1:${port}/callback`, `http://localhost:${port}/callback`]),
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none'
})
// is the page up, and does it name this id? A login server would refuse a page that is missing or
// names another id, with an error only it can see: better to say so here, plainly.
async function clientPageUp(): Promise<boolean> {
  const live = await fetchJson(CLIENT_PAGE_URL)
  return live?.client_id === CLIENT_PAGE_URL
}

// ----- discovery -----
// 1) protected-resource metadata names the authorization server (RFC 9728; the spec-required
//    path, with the WWW-Authenticate hint from a 401 as a better pointer when present)
// 2) authorization-server metadata names the endpoints (RFC 8414, openid-configuration fallback)
async function discover(mcpUrl: string, wwwAuthenticate?: string): Promise<AsMetadata & { scopesFromResource?: string[]; resource?: string }> {
  const u = new URL(mcpUrl)

  let resourceMetaUrl: string | undefined
  const m = wwwAuthenticate?.match(/resource_metadata="([^"]+)"/)
  if (m) resourceMetaUrl = m[1]
  const resourceMetaCandidates = [
    ...(resourceMetaUrl ? [resourceMetaUrl] : []),
    `${u.origin}/.well-known/oauth-protected-resource${u.pathname === '/' ? '' : u.pathname}`,
    `${u.origin}/.well-known/oauth-protected-resource`
  ]
  let authServer: string | undefined
  let scopesFromResource: string[] | undefined
  let resource: string | undefined
  for (const c of resourceMetaCandidates) {
    const meta = await fetchJson(c)
    const servers = meta?.authorization_servers as string[] | undefined
    if (servers?.length) {
      authServer = servers[0]
      scopesFromResource = meta?.scopes_supported as string[] | undefined
      // the name THEY give the MCP server (RFC 9728): the token is bound to it. Most repeat the MCP
      // URL; Artlist names its root and ElevenLabs its regional host.
      if (typeof meta?.resource === 'string' && meta.resource) resource = meta.resource
      break
    }
  }
  // no resource metadata → the MCP origin IS the authorization server (common on early servers)
  const as = new URL(authServer ?? u.origin)
  const asPath = as.pathname === '/' ? '' : as.pathname
  const asMetaCandidates = [
    `${as.origin}/.well-known/oauth-authorization-server${asPath}`,
    `${as.origin}/.well-known/oauth-authorization-server`,
    `${as.origin}/.well-known/openid-configuration`
  ]
  for (const c of asMetaCandidates) {
    const meta = (await fetchJson(c)) as AsMetadata | null
    if (meta?.authorization_endpoint && meta.token_endpoint) return { ...meta, scopesFromResource, resource }
  }
  throw new Error(`no OAuth server metadata found for ${mcpUrl} — this provider may not allow desktop clients yet`)
}

// ----- loopback redirect catcher -----
type Loopback = { server: Server; redirectUri: string; code: Promise<{ code: string; state: string; iss?: string }> }
function listenLoopback(port = 0): Promise<Loopback> {
  return new Promise((resolve, reject) => {
    let settle: (v: { code: string; state: string; iss?: string }) => void
    let fail: (e: Error) => void
    const code = new Promise<{ code: string; state: string; iss?: string }>((res, rej) => {
      settle = res
      fail = rej
    })
    code.catch(() => {}) // the login reads a refusal; a listener closed unused must not throw on its own
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const err = url.searchParams.get('error')
      const why = url.searchParams.get('error_description')
      const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        `<!doctype html><body style="background:#111;color:#ddd;font-family:monospace;display:grid;place-items:center;height:100vh"><div>${
          err ? `login failed: ${escapeHtml(err)}${why ? ` — ${escapeHtml(why)}` : ''} — close this tab and try again in Video Dancer` : 'logged in — return to Video Dancer'
        }</div></body>`
      )
      if (err) fail(new Error(`provider refused the login: ${err}${why ? ` (${why})` : ''}`))
      else settle({ code: url.searchParams.get('code') ?? '', state: url.searchParams.get('state') ?? '', iss: url.searchParams.get('iss') ?? undefined })
    })
    server.on('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') return reject(new Error('loopback listen failed'))
      resolve({ server, redirectUri: `http://127.0.0.1:${addr.port}/callback`, code })
    })
  })
}
// the page lists its redirect ports: the first one that is free
async function listenOnPagePort(): Promise<Loopback> {
  for (const port of CLIENT_PAGE_PORTS) {
    try {
      return await listenLoopback(port)
    } catch {
      /* in use: the next one */
    }
  }
  throw new Error(`the login ports (${CLIENT_PAGE_PORTS.join(', ')}) are all in use on this machine — close what holds them and try again`)
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

async function tokenRequest(endpoint: string, form: Record<string, string>, clientSecret?: string): Promise<TokenResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }
  if (clientSecret) headers.Authorization = `Basic ${Buffer.from(`${form.client_id}:${clientSecret}`).toString('base64')}`
  const r = await fetch(endpoint, { method: 'POST', headers, body: new URLSearchParams(form).toString() })
  const body = (await r.json().catch(() => ({}))) as TokenResponse
  if (!r.ok || body.error || !body.access_token)
    throw new Error(`token request failed (${r.status}): ${body.error_description ?? body.error ?? 'no access token in response'}`)
  return body
}

// ----- the full login flow -----
// `open` = where the login address goes: his browser (the default), or the clipboard when he
// asked for the link itself (list 33: a second account of the same supplier, in a private window)
export async function bridgeLogin(mcpUrl: string, label: string, wwwAuthenticate?: string, open: (url: string) => unknown = (url) => shell.openExternal(url)): Promise<BridgeAuth> {
  const meta = await discover(mcpUrl, wwwAuthenticate)
  const scope = meta.scopesFromResource?.join(' ') || meta.scopes_supported?.join(' ') || undefined
  const resource = meta.resource ?? mcpUrl

  // HOW THIS APP INTRODUCES ITSELF. A registration on the spot comes first wherever a server has
  // that door: it is the path every working login was proven on (the spec would put the page
  // first; a proven login is not moved onto an unproven one). Where the door is shut or missing,
  // and the server reads client pages, the page is the way in.
  let lb = await listenLoopback()
  let clientId = ''
  let clientSecret: string | undefined
  let refusal = `${label} publishes no registration endpoint — their MCP may only allow known web clients today`
  try {
    if (meta.registration_endpoint) {
      // dynamic client registration — public client, loopback redirect (the port varies per login,
      // so it is registered fresh each time; servers that pin exact URIs get the live one)
      const reg = await fetch(meta.registration_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_name: 'Video Dancer',
          redirect_uris: [lb.redirectUri],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none'
        })
      })
      const regBody = (await reg.json().catch(() => ({}))) as { client_id?: string; client_secret?: string; error?: string; error_description?: string; message?: string | string[] }
      if (reg.ok && regBody.client_id) {
        clientId = regBody.client_id
        clientSecret = regBody.client_secret
      } else {
        // their own words ride the row: a refusal that says why is the next fix (list 34). Auth0
        // keeps the reason in `message` ("dynamic client registration is disabled") beside a bare error
        const said = Array.isArray(regBody.message) ? regBody.message.join('; ') : regBody.message
        const why = regBody.error_description ?? said ?? regBody.error
        refusal = `${label} refused desktop client registration (${reg.status}${why ? `: ${why}` : ''}) — their MCP may only allow known web clients today`
      }
    }
    if (!clientId && meta.client_id_metadata_document_supported) {
      if (!(await clientPageUp())) throw new Error(`${label}’s login reads Video Dancer’s public page, and that page is not up yet (${CLIENT_PAGE_URL}) — it goes live with the app’s next release`)
      lb.server.close()
      lb = await listenOnPagePort() // the page lists exact redirects: one of its fixed ports
      clientId = CLIENT_PAGE_URL
    }
    if (!clientId) throw new Error(refusal)
  } catch (e) {
    lb.server.close()
    throw e
  }
  const { server, redirectUri, code } = lb
  try {
    const verifier = b64url(randomBytes(48))
    const challenge = b64url(createHash('sha256').update(verifier).digest())
    const state = b64url(randomBytes(24))
    const auth = new URL(meta.authorization_endpoint as string)
    auth.searchParams.set('response_type', 'code')
    auth.searchParams.set('client_id', clientId)
    auth.searchParams.set('redirect_uri', redirectUri)
    auth.searchParams.set('code_challenge', challenge)
    auth.searchParams.set('code_challenge_method', 'S256')
    auth.searchParams.set('state', state)
    auth.searchParams.set('resource', resource)
    if (scope) auth.searchParams.set('scope', scope)

    let browserUrl = auth
    if (new URL(mcpUrl).hostname === 'mcp.higgsfield.ai' && auth.origin === 'https://clerk.higgsfield.ai') {
      // App logout forgets MCP tokens; Higgsfield's browser session still selects the last user.
      // Use their sign-out page, then resume the unchanged OAuth request through their sign-in.
      const signIn = new URL('https://higgsfield.ai/auth')
      signIn.searchParams.set('redirect_url', auth.toString())
      browserUrl = new URL('https://higgsfield.ai/auth/logout')
      // Their rp reader decodes once more after URLSearchParams; preserve the nested OAuth query.
      browserUrl.searchParams.set('rp', encodeURIComponent(signIn.pathname + signIn.search))
      // Keep their logout page on the same Clerk host as this authorization request.
      browserUrl.searchParams.set('redirect_url', auth.toString())
    }
    await open(browserUrl.toString()) // their own site, his real browser (the brief)

    let timer: NodeJS.Timeout | undefined
    const got = await Promise.race([
      code,
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error('login timed out after 5 minutes — press LOGIN to try again')), 5 * 60_000)
      })
    ]).finally(() => clearTimeout(timer))
    if (got.state !== state) throw new Error('login state mismatch — try again')
    // RFC 9207: a server that names itself on the way back must be the one the login went to
    if (got.iss && meta.issuer && got.iss !== meta.issuer) throw new Error('the login came back from a different server than it went to — refused')
    if (!got.code) throw new Error('provider sent no code — try again')

    const tok = await tokenRequest(
      meta.token_endpoint as string,
      {
        grant_type: 'authorization_code',
        code: got.code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier,
        resource
      },
      clientSecret
    )
    return {
      authorizationEndpoint: meta.authorization_endpoint as string,
      tokenEndpoint: meta.token_endpoint as string,
      registrationEndpoint: meta.registration_endpoint,
      clientId,
      clientSecret,
      scope: tok.scope ?? scope,
      resource,
      accessToken: tok.access_token as string,
      refreshToken: tok.refresh_token,
      expiresAt: tok.expires_in ? Date.now() + tok.expires_in * 1000 : undefined
    }
  } finally {
    server.close()
  }
}

// silent refresh — mutates nothing; returns the refreshed auth or throws (caller decides the UI)
export async function bridgeRefresh(auth: BridgeAuth): Promise<BridgeAuth> {
  if (!auth.refreshToken) throw new Error('no refresh token — log in again')
  const tok = await tokenRequest(
    auth.tokenEndpoint,
    {
      grant_type: 'refresh_token',
      refresh_token: auth.refreshToken,
      client_id: auth.clientId,
      resource: auth.resource
    },
    auth.clientSecret
  )
  return {
    ...auth,
    accessToken: tok.access_token as string,
    refreshToken: tok.refresh_token ?? auth.refreshToken,
    expiresAt: tok.expires_in ? Date.now() + tok.expires_in * 1000 : undefined
  }
}
