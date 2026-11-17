import type { Model, PermissionMode as ModeOption, ShortcutGroup } from '@justanarthur/modo-ui-ai'
import type { PermissionMode } from '../engine/protocol'

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

export const COMPOSER = {
  models: MODELS,
  efforts: EFFORTS,
  permissionModes: MODES,
  outputStyles: ['Default'],
  commands: [],
  files: [],
}

export const modelName = (id?: string) => MODELS.find(m => m.alias && id?.includes(m.alias))?.name ?? 'Default'

export const modeLabel = (mode?: PermissionMode) => MODES.find(m => m.value === mode)?.label

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
      { label: 'Keyboard shortcuts', keys: ['⌘/'] },
    ],
  },
]
