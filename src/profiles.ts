import type { Profile } from '@justanarthur/modo-ui-ai'
import type { ProfileInfo } from './native/commands'

export function profileId(configDir: string) {
  const base = configDir.replace(/\/+$/, '').split('/').pop() ?? ''
  if (base === '.claude') return 'default'
  return base.replace(/^\.claude-/, '').replace(/^\./, '')
}

export function planLabel(info: ProfileInfo) {
  if (info.baseUrl) return 'API'
  if (!info.signedIn) return 'Signed out'
  const tier = info.rateLimitTier ?? ''
  switch (info.organizationType) {
    case 'claude_max':
      if (tier.includes('max_20x')) return 'Max 20x'
      if (tier.includes('max_5x')) return 'Max 5x'
      return 'Max'
    case 'claude_team':
      return 'Team'
    case 'claude_pro':
      return 'Pro'
    case 'claude_enterprise':
      return 'Enterprise'
  }
  return 'API'
}

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
