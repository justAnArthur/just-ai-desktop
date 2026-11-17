import { useHost, useStore } from '@just-apps/app-kit'
import { useEffect, useState } from 'react'
import { native, type ProfileInfo } from './native/commands'
import { toProfile } from './profiles'

export function useProfiles() {
  const host = useHost()
  const [dirs, setDirs, loaded] = useStore<string[]>('profiles.dirs', [])
  const [names, setNames] = useStore<Record<string, string>>('profiles.names', {})
  const [defaultId, setDefault] = useStore<string | null>('profiles.default', null)
  const [infos, setInfos] = useState<ProfileInfo[]>()
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!loaded) return
    let live = true
    native(host)('list_profiles', { extra: dirs }).then(next => live && setInfos(next))
    return () => {
      live = false
    }
  }, [host, dirs, loaded, version])

  const profiles = infos?.map(info => toProfile(info, names)) ?? []
  return {
    profiles,
    loading: !infos,
    defaultId: profiles.some(p => p.id === defaultId) ? defaultId : profiles[0]?.id,
    addDir: (dir: string) => !dirs.includes(dir) && setDirs([...dirs, dir]),
    rename: (id: string, name: string) => setNames({ ...names, [id]: name }),
    setDefault: (id: string) => setDefault(id),
    refresh: () => setVersion(v => v + 1),
  }
}
