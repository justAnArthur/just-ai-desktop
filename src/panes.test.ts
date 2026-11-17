import { expect, test } from 'bun:test'
import { initialSession, reduce, type SessionModel, type ToolCall } from './engine/session'
import { hunks, sameChanges, tasksOf, touches } from './panes'

const all = await Bun.file(new URL('./engine/fixtures/subagent.jsonl', import.meta.url))
  .text()
  .then(t => t.split('\n').filter(Boolean))
const replay = (until = all.length) => all.slice(0, until).reduce<SessionModel>(reduce, initialSession)
const progress = all.findIndex(line => line.includes('"task_progress"')) + 1

const agent = (id: string, patch: Partial<ToolCall> = {}): ToolCall => ({
  kind: 'tool',
  id,
  name: 'Agent',
  input: { description: id, subagent_type: 'Explore' },
  children: [],
  ...patch,
})

test('a sub-agent run, while it runs and once it reports', () => {
  expect(tasksOf(replay(progress))).toEqual([
    { id: 'toolu_01RcB1pCeYXb1A1f1iP6SLCP', title: 'Read hello.txt contents', kind: 'agent', status: 'running', detail: 'general-purpose · 0 tool uses' },
  ])
  const [done] = tasksOf(replay())
  expect(done).toMatchObject({ status: 'done', title: 'Read hello.txt contents' })
  expect(done?.detail).toMatch(/^general-purpose · 1 tool use · \d+s$/)
})

test('an unfinished run of an idle session stopped; errors failed; background runs left out; newest first', () => {
  const model: SessionModel = {
    ...initialSession,
    status: 'idle',
    turns: [
      agent('a', { result: 'ok', durationMs: 75_000 }),
      agent('b', { isError: true, result: 'boom' }),
      agent('c'),
      agent('d', { input: { description: 'd', run_in_background: true }, result: 'Async agent launched' }),
    ],
  }
  expect(tasksOf(model).map(t => [t.id, t.status, t.detail])).toEqual([
    ['c', 'stopped', 'Explore · 0 tool uses'],
    ['b', 'failed', 'Explore · 0 tool uses'],
    ['a', 'done', 'Explore · 0 tool uses · 1m 15s'],
  ])
})

test('finished tool calls that may touch the work tree, nested ones too', () => {
  expect(touches(replay(progress))).toBe(0)
  // The Write was denied: it still finished, and a refresh costs one git status.
  expect(touches(replay())).toBe(1)
})

test('changes compare by value', () => {
  const change = { path: 'a.ts', status: 'modified' as const, staged: false, patch: '+a' }
  expect(sameChanges([change], [{ ...change }])).toBe(true)
  expect(sameChanges([change], [{ ...change, staged: true }])).toBe(false)
  expect(sameChanges([change], [])).toBe(false)
})

test('patches from their first hunk', () => {
  expect(hunks('diff --git a/a b/a\nindex 1..2 100644\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-a\n+b\n')).toBe('@@ -1 +1 @@\n-a\n+b\n')
  expect(hunks('diff --git a/a b/b\nrename from a\nrename to b\n')).toBe('diff --git a/a b/b\nrename from a\nrename to b\n')
})
