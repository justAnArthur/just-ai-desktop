import { expect, test } from 'bun:test'
import { toProfile, withStatus } from './profiles'

test('profile from info and overrides', () => {
  const info = { configDir: '/Users/ada/.claude-work', signedIn: true, email: 'ada@example.com', baseUrl: 'http://x' }
  expect(toProfile(info, {})).toMatchObject({ id: 'work', name: 'Work', account: 'ada@example.com', provider: 'compatible', defaultModel: 'Default' })
  expect(toProfile(info, { work: 'Acme' }).name).toBe('Acme')
})

test('auth status has the last word on the sign-in', () => {
  const info = { configDir: '/Users/ada/.claude-work', signedIn: true, email: 'ada@example.com' }
  expect(withStatus(info)).toBe(info)
  expect(toProfile(withStatus(info, { loggedIn: false }), {}).plan).toBe('Signed out')
  expect(withStatus({ configDir: '/x', signedIn: false }, { loggedIn: true, email: 'b@example.com' })).toMatchObject({ signedIn: true, email: 'b@example.com' })
})
