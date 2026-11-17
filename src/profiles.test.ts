import { expect, test } from 'bun:test'
import { planLabel, profileId, toProfile } from './profiles'

test('profile id from the config dir', () => {
  expect(profileId('/Users/ada/.claude')).toBe('default')
  expect(profileId('/Users/ada/.claude-work-personal/')).toBe('work-personal')
  expect(profileId('/opt/agents/custom')).toBe('custom')
})

test('plan label from the account', () => {
  const max = { configDir: '', signedIn: true, organizationType: 'claude_max' }
  expect(planLabel({ ...max, rateLimitTier: 'default_claude_max_20x' })).toBe('Max 20x')
  expect(planLabel({ ...max, rateLimitTier: 'default_claude_max_5x' })).toBe('Max 5x')
  expect(planLabel({ ...max, organizationType: 'claude_team', rateLimitTier: 'default_claude_max_5x' })).toBe('Team')
  expect(planLabel({ ...max, organizationType: 'claude_pro' })).toBe('Pro')
  expect(planLabel({ ...max, organizationType: 'claude_enterprise' })).toBe('Enterprise')
  expect(planLabel({ configDir: '', signedIn: false })).toBe('Signed out')
  expect(planLabel({ configDir: '', signedIn: false, baseUrl: 'http://localhost:4000' })).toBe('API')
})

test('profile from info and overrides', () => {
  const info = { configDir: '/Users/ada/.claude-work', signedIn: true, email: 'ada@example.com', baseUrl: 'http://x' }
  expect(toProfile(info, {})).toMatchObject({ id: 'work', name: 'Work', account: 'ada@example.com', provider: 'compatible', defaultModel: 'Default' })
  expect(toProfile(info, { work: 'Acme' }).name).toBe('Acme')
})
