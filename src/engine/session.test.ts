import { describe, expect, test } from 'bun:test'
import { allow, answer, deny, interrupt, type PermissionUpdate, setModel, setPermissionMode, userMessage } from './protocol'
import { canStop, fromTranscript, initialSession, reduce, type Item, type SessionModel, type ToolCall } from './session'

const lines = (name: string) => Bun.file(new URL(`./fixtures/${name}`, import.meta.url)).text().then(t => t.split('\n').filter(Boolean))

function replay(all: string[], until = all.length) {
  return all.slice(0, until).reduce<SessionModel>(reduce, initialSession)
}

const tool = (items: Item[], name: string) => items.find((i): i is ToolCall => i.kind === 'tool' && i.name === name)

describe('protocol', () => {
  test('stdin lines', () => {
    expect(JSON.parse(allow('r1'))).toEqual({ type: 'control_response', response: { subtype: 'success', request_id: 'r1', response: { behavior: 'allow' } } })
    expect(JSON.parse(deny('r1', 'No')).response.response).toEqual({ behavior: 'deny', message: 'No' })
    expect(JSON.parse(answer('r1', { questions: [] }, { Q: 'A' })).response.response).toEqual({ behavior: 'allow', updatedInput: { questions: [], answers: { Q: 'A' } } })
    const int = JSON.parse(interrupt())
    expect(int).toMatchObject({ type: 'control_request', request: { subtype: 'interrupt' } })
    expect(int.request_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(JSON.parse(setPermissionMode('plan')).request).toEqual({ subtype: 'set_permission_mode', mode: 'plan' })
    expect(JSON.parse(setModel('haiku')).request).toEqual({ subtype: 'set_model', model: 'haiku' })
    expect(JSON.parse(userMessage('hi')).message).toEqual({ role: 'user', content: 'hi' })
    expect(JSON.parse(userMessage('look', [{ kind: 'image', mediaType: 'image/png', data: 'AA' }])).message.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA' } },
      { type: 'text', text: 'look' },
    ])
  })

  test('attachments: a PDF as a document, a text file inlined, no empty text', () => {
    const line = userMessage('', [
      { kind: 'document', name: 'spec.pdf', data: 'JVBE' },
      { kind: 'text', name: 'notes.md', text: 'has ``` inside' },
    ])
    const content = JSON.parse(line).message.content
    expect(content).toEqual([
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBE' }, title: 'spec.pdf' },
      { type: 'text', text: 'Attached file notes.md:\n````\nhas ``` inside\n````' },
    ])
    expect(reduce(initialSession, userMessage('see these', [{ kind: 'image', mediaType: 'image/png', data: 'AA' }, { kind: 'text', name: 'a.ts', text: 'x' }])).turns).toEqual([
      { kind: 'user', id: 'user-0', text: 'see these', attachments: [{ kind: 'image', name: 'Image 1' }, { kind: 'file', name: 'a.ts' }] },
    ])
    expect(reduce(initialSession, line).turns[0]).toMatchObject({ text: '', attachments: [{ kind: 'file', name: 'spec.pdf' }, { kind: 'file', name: 'notes.md' }] })
  })

  test('always allow hands the suggestions back', () => {
    const rules: PermissionUpdate[] = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'ls' }], behavior: 'allow', destination: 'localSettings' }]
    expect(JSON.parse(allow('r1', undefined, rules)).response.response).toEqual({ behavior: 'allow', updatedPermissions: rules })
    expect(JSON.parse(allow('r1', undefined, [])).response.response).toEqual({ behavior: 'allow' })
  })
})

describe('init and status', () => {
  const init = { type: 'system', subtype: 'init', session_id: 's', cwd: '/p', model: 'm', permissionMode: 'default', tools: [], claude_code_version: '2', slash_commands: ['review', 'compact', 'pdf'], skills: ['pdf'] }

  test('init lists the commands, status compacting', () => {
    const m = reduce(initialSession, JSON.stringify(init))
    expect(m.commands).toEqual({ slash: ['review', 'compact', 'pdf'], skills: ['pdf'] })
    expect(reduce(initialSession, JSON.stringify({ ...init, slash_commands: undefined, skills: undefined })).commands).toEqual({ slash: [], skills: [] })
    const compacting = reduce(m, JSON.stringify({ type: 'system', subtype: 'status', status: 'compacting' }))
    expect(compacting).toMatchObject({ compacting: true, permissionMode: 'default' })
    expect(reduce(compacting, JSON.stringify({ type: 'system', subtype: 'status', status: null })).compacting).toBe(false)
    expect(reduce(compacting, JSON.stringify({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1, num_turns: 1, usage: { input_tokens: 0, output_tokens: 0 } })).compacting).toBe(false)
  })

  test('a process can stop once idle, unless something waits or runs in the background', () => {
    const idle: SessionModel = { ...initialSession, status: 'idle' }
    expect(canStop(idle)).toBe(true)
    expect(canStop({ ...idle, status: 'failed' })).toBe(true)
    expect(canStop({ ...idle, status: 'running' })).toBe(false)
    expect(canStop({ ...idle, status: 'starting' })).toBe(false)
    const background: Item = { kind: 'tool', id: 't', name: 'Bash', input: { run_in_background: true }, children: [] }
    expect(canStop({ ...idle, turns: [{ kind: 'user', id: 'u', text: 'go', attachments: [] }, background] })).toBe(false)
    expect(canStop({ ...idle, turns: [background, { kind: 'user', id: 'u', text: 'go', attachments: [] }] })).toBe(true)
  })
})

describe('live stream', () => {
  test('question, permission, partial text, result', async () => {
    const all = await lines('permission.jsonl')
    const asked = all.findIndex(l => l.includes('"can_use_tool"')) + 1
    const waiting = replay(all, asked)
    expect(waiting.status).toBe('waiting')
    expect(waiting.pending).toMatchObject([{ kind: 'question', tool: 'AskUserQuestion', input: { questions: [{ header: 'File name' }] } }])
    expect(replay(all, asked + 1).pending).toEqual([])

    const writeAsked = all.findIndex(l => l.includes('"can_use_tool"') && l.includes('"Write"')) + 1
    expect(replay(all, writeAsked).pending).toMatchObject([{ kind: 'permission', tool: 'Write', suggestions: [{ type: 'setMode', mode: 'acceptEdits' }] }])

    const lastDelta = all.findLastIndex(l => l.includes('"text_delta"')) + 1
    expect(replay(all, lastDelta).draft).toBe('Done.')

    const m = replay(all)
    expect(m).toMatchObject({ sessionId: '02ec34ab-50ce-472f-9d50-6fe37c3780ff', model: 'claude-haiku-5-5', cwd: '/Users/you/project', permissionMode: 'default', status: 'idle', pending: [], draft: '' })
    expect(m.turns.map(i => i.kind)).toEqual(['user', 'tool', 'thinking', 'tool', 'text'])
    expect(m.turns[0]).toMatchObject({ kind: 'user', attachments: [] })
    expect(tool(m.turns, 'AskUserQuestion')?.result).toContain('"a.txt"')
    const write = tool(m.turns, 'Write')
    expect(write).toMatchObject({ input: { content: 'hi\n' }, isError: undefined })
    expect(write?.durationMs).toBeGreaterThan(0)
    expect(m.turns.at(-1)).toMatchObject({ kind: 'text', text: 'Done.' })
    expect(m.lastResult).toMatchObject({ isError: false, numTurns: 3 })
    expect(m.lastResult?.costUsd).toBeGreaterThan(0)
    expect(m.context).toMatchObject({ window: 1_000_000 })
    expect(m.context?.tokens).toBeGreaterThan(0)
    expect(m.rateLimit).toMatchObject({ status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 0.87 })
  })

  test('sub-agent children, denied tool, interrupt', async () => {
    const all = await lines('subagent.jsonl')
    const m = replay(all)
    const agent = tool(m.turns, 'Agent')
    expect(agent?.input).toMatchObject({ description: 'Read hello.txt contents' })
    expect(agent?.result).toContain('Subagent hand-back')
    expect(agent?.children.map(i => i.kind)).toEqual(['tool'])
    expect(tool(agent!.children, 'Read')).toMatchObject({ result: '1\thi\n2\t', input: { file_path: '/Users/you/project/hello.txt' } })
    expect(tool(m.turns, 'Read')).toBeUndefined()
    expect(tool(m.turns, 'Write')).toMatchObject({ result: 'Not now', isError: true })
    expect(m).toMatchObject({ status: 'idle', pending: [], lastResult: { isError: false } })
  })

  test('a tool result copies only the path to its tool', () => {
    const use = (id: string) => JSON.stringify({ type: 'assistant', message: { id, model: 'm', content: [{ type: 'tool_use', id, name: 'Bash', input: {} }] } })
    const before = ['t1', 't2', 't3'].map(use).reduce<SessionModel>(reduce, initialSession)
    const after = reduce(before, JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'ok' }] } }))
    expect(after.turns.map(t => t === before.turns[after.turns.indexOf(t)])).toEqual([true, false, true])
    expect(tool(after.turns, 'Bash')).toBe(before.turns[0] as ToolCall)
    expect((after.turns[1] as ToolCall).result).toBe('ok')
    expect(reduce(after, JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'none', content: 'x' }] } })).turns).toBe(after.turns)
  })

  test('api error result', async () => {
    const m = replay(await lines('auth-error.jsonl'))
    expect(m.status).toBe('failed')
    expect(m.error).toBe('Not logged in · Please run /login')
    expect(m.model).toBe('claude-haiku-5-5')
  })

  test('ignores junk and our own control requests', () => {
    expect(reduce(initialSession, 'not json')).toBe(initialSession)
    expect(reduce(initialSession, interrupt())).toBe(initialSession)
    expect(reduce(initialSession, userMessage('hi'))).toMatchObject({ status: 'running', turns: [{ kind: 'user', text: 'hi' }] })
  })
})

test('past session from a transcript', async () => {
  const m = fromTranscript(await lines('transcript.jsonl'))
  expect(m).toMatchObject({
    sessionId: '11111111-2222-4333-8444-555555555555',
    cwd: '/Users/you/project',
    model: 'claude-opus-5-5',
    permissionMode: 'acceptEdits',
    status: 'idle',
    todos: [{ content: 'Read README', status: 'completed' }, { content: 'Write plan', status: 'in_progress' }],
  })
  expect(m.turns.map(i => i.kind)).toEqual(['user', 'thinking', 'text', 'tool', 'tool', 'tool', 'text', 'user', 'text'])
  expect(m.turns[0]).toMatchObject({ text: 'List the files and plan the work', attachments: [] })
  expect(tool(m.turns, 'Bash')).toMatchObject({ result: 'README.md\nsrc', durationMs: 400 })
  expect(tool(m.turns, 'Read')).toMatchObject({ result: 'File does not exist.', isError: true })
  expect(m.turns[7]).toMatchObject({ kind: 'user', text: 'Here is a screenshot', attachments: [{ kind: 'image', name: 'Image 1' }] })
  expect(m.context).toEqual({ tokens: 16203 })
})
