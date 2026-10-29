import os from 'node:os'

/**
 * The Mac App Store build. It runs inside Apple's App Sandbox: it may only use folders the user
 * picked (src/main/folderAccess.ts), its home folder is a container of its own, programs it starts
 * run in the same sandbox, and it runs the Git bundled with it (scripts/build-mas-git.sh).
 */
export const appStore = process.mas === true

/** The user's home folder. Inside the App Sandbox, os.homedir() is GitLantern's own container. */
export function userHome(): string {
  return appStore ? os.userInfo().homedir : os.homedir()
}
