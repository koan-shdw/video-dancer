// Writes this app's public login page (the Client ID Metadata Document, src/main/bridge/oauth.ts)
// into this repo's oauth/client.json (GitHub Pages serves it). Run it whenever
// clientPage() changes, then commit that repo; its GitHub page serves the file at CLIENT_PAGE_URL.
// test-bridge-login.cjs fails while the two differ.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const main = path.resolve(__dirname, '../src/main').replaceAll('\\', '/')
const out = require('esbuild').buildSync({ stdin: { contents: `export { clientPage, CLIENT_PAGE_URL } from '${main}/bridge/oauth'`, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['electron'], logLevel: 'silent' })
const mod = { exports: {} }
vm.runInThisContext('(function(require,module,exports){' + out.outputFiles[0].text + '\n})')((n) => (n === 'electron' ? { shell: {} } : require(n)), mod, mod.exports)
const file = path.resolve(__dirname, '../oauth/client.json')
fs.mkdirSync(path.dirname(file), { recursive: true })
fs.writeFileSync(file, JSON.stringify(mod.exports.clientPage(), null, 2) + '\n')
console.log(`wrote ${file}\nserved at ${mod.exports.CLIENT_PAGE_URL} once that repo is pushed and its GitHub page is on`)
