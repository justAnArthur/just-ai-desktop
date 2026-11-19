import type { ClaudeCommands } from '@just-apps/claude-code'
import { commands, type Host } from '@just-apps/host-contract'
import type { PaneChange } from '@justanarthur/modo-ui-ai'

/**
 * A work tree's state. A file changed in both the index and the work tree is one unstaged change whose patch runs from HEAD.
 * Only the first 200 changes carry a patch, each cut to 200 KB.
 */
export interface GitStatus {
  /** Absent on a detached HEAD. */
  branch?: string
  upstream?: string
  ahead: number
  behind: number
  changes: PaneChange[]
}

// A type alias, not an interface: `CommandMap` needs the implicit index signature only aliases get.
export type NativeCommands = ClaudeCommands & {
  git_status: { args: { cwd: string }; result: GitStatus }
  git_stage: { args: { cwd: string; paths: string[] }; result: void }
  git_unstage: { args: { cwd: string; paths: string[] }; result: void }
  /** Reverts the work tree only: tracked files go back to the index, untracked ones are deleted. */
  git_discard: { args: { cwd: string; paths: string[] }; result: void }
  /** Commits the index; resolves to the new commit's short sha. */
  git_commit: { args: { cwd: string; message: string }; result: string }
  /** Local branch names, the current one first. */
  git_branches: { args: { cwd: string }; result: string[] }
}

export const native = (host: Host) => commands<NativeCommands>(host)
