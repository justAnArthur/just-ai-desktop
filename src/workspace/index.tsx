import { useCommand, useHost, useStore } from '@just-apps/app-kit'
import { Button, DesktopShell, DropdownContent, DropdownMenu, DropdownTrigger, Input, MenuItem } from '@justanarthur/modo-ui'
import type { InboxAction, InboxItem, PaletteItem, Profile, Project, Session, SessionGroup } from '@justanarthur/modo-ui-ai'
import Composer from '@justanarthur/modo-ui-ai/blocks/conversation/composer'
import FailureState, { type FailureKind } from '@justanarthur/modo-ui-ai/blocks/conversation/failure-states'
import CommandPalette from '@justanarthur/modo-ui-ai/blocks/dialogs/command-palette'
import ShortcutsSheet from '@justanarthur/modo-ui-ai/blocks/dialogs/shortcuts-sheet'
import SessionSidebar from '@justanarthur/modo-ui-ai/blocks/sessions/session-sidebar'
import { useIcon } from '@justanarthur/modo-ui-ai/lib/icons'
import { duration } from '@justanarthur/modo-ui-ai/lib/pace'
import { memo, useEffect, useRef, useState } from 'react'
import { allow, deny, setModel, setPermissionMode } from '@just-apps/claude-code'
import { initialSession, type SessionModel } from '@just-apps/claude-code'
import type { Attached } from '../attachments'
import { ago, basename, type Entry, groupSessions, inboxOf, statusOf } from '../sessions'
import { type Exit, NEW, type Sessions, useSessions } from '../use-sessions'
import { attach, Skipped } from './attach'
import { NewSession, type Target } from './new-session'
import { COMPOSER, commandsOf, DEFAULT_RUN, flagsOf, modelAlias, modelName, modeLabel, modeValue, type Run, runProps, SHORTCUTS } from './options'
import { PANE_TABS, type PaneTab, SessionPane } from './side-pane'
import { PendingPrompt, SessionTranscript } from './transcript-view'

/** Rows a sidebar group lists before its Show more. */
const GROUP_ROWS = 5

// The kit memoizes rows and groups, but the sidebar itself would still re-render with every stream line: re-render on changed data only.
const Sidebar = memo(SessionSidebar, (a, b) => JSON.stringify(a) === JSON.stringify(b))

/** Re-renders on each minute of the clock, so the sidebar's "5m" labels move on while nothing else happens. */
function useMinuteTick() {
  const [, setTick] = useState(0)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const next = () => {
      timer = setTimeout(() => {
        setTick(t => t + 1)
        next()
      }, 60_000 - (Date.now() % 60_000))
    }
    next()
    return () => clearTimeout(timer)
  }, [])
}

type Handlers = Record<string, (...args: never[]) => unknown>

/** Stable stand-ins for this render's callbacks, so a memoized child keeps them without going stale. */
function useStable<T extends Handlers>(handlers: T): T {
  const latest = useRef(handlers)
  latest.current = handlers
  const [stable] = useState(
    () => Object.fromEntries(Object.keys(handlers).map(k => [k, (...args: never[]) => latest.current[k](...args)])) as T,
  )
  return stable
}

const firstUserText = (model?: SessionModel) =>
  model?.turns.find(t => t.kind === 'user')?.text.split('\n')[0]?.slice(0, 80) || undefined

function failureOf(model: SessionModel): FailureKind {
  const error = model.error ?? ''
  if (/not logged in|authentication_failed/i.test(error)) return 'auth-expired'
  if (model.rateLimit?.status === 'rejected' || /rate.?limit|usage limit/i.test(error)) return 'rate-limited'
  return 'cli-crashed'
}

/**
 * The session's title as plain text, an input only while renaming: the title bar zooms the window on a double-click,
 * which must not start an edit.
 */
function SessionTitle({ title, renaming, onRename, onDone }: { title: string; renaming: boolean; onRename: (title: string) => void; onDone: () => void }) {
  // pl-2 is a compact field's text inset: renaming doesn't move the text.
  if (!renaming) return <span className="min-w-0 truncate pl-2 text-body weight-medium text-foreground">{title}</span>
  const finish = (value: string) => {
    const next = value.trim()
    if (next && next !== title) onRename(next)
    onDone()
  }
  return (
    <Input
      aria-label="Session title"
      defaultValue={title}
      size="compact"
      className="min-w-24 max-w-md"
      autoFocus
      onFocus={e => e.currentTarget.select()}
      onBlur={e => finish(e.currentTarget.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') finish(e.currentTarget.value)
        if (e.key === 'Escape') onDone()
      }}
    />
  )
}

interface SessionViewProps {
  sessions: Sessions
  entry: Entry
  profile: Profile
  model: SessionModel
  exit?: Exit
  run: Run
  onRunChange: (patch: Partial<Run>) => void
}

function SessionView({ sessions, entry, profile, model, exit, run, onRunChange }: SessionViewProps) {
  const { id } = entry
  const [loginNote, setLoginNote] = useState(false)
  const [skipped, setSkipped] = useState<string[]>([])
  const busy = sessions.running.includes(id) && (model.status === 'running' || model.status === 'waiting')
  const kind = model.status === 'failed' ? failureOf(model) : undefined
  const resetsAt = model.rateLimit?.resetsAt
  const pending = model.pending[0]
  const stderr = (exit?.stderr || model.error || '').split('\n').filter(Boolean)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {kind && (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-6 pt-3">
          <FailureState
            kind={kind}
            profile={profile}
            stderr={stderr}
            exitCode={exit ? (exit.code ?? 'signal') : undefined}
            resetsIn={resetsAt ? `in ${duration(Math.max(resetsAt * 1000 - Date.now(), 0) / 3_600_000)}` : undefined}
            onRestart={() => sessions.restart(id)}
            onLogin={() => setLoginNote(true)}
            onDismiss={() => sessions.dismiss(id)}
          />
          {kind === 'auth-expired' && loginNote && (
            <p className="m-0 text-caption text-muted-foreground">
              Run <code>CLAUDE_CONFIG_DIR={profile.configDir} claude /login</code> in a terminal, then send again.
            </p>
          )}
        </div>
      )}
      <SessionTranscript
        key={id}
        model={model}
        footer={pending && <PendingPrompt key={pending.requestId} pending={pending} respond={line => sessions.respond(id, line)} />}
      />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-6 pb-4">
        <Skipped reasons={skipped} />
        {model.refused && <p className="m-0 text-caption text-destructive">Claude Code refused: {model.refused}</p>}
        <Composer
          key={id}
          {...COMPOSER}
          commands={commandsOf(model.commands ?? sessions.profileCommands[entry.profileId])}
          compacting={model.compacting}
          {...runProps(run, onRunChange)}
          projects={[{ label: basename(entry.cwd), path: entry.cwd }]}
          project={entry.cwd}
          branches={entry.gitBranch ? [entry.gitBranch] : []}
          branch={entry.gitBranch}
          profiles={[profile]}
          profile={profile.id}
          context={model.context?.window ? model.context.tokens / model.context.window : 0}
          history={model.turns.flatMap(t => (t.kind === 'user' ? [t.text] : []))}
          status={busy ? 'streaming' : 'idle'}
          onStop={() => sessions.interrupt(id)}
          onSend={async (text, files) => {
            const attachments = await attach(text, files, setSkipped)
            if (attachments) await sessions.send(id, text, flagsOf(run), attachments)
          }}
          onCompact={() => sessions.send(id, '/compact', flagsOf(run))}
        />
      </div>
    </div>
  )
}

export default function Workspace() {
  const host = useHost()
  const sessions = useSessions()
  const { profiles, entries, models, selected, select } = sessions
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [target, setTarget] = useState<Target>({})
  const [targetKey, setTargetKey] = useState(0)
  // Picks made in a session's composer, over what its process reports.
  const [runs, setRuns] = useState<Record<string, Partial<Run>>>({})
  const [renaming, setRenaming] = useState<string>()
  const [paneOpen, setPaneOpen] = useStore('workspace.pane.open', false)
  const [paneTab, setPaneTab] = useStore<PaneTab>('workspace.pane.tab', 'changes')
  const More = useIcon('more-horizontal')
  const Pencil = useIcon('pencil')
  const Keyboard = useIcon('command')
  const Stop = useIcon('square')
  useMinuteTick()
  useCommand({ id: 'session.new', title: 'New session', shortcut: 'Mod+N', run: () => select(NEW) })

  const now = Date.now()
  const entry = entries.find(e => e.id === selected)
  const profileOf = (e: Entry) => profiles.find(p => p.id === e.profileId)
  const titleOf = (e: Entry) => sessions.titles[e.id] ?? e.title ?? firstUserText(models[e.id]) ?? 'Untitled session'

  const all: Session[] = entries.map(e => {
    const model = models[e.id]
    const done = model?.todos.filter(t => t.status === 'completed').length ?? 0
    return {
      id: e.id,
      title: titleOf(e),
      status: statusOf(model, sessions.running.includes(e.id), sessions.unread.includes(e.id)),
      profile: e.profileId,
      updated: ago(e.updated, now),
      branch: e.gitBranch,
      project: basename(e.cwd),
      tasks: model?.todos.length ? { done, total: model.todos.length } : undefined,
    }
  })
  const cwdOf = (id: string) => entries.find(e => e.id === id)?.cwd ?? ''
  const grouped = groupSessions(all, cwdOf, sessions)
  const projects: Project[] = [...new Set(entries.map(e => e.cwd))].map(path => ({ label: basename(path), path }))
  const inbox = inboxOf(
    all.filter(s => s.status === 'waiting').map(s => ({ session: s, model: models[s.id], at: entries.find(e => e.id === s.id)?.updated ?? now })),
    now,
  )
  const profile = entry && profileOf(entry)
  const model = entry ? (models[entry.id] ?? initialSession) : undefined
  const running = entry && sessions.running.includes(entry.id)

  const newSession = (next: Target) => {
    setTarget(next)
    setTargetKey(k => k + 1)
    select(NEW)
  }

  const onPick = (item: PaletteItem) => {
    if (item.kind === 'session') select(item.id)
    if (item.kind === 'shortcuts') setShortcutsOpen(true)
    if (item.kind === 'new-session') newSession({ cwd: item.project, profileId: item.profile })
    if (item.kind === 'profile') newSession({ ...target, profileId: item.id })
    if (item.kind === 'pane' && PANE_TABS.includes(item.pane as PaneTab)) {
      setPaneTab(item.pane as PaneTab)
      setPaneOpen(true)
    }
  }

  const sidebar = useStable({
    onPinnedOrderChange: sessions.reorderPinned,
    onValueChange: (id: string) => id !== 'overview' && select(id),
    onPin: sessions.pin,
    onArchive: sessions.archive,
    onRename: (id: string) => {
      select(id)
      setRenaming(id)
    },
    onMarkUnread: sessions.markUnread,
    onNewSessionIn: (group: SessionGroup) => newSession({ ...target, cwd: group.path }),
    onInboxAction: (item: InboxItem, action: InboxAction) => {
      if (action === 'open') return select(item.sessionId)
      if (action === 'allow') return sessions.respond(item.sessionId, allow(item.id))
      if (action === 'deny') return sessions.respond(item.sessionId, deny(item.id, 'Denied by the user.'))
    },
    onSearch: () => setPaletteOpen(true),
  })

  const start = ({ run, ...options }: { cwd: string; profileId: string; text: string; attachments: Attached[]; run: Run }) => {
    setTarget({ cwd: options.cwd, profileId: options.profileId })
    void sessions.start({ ...options, ...flagsOf(run) }).then(id => setRuns(all => ({ ...all, [id]: run })))
  }

  // A live process's mode is the one it reports: a switch it refused doesn't show as made.
  const runOf = (id: string, model: SessionModel): Run => {
    const run = { ...DEFAULT_RUN, model: modelName(model.model), mode: modeLabel(model.permissionMode), ...runs[id] }
    return sessions.running.includes(id) && model.permissionMode ? { ...run, mode: modeLabel(model.permissionMode) } : run
  }

  // A live process takes model and mode now; effort waits for its next start.
  const configure = (id: string, patch: Partial<Run>) => {
    const live = sessions.running.includes(id)
    const { mode: _, ...kept } = patch
    // The live mode lives in the model, from the process; a pick kept here would outlast it.
    setRuns(all => ({ ...all, [id]: { ...all[id], ...(live ? kept : patch) } }))
    if (!live) return
    if (patch.model) void sessions.respond(id, setModel(modelAlias(patch.model)))
    const mode = patch.mode && modeValue(patch.mode)
    if (mode) void sessions.respond(id, setPermissionMode(mode))
  }

  return (
    <DesktopShell
      titleBar="card"
      platform={host.kind === 'tauri' && host.os.platform === 'macos' ? 'mac' : 'linux'}
      leftLabel="Sessions sidebar"
      rightOpen={paneOpen}
      onRightOpenChange={setPaneOpen}
      title={
        entry && profile && model ? (
          <>
            <SessionTitle
              key={entry.id}
              title={titleOf(entry)}
              renaming={renaming === entry.id}
              onRename={title => sessions.rename(entry.id, title)}
              onDone={() => setRenaming(undefined)}
            />
            <span className="hidden shrink-0 text-caption text-muted-foreground @2xl:inline">
              {profile.name} · {model.model ?? profile.defaultModel}
            </span>
          </>
        ) : (
          <span className="text-body weight-medium text-foreground">New session</span>
        )
      }
      trailing={
        <>
          <ShortcutsSheet groups={SHORTCUTS} open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
          <CommandPalette
            sessions={[...all.filter(s => !sessions.archived.includes(s.id)), ...grouped.archived]}
            projects={projects}
            profiles={profiles}
            commands={[]}
            panes={PANE_TABS}
            settings={[]}
            searchTranscripts={false}
            manageProfiles={false}
            profile={entry?.profileId ?? target.profileId ?? sessions.defaultId ?? undefined}
            project={entry?.cwd ?? target.cwd}
            onSelect={onPick}
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
            trigger={null}
          />
          <DropdownMenu>
            <DropdownTrigger
              render={
                <Button variant="ghost" size="icon-compact" aria-label="Session options">
                  <More />
                </Button>
              }
            />
            <DropdownContent align="end" sideOffset={4} className="w-60 min-w-0">
              {entry && <MenuItem index={0} icon={Pencil} label="Rename" onSelect={() => setRenaming(entry.id)} />}
              <MenuItem index={1} icon={Keyboard} label="Keyboard shortcuts" onSelect={() => setShortcutsOpen(true)} />
              {running && <MenuItem index={2} icon={Stop} label="End the claude process" onSelect={() => sessions.kill(entry.id)} />}
            </DropdownContent>
          </DropdownMenu>
        </>
      }
      left={
        <Sidebar
          {...grouped}
          groupLimit={GROUP_ROWS}
          {...sidebar}
          profiles={profiles}
          value={entry ? entry.id : NEW}
          inbox={inbox}
        />
      }
      right={
        entry &&
        model && (
          <SessionPane
            cwd={entry.cwd}
            model={model}
            live={sessions.running.includes(entry.id)}
            open={paneOpen}
            tab={paneTab}
            onTabChange={setPaneTab}
            onClose={() => setPaneOpen(false)}
            onAsk={text => sessions.send(entry.id, text, flagsOf(runOf(entry.id, model)))}
            onInterrupt={() => sessions.interrupt(entry.id)}
          />
        )
      }
      main={
        entry && profile && model ? (
          <SessionView
            sessions={sessions}
            entry={entry}
            profile={profile}
            model={model}
            exit={sessions.exits[entry.id]}
            run={runOf(entry.id, model)}
            onRunChange={patch => configure(entry.id, patch)}
          />
        ) : (
          <NewSession
            key={targetKey}
            projects={projects}
            profiles={profiles}
            commands={sessions.profileCommands}
            target={{ cwd: target.cwd, profileId: target.profileId ?? sessions.defaultId ?? undefined }}
            onTargetChange={setTarget}
            onStart={start}
          />
        )
      }
    />
  )
}
