import type { PaneChange } from '@justanarthur/modo-ui-ai'
import { AUTH_EXIT, AUTH_LINE, type AuthExit, type AuthLine, type AuthStatus, type ProfileInfo } from '@just-apps/claude-code'
import { SESSION_EXIT, SESSION_LINE, type SessionExit, type SessionLine, type SessionSummary } from '@just-apps/claude-code'
import type { GitStatus } from './commands'
import image from './fixtures/image.png.b64?raw'
import stream from './fixtures/stream.jsonl?raw'

interface Context {
  emit(event: string, payload: unknown): void
}

let profiles: ProfileInfo[] = [
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
  { configDir: '~/.claude-personal', signedIn: false },
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

const SUMMARY = `This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

<system-reminder>
<tools-used-before-summary>Read, Edit</tools-used-before-summary>
</system-reminder>
Summary:
1. Primary Request and Intent:
   Add a dark mode toggle to the settings screen.
2. Files touched:
   - \`src/settings/appearance.tsx\`: the toggle
3. Pending: wire the toggle to the theme store.`

/** A session with a pasted image, an interrupted turn and a /compact, as a transcript records them. */
function compacted(sessionId: string) {
  const base = { isSidechain: false, userType: 'external', cwd: '/Users/you/projects/demo', sessionId, gitBranch: 'feat/dark-mode' }
  const at = (s: number) => new Date(now - 3 * hour + s * 1000).toISOString()
  const reply = (uuid: string, s: number, text: string) => ({
    ...base,
    uuid,
    timestamp: at(s),
    type: 'assistant',
    message: { id: `msg_${uuid}`, role: 'assistant', model: 'claude-opus-4-5', content: [{ type: 'text', text }] },
  })
  return [
    {
      ...base,
      uuid: 'u1',
      timestamp: at(0),
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image.trim() } },
          { type: 'text', text: 'Add dark mode to settings, like in this mockup.' },
        ],
      },
    },
    reply('a1', 4, 'I added a **Dark mode** switch under Appearance.'),
    { ...base, uuid: 'u2', timestamp: at(10), type: 'user', message: { role: 'user', content: 'Now make it follow the system theme too.' } },
    { ...base, uuid: 'u3', timestamp: at(12), type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } },
    { ...base, uuid: 'u4', timestamp: at(20), type: 'user', message: { role: 'user', content: '<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>' } },
    { ...base, type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', uuid: 'b1', timestamp: at(30) },
    { ...base, uuid: 'u5', timestamp: at(30), type: 'user', isCompactSummary: true, isVisibleInTranscriptOnly: true, message: { role: 'user', content: SUMMARY } },
    { ...base, uuid: 'u6', timestamp: at(31), type: 'user', message: { role: 'user', content: '<local-command-stdout>Compacted </local-command-stdout>' } },
    { ...base, uuid: 'u7', timestamp: at(40), type: 'user', message: { role: 'user', content: 'Where were we?' } },
    reply('a2', 44, 'The switch is in place; next is wiring it to the theme store.'),
  ].map(entry => JSON.stringify(entry))
}

const mode = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('mock')
// `?mock=heavy`: the load of real use — 4 profiles × 200 sessions over 40 projects, and long transcripts.
const heavy = mode === 'heavy'
// `?mock=not-installed`: no `claude` on PATH.
const NOT_FOUND = 'claude not found on PATH'
const claude = () => {
  if (mode === 'not-installed') throw new Error(NOT_FOUND)
}

const heavyProfiles: ProfileInfo[] = ['~/.claude', '~/.claude-a', '~/.claude-b', '~/.claude-c'].map((configDir, i) => ({
  configDir,
  signedIn: true,
  email: `user${i}@example.com`,
  displayName: `User ${i}`,
  organizationName: `Org ${i}`,
  organizationType: 'claude_max',
}))

// 40 folders as real use has them: long names, nested worktrees, and the Claude desktop app's and the OS's throwaway folders.
const heavyProjects = [
  ...Array.from({ length: 24 }, (_, i) => `/Users/you/projects/project-${i}`),
  '/Users/you/Projects/justanarthur/just-apps/apps/ai-desktop',
  '/Users/you/Projects/justanarthur/modo/.worktrees/kit-ux-review',
  '/Users/you/Projects/acme-corporation/customer-onboarding-service-with-a-really-long-name',
  '/Users/you/Projects/acme-corporation/ui',
  '/Users/you/Projects/other-org/ui',
  '/Users/you/Library/Application Support/Claude/scratch-workspaces/scratch-2026-11-24-e0b2a3',
  '/Users/you/Library/Application Support/Claude/scratch-workspaces/scratch-2026-11-23-9f1c07',
  '/Users/you/Library/Application Support/Claude-Work/scratch-workspaces/scratch-2026-11-20-41aa2e',
  '/private/tmp/claude-501/repro',
  '/private/var/folders/xy/abc123/T/tmp.k3j2',
  '/var/folders/xy/abc123/T/bun-test-run',
  '/tmp/quick-check',
  '/Users/you/notes',
  '/Users/you/Desktop/untitled folder',
  '/Users/you/Documents/Ünïcode-名前-folder',
  '/Users/you',
]

const heavySessions = (configDir: string): SessionSummary[] =>
  Array.from({ length: 200 }, (_, i) => {
    const p = heavyProfiles.findIndex(x => x.configDir === configDir)
    const n = p * 200 + i
    return {
      id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      cwd: heavyProjects[(n * 7) % heavyProjects.length],
      title: `Session ${n}: refactor the thing number ${n % 13} and check the tests`,
      updated: now - n * 600_000,
      gitBranch: n % 3 ? 'main' : `feat/branch-${n % 11}`,
    }
  })

function heavyTranscript(sessionId: string, turns = 300) {
  const base = { isSidechain: false, userType: 'external', cwd: '/Users/you/projects/project-0', sessionId, gitBranch: 'main' }
  const at = (s: number) => new Date(now - 10 * hour + s * 1000).toISOString()
  const out: object[] = []
  const reply = (t: number) =>
    `## Turn ${t}\n\nI changed **three** files and ran the tests:\n\n- \`src/a.ts\`: guard the empty case\n- \`src/b.ts\`: rename \`foo\` to \`bar\`\n\n\`\`\`ts\nexport function f(x: number) {\n  return x * ${t}\n}\n\`\`\`\n\nAll ${t} tests pass.`
  for (let t = 0; t < turns; t++) {
    const s = t * 60
    out.push({ ...base, uuid: `u${t}`, timestamp: at(s), type: 'user', message: { role: 'user', content: `Please do step ${t} of the plan and run the tests.` } })
    const tools = Array.from({ length: 5 }, (_, k) => ({
      type: 'tool_use',
      id: `toolu_${t}_${k}`,
      name: ['Bash', 'Read', 'Edit', 'Grep', 'Bash'][k],
      input: k === 2 ? { file_path: '/Users/you/projects/project-0/src/a.ts', old_string: 'a\nb\nc', new_string: 'a\nB\nc\nd' } : { command: `bun test --filter step-${t}-${k}`, file_path: `/x/${k}.ts` },
    }))
    out.push({
      ...base,
      uuid: `a${t}`,
      timestamp: at(s + 1),
      type: 'assistant',
      message: { id: `msg_${t}`, role: 'assistant', model: 'claude-opus-4-5', content: [{ type: 'thinking', thinking: `Thinking about step ${t}.` }, ...tools] },
    })
    out.push({
      ...base,
      uuid: `r${t}`,
      timestamp: at(s + 20),
      type: 'user',
      message: { role: 'user', content: tools.map(tool => ({ type: 'tool_result', tool_use_id: tool.id, content: Array.from({ length: 30 }, (_, l) => `line ${l} of output for ${tool.id}`).join('\n') })) },
    })
    out.push({ ...base, uuid: `b${t}`, timestamp: at(s + 30), type: 'assistant', message: { id: `msg_b${t}`, role: 'assistant', model: 'claude-opus-4-5', content: [{ type: 'text', text: reply(t) }] } })
  }
  return out.map(entry => JSON.stringify(entry))
}

let changes: PaneChange[] = [
  {
    path: 'src/auth/redirect.ts',
    status: 'modified',
    staged: true,
    patch: `diff --git a/src/auth/redirect.ts b/src/auth/redirect.ts
index 3f2a1c4..8b0d9e7 100644
--- a/src/auth/redirect.ts
+++ b/src/auth/redirect.ts
@@ -4,9 +4,12 @@ import { session } from './session'
 export function nextUrl(request: Request) {
   const url = new URL(request.url)
-  const next = url.searchParams.get('next') ?? '/'
-  return session(request) ? next : \`/login?next=\${next}\`
+  const next = url.searchParams.get('next')
+  // Only same-origin paths: an absolute URL here is an open redirect.
+  const safe = next?.startsWith('/') && !next.startsWith('//') ? next : '/'
+  if (url.pathname === '/login') return session(request) ? safe : null
+  return session(request) ? safe : \`/login?next=\${encodeURIComponent(safe)}\`
 }
`,
  },
  {
    path: 'src/auth/redirect.test.ts',
    status: 'added',
    staged: false,
    patch: `diff --git a/src/auth/redirect.test.ts b/src/auth/redirect.test.ts
new file mode 100644
index 0000000..5d1e2a9
--- /dev/null
+++ b/src/auth/redirect.test.ts
@@ -0,0 +1,11 @@
+import { expect, test } from 'bun:test'
+import { nextUrl } from './redirect'
+
+test('stays on /login when signed out', () => {
+  expect(nextUrl(new Request('https://demo.test/login?next=/login'))).toBeNull()
+})
+
+test('drops absolute next urls', () => {
+  const request = new Request('https://demo.test/settings?next=https://evil.test')
+  expect(nextUrl(request)).toBe('/login?next=%2F')
+})
`,
  },
  {
    path: 'src/routes/login.tsx',
    status: 'modified',
    staged: false,
    patch: `diff --git a/src/routes/login.tsx b/src/routes/login.tsx
index a41c0de..c7e93b2 100644
--- a/src/routes/login.tsx
+++ b/src/routes/login.tsx
@@ -12,7 +12,8 @@ export default function Login() {
   const [params] = useSearchParams()
   const navigate = useNavigate()
   const onSignedIn = () => {
-    navigate(params.get('next') ?? '/')
+    const next = nextUrl(new Request(location.href))
+    if (next) navigate(next)
   }
   return <SignInForm onSignedIn={onSignedIn} />
 }
`,
  },
  {
    path: 'src/auth/legacy-redirect.ts',
    status: 'deleted',
    staged: false,
    patch: `diff --git a/src/auth/legacy-redirect.ts b/src/auth/legacy-redirect.ts
deleted file mode 100644
index 9e4b7a1..0000000
--- a/src/auth/legacy-redirect.ts
+++ /dev/null
@@ -1,4 +0,0 @@
-// Kept for the v1 login page.
-export function legacyRedirect(next: string) {
-  return \`/login?next=\${next}\`
-}
`,
  },
]
let ahead = 1

const live = new Map<string, { session: string; turns: number; timers: ReturnType<typeof setTimeout>[]; bypass: boolean; mode: string }>()

function replay(key: string, script: string[], emit: Context['emit'], spread: number) {
  const run = live.get(key)
  if (!run) return
  const turn = run.turns
  script.forEach((line, i) => {
    const timer = setTimeout(() => {
      // Each turn replays the same fixture: its tool ids would repeat in one transcript.
      const fresh = line
        .replaceAll(fixtureSession, run.session)
        .replace(/toolu_\w+/g, id => `${id}_${turn}`)
        .replace(/"permissionMode":"\w+"/, `"permissionMode":"${run.mode}"`)
      emit(SESSION_LINE, { key, line: fresh } satisfies SessionLine)
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

/** The sign-ins running, by config dir: each waits for its pasted code. */
const logins = new Map<string, { timers: ReturnType<typeof setTimeout>[] }>()
const SIGN_IN_URL = 'https://claude.com/cai/oauth/authorize?code=true&client_id=mock&state=mock'

const profileAt = (configDir: string) => (heavy ? heavyProfiles : profiles).find(p => p.configDir === configDir)

function endLogin(configDir: string, code: number | null, emit: Context['emit']) {
  logins.get(configDir)?.timers.forEach(clearTimeout)
  logins.delete(configDir)
  emit(AUTH_EXIT, { configDir, code } satisfies AuthExit)
}

export const mockCommands = {
  list_profiles: ({ extra = [] }: { extra?: string[] } = {}) => [
    ...(heavy ? heavyProfiles : profiles),
    ...extra.filter(dir => !profileAt(dir)).map(configDir => ({ configDir, signedIn: false })),
  ],

  create_profile_dir({ configDir }: { configDir: string }) {
    if (!configDir.startsWith('~/') && !configDir.startsWith('/')) throw new Error(`not a full path: ${configDir}`)
    return configDir.replace(/\/+$/, '').replace(/^~/, '/Users/you')
  },

  auth_status({ configDir }: { configDir: string }): AuthStatus {
    claude()
    const p = profileAt(configDir)
    if (!p?.signedIn) return { loggedIn: false, authMethod: 'none' }
    return { loggedIn: true, authMethod: 'claude.ai', email: p.email, orgName: p.organizationName, subscriptionType: p.organizationType?.replace('claude_', '') }
  },

  auth_login({ configDir }: { configDir: string; method?: string; email?: string }, { emit }: Context) {
    claude()
    if (logins.has(configDir)) throw new Error(`a sign-in for ${configDir} is already running`)
    const send = (line: string, stream: AuthLine['stream'] = 'stdout') => emit(AUTH_LINE, { configDir, line, stream } satisfies AuthLine)
    const timers = [
      setTimeout(() => send('Opening browser to sign in…'), 200),
      setTimeout(() => send(`If the browser didn't open, visit: ${SIGN_IN_URL}`), 400),
    ]
    logins.set(configDir, { timers })
  },

  auth_write({ configDir, line }: { configDir: string; line: string }, { emit }: Context) {
    if (!logins.has(configDir)) throw new Error('no sign-in is running')
    const send = (text: string, stream: AuthLine['stream']) => emit(AUTH_LINE, { configDir, line: text, stream } satisfies AuthLine)
    if (!line.includes('#')) return send('Invalid code. Please make sure the full code was copied.', 'stderr')
    if (line.startsWith('bad')) {
      send('Login failed: Request failed with status code 400', 'stderr')
      return endLogin(configDir, 1, emit)
    }
    const account = { configDir, signedIn: true, email: 'ada@new.example.com', displayName: 'Ada', organizationName: 'New', organizationType: 'claude_pro' }
    profiles = profileAt(configDir) ? profiles.map(p => (p.configDir === configDir ? { ...p, ...account } : p)) : [...profiles, account]
    send('Paste code here if prompted > Login successful.', 'stdout')
    endLogin(configDir, 0, emit)
  },

  auth_cancel({ configDir }: { configDir: string }, { emit }: Context) {
    if (!logins.has(configDir)) throw new Error('no sign-in is running')
    endLogin(configDir, null, emit)
  },

  desktop_archived_sessions() {
    return []
  },

  auth_usage({ configDir }: { configDir: string }) {
    claude()
    if (!profileAt(configDir)?.signedIn) return 'Total cost: $0.0000'
    return 'Current session: 34% used · resets 6pm (Europe/Prague)\nCurrent week (all models): 12% used · resets Nov 24 at 2am (Europe/Prague)'
  },

  auth_logout({ configDir }: { configDir: string }) {
    claude()
    profiles = profiles.map(p => (p.configDir === configDir ? { configDir: p.configDir, signedIn: false, defaultModel: p.defaultModel } : p))
  },

  // The mock lists one set of sessions for every profile, so a copy has nothing to add.
  copy_session({ sessionId }: { fromConfigDir: string; toConfigDir: string; sessionId: string }) {
    if (!heavy && !sessions.some(s => s.id === sessionId)) throw new Error(`no transcript for session ${sessionId}`)
  },

  set_session_title({ sessionId, title }: { configDir: string; sessionId: string; title: string }) {
    const session = sessions.find(s => s.id === sessionId)
    if (!session) throw new Error(`no transcript for session ${sessionId}`)
    // An e2e test reads the titles written by defining this array first.
    ;(globalThis as { titleWrites?: { sessionId: string; title: string }[] }).titleWrites?.push({ sessionId, title })
    session.title = title
  },

  session_start({ key, args }: { key: string; args: string[] }, { emit }: Context) {
    claude()
    if (live.has(key)) throw new Error(`session ${key} is already running`)
    const bypass = args.includes('--allow-dangerously-skip-permissions') || args.includes('--dangerously-skip-permissions')
    const at = args.indexOf('--permission-mode')
    live.set(key, { session: crypto.randomUUID(), turns: 0, timers: [], bypass, mode: at === -1 ? 'default' : args[at + 1] })
    replay(key, startup, emit, 300)
  },

  session_write({ key, line }: { key: string; line: string }, { emit }: Context) {
    const run = live.get(key)
    if (!run) throw new Error(`session ${key} is not running`)
    // An e2e test reads what the app wrote by defining this array first.
    ;(globalThis as { sessionWrites?: SessionLine[] }).sessionWrites?.push({ key, line })
    const message = JSON.parse(line)
    const send = (line: object) => emit(SESSION_LINE, { key, line: JSON.stringify(line) } satisfies SessionLine)
    if (message.type === 'control_request') {
      const { subtype, mode } = message.request
      if (subtype === 'interrupt') run.timers.splice(0).forEach(clearTimeout)
      // As the CLI answers: bypass only for a process started to allow it.
      if (subtype === 'set_permission_mode' && mode === 'bypassPermissions' && !run.bypass) {
        const error = 'Cannot set permission mode to bypassPermissions because the session was not launched with --dangerously-skip-permissions'
        return send({ type: 'control_response', response: { subtype: 'error', request_id: message.request_id, error } })
      }
      send({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response: {} } })
      if (subtype === 'set_permission_mode') {
        run.mode = mode
        send({ type: 'system', subtype: 'status', status: null, permissionMode: mode })
      }
      return
    }
    if (message.type !== 'user') return
    if (message.message.content === '/compact') {
      const lines = [
        { type: 'system', subtype: 'status', status: 'compacting' },
        { type: 'system', subtype: 'status', status: null, compact_result: 'success' },
        { type: 'system', subtype: 'compact_boundary', uuid: crypto.randomUUID(), compact_metadata: { trigger: 'manual' } },
        { type: 'user', message: { role: 'user', content: SUMMARY }, parent_tool_use_id: null, uuid: crypto.randomUUID(), isSynthetic: true },
        { type: 'user', message: { role: 'user', content: '<local-command-stdout>Compacted </local-command-stdout>' }, parent_tool_use_id: null, uuid: crypto.randomUUID(), isReplay: true },
        { type: 'result', subtype: 'success', is_error: false, duration_ms: 0, num_turns: 0, session_id: run.session, usage: { input_tokens: 0, output_tokens: 0 } },
      ]
      return replay(key, lines.map(line => JSON.stringify(line)), emit, 2500)
    }
    replay(key, run.turns++ === 0 ? turn : followUp, emit, 2000)
  },

  session_kill({ key }: { key: string }, { emit }: Context) {
    if (!stop(key)) throw new Error(`session ${key} is not running`)
    setTimeout(() => emit(SESSION_EXIT, { key, code: null, stderr: '' } satisfies SessionExit), 50)
  },

  session_running: () => [...live.keys()],

  list_sessions: ({ configDir, limit = 200 }: { configDir: string; limit?: number }) =>
    (heavy ? heavySessions(configDir) : sessions).slice(0, limit),

  read_transcript({ sessionId }: { configDir: string; sessionId: string }) {
    if (heavy) return heavyTranscript(sessionId)
    if (!sessions.some(s => s.id === sessionId)) throw new Error(`no transcript for session ${sessionId}`)
    return sessionId === sessions[1].id ? compacted(sessionId) : transcript(sessionId)
  },

  git_status({ cwd }: { cwd: string }): GitStatus {
    if (cwd === '/Users/you/notes') throw new Error(`fatal: not a git repository (or any of the parent directories): .git`)
    return { branch: 'main', upstream: 'origin/main', ahead, behind: 0, changes }
  },

  git_stage({ paths }: { cwd: string; paths: string[] }) {
    changes = changes.map(c => (paths.includes(c.path) ? { ...c, staged: true } : c))
  },

  git_unstage({ paths }: { cwd: string; paths: string[] }) {
    changes = changes.map(c => (paths.includes(c.path) ? { ...c, staged: false } : c))
  },

  git_discard({ paths }: { cwd: string; paths: string[] }) {
    changes = changes.filter(c => c.staged || !paths.includes(c.path))
  },

  git_commit({ message }: { cwd: string; message: string }) {
    if (!message.trim()) throw new Error('Aborting commit due to empty commit message.')
    if (!changes.some(c => c.staged)) throw new Error('nothing added to commit')
    changes = changes.filter(c => !c.staged)
    ahead++
    return crypto.randomUUID().replaceAll('-', '').slice(0, 7)
  },

  git_branches: (_: { cwd: string }) => ['main', 'feat/dark-mode', 'fix/login-redirect'],
}
