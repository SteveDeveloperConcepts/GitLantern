import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// macos/GitLantern.xcodeproj builds the Mac App Store version in Xcode (docs/RELEASING.md). Xcode only runs
// on a Mac, so these check here that it's well-formed and agrees with electron-builder's settings.
const root = path.resolve(import.meta.dirname, '..')
const read = (file: string): string => fs.readFileSync(path.join(root, file), 'utf8')

type Value = string | Value[] | { [key: string]: Value }

/** Parse Xcode's project.pbxproj, which is in the old OpenStep property list format. */
function parsePbxproj(text: string): Value {
  let at = 0
  const skip = (): void => {
    for (;;) {
      const rest = text.slice(at)
      const space = /^\s+/.exec(rest)?.[0].length ?? 0
      if (space) at += space
      else if (rest.startsWith('//')) at = text.indexOf('\n', at) === -1 ? text.length : text.indexOf('\n', at)
      else if (rest.startsWith('/*')) {
        const end = text.indexOf('*/', at + 2)
        if (end === -1) throw new Error(`Unclosed comment at ${at}`)
        at = end + 2
      } else return
    }
  }
  const expect = (char: string): void => {
    skip()
    if (text[at] !== char) throw new Error(`Expected "${char}" at ${at}, found "${text.slice(at, at + 20)}"`)
    at++
  }
  const value = (): Value => {
    skip()
    if (text[at] === '{') {
      at++
      const dict: Record<string, Value> = {}
      for (skip(); text[at] !== '}'; skip()) {
        const key = value()
        if (typeof key !== 'string') throw new Error(`A key must be a string, at ${at}`)
        expect('=')
        dict[key] = value()
        expect(';')
      }
      at++
      return dict
    }
    if (text[at] === '(') {
      at++
      const list: Value[] = []
      for (skip(); text[at] !== ')'; skip()) {
        list.push(value())
        skip()
        if (text[at] === ',') at++
        else if (text[at] !== ')') throw new Error(`Expected "," or ")" at ${at}`)
      }
      at++
      return list
    }
    if (text[at] === '"') {
      let result = ''
      for (at++; text[at] !== '"'; at++) {
        if (at >= text.length) throw new Error('Unclosed string')
        if (text[at] === '\\') {
          at++
          result += text[at] === 'n' ? '\n' : text[at] === 't' ? '\t' : text[at]
        } else {
          result += text[at]
        }
      }
      at++
      return result
    }
    const word = /^[\w$/:.-]+/.exec(text.slice(at))?.[0]
    if (!word) throw new Error(`Unexpected "${text.slice(at, at + 20)}" at ${at}`)
    at += word.length
    return word
  }
  const result = value()
  skip()
  if (at !== text.length) throw new Error(`Unexpected text after the end, at ${at}`)
  return result
}

/** The keys set to true, and the string arrays, of an entitlements file. */
function entitlements(file: string): Record<string, true | string[]> {
  const xml = read(file).replace(/<!--[\s\S]*?-->/g, '')
  const result: Record<string, true | string[]> = {}
  for (const [, key, body] of xml.matchAll(/<key>([^<]+)<\/key>\s*(<true\/>|<array>[\s\S]*?<\/array>)/g)) {
    if (!key || !body) continue
    result[key] = body === '<true/>' ? true : [...body.matchAll(/<string>([^<]*)<\/string>/g)].map((match) => match[1] ?? '')
  }
  return result
}

const project = parsePbxproj(read('macos/GitLantern.xcodeproj/project.pbxproj')) as { objects: Record<string, Record<string, Value>>; rootObject: string }
const objects = project.objects
const ofType = (isa: string) => Object.entries(objects).filter(([, object]) => object.isa === isa)
const settings = (configurationList: Value | undefined): Record<string, Value>[] =>
  ((objects[configurationList as string]?.buildConfigurations ?? []) as string[]).map((id) => objects[id]?.buildSettings as Record<string, Value>)
const builderConfig = read('electron-builder.yml')
const appId = /^appId: (\S+)$/m.exec(builderConfig)?.[1]
const productName = (JSON.parse(read('package.json')) as { productName: string }).productName

describe('the Xcode project', () => {
  it('parses, and every object it refers to is in it', () => {
    expect(objects[project.rootObject]?.isa).toBe('PBXProject')
    // Every 24-digit ID used as a value names an object.
    const ids = JSON.stringify(objects).match(/"[0-9A-F]{24}"/g) ?? []
    for (const id of ids) expect(objects[JSON.parse(id) as string], id).toBeDefined()
  })

  it('builds the Electron app first, then the GitLantern app around it', () => {
    const [[appTargetId, app]] = ofType('PBXNativeTarget') as [[string, Record<string, Value>]]
    const [[electronId, electron]] = ofType('PBXAggregateTarget') as [[string, Record<string, Value>]]
    expect(app.name).toBe('GitLantern')
    expect(app.productType).toBe('com.apple.product-type.application')
    const dependency = objects[(app.dependencies as string[])[0] ?? '']
    expect(dependency?.target).toBe(electronId)

    const script = (target: Record<string, Value>): string => objects[(target.buildPhases as string[])[0] ?? '']?.shellScript as string
    expect(script(electron)).toContain('build-electron.sh')
    expect(script(app)).toContain('embed-electron.sh')
    for (const file of ['macos/build-electron.sh', 'macos/embed-electron.sh']) expect(fs.existsSync(path.join(root, file)), file).toBe(true)

    // The shared scheme builds, runs and archives that app.
    const scheme = read('macos/GitLantern.xcodeproj/xcshareddata/xcschemes/GitLantern.xcscheme')
    const referenced = new Set([...scheme.matchAll(/BlueprintIdentifier = "([0-9A-F]{24})"/g)].map((match) => match[1]))
    expect([...referenced]).toEqual([appTargetId])
    expect(scheme).toMatch(/<ArchiveAction\s+buildConfiguration = "Release"/)
  })

  it('signs the app with the bundle ID, name and Info.plist electron-builder uses', () => {
    const [[, app]] = ofType('PBXNativeTarget') as [[string, Record<string, Value>]]
    const configurations = settings(app.buildConfigurationList as string)
    expect(configurations).toHaveLength(2)
    for (const config of configurations) {
      expect(config.PRODUCT_BUNDLE_IDENTIFIER).toBe(appId)
      expect(config.PRODUCT_NAME).toBe(productName)
      expect(config.INFOPLIST_FILE).toBe('$(SRCROOT)/../dist/xcode/Info.plist')
      expect(config.CODE_SIGN_ENTITLEMENTS).toBe('GitLantern.entitlements')
      // The App Sandbox, not the hardened runtime, and nothing stripped from Electron's binaries.
      expect(config.ENABLE_HARDENED_RUNTIME).toBe('NO')
      expect(config.STRIP_INSTALLED_PRODUCT).toBe('NO')
    }
    // The build scripts read and write outside the project folder.
    for (const config of settings((objects[project.rootObject] as Record<string, Value>).buildConfigurationList)) {
      expect(config.ENABLE_USER_SCRIPT_SANDBOXING).toBe('NO')
    }
  })

  it('gives the app the same entitlements as electron-builder does, with Electron’s application group', () => {
    const xcode = entitlements('macos/GitLantern.entitlements')
    const builder = entitlements('build/entitlements.mas.plist')
    const { 'com.apple.security.application-groups': groups, ...rest } = xcode
    expect(rest).toEqual(builder)
    expect(groups).toEqual([`$(TeamIdentifierPrefix)${appId}`])
  })

  it('doesn’t ask to listen for connections, which App Review turns down in an app that isn’t a server', () => {
    expect(entitlements('build/entitlements.mas.plist')).not.toHaveProperty(['com.apple.security.network.server'])
  })
})
