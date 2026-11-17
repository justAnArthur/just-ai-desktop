import { useCommand, useHost } from '@just-apps/app-kit'
import { Button, DesktopShell, DropdownContent, DropdownMenu, DropdownTrigger, EditableText, MenuItem } from '@justanarthur/modo-ui'
import type { PaletteItem, Profile, Project, Session } from '@justanarthur/modo-ui-ai'
import Composer from '@justanarthur/modo-ui-ai/blocks/conversation/composer'
import FailureState, { type FailureKind } from '@justanarthur/modo-ui-ai/blocks/conversation/failure-states'
import CommandPalette from '@justanarthur/modo-ui-ai/blocks/dialogs/command-palette'
import ShortcutsSheet from '@justanarthur/modo-ui-ai/blocks/dialogs/shortcuts-sheet'
import SessionSidebar from '@justanarthur/modo-ui-ai/blocks/sessions/session-sidebar'
import { useIcon } from '@justanarthur/modo-ui-ai/lib/icons'
import { duration } from '@justanarthur/modo-ui-ai/lib/pace'
import { useState } from 'react'
import { allow, deny } from '../engine/protocol'
import { initialSession, type SessionModel } from '../engine/session'
import { ago, basename, type Entry, groupSessions, inboxOf, statusOf } from '../sessions'
import { type Exit, NEW, type Sessions, useSessions } from '../use-sessions'
import { NewSession, type Target } from './new-session'
import { COMPOSER, modelName, modeLabel, SHORTCUTS } from './options'
import { PendingPrompt, SessionTranscript } from './transcript-view'

const firstUserText = (model?: SessionModel) =>
  model?.turns.find(t => t.kind === 'user')?.text.split('\n')[0]?.slice(0, 80) || undefined

function failureOf(model: SessionModel): FailureKind {
  const error = model.error ?? ''
  if (/not logged in|authentication_failed/i.test(error)) return 'auth-expired'
  if (model.rateLimit?.status === 'rejected' || /rate.?limit|usage limit/i.test(error)) return 'rate-limited'
  return 'cli-crashed'
}

interface SessionViewProps {
  sessions: Sessions
  entry: Entry
  profile: Profile
  model: SessionModel
  exit?: Exit
}

function SessionView({ sessions, entry, profile, model, exit }: SessionViewProps) {
  const { id } = entry
  const [loginNote, setLoginNote] = useState(false)
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
        model={model}
        footer={pending && <PendingPrompt key={pending.requestId} pending={pending} respond={line => sessions.respond(id, line)} />}
      />
      <div className="mx-auto w-full max-w-3xl px-6 pb-4">
        <Composer
          key={id}
          {...COMPOSER}
          projects={[{ label: basename(entry.cwd), path: entry.cwd }]}
          branches={entry.gitBranch ? [entry.gitBranch] : []}
          branch={entry.gitBranch}
          profiles={[profile]}
          defaultProfile={profile.id}
          defaultModel={modelName(model.model)}
          defaultPermissionMode={modeLabel(model.permissionMode)}
          context={model.context?.window ? model.context.tokens / model.context.window : 0}
          history={model.turns.flatMap(t => (t.kind === 'user' ? [t.text] : []))}
          status={busy ? 'streaming' : 'idle'}
          onStop={() => sessions.interrupt(id)}
          onSend={text => sessions.send(id, text)}
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
  const More = useIcon('more-horizontal')
  const Keyboard = useIcon('command')
  const Stop = useIcon('square')
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

  const onPick = (item: PaletteItem) => {
    if (item.kind === 'session') select(item.id)
    if (item.kind === 'shortcuts') setShortcutsOpen(true)
    if (item.kind === 'new-session' || item.kind === 'profile') {
      setTarget(item.kind === 'profile' ? { ...target, profileId: item.id } : { cwd: item.project, profileId: item.profile })
      setTargetKey(k => k + 1)
      select(NEW)
    }
  }

  const start = (options: { cwd: string; profileId: string; text: string }) => {
    setTarget({ cwd: options.cwd, profileId: options.profileId })
    void sessions.start(options)
  }

  return (
    <DesktopShell
      titleBar="card"
      platform={host.kind === 'tauri' && host.os.platform === 'macos' ? 'mac' : 'linux'}
      leftLabel="Sessions sidebar"
      title={
        entry && profile && model ? (
          <>
            <EditableText
              label="Session title"
              value={titleOf(entry)}
              onValueChange={title => sessions.rename(entry.id, title)}
              className="min-w-24 weight-medium"
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
              <MenuItem index={0} icon={Keyboard} label="Keyboard shortcuts" onSelect={() => setShortcutsOpen(true)} />
              {running && <MenuItem index={1} icon={Stop} label="End the claude process" onSelect={() => sessions.kill(entry.id)} />}
            </DropdownContent>
          </DropdownMenu>
        </>
      }
      left={
        <SessionSidebar
          {...grouped}
          // ProfileUsage reads every profile's limits and fails on a profile with none yet.
          profiles={profiles.filter(p => p.limits.length > 0)}
          onPinnedOrderChange={sessions.reorderPinned}
          value={entry ? entry.id : NEW}
          onValueChange={id => id !== 'overview' && select(id)}
          inbox={inbox}
          onInboxAction={(item, action) => {
            if (action === 'open') return select(item.sessionId)
            if (action === 'allow') return sessions.respond(item.sessionId, allow(item.id))
            if (action === 'deny') return sessions.respond(item.sessionId, deny(item.id, 'Denied by the user.'))
          }}
          onSearch={() => setPaletteOpen(true)}
        />
      }
      main={
        entry && profile && model ? (
          <SessionView sessions={sessions} entry={entry} profile={profile} model={model} exit={sessions.exits[entry.id]} />
        ) : (
          <NewSession
            key={targetKey}
            projects={projects}
            profiles={profiles}
            target={{ cwd: target.cwd, profileId: target.profileId ?? sessions.defaultId ?? undefined }}
            onTargetChange={setTarget}
            onStart={start}
          />
        )
      }
    />
  )
}
