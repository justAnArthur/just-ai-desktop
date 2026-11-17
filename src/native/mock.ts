import type { ProfileInfo, SessionExit, SessionLine, SessionSummary } from './commands'
import { SESSION_EXIT, SESSION_LINE } from './commands'
import stream from './fixtures/stream.jsonl?raw'

interface Context {
  emit(event: string, payload: unknown): void
}

const profiles: ProfileInfo[] = [
  {
    configDir: '~/.claude',
    signedIn: true,
    email: 'ada@example.com',
    displayName: 'Ada',
    organizationName: 'Ada Lovelace',
    organizationType: 'claude_max',
    rateLimitTier: 'default_claude_max_20x',
  },
  {
    configDir: '~/.claude-work',
    signedIn: true,
    email: 'ada@acme.example.com',
    displayName: 'Ada',
    organizationName: 'Acme',
    organizationType: 'claude_team',
    rateLimitTier: 'default_claude_max_5x',
    defaultModel: 'opus',
  },
  { configDir: '~/.claude-local', signedIn: false, baseUrl: 'http://localhost:4000' },
]

const lines = stream.trim().split('\n')
const fixtureSession: string = JSON.parse(lines[0]).session_id
// SessionStart hooks run as soon as the CLI starts; everything else waits for the first user message.
const startup = lines.filter(line => line.includes('"subtype":"hook_'))
const turn = lines.filter(line => !startup.includes(line))
const followUp = turn.filter(line => !line.includes('"subtype":"init"'))

const now = Date.now()
const hour = 3_600_000

const sessions: SessionSummary[] = [
  { id: 'a1f0c3d2-0000-4000-8000-000000000001', cwd: '/Users/you/projects/demo', title: 'Fix the login redirect loop', updated: now - hour / 4, gitBranch: 'main' },
  { id: 'a1f0c3d2-0000-4000-8000-000000000002', cwd: '/Users/you/projects/demo', title: 'Add dark mode to settings', updated: now - 3 * hour, gitBranch: 'feat/dark-mode' },
  { id: 'a1f0c3d2-0000-4000-8000-000000000003', cwd: '/Users/you/projects/api', title: 'Why is the users query slow?', updated: now - 26 * hour, gitBranch: 'main' },
  { id: 'a1f0c3d2-0000-4000-8000-000000000004', cwd: '/Users/you/notes', title: 'Summarize this week', updated: now - 72 * hour },
]

function transcript(sessionId: string) {
  const base = { isSidechain: false, userType: 'external', cwd: '/Users/you/projects/demo', sessionId, version: '2.1.325', gitBranch: 'main', entrypoint: 'cli' }
  const at = (s: number) => new Date(now - hour + s * 1000).toISOString()
  return [
    { type: 'queue-operation', operation: 'enqueue', timestamp: at(0), sessionId },
    { ...base, parentUuid: null, uuid: 'u1', timestamp: at(0), type: 'user', message: { role: 'user', content: 'What does `bun run check` do here?' } },
    {
      ...base,
      parentUuid: 'u1',
      uuid: 'a1',
      timestamp: at(2),
      type: 'assistant',
      message: { id: 'msg_01', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content: [{ type: 'tool_use', id: 'toolu_01', name: 'Read', input: { file_path: '/Users/you/projects/demo/package.json' } }], stop_reason: 'tool_use' },
    },
    {
      ...base,
      parentUuid: 'a1',
      uuid: 'u2',
      timestamp: at(3),
      type: 'user',
      message: { role: 'user', content: [{ tool_use_id: 'toolu_01', type: 'tool_result', content: '{ "scripts": { "check": "tsc -p . --noEmit" } }' }] },
      toolUseResult: { type: 'text', file: { filePath: '/Users/you/projects/demo/package.json', numLines: 1 } },
    },
    {
      ...base,
      parentUuid: 'u2',
      uuid: 'a2',
      timestamp: at(5),
      type: 'assistant',
      message: { id: 'msg_02', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content: [{ type: 'text', text: 'It typechecks the project with `tsc --noEmit`.' }], stop_reason: 'end_turn' },
    },
    { type: 'custom-title', customTitle: 'What does bun run check do', sessionId },
  ].map(entry => JSON.stringify(entry))
}

const live = new Map<string, { session: string; turns: number; timers: ReturnType<typeof setTimeout>[] }>()

function replay(key: string, script: string[], emit: Context['emit'], spread: number) {
  const run = live.get(key)
  if (!run) return
  script.forEach((line, i) => {
    const timer = setTimeout(() => {
      emit(SESSION_LINE, { key, line: line.replaceAll(fixtureSession, run.session) } satisfies SessionLine)
    }, ((i + 1) * spread) / script.length)
    run.timers.push(timer)
  })
}

function stop(key: string) {
  const run = live.get(key)
  run?.timers.forEach(clearTimeout)
  live.delete(key)
  return run
}

export const mockCommands = {
  list_profiles: ({ extra = [] }: { extra?: string[] } = {}) => [
    ...profiles,
    ...extra.map(configDir => ({ configDir, signedIn: false })),
  ],

  session_start({ key }: { key: string }, { emit }: Context) {
    if (live.has(key)) throw new Error(`session ${key} is already running`)
    live.set(key, { session: crypto.randomUUID(), turns: 0, timers: [] })
    replay(key, startup, emit, 300)
  },

  session_write({ key, line }: { key: string; line: string }, { emit }: Context) {
    const run = live.get(key)
    if (!run) throw new Error(`session ${key} is not running`)
    const message = JSON.parse(line)
    if (message.type === 'control_request') {
      if (message.request.subtype === 'interrupt') run.timers.splice(0).forEach(clearTimeout)
      const response = { type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response: {} } }
      emit(SESSION_LINE, { key, line: JSON.stringify(response) } satisfies SessionLine)
      return
    }
    if (message.type !== 'user') return
    replay(key, run.turns++ === 0 ? turn : followUp, emit, 2000)
  },

  session_kill({ key }: { key: string }, { emit }: Context) {
    if (!stop(key)) throw new Error(`session ${key} is not running`)
    setTimeout(() => emit(SESSION_EXIT, { key, code: null, stderr: '' } satisfies SessionExit), 50)
  },

  session_running: () => [...live.keys()],

  list_sessions: ({ limit = 200 }: { configDir: string; limit?: number }) => sessions.slice(0, limit),

  read_transcript({ sessionId }: { configDir: string; sessionId: string }) {
    if (!sessions.some(s => s.id === sessionId)) throw new Error(`no transcript for session ${sessionId}`)
    return transcript(sessionId)
  },
}
