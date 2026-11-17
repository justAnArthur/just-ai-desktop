import { Code, Diff, Markdown } from '@justanarthur/modo-ui'
import { AgentPrompt, Transcript } from '@justanarthur/modo-ui-ai'
import { type ReactNode, useState } from 'react'
import { allow, answer, deny, type PermissionMode, setPermissionMode } from '../engine/protocol'
import type { Item, Pending, SessionModel, TextItem, ToolCall, UserItem } from '../engine/session'
import { duration, isAgent, plural } from '../panes'

const MAX_LINES = 40
const MAX_CHARS = 4000
const SUMMARY_KEYS = ['command', 'file_path', 'notebook_path', 'pattern', 'path', 'url', 'query', 'skill', 'description', 'prompt']

interface Live {
  running: boolean
  waiting: Set<string>
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
const lines = (s: string) => (s ? s.split('\n') : [])

const summarize = (input: Record<string, unknown>) => SUMMARY_KEYS.map(k => str(input[k])).find(Boolean)?.split('\n')[0] ?? ''

function clip(text: string) {
  const head = lines(text).slice(0, MAX_LINES).join('\n').slice(0, MAX_CHARS)
  return head.length < text.length ? `${head}\n…` : text
}

function edit(name: string, input: Record<string, unknown>) {
  const before = name === 'Write' ? '' : str(input.old_string)
  const after = name === 'Write' ? str(input.content) : str(input.new_string)
  if ((name !== 'Edit' && name !== 'Write') || before === undefined || after === undefined) return
  const removed = lines(before.replace(/\n$/, ''))
  const added = lines((name === 'Write' ? clip(after) : after).replace(/\n$/, ''))
  return {
    meta: `+${added.length} −${removed.length}`,
    patch: [`@@ -1,${removed.length} +1,${added.length} @@`, ...removed.map(l => `-${l}`), ...added.map(l => `+${l}`)].join('\n'),
  }
}

// The CLI wraps a sub-agent's report in a harness frame and appends its id and usage.
function report(result: string) {
  const body = result.split('The report follows:\n')[1] ?? result
  return body.split(/\nagentId: /)[0].replace(/^ {2}/gm, '').trim()
}

function status(tool: ToolCall, live: Live) {
  if (tool.isError) return 'error'
  if (tool.result !== undefined) return 'done'
  if (live.waiting.has(tool.id)) return 'waiting'
  return live.running ? 'running' : 'done'
}

function meta(tool: ToolCall) {
  if (tool.isError) return 'error'
  const change = edit(tool.name, tool.input)
  if (change) return change.meta
  const n = lines(tool.result?.trimEnd() ?? '').length
  return n > 1 ? `${n} lines` : undefined
}

function body(tool: ToolCall) {
  const change = !tool.isError && edit(tool.name, tool.input)
  if (change) return <Diff lineNumbers={false} patch={change.patch} />
  if (tool.result) return <Code language="plaintext">{clip(tool.result)}</Code>
}

function span(tools: ToolCall[]) {
  const timed = tools.filter(t => t.startedAt !== undefined)
  if (!timed.length) return
  const start = Math.min(...timed.map(t => t.startedAt!))
  const end = Math.max(...timed.map(t => t.startedAt! + (t.durationMs ?? 0)))
  return end > start ? end - start : undefined
}

const waitsOn = (items: Item[], live: Live): boolean =>
  items.some(i => i.kind === 'tool' && (live.waiting.has(i.id) || waitsOn(i.children, live)))

function Agent({ tool, live }: { tool: ToolCall; live: Live }) {
  const own = status(tool, live)
  // A prompt from one of its tools holds the sub-agent too.
  const state = own === 'running' && waitsOn(tool.children, live) ? 'waiting' : own
  const tally = [plural(tool.children.filter(i => i.kind === 'tool').length, 'tool use'), tool.durationMs && duration(tool.durationMs)]
  return (
    <Transcript.Agent
      agent={str(tool.input.subagent_type) ?? 'Agent'}
      description={str(tool.input.description) ?? ''}
      status={state}
      background={tool.input.run_in_background === true}
      meta={tally.filter(Boolean).join(' · ')}
    >
      {tool.children.length > 0 && <WorkItems items={tool.children} live={live} />}
      {tool.result && <Markdown className="text-muted-foreground">{report(tool.result)}</Markdown>}
    </Transcript.Agent>
  )
}

function WorkItems({ items, live }: { items: Item[]; live: Live }) {
  const out: ReactNode[] = []
  let run: ToolCall[] = []
  const flush = () => {
    if (!run.length) return
    out.push(
      <Transcript.Tools key={run[0].id}>
        {run.map((tool, index) => (
          <Transcript.Tool
            key={tool.id}
            value={tool.id}
            index={index}
            tool={tool.name}
            summary={summarize(tool.input)}
            status={status(tool, live)}
            meta={meta(tool)}
          >
            {body(tool)}
          </Transcript.Tool>
        ))}
      </Transcript.Tools>,
    )
    run = []
  }
  for (const item of items) {
    if (item.kind === 'tool' && !isAgent(item)) {
      run.push(item)
      continue
    }
    flush()
    if (item.kind === 'tool') out.push(<Agent key={item.id} tool={item} live={live} />)
    else if (item.kind === 'thinking')
      out.push(
        <Transcript.Thinking key={item.id}>
          <p className="m-0 whitespace-pre-wrap">{item.text}</p>
        </Transcript.Thinking>,
      )
    else if (item.kind === 'text') out.push(<Markdown key={item.id}>{item.text}</Markdown>)
  }
  flush()
  return out
}

function workSummary(items: Item[], streaming: boolean) {
  const tools = items.filter((i): i is ToolCall => i.kind === 'tool')
  const agents = tools.filter(isAgent).length
  const counts = [tools.length - agents && plural(tools.length - agents, 'tool call'), agents && plural(agents, 'agent')]
  const detail = counts.filter(Boolean).join(' · ') || 'Thought'
  if (streaming) return { summary: 'Working…', detail }
  const ms = span(tools)
  return ms ? { summary: `Worked for ${duration(ms)}`, detail } : { summary: detail }
}

function AssistantTurn({ items, streaming, live }: { items: Item[]; streaming: boolean; live: Live }) {
  const visible = items.filter(i => i.kind !== 'thinking' || i.text)
  const split = visible.findLastIndex(i => i.kind !== 'text') + 1
  const work = visible.slice(0, split)
  const reply = visible.slice(split) as TextItem[]
  return (
    <Transcript.Assistant streaming={streaming}>
      {work.length > 0 && (
        <Transcript.Work {...workSummary(work, streaming)} running={streaming}>
          <WorkItems items={work} live={live} />
        </Transcript.Work>
      )}
      {reply.map(item => (
        <Markdown key={item.id} streaming={streaming}>
          {item.text}
        </Markdown>
      ))}
    </Transcript.Assistant>
  )
}

function UserTurn({ item }: { item: UserItem }) {
  const images = Array.from({ length: item.attachments }, (_, i) => (
    <Transcript.Attachment key={i} kind="image" name={`Image ${i + 1}`} />
  ))
  return (
    <Transcript.User attachments={images.length ? images : undefined}>
      <span className="whitespace-pre-wrap">{item.text}</span>
    </Transcript.User>
  )
}

function turns(items: Item[]) {
  const out: Item[][] = []
  for (const item of items) {
    const last = out.at(-1)
    if (item.kind !== 'user' && last && last[0].kind !== 'user') last.push(item)
    else out.push([item])
  }
  return out
}

export function SessionTranscript({ model, footer }: { model: SessionModel; footer?: ReactNode }) {
  const draft: TextItem[] = model.draft ? [{ kind: 'text', id: 'draft', text: model.draft }] : []
  const groups = turns([...model.turns, ...draft])
  const running = model.status === 'running'
  const live: Live = { running: running || model.status === 'waiting', waiting: new Set(model.pending.map(p => p.toolUseId)) }
  const tasks = model.todos.length > 0 && <Transcript.TaskList items={model.todos} />
  const last = groups.at(-1)?.[0]
  return (
    <Transcript footer={tasks || footer ? <>{tasks}{footer}</> : undefined}>
      {groups.map((group, i) =>
        group[0].kind === 'user' ? (
          <UserTurn key={group[0].id} item={group[0]} />
        ) : (
          <AssistantTurn key={group[0].id} items={group} streaming={running && i === groups.length - 1} live={live} />
        ),
      )}
      {running && (!last || last.kind === 'user') && <Transcript.Working />}
    </Transcript>
  )
}

interface Question {
  question: string
  header?: string
  options?: { label: string; description?: string; preview?: string }[]
  multiSelect?: boolean
}

function Questions({ pending: { requestId, input }, respond }: { pending: Pending; respond: (line: string) => void }) {
  const questions = (Array.isArray(input.questions) ? input.questions : []) as Question[]
  const [given, setGiven] = useState<string[]>([])
  const q = questions[given.length]
  if (!q) return null
  const tag = questions.length > 1 ? `${q.header ?? 'Question'} · ${given.length + 1}/${questions.length}` : q.header
  return (
    <AgentPrompt.Question
      key={given.length}
      question={q.question}
      tag={tag}
      options={q.options ?? []}
      multiSelect={q.multiSelect}
      onSubmit={(labels, other) => {
        const own = other.trim()
        const all = [...given, q.multiSelect ? [...labels, own].filter(Boolean).join(', ') : own || (labels[0] ?? '')]
        if (all.length < questions.length) return setGiven(all)
        respond(answer(requestId, input, Object.fromEntries(questions.map((each, i) => [each.question, all[i]]))))
      }}
    />
  )
}

const suggestedMode = (suggestions: unknown[] = []) =>
  (suggestions.find(s => (s as { type?: string })?.type === 'setMode') as { mode: PermissionMode } | undefined)?.mode

export function PendingPrompt({ pending, respond }: { pending: Pending; respond: (line: string) => void }) {
  const { requestId, input, tool } = pending
  if (pending.kind === 'question') return <Questions key={requestId} pending={pending} respond={respond} />
  if (pending.kind === 'plan')
    return (
      <AgentPrompt.Plan
        onDecide={(decision, feedback) => {
          if (decision === 'keep-planning') return respond(deny(requestId, feedback.trim() || 'Keep planning.'))
          respond(allow(requestId))
          respond(setPermissionMode(decision === 'auto' ? 'acceptEdits' : 'default'))
        }}
      >
        <Markdown>{str(input.plan) ?? ''}</Markdown>
      </AgentPrompt.Plan>
    )
  const change = edit(tool, input)
  const mode = suggestedMode(pending.suggestions)
  return (
    <AgentPrompt.Permission
      tool={tool}
      command={summarize(input) || clip(JSON.stringify(input, null, 2))}
      detail={change && <Diff lineNumbers={false} patch={change.patch} />}
      rule={mode === 'acceptEdits' ? 'edits' : undefined}
      hint={pending.description ?? null}
      onAnswer={decision => {
        if (decision === 'deny') return respond(deny(requestId, 'Denied by the user.'))
        respond(allow(requestId))
        if (decision === 'always' && mode) respond(setPermissionMode(mode))
      }}
    />
  )
}
