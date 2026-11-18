import { useHost } from '@just-apps/app-kit'
import { AlertDialog } from '@justanarthur/modo-ui'
import type { PaneId } from '@justanarthur/modo-ui-ai'
import SidePane from '@justanarthur/modo-ui-ai/blocks/panes/side-pane'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { SessionModel } from '../engine/session'
import { type GitStatus, native } from '../native/commands'
import { busy, sameChanges, tasksOf, touches } from '../panes'

export type PaneTab = Extract<PaneId, 'changes' | 'tasks'>
export const PANE_TABS: PaneTab[] = ['changes', 'tasks']

interface Revert {
  paths: string[]
  done: (reverted: boolean) => void
}

interface SessionPaneProps {
  cwd: string
  model: SessionModel
  /** The session's process runs. */
  live: boolean
  open: boolean
  tab: PaneTab
  onTabChange: (tab: PaneTab) => void
  onClose: () => void
  /** Sends the session a user message. */
  onAsk: (text: string) => void
  onInterrupt: () => void
}

export function SessionPane({ cwd, model, live, open, tab, onTabChange, onClose, onAsk, onInterrupt }: SessionPaneProps) {
  const host = useHost()
  const call = useMemo(() => native(host), [host])
  const [git, setGit] = useState<GitStatus>()
  const [error, setError] = useState<string>()
  const [note, setNote] = useState<string>()
  const [reverting, setReverting] = useState<Revert>()
  const latest = useRef(git)
  latest.current = git
  const seq = useRef(0)
  const working = busy(model)
  const touched = touches(model)
  // The pane holds a Stop until its `tasks` change: a new list each render would drop it.
  const tasks = useMemo(() => tasksOf(model), [model.turns, working])

  // `fresh` hands the pane new `changes` even when git reports the same ones, dropping what it shows of a failed action.
  async function load(fresh = false) {
    const n = ++seq.current
    try {
      const status = await call('git_status', { cwd })
      if (n !== seq.current) return
      setError(undefined)
      const prev = latest.current
      const same = !fresh && prev && sameChanges(prev.changes, status.changes)
      if (same && prev.branch === status.branch && prev.ahead === status.ahead && prev.behind === status.behind) return
      setGit(same ? { ...status, changes: prev.changes } : status)
    } catch (e) {
      if (n === seq.current) setError(String(e))
    }
  }

  async function act(run: () => Promise<unknown>) {
    setNote(undefined)
    try {
      await run()
      await load()
      return true
    } catch (e) {
      setNote(String(e))
      await load(true)
      return false
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

  // Async: the pane keeps the rows only when a promise resolves `false`; a plain `false` drops them.
  const commit = async (message: string, paths: string[]) => {
    if (message.trim()) return act(() => call('git_commit', { cwd, message }))
    // The files stay staged until Claude commits them.
    onAsk(`Commit the staged changes with a commit message you write from their diff. Staged: ${paths.join(', ')}. Don't stage or commit anything else.`)
    return false
  }

  return (
    <>
      <SidePane
        className="flex-1"
        panes={PANE_TABS}
        pane={tab}
        onPaneChange={pane => onTabChange(pane as PaneTab)}
        onClose={onClose}
        data={{ changes: git?.changes, tasks }}
        badges={{ changes: git?.changes.length ?? 0, tasks: tasks.filter(t => t.status === 'running').length }}
        paneProps={{
          changes: {
            branch: git?.branch,
            ahead: git?.ahead,
            behind: git?.behind,
            error: note ?? (error && (/not a git repository/i.test(error) ? `Not a git repository: ${cwd}` : error)),
            canAutoCommit: live && model.status === 'idle',
            onStage: (paths, staged) => void act(() => (staged ? call('git_stage', { cwd, paths }) : call('git_unstage', { cwd, paths }))),
            onRevert: paths => new Promise<boolean>(done => setReverting({ paths, done })),
            onCommit: commit,
            onOpenFile: path => void host.os.openPath(`${cwd.replace(/\/$/, '')}/${path}`),
          },
          tasks: { onStop: onInterrupt },
        }}
      />
      <AlertDialog
        open={reverting !== undefined}
        onOpenChange={next => {
          if (next) return
          reverting?.done(false)
          setReverting(undefined)
        }}
      >
        <AlertDialog.Content>
          <AlertDialog.Header>
            <AlertDialog.Title>
              {reverting?.paths.length === 1 ? `Revert ${reverting.paths[0]}?` : `Revert ${reverting?.paths.length ?? 0} files?`}
            </AlertDialog.Title>
            <AlertDialog.Description>Their unstaged changes are lost and new files are deleted. This can't be undone.</AlertDialog.Description>
          </AlertDialog.Header>
          <AlertDialog.Footer>
            <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
            <AlertDialog.Action
              variant="destructive"
              onClick={async () => {
                if (!reverting) return
                await call('git_discard', { cwd, paths: reverting.paths })
                reverting.done(true)
                void load()
              }}
              onError={e => setNote(String(e))}
            >
              Revert
            </AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog>
    </>
  )
}
