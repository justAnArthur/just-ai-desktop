import { commands, type Host } from '@just-apps/host-contract'

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
}

export const native = (host: Host) => commands<NativeCommands>(host)
