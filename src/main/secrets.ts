import fs from 'node:fs'
import path from 'node:path'
import { safeStorage } from 'electron'

/**
 * Small key/value store for secrets, encrypted with the OS keychain via Electron's safeStorage
 * (Keychain on macOS, DPAPI on Windows). Nothing is stored when OS-backed encryption is
 * unavailable: there is no plaintext fallback.
 */
export class SecretStore {
  constructor(private readonly file: string) {}

  available(): boolean {
    if (!safeStorage.isEncryptionAvailable()) return false
    // On Linux without a keyring, safeStorage falls back to a hard-coded key.
    return !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
  }

  get(key: string): string | null {
    const encoded = this.read()[key]
    if (!encoded || !this.available()) return null
    try {
      return safeStorage.decryptString(Buffer.from(encoded, 'base64'))
    } catch {
      return null
    }
  }

  set(key: string, value: string): boolean {
    if (!this.available()) return false
    const data = this.read()
    data[key] = safeStorage.encryptString(value).toString('base64')
    this.write(data)
    return true
  }

  delete(key: string): void {
    const data = this.read()
    if (key in data) {
      delete data[key]
      this.write(data)
    }
  }

  keys(prefix = ''): string[] {
    return Object.keys(this.read()).filter((key) => key.startsWith(prefix))
  }

  clear(prefix = ''): void {
    const data = this.read()
    for (const key of Object.keys(data)) if (key.startsWith(prefix)) delete data[key]
    this.write(data)
  }

  private read(): Record<string, string> {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
    } catch {
      return {}
    }
  }

  private write(data: Record<string, string>): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const temp = `${this.file}.tmp`
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 })
    fs.renameSync(temp, this.file)
  }
}
