import { useHost } from '@just-apps/app-kit'
import { AlertDialog, Button, EmptyState, ScrollArea, SizeProvider, Tabs, Tooltip } from '@justanarthur/modo-ui'
import type { PaneChange, PaneId } from '@justanarthur/modo-ui-ai'
import ChangesPane from '@justanarthur/modo-ui-ai/blocks/panes/changes-pane'
import TasksPane from '@justanarthur/modo-ui-ai/blocks/panes/tasks-pane'
import { useIcon } from '@justanarthur/modo-ui-ai/lib/icons'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { SessionModel } from '../engine/session'
import { native } from '../native/commands'
import { busy, hunks, sameChanges, tasksOf, touches } from '../panes'

export type PaneTab = Extract<PaneId, 'changes' | 'tasks'>
export const PANE_TABS: PaneTab[] = ['changes', 'tasks']

interface Git {
  changes: PaneChange[]
  /** Remounts the kit pane, which keeps its own copy of what it was mounted with. */
  key: number
}

const drop = (paths: string[]) => (changes: PaneChange[]) => changes.filter(c => !paths.includes(c.path))

function Count({ label, n }: { label: string; n: number }) {
  return (
    <>
      {label}
      {n > 0 && <span className="tabular-nums text-muted-foreground"> {n}</span>}
    </>
  )
}

interface SidePaneProps {
  cwd: string
  model: SessionModel
  open: boolean
  tab: PaneTab
  onTabChange: (tab: PaneTab) => void
  onClose: () => void
  /** Sends the session a user message. */
  onAsk: (text: string) => void
  onInterrupt: () => void
}

export function SidePane({ cwd, model, open, tab, onTabChange, onClose, onAsk, onInterrupt }: SidePaneProps) {
  const host = useHost()
  const call = useMemo(() => native(host), [host])
  const [git, setGit] = useState<Git>()
  const [error, setError] = useState<string>()
  const [note, setNote] = useState<string>()
  const [reverting, setReverting] = useState<string[]>()
  const [retried, setRetried] = useState(0)
  const latest = useRef(git)
  latest.current = git
  const seq = useRef(0)
  const Close = useIcon('x')
  const Diff = useIcon('file-diff')
  const Tasks = useIcon('list-checks')
  const Alert = useIcon('triangle-alert')
  const working = busy(model)
  const touched = touches(model)
  const tasks = tasksOf(model)

  async function load(remount = false) {
    const n = ++seq.current
    try {
      const status = await call('git_status', { cwd })
      if (n !== seq.current) return
      setError(undefined)
      const changes = status.changes.map(c => ({ ...c, patch: hunks(c.patch) }))
      const prev = latest.current
      if (!remount && prev && sameChanges(prev.changes, changes)) return
      setGit({ changes, key: (prev?.key ?? 0) + 1 })
    } catch (e) {
      if (n === seq.current) setError(String(e))
    }
  }

  // The pane already shows the result of what was pressed: mirror it, so the refresh after it doesn't remount the pane.
  const mirror = (f: (changes: PaneChange[]) => PaneChange[]) => setGit(g => g && { ...g, changes: f(g.changes) })
  const remount = () => setGit(g => g && { ...g, key: g.key + 1 })

  async function act(run: () => Promise<unknown>) {
    setNote(undefined)
    try {
      await run()
      await load()
    } catch (e) {
      setNote(String(e))
      await load(true)
    }
  }

  useEffect(() => {
    setGit(undefined)
    setError(undefined)
    setNote(undefined)
  }, [cwd])

  // Its notes are about the last thing pressed, which a turn's end makes stale.
  useEffect(() => {
    if (!working) setNote(undefined)
  }, [working])

  // On open, at a turn's start and end, and after each tool call that may touch the work tree.
  useEffect(() => {
    if (open) void load()
  }, [open, cwd, working, touched])

  useEffect(() => {
    if (open) return host.window.onFocusChange(focused => focused && void load())
  }, [host, open, cwd])

  const stage = (paths: string[], staged: boolean) => {
    mirror(cs => cs.map(c => (paths.includes(c.path) ? { ...c, staged } : c)))
    void act(() => (staged ? call('git_stage', { cwd, paths }) : call('git_unstage', { cwd, paths })))
  }

  const commit = (message: string, paths: string[]) => {
    if (message.trim()) {
      mirror(drop(paths))
      return void act(() => call('git_commit', { cwd, message }))
    }
    if (working || model.status === 'failed') {
      setNote('Claude can write the message once this session is idle. Write one yourself, or commit after the turn ends.')
      return remount()
    }
    // The files stay staged until Claude commits them.
    setNote(undefined)
    remount()
    onAsk(
      `Commit the staged changes with a commit message you write from their diff. Staged: ${paths.join(', ')}. Don't stage or commit anything else.`,
    )
  }

  const changes =
    error !== undefined ? (
      <EmptyState
        size="compact"
        icon={Alert}
        title={/not a git repository/i.test(error) ? 'Not a git repository' : 'Git failed'}
        description={/not a git repository/i.test(error) ? cwd : error}
      />
    ) : (
      git && (
        <div className="flex flex-col gap-2">
          {note && <p className="m-0 px-2 text-caption text-status-error">{note}</p>}
          <ChangesPane
            key={git.key}
            changes={git.changes}
            onStage={stage}
            onRevert={setReverting}
            onCommit={commit}
            onOpenFile={path => void host.os.openPath(`${cwd.replace(/\/$/, '')}/${path}`)}
          />
        </div>
      )
    )

  return (
    <section aria-label="Side pane" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <SizeProvider size="compact">
        <Tabs variant="subtle" value={tab} onValueChange={value => onTabChange(value as PaneTab)} className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center gap-1 px-2">
            <Tabs.List className="min-w-0">
              <Tabs.Item value="changes" icon={Diff} aria-label="Changes" label={<Count label="Changes" n={git?.changes.length ?? 0} />} />
              <Tabs.Item
                value="tasks"
                icon={Tasks}
                aria-label="Tasks"
                label={<Count label="Tasks" n={tasks.filter(t => t.status === 'running').length} />}
              />
            </Tabs.List>
            <Tooltip content="Close the pane" side="bottom">
              <Button variant="ghost" size="icon-compact" aria-label="Close the pane" className="ml-auto shrink-0" onClick={onClose}>
                <Close />
              </Button>
            </Tooltip>
          </div>
          <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade">
            <Tabs.Panel value={tab} className="px-2 pb-4 [contain:inline-size]">
              {tab === 'changes' ? (
                changes
              ) : (
                // Retry has nothing to start again: remounting puts the row back as it was.
                <TasksPane
                  key={`${retried}:${JSON.stringify(tasks)}`}
                  tasks={tasks}
                  onStop={onInterrupt}
                  onRetry={() => setRetried(n => n + 1)}
                />
              )}
            </Tabs.Panel>
          </ScrollArea>
        </Tabs>
      </SizeProvider>
      <AlertDialog
        open={reverting !== undefined}
        onOpenChange={(next, details) => {
          if (next) return
          if (details.reason !== 'imperative-action') remount()
          setReverting(undefined)
        }}
      >
        <AlertDialog.Content>
          <AlertDialog.Header>
            <AlertDialog.Title>
              {reverting?.length === 1 ? `Revert ${reverting[0]}?` : `Revert ${reverting?.length ?? 0} files?`}
            </AlertDialog.Title>
            <AlertDialog.Description>
              Their unstaged changes are lost and new files are deleted. This can't be undone.
            </AlertDialog.Description>
          </AlertDialog.Header>
          <AlertDialog.Footer>
            <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
            <AlertDialog.Action
              variant="destructive"
              onClick={async () => {
                const paths = reverting ?? []
                await call('git_discard', { cwd, paths })
                mirror(drop(paths))
                await load()
              }}
              onError={e => setNote(String(e))}
            >
              Revert
            </AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog>
    </section>
  )
}
