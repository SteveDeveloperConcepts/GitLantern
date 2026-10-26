import { providerInfo } from '../shared/providers'
import { serviceName } from '../shared/remoteUrl'
import type { Account, NewPullRequest, PullRequest, PullRequestList } from '../shared/types'
import type { AccountStore } from './accounts/store'
import { createPullRequest, listPullRequests } from './accounts/providerApi'
import * as git from './git/commands'
import type { Remote } from './git/parsers'

interface Source {
  remote: Remote
  account: Account
  token: string
}

/** Where pull requests for a repository live: its origin (or only) remote, and the account for that server. */
async function lookUp(repo: string, accounts: AccountStore): Promise<{ list: Omit<PullRequestList, 'items'>; source?: Source }> {
  const remotes = await git.remotes(repo)
  const remote = remotes.find((r) => r.name === 'origin') ?? remotes[0]
  if (!remote) return { list: { remote: null, service: '', noun: 'pull request', unavailable: 'no-remote', defaultBranch: null } }

  const account = accounts.findByUrl(remote.fetchUrl)
  const service = account ? providerInfo(account.provider).name : serviceName(remote.fetchUrl)
  const list: Omit<PullRequestList, 'items'> = {
    remote: remote.name,
    service,
    noun: account?.provider === 'gitlab' || service === 'GitLab' ? 'merge request' : 'pull request',
    defaultBranch: await git.remoteDefaultBranch(repo, remote.name)
  }
  if (!account) return { list: { ...list, unavailable: 'no-account' } }
  if (account.provider === 'generic') return { list: { ...list, unavailable: 'unsupported' } }
  const token = await accounts.freshToken(account.id)
  if (!token) return { list: { ...list, unavailable: 'no-account' } }
  return { list, source: { remote, account, token } }
}

async function source(repo: string, accounts: AccountStore): Promise<Source> {
  const { list, source: found } = await lookUp(repo, accounts)
  if (!found) throw new Error(`Connect your ${list.service || 'Git service'} account first, under Accounts`)
  return found
}

export async function list(repo: string, accounts: AccountStore): Promise<PullRequestList> {
  const { list: info, source: found } = await lookUp(repo, accounts)
  if (!found) return { ...info, items: [] }
  return { ...info, items: await listPullRequests(found.account, found.token, found.remote.fetchUrl) }
}

export async function create(repo: string, accounts: AccountStore, input: NewPullRequest): Promise<PullRequest> {
  const title = input.title.trim()
  if (!title) throw new Error('Give it a title')
  if (input.source === input.target) throw new Error('Pick a different branch to merge into')
  const found = await source(repo, accounts)
  return createPullRequest(found.account, found.token, found.remote.fetchUrl, { ...input, title })
}

/** Where a service keeps the commits of a pull request from a fork, if it keeps them in the target repository. */
const FORK_REFS: Partial<Record<Account['provider'], (n: number) => string>> = {
  github: (n) => `refs/pull/${n}/head`,
  gitea: (n) => `refs/pull/${n}/head`,
  gitlab: (n) => `refs/merge-requests/${n}/head`
}

/** Check out a pull request: its branch when it's in this repository, else a `pr/<number>` branch. */
export async function checkout(repo: string, accounts: AccountStore, number: number): Promise<string> {
  const found = await source(repo, accounts)
  const pr = (await listPullRequests(found.account, found.token, found.remote.fetchUrl)).find((p) => p.number === number)
  if (!pr) throw new Error(`#${number} isn’t open any more`)
  if (pr.sameRepo) {
    await git.fetchBranch(repo, found.remote.name, pr.sourceBranch)
    await git.checkout(repo, { kind: 'remote', name: `${found.remote.name}/${pr.sourceBranch}` })
    return pr.sourceBranch
  }
  const ref = FORK_REFS[found.account.provider]
  if (!ref) throw new Error(`#${number} comes from a fork, which GitLantern can only check out on GitHub, GitLab and Gitea`)
  const local = `pr/${number}`
  await git.checkoutFetched(repo, found.remote.name, ref(number), local)
  return local
}
