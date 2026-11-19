import type { Profile } from '@justanarthur/modo-ui-ai'
import { type AuthStatus, planLabel, profileId, type ProfileInfo } from '@just-apps/claude-code'

export function toProfile(info: ProfileInfo, names: Record<string, string>): Profile {
  const id = profileId(info.configDir)
  return {
    id,
    name: names[id] ?? id.charAt(0).toUpperCase() + id.slice(1),
    configDir: info.configDir,
    plan: planLabel(info),
    provider: info.baseUrl ? 'compatible' : 'anthropic',
    baseUrl: info.baseUrl,
    account: info.email ?? '',
    defaultModel: info.defaultModel ?? 'Default',
    limits: [],
    running: 0,
  }
}

/** The listing's account, over which `claude auth status` has the last word: a stale `.claude.json` can outlive its sign-in. */
export const withStatus = (info: ProfileInfo, status?: AuthStatus): ProfileInfo =>
  status ? { ...info, signedIn: status.loggedIn, email: info.email ?? status.email } : info
