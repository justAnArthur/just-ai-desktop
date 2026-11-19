import type { Command, Model, PermissionMode as ModeOption, ShortcutGroup } from '@justanarthur/modo-ui-ai'
import { ACCEPT } from '../attachments'
import type { PermissionMode } from '@just-apps/claude-code'
import type { Commands } from '@just-apps/claude-code'

/** The composer's models; `alias` is what `--model` takes. */
export const MODELS: (Model & { alias?: string })[] = [
  { name: 'Default', note: "The profile's default" },
  { name: 'Opus', note: 'Most capable', alias: 'opus' },
  { name: 'Sonnet', note: 'Fast and capable', alias: 'sonnet' },
  { name: 'Haiku', note: 'Fastest, lightest', alias: 'haiku' },
]

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

export const MODES: (ModeOption & { value: PermissionMode })[] = [
  { label: 'Ask before edits', note: 'Asks before every edit and command', icon: 'shield-check', value: 'default' },
  { label: 'Accept edits', note: 'Edits freely, asks before commands', icon: 'pen-line', value: 'acceptEdits' },
  { label: 'Plan mode', note: 'Reads and plans, changes nothing', icon: 'list-checks', value: 'plan' },
  { label: 'Bypass permissions', note: 'Never asks; for sandboxes only', icon: 'triangle-alert', value: 'bypassPermissions' },
]

// Sessions run in place (no worktrees) and take no fast mode or output style, so the composer leaves those controls out
// (`fastMode` and a lone style from the modo-ui-ai release after 0.6.0; until then fast stays pinned off). A composer
// mounts per session: `autoFocus` puts the caret in it as a session opens and as the first message starts one.
export const COMPOSER = {
  models: MODELS,
  efforts: EFFORTS,
  permissionModes: MODES,
  outputStyles: ['Default'],
  fastMode: false,
  fast: false,
  onFastChange: () => {},
  files: [],
  accept: ACCEPT,
  maxFiles: 10,
  defaultWorktree: false,
  targetOptions: { worktree: false, baseBranch: false, setupScript: false },
  textareaProps: { autoFocus: true },
}

/** The composer's commands from a session's `system/init`: skills apart from the other slash commands. */
export const commandsOf = (commands?: Commands): Command[] => [
  ...(commands?.slash ?? []).filter(name => !commands?.skills.includes(name)).map(name => ({ name: `/${name}`, description: '', kind: 'command' as const })),
  ...(commands?.skills ?? []).map(name => ({ name: `/${name}`, description: '', kind: 'skill' as const })),
]

export const modelName = (id?: string) => MODELS.find(m => m.alias && id?.includes(m.alias))?.name ?? 'Default'

export const modeLabel = (mode?: PermissionMode) => MODES.find(m => m.value === mode)?.label ?? MODES[0].label

/** A session's run settings as the composer shows them: model and mode by name. */
export interface Run {
  model: string
  effort: string
  mode: string
}

export const DEFAULT_RUN: Run = { model: MODELS[0].name, effort: EFFORTS[Math.floor(EFFORTS.length / 2)], mode: MODES[0].label }

export const modelAlias = (name: string) => MODELS.find(m => m.name === name)?.alias

export const modeValue = (label: string) => MODES.find(m => m.label === label)?.value

/** What `--model`, `--permission-mode` and `--effort` take. */
export const flagsOf = (run: Run) => ({ model: modelAlias(run.model), mode: modeValue(run.mode), effort: run.effort })

/** The composer's controlled run props over `run`, each change as a patch. */
export const runProps = (run: Run, change: (patch: Partial<Run>) => void) => ({
  model: run.model,
  onModelChange: (model: string) => change({ model }),
  effort: run.effort,
  onEffortChange: (effort: string) => change({ effort }),
  permissionMode: run.mode,
  onPermissionModeChange: (mode: string) => change({ mode }),
})

export const SHORTCUTS: ShortcutGroup[] = [
  {
    label: 'Sessions',
    shortcuts: [
      { label: 'New session', keys: ['⌘N'] },
      { label: 'Search sessions and commands', keys: ['⌘K'] },
    ],
  },
  {
    label: 'Window',
    shortcuts: [
      { label: 'Fold the sessions sidebar', keys: ['['] },
      { label: 'Fold the side pane', keys: [']'] },
      { label: 'Keyboard shortcuts', keys: ['⌘/'] },
    ],
  },
]
