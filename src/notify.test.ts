import { expect, test } from 'bun:test'
import type { Line } from '@just-apps/claude-code'
import { createNotifier, noticeOf } from './notify'

const ask = (tool_name: string, input: Record<string, unknown>) =>
  ({ type: 'control_request', request_id: 'r', request: { subtype: 'can_use_tool', tool_name, input, tool_use_id: 't' } }) as Line

const result = (is_error: boolean, extra = {}) =>
  ({ type: 'result', subtype: 'success', session_id: 's', is_error, duration_ms: 1, num_turns: 1, usage: { input_tokens: 0, output_tokens: 0 }, ...extra }) as Line

test('notice bodies', () => {
  expect(noticeOf(ask('Bash', { command: 'rm -rf dist\nls' }))).toBe('Needs you: Bash · rm -rf dist')
  expect(noticeOf(ask('AskUserQuestion', { questions: [{ question: 'a.txt or b.txt?' }] }))).toBe('Needs you: a.txt or b.txt?')
  expect(noticeOf(ask('ExitPlanMode', { plan: '...' }))).toBe('Needs you: a plan to review')
  expect(noticeOf(ask('mcp__x__y', {}))).toBe('Needs you: mcp__x__y')
  expect(noticeOf(result(false))).toBe('Finished')
  expect(noticeOf(result(true, { result: 'Not logged in\nmore' }))).toBe('Failed: Not logged in')
  expect(noticeOf({ type: 'control_request', request_id: 'r', request: { subtype: 'interrupt' } } as Line)).toBeUndefined()
  expect(noticeOf({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } })).toBeUndefined()
})

const tick = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

test('notifier: last notice per session, only when wanted, quiet after an answer', async () => {
  const sent: string[] = []
  let wanted = true
  let now = 0
  const notifier = createNotifier({ send: (id, body) => sent.push(`${id}: ${body}`), wanted: () => wanted, delay: 5, quiet: 100, now: () => now })
  notifier.push('a', 'Needs you: Bash')
  notifier.push('a', 'Finished')
  notifier.push('b', 'Finished')
  await tick(20)
  expect(sent).toEqual(['a: Finished', 'b: Finished'])

  wanted = false
  notifier.push('a', 'Finished')
  await tick(20)
  expect(sent).toHaveLength(2)

  wanted = true
  notifier.push('a', 'Needs you: Bash')
  notifier.answered('a')
  notifier.push('a', 'Finished')
  await tick(20)
  expect(sent).toHaveLength(2)
  now = 200
  notifier.push('a', 'Finished')
  await tick(20)
  expect(sent).toEqual(['a: Finished', 'b: Finished', 'a: Finished'])
})
