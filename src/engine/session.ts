import { attachedName, type ContentBlock, type Line, type PermissionMode, type PermissionUpdate, type RateLimitInfo, type ToolResultBlock, type Usage } from './protocol'

export type Status = 'starting' | 'running' | 'waiting' | 'idle' | 'failed'

export interface UserAttachment { kind: 'image' | 'file'; name: string }
export interface UserItem { kind: 'user'; id: string; text: string; attachments: UserAttachment[] }
export interface TextItem { kind: 'text'; id: string; text: string }
export interface ThinkingItem { kind: 'thinking'; id: string; text: string }
export interface ToolCall {
  kind: 'tool'
  id: string
  name: string
  input: Record<string, unknown>
  result?: string
  isError?: boolean
  startedAt?: number
  durationMs?: number
  children: Item[]
}
export type Item = UserItem | TextItem | ThinkingItem | ToolCall

export interface Todo { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm?: string }

export interface Pending {
  kind: 'permission' | 'question' | 'plan'
  requestId: string
  toolUseId: string
  tool: string
  input: Record<string, unknown>
  suggestions?: PermissionUpdate[]
  description?: string
}

export interface LastResult { costUsd?: number; durationMs: number; isError: boolean; numTurns: number; usage: Usage }

export interface SessionModel {
  sessionId?: string
  model?: string
  cwd?: string
  permissionMode?: PermissionMode
  status: Status
  turns: Item[]
  todos: Todo[]
  pending: Pending[]
  draft: string
  lastResult?: LastResult
  context?: { tokens: number; window?: number }
  rateLimit?: RateLimitInfo
  /** From `system/init`: what the composer's commands list offers. */
  commands?: Commands
  compacting?: boolean
  error?: string
}

export interface Commands {
  slash: string[]
  skills: string[]
}

export const initialSession: SessionModel = { status: 'starting', turns: [], todos: [], pending: [], draft: '' }

const pendingKinds: Record<string, Pending['kind']> = { AskUserQuestion: 'question', ExitPlanMode: 'plan' }

function parse(line: unknown) {
  if (typeof line !== 'string') return line
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

const time = (iso?: string) => (iso ? Date.parse(iso) : undefined)

const text = (content: ToolResultBlock['content']) =>
  typeof content === 'string' ? content : (content ?? []).flatMap(b => (b.type === 'text' ? [b.text] : [])).join('\n')

// From the end, stopping at the match: results land on recent tools, and every other item stays as it is.
function updateTool(items: Item[], id: string, f: (tool: ToolCall) => ToolCall): Item[] {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.kind !== 'tool') continue
    let next: ToolCall = item
    if (item.id === id) next = f(item)
    else {
      const children = updateTool(item.children, id, f)
      if (children !== item.children) next = { ...item, children }
    }
    if (next === item) continue
    const copy = items.slice()
    copy[i] = next
    return copy
  }
  return items
}

function append(items: Item[], parent: string | null, added: Item[]) {
  if (!added.length) return items
  const nested = parent ? updateTool(items, parent, t => ({ ...t, children: [...t.children, ...added] })) : items
  return nested !== items ? nested : [...items, ...added]
}

function attachmentsOf(blocks: ContentBlock[]) {
  let images = 0
  return blocks.flatMap((b): UserAttachment[] => {
    if (b.type === 'image') return [{ kind: 'image', name: `Image ${++images}` }]
    if (b.type === 'document') return [{ kind: 'file', name: b.title ?? 'Document' }]
    const name = b.type === 'text' && attachedName(b.text)
    return name ? [{ kind: 'file', name }] : []
  })
}

const activity = (pending: Pending[]): Status => (pending.length ? 'waiting' : 'running')

export function reduce(model: SessionModel, raw: unknown): SessionModel {
  const line = parse(raw) as Line | undefined
  if (!line || typeof line !== 'object') return model

  switch (line.type) {
    case 'system':
      if (line.subtype === 'init') {
        const { session_id, cwd, model: name, permissionMode, slash_commands = [], skills = [] } = line
        return {
          ...model,
          sessionId: session_id,
          cwd,
          model: name,
          permissionMode,
          commands: { slash: slash_commands, skills },
          status: model.status === 'starting' ? 'idle' : model.status,
        }
      }
      if (line.subtype === 'status')
        return { ...model, compacting: line.status === 'compacting', permissionMode: line.permissionMode ?? model.permissionMode }
      return model

    case 'user': {
      const { content } = line.message
      const blocks: ContentBlock[] = typeof content === 'string' ? [{ type: 'text', text: content }] : content
      const results = blocks.filter(b => b.type === 'tool_result')
      if (results.length) {
        const at = time(line.timestamp)
        const turns = results.reduce(
          (items, r) =>
            updateTool(items, r.tool_use_id, t => ({
              ...t,
              result: text(r.content),
              isError: r.is_error || undefined,
              durationMs: at && t.startedAt ? at - t.startedAt : undefined,
            })),
          model.turns,
        )
        return { ...model, turns }
      }
      if (line.parent_tool_use_id) return model
      const item: UserItem = {
        kind: 'user',
        id: line.uuid ?? `user-${model.turns.length}`,
        text: blocks.flatMap(b => (b.type === 'text' && !attachedName(b.text) ? [b.text] : [])).join('\n'),
        attachments: attachmentsOf(blocks),
      }
      return { ...model, turns: [...model.turns, item], status: 'running', error: undefined, draft: '' }
    }

    case 'assistant': {
      const { message, parent_tool_use_id: parent } = line
      const base = line.uuid ?? `${message.id}-${model.turns.length}`
      const startedAt = time(line.timestamp)
      let todos = model.todos
      const added = message.content.flatMap((b, i): Item[] => {
        const id = `${base}-${i}`
        if (b.type === 'text') return [{ kind: 'text', id, text: b.text }]
        if (b.type === 'thinking') return [{ kind: 'thinking', id, text: b.thinking }]
        if (b.type !== 'tool_use') return []
        if (b.name === 'TodoWrite' && Array.isArray(b.input.todos)) todos = b.input.todos as Todo[]
        return [{ kind: 'tool', id: b.id, name: b.name, input: b.input, startedAt, children: [] }]
      })
      const usage = !parent && message.usage
      return {
        ...model,
        model: message.model === '<synthetic>' ? model.model : message.model,
        turns: append(model.turns, parent, added),
        todos,
        draft: parent ? model.draft : '',
        status: activity(model.pending),
        error: line.error ? text(message.content) || line.error : model.error,
        context: usage
          ? { ...model.context, tokens: usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) }
          : model.context,
      }
    }

    case 'stream_event': {
      const { delta } = line.event
      if (line.parent_tool_use_id || delta?.type !== 'text_delta') return model
      return { ...model, draft: model.draft + (delta.text ?? ''), status: activity(model.pending) }
    }

    case 'result': {
      const window = model.model ? line.modelUsage?.[model.model]?.contextWindow : undefined
      return {
        ...model,
        status: line.is_error ? 'failed' : 'idle',
        pending: [],
        compacting: false,
        draft: '',
        error: line.is_error ? line.result || line.errors?.join('\n') || line.subtype : model.error,
        lastResult: { costUsd: line.total_cost_usd, durationMs: line.duration_ms, isError: line.is_error, numTurns: line.num_turns, usage: line.usage },
        context: model.context && window ? { ...model.context, window } : model.context,
      }
    }

    case 'rate_limit_event':
      return { ...model, rateLimit: line.rate_limit_info }

    case 'control_request': {
      const { request } = line
      if (!('tool_name' in request)) return model
      const pending: Pending = {
        kind: pendingKinds[request.tool_name] ?? 'permission',
        requestId: line.request_id,
        toolUseId: request.tool_use_id,
        tool: request.tool_name,
        input: request.input,
        suggestions: request.permission_suggestions,
        description: request.description ?? request.decision_reason,
      }
      return { ...model, pending: [...model.pending, pending], status: 'waiting' }
    }

    case 'control_cancel_request':
    case 'control_response': {
      const id = line.type === 'control_response' ? line.response.request_id : line.request_id
      const pending = model.pending.filter(p => p.requestId !== id)
      if (pending.length === model.pending.length) return model
      return { ...model, pending, status: activity(pending) }
    }
  }
  return model
}

interface TranscriptEntry {
  type: string
  message?: { content: unknown }
  sessionId?: string
  cwd?: string
  permissionMode?: PermissionMode
  uuid?: string
  timestamp?: string
  isSidechain?: boolean
  isMeta?: boolean
  isCompactSummary?: boolean
  isApiErrorMessage?: boolean
}

// Harness-injected user entries (<task-notification>, <system-reminder>, <command-name>…) are not things the user typed.
const injected = (e: TranscriptEntry) => e.type === 'user' && typeof e.message?.content === 'string' && e.message.content.startsWith('<')

export function fromTranscript(lines: string[]): SessionModel {
  let model: SessionModel = { ...initialSession, status: 'idle' }
  for (const raw of lines) {
    const e = parse(raw) as TranscriptEntry | undefined
    if (!e || (e.type !== 'user' && e.type !== 'assistant') || !e.message) continue
    if (e.isSidechain || e.isMeta || e.isCompactSummary || injected(e)) continue
    model = reduce(model, {
      type: e.type,
      message: e.message,
      parent_tool_use_id: null,
      uuid: e.uuid,
      timestamp: e.timestamp,
      ...(e.isApiErrorMessage && { error: 'api_error' }),
    })
    model = { ...model, sessionId: e.sessionId ?? model.sessionId, cwd: e.cwd ?? model.cwd, permissionMode: e.permissionMode ?? model.permissionMode }
  }
  return { ...model, status: 'idle', pending: [], draft: '' }
}

/**
 * Whether a live process can be stopped for idling: its turn is over and nothing waits on it.
 * A background tool in the last turn may still be running inside the process, so that keeps it.
 */
export function canStop(model: SessionModel) {
  if ((model.status !== 'idle' && model.status !== 'failed') || model.pending.length) return false
  const last = model.turns.slice(model.turns.findLastIndex(i => i.kind === 'user') + 1)
  return !last.some(i => i.kind === 'tool' && i.input.run_in_background === true)
}
