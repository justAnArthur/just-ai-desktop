import { useHost, useStore } from '@just-apps/app-kit'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { type AuthStatus, notInstalled, type ProfileInfo, profileId, signedOut } from '@just-apps/claude-code'
import { native } from './native/commands'
import { toProfile, withStatus } from './profiles'

export function useProfiles() {
  const host = useHost()
  const call = useMemo(() => native(host), [host])
  const [dirs, setDirs, loaded] = useStore<string[]>('profiles.dirs', [])
  const [names, setNames] = useStore<Record<string, string>>('profiles.names', {})
  const [defaultId, setDefault] = useStore<string | null>('profiles.default', null)
  // Removed from the app, by id: the dir and its sign-in stay as they are.
  const [hidden, setHidden] = useStore<string[]>('profiles.hidden', [])
  const [infos, setInfos] = useState<ProfileInfo[]>()
  const [statuses, setStatuses] = useState<Record<string, AuthStatus>>({})
  // Unknown until a status comes back: a missing `claude` fails every one.
  const [installed, setInstalled] = useState<boolean>()
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!loaded) return
    let live = true
    call('list_profiles', { extra: dirs }).then(all => {
      if (!live) return
      const next = all.filter(info => !hidden.includes(profileId(info.configDir)))
      setInfos(next)
      for (const { configDir } of next.filter(info => !info.baseUrl)) {
        call('auth_status', { configDir })
          .then(status => {
            if (!live) return
            setInstalled(true)
            setStatuses(all => ({ ...all, [configDir]: status }))
          })
          .catch(error => {
            if (!live) return
            if (notInstalled(error)) setInstalled(false)
            else console.error(`[profiles] auth status of ${configDir}:`, error)
          })
      }
    })
    return () => {
      live = false
    }
  }, [call, dirs, hidden, loaded, version])

  // Kept while their inputs are: a new list each render re-renders every memoized consumer.
  const { profiles, out, signedIn } = useMemo(() => {
    const merged = infos?.map(info => withStatus(info, statuses[info.configDir])) ?? []
    return {
      profiles: merged.map(info => toProfile(info, names)),
      out: merged.filter(signedOut).map(info => profileId(info.configDir)),
      signedIn: merged.filter(info => statuses[info.configDir]?.loggedIn).map(info => profileId(info.configDir)),
    }
  }, [infos, statuses, names])
  const usable = profiles.filter(p => !out.includes(p.id))
  // Stable: effects re-read sign-ins with it.
  const refresh = useCallback(() => setVersion(v => v + 1), [])
  return {
    profiles,
    loading: !infos,
    installed,
    /** Ids of the profiles with no account to run under. */
    signedOut: out,
    /** Ids of the profiles `claude auth status` found signed in. */
    signedIn,
    defaultId: profiles.some(p => p.id === defaultId) ? defaultId : (usable[0] ?? profiles[0])?.id,
    addDir(dir: string) {
      if (!dirs.includes(dir)) setDirs([...dirs, dir])
      const id = profileId(dir)
      if (hidden.includes(id)) setHidden(hidden.filter(h => h !== id))
    },
    /** Takes a profile out of the app; adding its dir again brings it back. */
    remove: (id: string) => !hidden.includes(id) && setHidden([...hidden, id]),
    rename: (id: string, name: string) => setNames({ ...names, [id]: name }),
    setDefault: (id: string) => setDefault(id),
    signOut: (configDir: string) => call('auth_logout', { configDir }).finally(refresh),
    /** Asks `claude auth status` again now: a sign-in read at launch may have expired since. */
    async check(configDir: string) {
      const status = await call('auth_status', { configDir })
      setStatuses(all => ({ ...all, [configDir]: status }))
      return status
    },
    refresh,
  }
}

export type Profiles = ReturnType<typeof useProfiles>
