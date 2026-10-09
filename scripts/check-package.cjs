// electron-builder afterPack (audit 2026-10-09 H18): an installer never ships the private koan-shared
// source (343 .ts/.tsx files rode in 0.26.0's app.asar) or the four draft MOODS. Any of them in the
// packed app stops the build here, before an installer is made.
const path = require('node:path')
const fs = require('node:fs')
const asar = require('@electron/asar')

const DRAFT = 'FIRST DRAFT for the director' // the line every draft MOOD opens its description with

function asarOf(context) {
  const name = context.packager.appInfo.productFilename
  const candidates = [path.join(context.appOutDir, 'resources', 'app.asar'), path.join(context.appOutDir, `${name}.app`, 'Contents', 'Resources', 'app.asar')]
  const hit = candidates.find((p) => fs.existsSync(p))
  if (!hit) throw new Error(`check-package: no app.asar under ${context.appOutDir}`)
  return hit
}

function problemsIn(file) {
  const listed = asar.listPackage(file) // the OS's own separators, which extractFile wants back
  const files = listed.map((f) => f.split(path.sep).join('/'))
  const out = []
  // OUR source: anything outside node_modules, and the koan packages (a public library's own .ts is not ours)
  const source = files.filter((f) => /\.tsx?$/.test(f) && !/\.d\.ts$/.test(f) && (!f.includes('/node_modules/') || f.includes('/node_modules/@koan/')))
  if (source.length) out.push(`${source.length} source file(s), e.g. ${source.slice(0, 3).join(', ')}`)
  const koan = files.filter((f) => f.includes('/node_modules/@koan/'))
  if (koan.length) out.push(`node_modules/@koan is packed (${koan.length} files)`)
  files.forEach((f, i) => {
    if (/^\/out\/main\/.*\.js$/.test(f) && asar.extractFile(file, listed[i].replace(/^[\\/]/, '')).toString('utf8').includes(DRAFT)) out.push(`draft MOOD text in ${f}`)
  })
  return out
}

module.exports = async function afterPack(context) {
  const file = asarOf(context)
  const problems = problemsIn(file)
  if (problems.length) throw new Error(`check-package: this installer would ship what it must not:\n- ${problems.join('\n- ')}`)
  console.log(`  • check-package: ${path.basename(file)} carries no source and no draft MOODS`)
}
module.exports.problemsIn = problemsIn
