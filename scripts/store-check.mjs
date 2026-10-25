// Checks the setup for a store build before the long build starts. Usage: node scripts/store-check.mjs msstore|mas|mas-dev
import fs from 'node:fs'
import path from 'node:path'

const target = process.argv[2]
const root = path.resolve(import.meta.dirname, '..')
const guide = 'docs/RELEASING.md'
const problems = []
const warnings = []

if (target === 'msstore') {
  if (process.platform !== 'win32') problems.push('Microsoft Store packages are built on Windows 10 or 11.')
  const config = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8')
  const placeholders = config
    .split(/\r?\n/)
    .filter((line) => line.includes('REPLACE-ME'))
    .map((line) => `    ${line.trim()}`)
  if (placeholders.length > 0) {
    warnings.push(
      [
        'The Store identity in electron-builder.yml (appx) still has placeholders:',
        ...placeholders,
        '  The package will work for a local test install, but Partner Center rejects it until you copy in',
        `  the values from Product management → Product identity (${guide}).`
      ].join('\n')
    )
  }
} else if (target === 'mas' || target === 'mas-dev') {
  if (process.platform !== 'darwin') problems.push('Mac App Store builds must be made on a Mac with your Apple certificates in the keychain.')
  const profile = target === 'mas' ? 'build/embedded.provisionprofile' : 'build/development.provisionprofile'
  if (!fs.existsSync(path.join(root, profile))) {
    problems.push(`Missing ${profile}. Download it from developer.apple.com → Certificates, IDs & Profiles → Profiles (${guide}).`)
  }
  warnings.push(
    `Git Steve can't run Git inside Apple's App Sandbox yet, so this build won't pass App Review.\n  See "Mac App Store" in ${guide} for what's missing.`
  )
} else {
  console.error('Usage: node scripts/store-check.mjs msstore|mas|mas-dev')
  process.exit(2)
}

for (const warning of warnings) console.warn(`\n⚠ ${warning}\n`)
if (problems.length > 0) {
  for (const problem of problems) console.error(`✖ ${problem}`)
  process.exit(1)
}
