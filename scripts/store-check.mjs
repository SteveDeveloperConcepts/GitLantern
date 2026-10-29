// Checks the setup for a store build before the long build starts. Usage: node scripts/store-check.mjs msstore|mas|mas-dev
import { spawnSync } from 'node:child_process'
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
  if (process.platform !== 'darwin') {
    problems.push('Mac App Store builds must be made on a Mac with your Apple certificates in the keychain.')
  } else {
    if (spawnSync('xcrun', ['--find', 'clang'], { encoding: 'utf8' }).status !== 0) {
      problems.push("Xcode or its command line tools aren't installed (the bundled Git is compiled): run xcode-select --install.")
    }
    // Signing certificates in the keychain. Their names have changed over the years, so a missing one is a warning.
    const identities = spawnSync('security', ['find-identity', '-v'], { encoding: 'utf8' }).stdout ?? ''
    const needed =
      target === 'mas'
        ? [
            ['Apple Distribution', /"(Apple Distribution|3rd Party Mac Developer Application):/],
            ['Mac Installer Distribution', /"(3rd Party Mac Developer Installer|Mac Installer Distribution):/]
          ]
        : [['Apple Development', /"(Apple Development|Mac Developer):/]]
    for (const [name, pattern] of needed) {
      if (!pattern.test(identities)) {
        warnings.push(`No "${name}" certificate found in your keychain. Add it in Xcode → Settings → Accounts → Manage Certificates (${guide}).`)
      }
    }
  }
  const profile = target === 'mas' ? 'build/embedded.provisionprofile' : 'build/development.provisionprofile'
  if (!fs.existsSync(path.join(root, profile))) {
    problems.push(`Missing ${profile}. Download it from developer.apple.com → Certificates, IDs & Profiles → Profiles (${guide}).`)
  }
} else {
  console.error('Usage: node scripts/store-check.mjs msstore|mas|mas-dev')
  process.exit(2)
}

for (const warning of warnings) console.warn(`\n⚠ ${warning}\n`)
if (problems.length > 0) {
  for (const problem of problems) console.error(`✖ ${problem}`)
  process.exit(1)
}
