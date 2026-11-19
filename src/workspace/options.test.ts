import { expect, test } from 'bun:test'
import { commandsOf } from './options'

test('commands from init: skills apart, slash-prefixed', () => {
  expect(commandsOf({ slash: ['review', 'pdf'], skills: ['pdf'] })).toEqual([
    { name: '/review', description: '', kind: 'command' },
    { name: '/pdf', description: '', kind: 'skill' },
  ])
  expect(commandsOf(undefined)).toEqual([])
})
