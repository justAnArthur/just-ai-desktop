import { expect, test } from 'bun:test'
import type { Session } from '@justanarthur/modo-ui-ai'
import { initialSession } from './engine/session'
import { ago, type Entry, groupSessions, inboxOf, limitsOf, mergeEntries, statusOf } from './sessions'

const HOUR = 3_600_000
const now = Date.UTC(2026, 10, 17, 12)

test('limits from the stream windows, dropping a window past its reset', () => {
  const at = (hours: number) => (now + hours * HOUR) / 1000
  const limits = limitsOf(
    { five_hour: { utilization: 0.13, resetsAt: at(2), status: 'allowed' }, seven_day: { utilization: 0.87, resetsAt: at(-1), status: 'allowed' } },
    now,
  )
  expect(limits).toEqual([{ label: 'Session (5h)', value: 0.13, detail: '13% · 2h', windowHours: 5, resetsInHours: 2 }])
  expect(limitsOf(undefined, now)).toEqual([])
})

test('relative time', () => {
  expect(ago(now - 30_000, now)).toBe('now')
  expect(ago(now - 15 * 60_000, now)).toBe('15m')
  expect(ago(now - 3 * HOUR, now)).toBe('3h')
  expect(ago(now - 72 * HOUR, now)).toBe('3d')
})

test('status: live state only while the process runs', () => {
  const waiting = { ...initialSession, status: 'waiting' as const }
  expect(statusOf(waiting, true, false)).toBe('waiting')
  expect(statusOf({ ...initialSession, status: 'running' }, true, true)).toBe('running')
  expect(statusOf(waiting, false, true)).toBe('unread')
  expect(statusOf(undefined, false, false)).toBe('idle')
})

test('entries: one per id, newest first, keeping a title', () => {
  const e = (id: string, updated: number, title?: string): Entry => ({ id, profileId: 'p', configDir: '/c', cwd: '/x', updated, title })
  expect(mergeEntries([[e('a', 1, 'First line')], [e('a', 3), e('b', 2)]])).toEqual([e('a', 3, 'First line'), e('b', 2)])
})

test('groups: pinned, sections, projects by folder, archived', () => {
  const s = (id: string): Session => ({ id, title: id, status: 'idle', profile: 'p', updated: 'now' })
  const cwd: Record<string, string> = { a: '/u/demo', b: '/u/api', c: '/u/demo', d: '/u/api', e: '/u/demo' }
  const out = groupSessions([s('a'), s('b'), s('c'), s('d'), s('e')], id => cwd[id] ?? '', {
    pinned: ['c'],
    archived: ['d'],
    sections: [{ label: 'Later', ids: ['e'] }],
  })
  expect(out.pinned.map(x => [x.id, x.pinned])).toEqual([['c', true]])
  expect(out.archived.map(x => x.id)).toEqual(['d'])
  expect(out.groups.map(g => [g.label, g.kind, g.sessions.map(x => x.id)])).toEqual([
    ['Later', 'section', ['e']],
    ['demo', 'project', ['a']],
    ['api', 'project', ['b']],
  ])
})

test('groups: folders with one name get their parents until unique', () => {
  const s = (id: string): Session => ({ id, title: id, status: 'idle', profile: 'p', updated: 'now' })
  const cwd: Record<string, string> = { a: '/x/one/ui', b: '/x/two/ui', c: '/y/one/ui', d: '/u/api' }
  const out = groupSessions([s('a'), s('b'), s('c'), s('d')], id => cwd[id] ?? '', { pinned: [], archived: [], sections: [] })
  expect(out.groups.map(g => g.label)).toEqual(['ui · one · x', 'ui · two', 'ui · one · y', 'api'])
})

test('inbox: one row per waiting prompt', () => {
  const session: Session = { id: 's', title: 'Fix it', status: 'waiting', profile: 'p', updated: 'now', project: 'demo' }
  const model = {
    ...initialSession,
    pending: [{ kind: 'permission' as const, requestId: 'r', toolUseId: 't', tool: 'Bash', input: { command: 'rm -rf dist' } }],
  }
  expect(inboxOf([{ session, model, at: now - 5 * 60_000 }], now)).toEqual([
    { id: 'r', kind: 'permission', title: 'rm -rf dist', sessionId: 's', session: 'Fix it', project: 'demo', profile: 'p', detail: 'Bash', ago: 5 },
  ])
})
