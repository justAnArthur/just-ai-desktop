import { expect, test } from 'bun:test'
import { initialSession, reduce, type SessionModel, type ToolCall } from '@just-apps/claude-code'
import { sameChanges, tasksOf, touches } from './panes'

const all = await Bun.file(Bun.fileURLToPath(import.meta.resolve('@just-apps/claude-code/fixtures/subagent.jsonl')))
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
