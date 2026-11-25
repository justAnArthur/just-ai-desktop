// What a mock session asks mid-turn, in the CLI's stream-json shapes: a message naming `mock:<kind>` (`mock:bash mock:plan`)
// gets the assistant's tool calls and a `can_use_tool` control request for each, all pending at once, and goes on as each is answered.

interface Ask {
  tool: string
  input: Record<string, unknown>
  description?: string
  suggestions?: object[]
  /** The tool's output once allowed. */
  output: string
}

const plan = [
  '# Plan: split the session store',
  '',
  'The store holds every transcript in one map; this splits it per profile.',
  '',
  ...Array.from({ length: 24 }, (_, i) => [
    `## Step ${i + 1}: ${['Read', 'Move', 'Rename', 'Test'][i % 4]} the ${['store', 'reducer', 'sidebar', 'listing'][i % 4]}`,
    '',
    `- Change \`src/store/part-${i}.ts\` so it keeps only its own profile's sessions.`,
    `- Update the ${i + 2} callers and their tests.`,
    i % 6 === 0 ? '\n```ts\nexport const store = new Map<string, Session[]>()\n```\n' : '',
  ]).flat(),
  '## Risks',
  '',
  'A session moved between profiles shows twice until both lists are re-read.',
].join('\n')

const longCommand = [
  "find . -type f \\( -name '*.ts' -o -name '*.tsx' \\) -not -path './node_modules/*' -not -path './dist/*' -print0",
  "| xargs -0 grep -l 'useSessions' | while read -r f; do echo \"== $f\"; sed -n '1,40p' \"$f\" | grep -n 'import' || true; done",
  "&& bunx tsc --noEmit -p . && bun test --coverage --reporter=junit --reporter-outfile=./tmp/junit.xml 2>&1 | tee ./tmp/test-output-with-a-very-long-file-name.log",
].join(' ')

const option = (label: string, description: string) => ({ label, description })

export const ASKS: Record<string, Ask> = {
  bash: {
    tool: 'Bash',
    input: { command: 'bun test --filter auth', description: 'Run the auth tests' },
    description: 'Run the auth tests',
    suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'bun test:*' }], behavior: 'allow', destination: 'localSettings' }],
    output: '12 pass\n0 fail\nRan 12 tests across 3 files. [412ms]',
  },
  longbash: {
    tool: 'Bash',
    input: { command: `${longCommand}\ncat <<'EOF' > ./tmp/notes.md\n${Array.from({ length: 60 }, (_, i) => `line ${i + 1} of the notes`).join('\n')}\nEOF`, description: 'Find the callers, type-check and run every test with coverage, then write the notes file' },
    description: 'Find the callers, type-check and run every test with coverage, then write the notes file',
    suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'find:*' }], behavior: 'allow', destination: 'localSettings' }],
    output: Array.from({ length: 400 }, (_, i) => `== ./src/file-${i}.ts\n3:import { useSessions } from './use-sessions'`).join('\n'),
  },
  edit: {
    tool: 'Edit',
    input: {
      file_path: '/Users/you/projects/demo/src/auth/redirect.ts',
      old_string: "  const next = url.searchParams.get('next') ?? '/'\n  return session(request) ? next : `/login?next=${next}`",
      new_string: "  const next = url.searchParams.get('next')\n  const safe = next?.startsWith('/') && !next.startsWith('//') ? next : '/'\n  return session(request) ? safe : `/login?next=${encodeURIComponent(safe)}`",
    },
    description: 'redirect.ts',
    suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }],
    output: 'The file /Users/you/projects/demo/src/auth/redirect.ts has been updated.',
  },
  mcp: {
    tool: 'mcp__github__create_issue',
    input: { owner: 'you', repo: 'demo', title: 'Login redirect loops when signed out', body: 'Steps:\n1. Sign out\n2. Open /settings\n3. The page loops between /login and /settings', labels: ['bug', 'auth'] },
    suggestions: [{ type: 'addRules', rules: [{ toolName: 'mcp__github__create_issue' }], behavior: 'allow', destination: 'localSettings' }],
    output: 'Created issue #42',
  },
  question: {
    tool: 'AskUserQuestion',
    input: {
      questions: [
        { question: 'Should the file be named a.txt or b.txt?', header: 'File name', options: [option('a.txt', 'Write the file as a.txt containing hi'), option('b.txt', 'Write the file as b.txt containing hi')], multiSelect: false },
      ],
    },
    output: '',
  },
  multi: {
    tool: 'AskUserQuestion',
    input: {
      questions: [
        {
          question: 'Which checks should run before each commit?',
          header: 'Checks',
          options: [option('Type-check', 'tsc --noEmit'), option('Lint', 'biome check'), option('Unit tests', 'bun test'), option('E2E', 'Playwright, about two minutes')],
          multiSelect: true,
        },
      ],
    },
    output: '',
  },
  questions: {
    tool: 'AskUserQuestion',
    input: {
      questions: [
        { question: 'Where should the session store live?', header: 'Store', options: [option('Per profile', 'One map per profile'), option('One map', 'Keep it as it is')], multiSelect: false },
        { question: 'Which tests should I add?', header: 'Tests', options: [option('Reducer', 'Unit tests for the reducer'), option('E2E', 'A Playwright flow')], multiSelect: true },
      ],
    },
    output: '',
  },
  longquestion: {
    tool: 'AskUserQuestion',
    input: {
      questions: [
        {
          question:
            'The listing re-reads every transcript on each focus, which takes seconds with 800 sessions across four profiles: how should it decide what to re-read, given that the CLI writes transcripts without telling us?',
          header: 'Re-reading transcripts on focus',
          options: [
            option('Compare file modification times and re-read only the transcripts that changed since the last listing', 'Cheap: one stat per file, but a clock change or a copied transcript can hide an update until the next full listing'),
            option('Watch every profile’s projects folder with a file-system watcher and re-read on each change event as it arrives', 'Instant, but macOS FSEvents can coalesce or drop events under load, so it still needs a periodic full listing as a fallback'),
            option('Keep the full re-read on focus but move it to a background thread so the window never stalls while it runs', 'Simplest change; costs the same CPU and disk as today, only off the main thread, and the list still updates late'),
            option('Only re-read the sessions currently visible in the sidebar and the one that is open, and lazily the rest when scrolled into view', 'Fast for the common case, but the inbox and notifications could miss a session that changed while it was off-screen'),
          ],
          multiSelect: false,
        },
      ],
    },
    output: '',
  },
  plan: { tool: 'ExitPlanMode', input: { plan }, output: '' },
}

/** The tool's output for an allowed ask, as the CLI reports it. */
export function outputOf(ask: Ask, updatedInput?: Record<string, unknown>) {
  if (ask.tool === 'ExitPlanMode') return 'User has approved your plan. You can now start coding.'
  if (ask.tool !== 'AskUserQuestion') return ask.output
  const answers = Object.entries((updatedInput?.answers ?? {}) as Record<string, string>)
  return `Your questions have been answered: ${answers.map(([q, a]) => `"${q}"="${a}"`).join(', ')}. You can now continue with these answers in mind.`
}
