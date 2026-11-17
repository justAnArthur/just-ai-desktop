import { describe, expect, test } from 'bun:test'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { fromTranscript, initialSession, type Pending, reduce, type SessionModel } from '../engine/session'
import { PendingPrompt, SessionTranscript } from './transcript-view'

const lines = (name: string) =>
  Bun.file(new URL(`../engine/fixtures/${name}`, import.meta.url)).text().then(t => t.split('\n').filter(Boolean))

const replay = (all: string[], until = all.length) => all.slice(0, until).reduce<SessionModel>(reduce, initialSession)

const text = (html: string) => html.replace(/<[^>]+>/g, '').replaceAll('&amp;', '&')

const html = (model: SessionModel) => renderToStaticMarkup(<SessionTranscript model={model} />)

const prompt = (pending: Pending) => text(renderToStaticMarkup(<PendingPrompt pending={pending} respond={() => {}} />))

const sent = (pending: Pending) => {
  const out: unknown[] = []
  const element = PendingPrompt({ pending, respond: line => out.push(JSON.parse(line)) }) as ReactElement<Record<string, (...a: unknown[]) => void>>
  return { props: element.props, out }
}

describe('SessionTranscript', () => {
  test('mounts only its last turns, the rest behind a button', () => {
    const turns = Array.from({ length: 250 }, (_, i) => ({ kind: 'user' as const, id: `u${i}`, text: `message ${i}.`, attachments: 0 }))
    const out = text(html({ ...initialSession, status: 'idle', turns }))
    expect(out).toContain('Show earlier turns')
    expect(out).toContain('message 249.')
    expect(out).toContain('message 50.')
    expect(out).not.toContain('message 49.')
  })

  test('past transcript', async () => {
    const out = text(html(fromTranscript(await lines('transcript.jsonl'))))
    for (const text of ['List the files and plan the work', 'Here is a screenshot', 'Image 1', 'Bash', 'Read README', 'Write plan', 'error'])
      expect(out).toContain(text)
  })

  test('live permission stream: question, write, draft, result', async () => {
    const all = await lines('permission.jsonl')
    const asked = all.findIndex(l => l.includes('"can_use_tool"')) + 1
    const waiting = replay(all, asked)
    expect(html(waiting)).toContain('AskUserQuestion')
    const question = prompt(waiting.pending[0])
    expect(question).toContain('Should the file be named a.txt or b.txt?')
    expect(question).toContain('Write the file as b.txt containing hi')

    const writeAsked = all.findIndex(l => l.includes('"can_use_tool"') && l.includes('"Write"')) + 1
    const write = replay(all, writeAsked)
    const permission = prompt(write.pending[0])
    expect(permission).toContain('Allow Write to run this?')
    expect(permission).toContain('/Users/you/project/a.txt')
    expect(permission).toContain('Always allow edits')

    const streaming = html(replay(all, all.findLastIndex(l => l.includes('"text_delta"')) + 1))
    expect(streaming).toContain('Done.')
    expect(streaming).toContain('role="status"')

    const done = html(replay(all))
    expect(done).toContain('Done.')
    expect(done).toContain('Worked for')
    expect(done).not.toContain('role="status"')
  })

  test('sub-agent run', async () => {
    const out = text(html(replay(await lines('subagent.jsonl'))))
    for (const text of ['general-purpose', 'Read hello.txt contents', '1 tool use', 'I did not modify anything', 'Write'])
      expect(out).toContain(text)
    expect(out).not.toContain('Subagent hand-back')
    expect(out).not.toContain('agentId')
  })

  test('api error and an odd tool', async () => {
    const model = replay(await lines('auth-error.jsonl'))
    expect(() => html(model)).not.toThrow()
    const odd: SessionModel = {
      ...initialSession,
      status: 'running',
      turns: [{ kind: 'tool', id: 't1', name: 'mcp__x__y', input: { deep: { a: 1 } }, children: [] }],
      todos: [{ content: 'Step one', status: 'in_progress' }],
      draft: '',
    }
    const out = text(html(odd))
    expect(out).toContain('mcp__x__y')
    expect(out).toContain('Working…')
    expect(out).toContain('Step one')
  })
})

describe('PendingPrompt', () => {
  const base = { requestId: 'r1', toolUseId: 't1' }

  test('permission answers', () => {
    const pending: Pending = {
      ...base,
      kind: 'permission',
      tool: 'Edit',
      input: { file_path: '/a.ts', old_string: 'a', new_string: 'b' },
      suggestions: [{ type: 'setMode', mode: 'acceptEdits' }],
    }
    expect(prompt(pending)).toContain('/a.ts')
    const always = sent(pending)
    always.props.onAnswer('always')
    expect(always.out).toMatchObject([
      { response: { request_id: 'r1', response: { behavior: 'allow' } } },
      { request: { subtype: 'set_permission_mode', mode: 'acceptEdits' } },
    ])
    const denied = sent(pending)
    denied.props.onAnswer('deny')
    expect(denied.out).toMatchObject([{ response: { response: { behavior: 'deny' } } }])
  })

  test('plan', () => {
    const pending: Pending = { ...base, kind: 'plan', tool: 'ExitPlanMode', input: { plan: '## Steps\n\n- **one**' } }
    const out = prompt(pending)
    expect(out).toContain('Steps')
    expect(renderToStaticMarkup(<PendingPrompt pending={pending} respond={() => {}} />)).toContain('<strong>one</strong>')
    const keep = sent(pending)
    keep.props.onDecide('keep-planning', 'more tests')
    expect(keep.out).toMatchObject([{ response: { response: { behavior: 'deny', message: 'more tests' } } }])
    const auto = sent(pending)
    auto.props.onDecide('auto', '')
    expect(auto.out).toMatchObject([{ response: { response: { behavior: 'allow' } } }, { request: { mode: 'acceptEdits' } }])
  })

  test('several questions show one at a time', () => {
    const pending: Pending = {
      ...base,
      kind: 'question',
      tool: 'AskUserQuestion',
      input: {
        questions: [
          { question: 'First?', header: 'One', options: [{ label: 'A' }, { label: 'B' }] },
          { question: 'Second?', header: 'Two', options: [{ label: 'C' }], multiSelect: true },
        ],
      },
    }
    const out = prompt(pending)
    expect(out).toContain('First?')
    expect(out).toContain('One · 1/2')
    expect(out).not.toContain('Second?')
  })
})
