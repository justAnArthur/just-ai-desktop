import { useHost } from '@just-apps/app-kit'
import { toast } from '@justanarthur/modo-ui'
import { useEffect } from 'react'

const FIRST_CHECK = 15_000
const EVERY = 6 * 3_600_000
const ID = 'update'

/**
 * Checks GitHub's latest release a little after launch and every few hours. A new version waits in a
 * toast until the user restarts into it: sessions may be running, so it never relaunches on its own.
 */
export function useUpdate() {
  const host = useHost()

  useEffect(() => {
    // The web host has nothing to update, and a dev build would offer the release over itself.
    if (host.kind !== 'tauri' || import.meta.env.DEV) return
    let offered: string | undefined

    const install = () =>
      host.updater.install(state => {
        if (state.kind === 'downloading')
          toast.update(ID, { type: 'loading', title: 'Downloading the update…', description: `${Math.round(state.progress * 100)}%`, action: undefined })
        if (state.kind === 'ready') toast.update(ID, { type: 'loading', title: `Restarting into ${state.version}…`, description: undefined })
        if (state.kind === 'error') toast.update(ID, { type: 'error', title: 'The update failed', description: state.message, timeout: 0 })
      })

    const check = async () => {
      const state = await host.updater.check()
      if (state.kind === 'error') return console.error('[update]', state.message)
      if (state.kind !== 'available' || state.version === offered) return
      offered = state.version
      toast.show({
        id: ID,
        type: 'info',
        title: `AI Desktop ${state.version} is available`,
        description: `You have ${host.app.version}. Restarting stops running sessions; they resume when you open them.`,
        timeout: 0,
        action: { label: 'Restart to update', onClick: () => void install() },
      })
    }

    const first = setTimeout(() => void check(), FIRST_CHECK)
    const every = setInterval(() => void check(), EVERY)
    return () => {
      clearTimeout(first)
      clearInterval(every)
    }
  }, [host])
}
