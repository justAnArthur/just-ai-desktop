import type { PaneChange, PaneTask } from '@justanarthur/modo-ui-ai'
import type { Item, SessionModel, ToolCall } from './engine/session'

const TOUCHING = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Bash'])

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

/** A git patch from its first hunk: the Diff block reads `diff --git`, `index` and mode lines as context. A patch without hunks (a rename, a binary) stays whole. */
export function hunks(patch: string) {
  const at = patch.search(/^@@ /m)
  return at > 0 ? patch.slice(at) : patch
}
