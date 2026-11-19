import type { Profile } from '@justanarthur/modo-ui-ai'
import { planLabel, profileId, type ProfileInfo } from '@just-apps/claude-code'

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
