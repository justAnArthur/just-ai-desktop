import type { PaneChange, PaneTask } from '@justanarthur/modo-ui-ai'
import type { Item, SessionModel, ToolCall } from '@just-apps/claude-code'

const TOUCHING = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Bash'])
const SUMMARY_KEYS = ['command', 'file_path', 'notebook_path', 'pattern', 'path', 'url', 'query', 'skill', 'description', 'prompt']

/** A tool call's command, path or query in full: what a permission prompt shows, every line of it. */
export const subjectOf = (input: Record<string, unknown>) =>
  SUMMARY_KEYS.map(k => input[k]).find((v): v is string => typeof v === 'string' && v !== '')

/** A tool call's input in one line: its command, path or query. */
export const summarize = (input: Record<string, unknown>) => subjectOf(input)?.split('\n')[0] ?? ''

/** A tool's name as shown: an MCP tool's `mcp__server__tool` as `server · tool`. */
export const toolLabel = (name: string) => (name.startsWith('mcp__') ? name.slice(5).split('__').join(' · ') : name)

export const isAgent = (t: ToolCall) => t.name === 'Agent' || t.name === 'Task'

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function duration(ms: number) {
  const s = Math.max(1, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

const tools = (items: Item[]): ToolCall[] => items.flatMap(i => (i.kind === 'tool' ? [i, ...tools(i.children)] : []))

export const busy = (model: SessionModel) => model.status === 'running' || model.status === 'waiting'

/** How many tool calls that may change the work tree have finished: a change in it means git status may have moved. */
export const touches = (model: SessionModel) => tools(model.turns).filter(t => TOUCHING.has(t.name) && t.result !== undefined).length

/**
 * The session's sub-agent runs, newest first. A background run (`run_in_background`) is left out:
 * its tool result only says it started, and the model has nothing on how it ends.
 */
export function tasksOf(model: SessionModel): PaneTask[] {
  const live = busy(model)
  return tools(model.turns)
    .filter(t => isAgent(t) && t.input.run_in_background !== true)
    .map((t): PaneTask => {
      const type = typeof t.input.subagent_type === 'string' ? t.input.subagent_type : 'agent'
      const used = t.children.filter(i => i.kind === 'tool').length
      return {
        id: t.id,
        title: typeof t.input.description === 'string' ? t.input.description : 'Sub-agent',
        kind: 'agent',
        status: t.isError ? 'failed' : t.result !== undefined ? 'done' : live ? 'running' : 'stopped',
        detail: [type, plural(used, 'tool use'), t.durationMs && duration(t.durationMs)].filter(Boolean).join(' · '),
      }
    })
    .reverse()
}

export const sameChanges = (a: PaneChange[], b: PaneChange[]) =>
  a.length === b.length &&
  a.every((c, i) => c.path === b[i].path && c.staged === b[i].staged && c.status === b[i].status && c.patch === b[i].patch)
