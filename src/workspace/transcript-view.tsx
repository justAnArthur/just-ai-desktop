import { Button, Code, Diff, Markdown } from '@justanarthur/modo-ui'
import { AgentPrompt, Transcript } from '@justanarthur/modo-ui-ai'
import { memo, type ReactNode, useMemo, useState } from 'react'
import { allow, answer, deny, type PermissionUpdate, setPermissionMode } from '@just-apps/claude-code'
import type { CompactItem, Item, Pending, SessionModel, TextItem, ToolCall, UserItem } from '@just-apps/claude-code'
import { duration, isAgent, plural, summarize } from '../panes'

const MAX_LINES = 40
const MAX_CHARS = 4000

interface Live {
  running: boolean
  waiting: Set<string>
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
const lines = (s: string) => (s ? s.split('\n') : [])

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

export function WorkItems({ items, live }: { items: Item[]; live: Live }) {
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

interface AssistantTurnProps {
  items: Item[]
  streaming: boolean
  live: Live
}

const sameItems = (a: Item[], b: Item[]) => a.length === b.length && a.every((item, i) => item === b[i])

// Memoized, with reduce() keeping unchanged items identical: a new line re-renders only the turn it touches.
const AssistantTurn = memo(function AssistantTurn({ items, streaming, live }: AssistantTurnProps) {
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
},
(a, b) => a.streaming === b.streaming && a.live === b.live && sameItems(a.items, b.items))

const UserTurn = memo(function UserTurn({ item }: { item: UserItem }) {
  // `src` (an image's thumbnail) is read by the kit's Attachment from its next release; this one shows the chip alone.
  const chips = item.attachments.map((a, i) => {
    const props = { kind: a.kind, name: a.name, src: a.src }
    return <Transcript.Attachment key={i} {...props} />
  })
  return (
    <Transcript.User attachments={chips.length ? chips : undefined}>
      <span className="whitespace-pre-wrap">{item.text}</span>
    </Transcript.User>
  )
})

/** A compaction: the kit's divider, opening to the summary the session went on from. */
const Compacted = memo(function Compacted({ item }: { item: CompactItem }) {
  return item.summary ? <Transcript.Compact summary={item.summary} /> : <Transcript.Working label="Summarizing" />
})

/** Items that stand alone between turns, not part of an assistant's. */
const standalone = (item: Item) => item.kind === 'user' || item.kind === 'compact' || item.kind === 'interrupted'

function turns(items: Item[]) {
  const out: Item[][] = []
  for (const item of items) {
    const last = out.at(-1)
    if (!standalone(item) && last && !standalone(last[0])) last.push(item)
    else out.push([item])
  }
  return out
}

function Group({ group, streaming, live }: { group: Item[]; streaming: boolean; live: Live }) {
  const [first] = group
  if (first.kind === 'user') return <UserTurn item={first} />
  if (first.kind === 'compact') return <Compacted item={first} />
  if (first.kind === 'interrupted') return <Transcript.Notice>Interrupted</Transcript.Notice>
  return <AssistantTurn items={group} streaming={streaming} live={unsettled(group) ? live : SETTLED} />
}

/** Top-level items a transcript mounts from its end, and per "Show earlier": each mounted turn slows every later render and layout. */
const TAIL_ITEMS = 200

/** Where the last groups holding at least `items` items start. */
function tailStart(groups: Item[][], items: number) {
  let start = groups.length
  for (let n = 0; start > 0 && n < items; ) n += groups[--start].length
  return start
}

const SETTLED: Live = { running: false, waiting: new Set() }

/** A tool still without a result: its status follows the session's. */
const unsettled = (items: Item[]): boolean => items.some(i => i.kind === 'tool' && (i.result === undefined || unsettled(i.children)))

/** Turns per memoized block: a new line re-renders its block alone, where each memoized turn would cost React a walk up the tree. */
const BLOCK = 50

interface BlockProps {
  groups: Item[][]
  /** The block holds the streaming last turn. */
  streaming: boolean
  live: Live
}

const sameGroups = (a: Item[][], b: Item[][]) => a.length === b.length && a.every((group, i) => sameItems(group, b[i]))

const Block = memo(function Block({ groups, streaming, live }: BlockProps) {
  // The kit's turns skip layout off-screen themselves (content-visibility), since modo-ui-ai 0.5.
  return groups.map((group, i) => <Group key={group[0].id} group={group} streaming={streaming && i === groups.length - 1} live={live} />)
},
(a, b) => a.streaming === b.streaming && a.live === b.live && sameGroups(a.groups, b.groups))

export function SessionTranscript({ model, footer }: { model: SessionModel; footer?: ReactNode }) {
  const draft: TextItem[] = model.draft ? [{ kind: 'text', id: 'draft', text: model.draft }] : []
  const groups = turns([...model.turns, ...draft])
  const running = model.status === 'running'
  const busy = running || model.status === 'waiting'
  const waiting = model.pending.map(p => p.toolUseId).join('\n')
  const live = useMemo<Live>(() => ({ running: busy, waiting: new Set(waiting.split('\n')) }), [busy, waiting])
  // The first group shown, fixed once known: a window sliding with each new turn would shift what you read.
  const [first, setFirst] = useState<string>()
  const auto = tailStart(groups, TAIL_ITEMS)
  if (first === undefined && groups.length) setFirst(groups[auto][0].id)
  const at = groups.findIndex(g => g[0].id === first)
  const start = at === -1 ? auto : at
  // Blocks are cut at fixed indexes, so "Show earlier" fills the first and keeps the rest.
  const blocks: number[] = []
  for (let i = start; i < groups.length; i = (Math.floor(i / BLOCK) + 1) * BLOCK) blocks.push(i)
  const tasks = model.todos.length > 0 && <Transcript.TaskList items={model.todos} />
  const last = groups.at(-1)?.[0]
  return (
    <Transcript className="select-text" footer={tasks || footer ? <>{tasks}{footer}</> : undefined}>
      {start > 0 && (
        <Button variant="ghost" size="compact" className="self-center" onClick={() => setFirst(groups[tailStart(groups.slice(0, start), TAIL_ITEMS)][0].id)}>
          Show earlier turns
        </Button>
      )}
      {blocks.map((from, i) => {
        const to = blocks[i + 1] ?? groups.length
        return <Block key={Math.floor(from / BLOCK)} groups={groups.slice(from, to)} streaming={running && to === groups.length} live={live} />
      })}
      {running && (!last || standalone(last)) && <Transcript.Working label={model.compacting ? 'Compacting the conversation' : undefined} />}
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

/** What "Always allow" adds, as its button names it: `Bash(npm test)`, or `edits` for the accept-edits mode. */
function ruleOf(suggestions: PermissionUpdate[]) {
  const rules = suggestions.flatMap(s => (s.type === 'addRules' ? s.rules : []))
  if (rules.length) return rules.map(r => (r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName)).join(', ')
  if (suggestions.some(s => s.type === 'setMode' && s.mode === 'acceptEdits')) return 'edits'
}

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
  const suggestions = pending.suggestions ?? []
  const mode = suggestions.find(s => s.type === 'setMode')?.mode
  return (
    <AgentPrompt.Permission
      tool={tool}
      command={summarize(input) || clip(JSON.stringify(input, null, 2))}
      detail={change && <Diff lineNumbers={false} patch={change.patch} />}
      rule={ruleOf(suggestions)}
      hint={pending.description ?? null}
      onAnswer={decision => {
        if (decision === 'deny') return respond(deny(requestId, 'Denied by the user.'))
        if (decision === 'once') return respond(allow(requestId))
        respond(allow(requestId, undefined, suggestions))
        if (mode) respond(setPermissionMode(mode))
      }}
    />
  )
}
