import type { CanUseTool, Line } from '@just-apps/claude-code'
import { summarize } from './panes'

const firstLine = (text: string) => text.trim().split('\n')[0].slice(0, 120)

/** A notification's body for a stream line that ends a turn or starts a wait; none for any other line. */
export function noticeOf(line: Line): string | undefined {
  if (line.type === 'result') {
    if (!line.is_error) return 'Finished'
    return `Failed: ${firstLine(line.result || line.errors?.join('\n') || line.subtype)}`
  }
  if (line.type !== 'control_request' || !('tool_name' in line.request)) return
  const { tool_name, input } = line.request as CanUseTool
  if (tool_name === 'ExitPlanMode') return 'Needs you: a plan to review'
  if (tool_name === 'AskUserQuestion') {
    const [first] = (Array.isArray(input.questions) ? input.questions : []) as { question?: string }[]
    return `Needs you: ${first?.question ? firstLine(first.question) : 'a question'}`
  }
  const summary = summarize(input)
  return `Needs you: ${tool_name}${summary ? ` · ${firstLine(summary)}` : ''}`
}

interface NotifierOptions {
  send(id: string, body: string): void
  /** Asked when a notice is due: whether the user should hear about this session now. */
  wanted(id: string): boolean
  /** Notices of one session this close together come as the last one. */
  delay?: number
  /** After the user answers a session, its notices stay quiet this long. */
  quiet?: number
  now?: () => number
}

export function createNotifier({ send, wanted, delay = 1000, quiet = 5000, now = Date.now }: NotifierOptions) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const answeredAt = new Map<string, number>()
  const cancel = (id: string) => {
    clearTimeout(timers.get(id))
    timers.delete(id)
  }
  return {
    push(id: string, body: string) {
      if (now() - (answeredAt.get(id) ?? -Infinity) < quiet) return
      cancel(id)
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id)
          if (wanted(id)) send(id, body)
        }, delay),
      )
    },
    answered(id: string) {
      answeredAt.set(id, now())
      cancel(id)
    },
  }
}
