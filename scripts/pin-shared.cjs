// Run after committing koan-shared, before tagging an application release.
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..'), shared = path.resolve(root, '../koan-shared')
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${shared.replaceAll('\\', '/')}`, '-C', shared, ...args], { encoding: 'utf8' }).trim()
if (git('status', '--porcelain')) throw Error('Commit the shared changes before pinning a release. Nothing was changed.')
const revision = git('rev-parse', 'HEAD')
fs.writeFileSync(path.join(root, 'koan-shared.ref'), revision + '\n')
console.log('Pinned koan-shared ' + revision)
