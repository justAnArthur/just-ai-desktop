import { useHost, useStore } from '@just-apps/app-kit'
import { useEffect, useMemo, useRef, useState } from 'react'
import { interrupt as interruptLine, type PermissionMode, userMessage } from './engine/protocol'
import { fromTranscript, initialSession, reduce, type SessionModel } from './engine/session'
import { native, SESSION_EXIT, SESSION_LINE, type SessionExit, type SessionLine } from './native/commands'
import { type Entry, limitsOf, mergeEntries, type Section, type Windows } from './sessions'
import { useProfiles } from './use-profiles'

/** The selection for a session not started yet. */
export const NEW = 'new'

export interface StartOptions {
  profileId: string
  cwd: string
  text: string
  model?: string
  mode?: PermissionMode
  effort?: string
}

export interface Exit {
  code: number | null
  stderr: string
}

function parse(line: string) {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

const flags = ({ model, mode, effort }: Omit<StartOptions, 'profileId' | 'cwd' | 'text'>) => [
  ...(model ? ['--model', model] : []),
  ...(mode ? ['--permission-mode', mode] : []),
  ...(effort ? ['--effort', effort] : []),
]

const without = (ids: string[], id: string) => ids.filter(i => i !== id)

/** How long a profile's listing waits for more turns to end before it re-reads its transcripts. */
const RELIST_DELAY = 1000

export function useSessions() {
  const host = useHost()
  const call = useMemo(() => native(host), [host])
  const { profiles, defaultId, loading } = useProfiles()
  // Per profile: one re-reads its sessions without touching the others' lists.
  const [lists, setLists] = useState<Record<string, Entry[]>>({})
  const [started, setStarted] = useState<Entry[]>([])
  const [models, setModels] = useState<Record<string, SessionModel>>({})
  const [running, setRunning] = useState<string[]>([])
  const [exits, setExits] = useState<Record<string, Exit>>({})
  const [usage, setUsage] = useState<Record<string, Windows>>({})
  const [titles, setTitles] = useStore<Record<string, string>>('sessions.titles', {})
  const [pinned, setPinned] = useStore<string[]>('sessions.pinned', [])
  const [archived, setArchived] = useStore<string[]>('sessions.archived', [])
  const [sections] = useStore<Section[]>('sessions.sections', [])
  const [unread, setUnread] = useStore<string[]>('sessions.unread', [])
  const [selected, setSelected] = useStore<string>('sessions.selected', NEW)
  // Synchronous twins of `running`: a second start must see the first before React re-renders.
  const live = useRef(new Set<string>())
  const killed = useRef(new Set<string>())
  const listing = useRef(new Map<string, { timer?: ReturnType<typeof setTimeout>; seq: number }>())

  const profileKey = profiles.map(p => `${p.id}=${p.configDir}`).join()
  const past = useMemo(() => mergeEntries(profiles.map(p => lists[p.id] ?? [])), [lists, profileKey])
  const entries = useMemo(() => mergeEntries([started, past]), [started, past])
  const entryOf = (id: string) => entries.find(e => e.id === id)

  const update = (id: string, f: (model: SessionModel) => SessionModel) =>
    setModels(all => ({ ...all, [id]: f(all[id] ?? initialSession) }))

  const setLive = (id: string, on: boolean) => {
    if (on) live.current.add(id)
    else live.current.delete(id)
    setRunning([...live.current])
  }

  /** Re-lists these profiles after `delay`, one call each however often asked; a stale answer is dropped, an unchanged one kept. */
  function relist(targets: { id: string; configDir: string }[], delay = 0) {
    for (const { id, configDir } of targets) {
      const state = listing.current.get(id) ?? { seq: 0 }
      listing.current.set(id, state)
      clearTimeout(state.timer)
      state.timer = setTimeout(() => {
        const seq = ++state.seq
        call('list_sessions', { configDir })
          .then(list => {
            if (seq !== state.seq) return
            const next = list.map((s): Entry => ({ ...s, profileId: id, configDir }))
            setLists(all => (JSON.stringify(all[id]) === JSON.stringify(next) ? all : { ...all, [id]: next }))
          })
          .catch(error => console.error(`[sessions] list of ${configDir}:`, error))
      }, delay)
    }
  }

  useEffect(() => {
    if (!loading) relist(profiles)
  }, [call, loading, profileKey])

  useEffect(() => {
    let current = true
    Promise.all(profiles.map(p => host.store.get<Windows>(`usage.${p.id}`).then(w => (w ? [[p.id, w] as const] : [])))).then(
      pairs => current && setUsage(Object.fromEntries(pairs.flat())),
    )
    return () => {
      current = false
    }
  }, [host, profileKey])

  useEffect(() => {
    call('session_running').then(ids => {
      for (const id of ids) live.current.add(id)
      setRunning([...live.current])
    })
  }, [call])

  useEffect(() => {
    if (!loading) return host.window.onFocusChange(focused => focused && relist(profiles))
  }, [host, loading, profileKey])

  // A transcript can hold megabytes: keep only those shown, running or failed, and read the others again when shown.
  useEffect(() => {
    setModels(all => {
      const kept = Object.entries(all).filter(([id, model]) => id === selected || live.current.has(id) || model.status === 'failed')
      return kept.length === Object.keys(all).length ? all : Object.fromEntries(kept)
    })
  }, [selected, running])

  const entry = entryOf(selected)
  useEffect(() => {
    if (!entry || models[selected]) return
    let current = true
    call('read_transcript', { configDir: entry.configDir, sessionId: selected })
      .then(lines => current && setModels(all => (all[selected] ? all : { ...all, [selected]: fromTranscript(lines) })))
      .catch(error => console.error(`[sessions] transcript of ${selected}:`, error))
    return () => {
      current = false
    }
  }, [call, selected, entry?.configDir])

  // The native events are subscribed once; they read this render's state through the ref.
  const on = useRef({ line: (_: SessionLine) => {}, exit: (_: SessionExit) => {} })
  on.current = {
    line({ key, line }) {
      update(key, model => reduce(model, line))
      const message = parse(line)
      if (message?.type === 'rate_limit_event') {
        const windows: Windows | undefined = message.rate_limit_info?.unifiedWindows
        const profileId = entryOf(key)?.profileId
        if (!windows || !profileId) return
        setUsage(all => ({ ...all, [profileId]: windows }))
        void host.store.set(`usage.${profileId}`, windows)
      }
      if (message?.type === 'result') {
        const entry = entryOf(key)
        const profile = entry && profiles.find(p => p.id === entry.profileId)
        if (profile) relist([profile], RELIST_DELAY)
        if (key !== selected && !unread.includes(key)) setUnread([...unread, key])
      }
    },
    exit({ key, code, stderr }) {
      setLive(key, false)
      const failed = !killed.current.delete(key) && code !== 0
      if (failed) setExits(all => ({ ...all, [key]: { code, stderr } }))
      update(key, model => ({
        ...model,
        pending: [],
        draft: '',
        status: failed ? 'failed' : 'idle',
        error: failed ? (model.error ?? (stderr.trim().split('\n').pop() || `claude exited (${code ?? 'killed'})`)) : model.error,
      }))
    },
  }

  useEffect(() => {
    const offLine = host.on(SESSION_LINE, payload => on.current.line(payload as SessionLine))
    const offExit = host.on(SESSION_EXIT, payload => on.current.exit(payload as SessionExit))
    return () => {
      offLine()
      offExit()
    }
  }, [host])

  const fail = (id: string, error: unknown) => update(id, model => ({ ...model, status: 'failed', error: String(error) }))

  async function spawn(target: Entry, args: string[]) {
    if (live.current.has(target.id)) return
    setLive(target.id, true)
    setExits(({ [target.id]: _, ...rest }) => rest)
    try {
      await call('session_start', { key: target.id, configDir: target.configDir, cwd: target.cwd, args })
    } catch (error) {
      setLive(target.id, false)
      throw error
    }
  }

  async function write(id: string, line: string) {
    update(id, model => reduce(model, line))
    await call('session_write', { key: id, line })
  }

  const select = (id: string) => {
    setSelected(id)
    if (unread.includes(id)) setUnread(without(unread, id))
  }

  async function start({ profileId, cwd, text, ...options }: StartOptions) {
    const profile = profiles.find(p => p.id === profileId)
    if (!profile) throw new Error(`no profile ${profileId}`)
    const id = crypto.randomUUID()
    const target: Entry = { id, profileId, configDir: profile.configDir, cwd, updated: Date.now(), title: text.split('\n')[0]?.slice(0, 80) }
    setStarted(all => [...all, target])
    setModels(all => ({ ...all, [id]: initialSession }))
    select(id)
    try {
      await spawn(target, ['--session-id', id, ...flags(options)])
      await write(id, userMessage(text))
    } catch (error) {
      fail(id, error)
    }
    return id
  }

  /** Starts the session's process with `--resume` unless it runs already. */
  async function resume(id: string, options: Parameters<typeof flags>[0] = {}) {
    const target = entryOf(id)
    if (!target) throw new Error(`no session ${id}`)
    await spawn(target, ['--resume', id, ...flags(options)])
  }

  /** `options` apply only when this starts the process. */
  async function send(id: string, text: string, options: Parameters<typeof flags>[0] = {}) {
    try {
      await resume(id, options)
      await write(id, userMessage(text))
    } catch (error) {
      fail(id, error)
    }
  }

  const respond = (id: string, line: string) => write(id, line).catch(error => fail(id, error))

  const interrupt = (id: string) => call('session_write', { key: id, line: interruptLine() }).catch(error => fail(id, error))

  async function kill(id: string) {
    if (!live.current.has(id)) return
    killed.current.add(id)
    await call('session_kill', { key: id })
  }

  const dismiss = (id: string) => update(id, model => ({ ...model, status: 'idle', error: undefined }))

  async function restart(id: string) {
    dismiss(id)
    await resume(id).catch(error => fail(id, error))
  }

  const setIn = (ids: string[], id: string, on: boolean) => (on ? [...without(ids, id), id] : without(ids, id))

  // Pinned and archived exclude each other: a session shows in one list.
  function pin(id: string, on: boolean) {
    setPinned(setIn(pinned, id, on))
    if (on && archived.includes(id)) setArchived(without(archived, id))
  }

  function archive(id: string, on: boolean) {
    setArchived(setIn(archived, id, on))
    if (on && pinned.includes(id)) setPinned(without(pinned, id))
  }

  return {
    profiles: profiles.map(p => ({
      ...p,
      limits: limitsOf(usage[p.id]),
      running: running.filter(id => entryOf(id)?.profileId === p.id).length,
    })),
    defaultId,
    loading,
    entries,
    models,
    running,
    exits,
    titles,
    pinned,
    archived,
    sections,
    unread,
    selected,
    select,
    start,
    send,
    respond,
    interrupt,
    kill,
    restart,
    dismiss,
    rename: (id: string, title: string) => setTitles({ ...titles, [id]: title }),
    pin,
    archive,
    markUnread: (id: string) => {
      if (!unread.includes(id)) setUnread([...unread, id])
    },
    reorderPinned: setPinned,
    refresh: () => relist(profiles),
  }
}

export type Sessions = ReturnType<typeof useSessions>
