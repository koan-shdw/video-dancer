// BRIDGE OAuth — the login half of the MCP lane (BRIDGE-SPEC-2026-09-01 §3.1). Standard MCP
// authorization: RFC 9728 protected-resource metadata → RFC 8414 server metadata → RFC 7591
// dynamic client registration → authorization-code + PKCE (S256) with the user's REAL browser
// (shell.openExternal, his brief) and a loopback redirect on 127.0.0.1. Hand-rolled on node http
// + fetch + crypto, same house style as codirMcp.ts — no SDK dependency.
//
// OPEN per provider until probed: whether their server accepts DCR + a loopback redirect from a
// desktop client at all. A refusal surfaces as a plain error on the BRIDGE row, never a crash.

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
  authorization_endpoint?: string
  token_endpoint?: string
  registration_endpoint?: string
  scopes_supported?: string[]
  code_challenge_methods_supported?: string[]
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

// ----- discovery -----
// 1) protected-resource metadata names the authorization server (RFC 9728; the spec-required
//    path, with the WWW-Authenticate hint from a 401 as a better pointer when present)
// 2) authorization-server metadata names the endpoints (RFC 8414, openid-configuration fallback)
async function discover(mcpUrl: string, wwwAuthenticate?: string): Promise<AsMetadata & { scopesFromResource?: string[] }> {
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
  for (const c of resourceMetaCandidates) {
    const meta = await fetchJson(c)
    const servers = meta?.authorization_servers as string[] | undefined
    if (servers?.length) {
      authServer = servers[0]
      scopesFromResource = meta?.scopes_supported as string[] | undefined
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
    if (meta?.authorization_endpoint && meta.token_endpoint) return { ...meta, scopesFromResource }
  }
  throw new Error(`no OAuth server metadata found for ${mcpUrl} — this provider may not allow desktop clients yet`)
}

// ----- loopback redirect catcher -----
function listenLoopback(): Promise<{ server: Server; redirectUri: string; code: Promise<{ code: string; state: string }> }> {
  return new Promise((resolve, reject) => {
    let settle: (v: { code: string; state: string }) => void
    let fail: (e: Error) => void
    const code = new Promise<{ code: string; state: string }>((res, rej) => {
      settle = res
      fail = rej
    })
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const err = url.searchParams.get('error')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        `<!doctype html><body style="background:#111;color:#ddd;font-family:monospace;display:grid;place-items:center;height:100vh"><div>${
          err ? `login failed: ${err} — close this tab and try again in Video Dancer` : 'logged in — return to Video Dancer'
        }</div></body>`
      )
      if (err) fail(new Error(`provider refused the login: ${err}`))
      else settle({ code: url.searchParams.get('code') ?? '', state: url.searchParams.get('state') ?? '' })
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') return reject(new Error('loopback listen failed'))
      resolve({ server, redirectUri: `http://127.0.0.1:${addr.port}/callback`, code })
    })
  })
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
export async function bridgeLogin(mcpUrl: string, label: string, wwwAuthenticate?: string): Promise<BridgeAuth> {
  const meta = await discover(mcpUrl, wwwAuthenticate)
  const scope = meta.scopesFromResource?.join(' ') || meta.scopes_supported?.join(' ') || undefined

  // dynamic client registration — public client, loopback redirect (port varies per login, so a
  // wildcard-ish loopback is registered fresh each time; servers that pin exact URIs get the live one)
  const { server, redirectUri, code } = await listenLoopback()
  try {
    let clientId: string
    let clientSecret: string | undefined
    if (meta.registration_endpoint) {
      const reg = await fetch(meta.registration_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_name: 'Video Dancer',
          redirect_uris: [redirectUri],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none'
        })
      })
      const regBody = (await reg.json().catch(() => ({}))) as { client_id?: string; client_secret?: string; error?: string; error_description?: string }
      if (!reg.ok || !regBody.client_id) {
        // their own words ride the row: a refusal that says why is the next fix (list 34)
        const why = regBody.error_description ?? regBody.error
        throw new Error(`${label} refused desktop client registration (${reg.status}${why ? `: ${why}` : ''}) — their MCP may only allow known web clients today`)
      }
      clientId = regBody.client_id
      clientSecret = regBody.client_secret
    } else {
      throw new Error(`${label} publishes no registration endpoint — their MCP may only allow known web clients today`)
    }

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
    auth.searchParams.set('resource', mcpUrl)
    if (scope) auth.searchParams.set('scope', scope)

    await shell.openExternal(auth.toString()) // their own site, his real browser (the brief)

    const got = await Promise.race([
      code,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('login timed out after 5 minutes — press LOGIN to try again')), 5 * 60_000))
    ])
    if (got.state !== state) throw new Error('login state mismatch — try again')
    if (!got.code) throw new Error('provider sent no code — try again')

    const tok = await tokenRequest(
      meta.token_endpoint as string,
      {
        grant_type: 'authorization_code',
        code: got.code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier,
        resource: mcpUrl
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
      resource: mcpUrl,
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
