import type { InboxItem, Session, SessionGroup, SessionStatus, UsageLimit } from '@justanarthur/modo-ui-ai'
import { duration } from '@justanarthur/modo-ui-ai/lib/pace'
import type { RateLimitInfo } from './engine/protocol'
import type { SessionModel } from './engine/session'

/** A session on disk or started here: where it runs and under which profile. */
export interface Entry {
  id: string
  profileId: string
  configDir: string
  cwd: string
  title?: string
  /** ms since epoch. */
  updated: number
  gitBranch?: string
}

export interface Section {
  label: string
  ids: string[]
}

export type Windows = NonNullable<RateLimitInfo['unifiedWindows']>

const HOUR = 3_600_000

const WINDOWS = [
  { key: 'five_hour', label: 'Session (5h)', windowHours: 5 },
  { key: 'seven_day', label: 'Weekly', windowHours: 168 },
]

export function limitsOf(windows: Windows | undefined, now = Date.now()): UsageLimit[] {
  return WINDOWS.flatMap(({ key, label, windowHours }) => {
    const window = windows?.[key]
    if (!window) return []
    const resetsInHours = (window.resetsAt * 1000 - now) / HOUR
    // Past its reset the stored share is stale: the window has started over.
    if (resetsInHours <= 0) return []
    const value = window.utilization
    return [{ label, value, detail: `${Math.round(value * 100)}% · ${duration(resetsInHours)}`, windowHours, resetsInHours }]
  })
}

export function ago(at: number, now = Date.now()) {
  const minutes = (now - at) / 60_000
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${Math.floor(minutes)}m`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`
  return `${Math.floor(minutes / 60 / 24)}d`
}

export const basename = (path: string) => path.replace(/\/+$/, '').split('/').pop() || path

export function statusOf(model: SessionModel | undefined, running: boolean, unread: boolean): SessionStatus {
  if (running && model?.status === 'waiting') return 'waiting'
  if (running && (model?.status === 'running' || model?.status === 'starting')) return 'running'
  return unread ? 'unread' : 'idle'
}

/** Newest first, one entry per id. */
export function mergeEntries(lists: Entry[][]) {
  const byId = new Map<string, Entry>()
  for (const entry of lists.flat()) {
    const seen = byId.get(entry.id)
    if (!seen || seen.updated < entry.updated) byId.set(entry.id, { ...seen, ...entry, title: entry.title ?? seen?.title })
  }
  return [...byId.values()].sort((a, b) => b.updated - a.updated)
}

/** Pinned, the user's sections, then one group per project folder in order of its latest session; archived apart. */
export function groupSessions(
  sessions: Session[],
  cwdOf: (id: string) => string,
  { pinned, archived, sections }: { pinned: string[]; archived: string[]; sections: Section[] },
) {
  const byId = new Map(sessions.map(s => [s.id, s]))
  const pick = (ids: string[]) => ids.flatMap(id => byId.get(id) ?? [])
  const placed = new Set([...pinned, ...archived, ...sections.flatMap(s => s.ids)])
  const projects = new Map<string, SessionGroup>()
  for (const session of sessions) {
    if (placed.has(session.id)) continue
    const cwd = cwdOf(session.id)
    const group = projects.get(cwd) ?? { label: basename(cwd), kind: 'project', path: cwd, sessions: [] }
    projects.set(cwd, group)
    group.sessions.push({ ...session, project: undefined })
  }
  return {
    pinned: pick(pinned).map(s => ({ ...s, pinned: true })),
    groups: [...sections.map((s): SessionGroup => ({ label: s.label, kind: 'section', sessions: pick(s.ids) })), ...projects.values()],
    archived: pick(archived),
  }
}

const command = (input: Record<string, unknown>) =>
  [input.command, input.file_path, input.path, input.url, input.pattern].find(v => typeof v === 'string') as string | undefined

/** What each session waits on, one inbox row per prompt. */
export function inboxOf(sessions: { session: Session; model?: SessionModel; at: number }[], now = Date.now()): InboxItem[] {
  return sessions.flatMap(({ session, model, at }) =>
    (model?.pending ?? []).map(p => {
      const questions = p.input.questions as { question?: string }[] | undefined
      return {
        id: p.requestId,
        kind: p.kind,
        title: p.kind === 'question' ? (questions?.[0]?.question ?? p.tool) : p.kind === 'plan' ? 'Plan to approve' : (command(p.input) ?? p.tool),
        sessionId: session.id,
        session: session.title,
        project: session.project,
        profile: session.profile,
        detail: p.kind === 'permission' ? p.tool : undefined,
        ago: Math.max(0, Math.floor((now - at) / 60_000)),
      }
    }),
  )
}
