import fs from 'node:fs'
import path from 'node:path'

export interface AppSettings {
  recentRepos: string[]
  /** Explicit git executable; otherwise PATH and common install locations are searched. */
  gitPath?: string
  /** Folder the clone dialog last cloned into. */
  cloneFolder?: string
}

const MAX_RECENT = 12

export class Settings {
  private data: AppSettings

  constructor(private readonly file: string) {
    this.data = this.load()
  }

  get(): Readonly<AppSettings> {
    return this.data
  }

  addRecentRepo(repoPath: string): void {
    const rest = this.data.recentRepos.filter((p) => p !== repoPath)
    this.data = { ...this.data, recentRepos: [repoPath, ...rest].slice(0, MAX_RECENT) }
    this.save()
  }

  setCloneFolder(folder: string): void {
    this.data = { ...this.data, cloneFolder: folder }
    this.save()
  }

  private load(): AppSettings {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<AppSettings>
      return {
        recentRepos: Array.isArray(parsed.recentRepos)
          ? parsed.recentRepos.filter((p): p is string => typeof p === 'string')
          : [],
        ...(typeof parsed.gitPath === 'string' ? { gitPath: parsed.gitPath } : {}),
        ...(typeof parsed.cloneFolder === 'string' ? { cloneFolder: parsed.cloneFolder } : {})
      }
    } catch {
      return { recentRepos: [] }
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2))
  }
}
