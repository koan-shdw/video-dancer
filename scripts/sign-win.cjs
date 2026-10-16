// electron-builder win.sign hook. release.yml passes it (-c.win.sign) only when the SSL.com eSigner
// secrets exist, so unsigned builds never load it. Signs each file (app exe, uninstaller, installer)
// with SSL.com's CodeSignTool, which the workflow unpacks into CODESIGNTOOL_DIR. Runs inside the
// build, before latest.yml is hashed, so auto-update sees the signed installer's real sha512.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function find(dir, test) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isFile() && test(entry.name.toLowerCase())) return full
    if (entry.isDirectory()) {
      const hit = find(full, test)
      if (hit) return hit
    }
  }
  return null
}

module.exports = async function sign({ path: file }) {
  const bat = find(process.env.CODESIGNTOOL_DIR, (n) => n === 'codesigntool.bat')
  if (!bat) throw new Error(`sign-win: no CodeSignTool.bat under ${process.env.CODESIGNTOOL_DIR}`)
  const home = path.dirname(bat) // CodeSignTool reads conf/ relative to its own folder
  // java + jar straight, not the .bat: cmd would mangle a password holding & ^ % or quotes
  const java = find(home, (n) => n === 'java.exe') ?? 'java'
  const jar = find(home, (n) => n.startsWith('code_sign_tool') && n.endsWith('.jar'))
  if (!jar) throw new Error(`sign-win: no code_sign_tool jar under ${home}`)
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'esign-'))
  try {
    execFileSync(java, ['-jar', jar, 'sign',
      `-username=${process.env.ES_USERNAME}`,
      `-password=${process.env.ES_PASSWORD}`,
      `-credential_id=${process.env.ES_CREDENTIAL_ID}`,
      `-totp_secret=${process.env.ES_TOTP_SECRET}`,
      `-input_file_path=${file}`,
      `-output_dir_path=${out}`,
    ], { cwd: home, stdio: 'inherit' })
    // CodeSignTool can exit 0 on a failed sign; the missing output file is what fails the build then
    fs.copyFileSync(path.join(out, path.basename(file)), file)
  } finally {
    fs.rmSync(out, { recursive: true, force: true })
  }
}
