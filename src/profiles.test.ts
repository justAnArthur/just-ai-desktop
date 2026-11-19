import { expect, test } from 'bun:test'
import { toProfile } from './profiles'

test('profile from info and overrides', () => {
  const info = { configDir: '/Users/ada/.claude-work', signedIn: true, email: 'ada@example.com', baseUrl: 'http://x' }
  expect(toProfile(info, {})).toMatchObject({ id: 'work', name: 'Work', account: 'ada@example.com', provider: 'compatible', defaultModel: 'Default' })
  expect(toProfile(info, { work: 'Acme' }).name).toBe('Acme')
})
