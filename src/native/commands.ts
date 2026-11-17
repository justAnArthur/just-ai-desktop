import { commands, type Host } from '@just-apps/host-contract'
import type { PaneChange } from '@justanarthur/modo-ui-ai'

export interface ProfileInfo {
  configDir: string
  signedIn: boolean
  email?: string
  displayName?: string
  organizationName?: string
  organizationType?: string
  rateLimitTier?: string
  defaultModel?: string
  baseUrl?: string
}

export interface SessionSummary {
  id: string
  cwd: string
  title?: string
  /** File mtime, ms since epoch. */
  updated: number
  gitBranch?: string
}

/** `session://line`: one unparsed stream-json line from a live session's stdout. */
export interface SessionLine {
  key: string
  line: string
}

/** `session://exit`: the process ended; `code` is null when a signal killed it, `stderr` is its last 40 lines. */
export interface SessionExit {
  key: string
  code: number | null
  stderr: string
}

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

export const SESSION_LINE = 'session://line'
export const SESSION_EXIT = 'session://exit'

// A type alias, not an interface: `CommandMap` needs the implicit index signature only aliases get.
export type NativeCommands = {
  list_profiles: { args: { extra: string[] }; result: ProfileInfo[] }
  session_start: { args: { key: string; configDir: string; cwd: string; args: string[] }; result: void }
  session_write: { args: { key: string; line: string }; result: void }
  session_kill: { args: { key: string }; result: void }
  session_running: { args: undefined; result: string[] }
  list_sessions: { args: { configDir: string; limit?: number }; result: SessionSummary[] }
  read_transcript: { args: { configDir: string; sessionId: string }; result: string[] }
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
