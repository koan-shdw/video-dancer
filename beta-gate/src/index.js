// The Video Dancer beta download (list 59, his ask 10-02: "can we make a password protexted page for
// the installer?"). A Cloudflare Worker: a password page in front of the installers. The password is
// a Cloudflare secret (BETA_PASSWORD), checked here and never sent to the page; the installers stream
// from a private R2 bucket (BUCKET). Tries are slowed per visitor (TRIES). Installed copies keep
// updating from GitHub Releases as before. Built from Cloudflare's docs read 10-02.
export const FILES = [
  { key: 'VideoDancer-Windows-Setup.exe', label: 'Download for Windows' },
  { key: 'VideoDancer-Mac.dmg', label: 'Download for Mac' }
]
const CONTACT = 'alex@shdw.gallery'
const enc = new TextEncoder()

// equal in constant time: compare SHA-256 digests, so neither the length nor a matching start leaks
export async function same(a, b) {
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))))
  const p = new Uint8Array(x), q = new Uint8Array(y)
  let d = 0
  for (let i = 0; i < p.length; i++) d |= p[i] ^ q[i]
  return d === 0
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

function page(files, message = '', status = 200) {
  const buttons = files.length
    ? files.map((f) => `<button type="submit" name="file" value="${esc(f.key)}">${esc(f.label)}</button>`).join('')
    : '<p class="note">The installers are being prepared. Check back soon.</p>'
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Video Dancer Beta</title>
<style>
:root{--bg:#0c0c0f;--panel:#141418;--line:#33333c;--fg:#e8e8ee;--dim:#8c8c99;--accent:#e7a93c;--bad:#e0795f;--mono:ui-monospace,"Cascadia Mono","SF Mono",Menlo,Consolas,monospace;--sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.5 var(--sans);padding:24px 16px}
main{width:100%;max-width:420px;display:grid;gap:18px}
h1{margin:0;font:700 22px/1.2 var(--mono);letter-spacing:.08em}
h1 span{color:var(--accent);font-size:13px;letter-spacing:.14em;vertical-align:middle;margin-left:8px;border:1px solid var(--accent);border-radius:3px;padding:1px 6px}
p{margin:0;color:var(--dim)}
form{display:grid;gap:12px}
label{font:600 11px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--dim)}
input{width:100%;font:16px var(--sans);color:var(--fg);background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:11px 12px}
button{width:100%;font:700 14px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--fg);background:#000;border:2px solid var(--fg);padding:16px 12px;cursor:pointer}
button:hover{border-color:var(--accent);color:var(--accent)}
input:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.msg{color:var(--bad);font-size:14px}
.note{color:var(--dim)}
a{color:var(--accent)}
</style></head><body><main>
<h1>VIDEO DANCER<span>BETA</span></h1>
<p>Free and open to everyone while it's in beta. Enter the password from your invite to download.</p>
<form method="post" action="/">
<label for="password">Beta password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required>
${message ? `<p class="msg" role="alert">${esc(message)}</p>` : ''}
${buttons}
</form>
<p>No password? Email <a href="mailto:${CONTACT}?subject=Video%20Dancer%20beta">${CONTACT}</a> to get one.</p>
</main></body></html>`
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff'
    }
  })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname !== '/') return new Response('Not found', { status: 404 })
    if (request.method !== 'GET' && request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, POST' } })
    // only the installers that are in the bucket get a button
    const files = (await Promise.all(FILES.map(async (f) => ((await env.BUCKET.head(f.key)) ? f : null)))).filter(Boolean)
    if (request.method === 'GET') return page(files)
    if (!env.BETA_PASSWORD) return page(files, 'Downloads aren’t open yet.', 503)
    // ponytail: keyed by the visitor's IP, which Cloudflare's docs advise against (an office shares
    // one); before a password there is no other key. 10 tries a minute is loose enough for an office.
    const { success } = await env.TRIES.limit({ key: request.headers.get('cf-connecting-ip') || 'unknown' })
    if (!success) return page(files, 'Too many tries. Wait a minute and try again.', 429)
    const form = await request.formData().catch(() => null)
    if (!(await same(String(form?.get('password') ?? ''), env.BETA_PASSWORD))) return page(files, 'That password isn’t right.', 401)
    const file = FILES.find((f) => f.key === String(form?.get('file') ?? ''))
    if (!file) return page(files, 'Pick a download.', 400)
    const obj = await env.BUCKET.get(file.key)
    if (!obj) return page(files, 'That installer isn’t up yet.', 404)
    const headers = new Headers()
    obj.writeHttpMetadata(headers)
    headers.set('content-type', 'application/octet-stream')
    headers.set('content-disposition', `attachment; filename="${file.key}"`)
    headers.set('content-length', String(obj.size))
    headers.set('cache-control', 'no-store')
    return new Response(obj.body, { headers })
  }
}
