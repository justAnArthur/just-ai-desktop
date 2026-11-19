import { useHost } from '@just-apps/app-kit'
import type { Host } from '@just-apps/host-contract'
import { toast } from '@justanarthur/modo-ui'
import { useEffect } from 'react'

const FIRST_CHECK = 15_000
const EVERY = 6 * 3_600_000
const ID = 'update'

// The version already offered: a later check doesn't raise the same toast again.
let offered: string | undefined

/** Whether this build can update itself: the web host has nothing to update, and a dev build would install the release over itself. */
export const canUpdate = (host: Host) => host.kind === 'tauri' && !import.meta.env.DEV

function install(host: Host) {
  return host.updater.install(state => {
    if (state.kind === 'downloading')
      toast.update(ID, { type: 'loading', title: 'Downloading the update…', description: `${Math.round(state.progress * 100)}%`, action: undefined })
    if (state.kind === 'ready') toast.update(ID, { type: 'loading', title: `Restarting into ${state.version}…`, description: undefined })
    if (state.kind === 'error') toast.update(ID, { type: 'error', title: 'The update failed', description: state.message, timeout: 0 })
  })
}

/**
 * Asks GitHub's latest release for a newer version. A new one waits in a toast until the user restarts into
 * it: sessions may be running, so it never relaunches on its own. `manual` also says when there is none.
 */
export async function checkForUpdate(host: Host, manual = false) {
  const state = await host.updater.check()
  if (state.kind === 'error') {
    console.error('[update]', state.message)
    if (manual) toast.show({ id: ID, type: 'error', title: 'Couldn’t check for updates', description: state.message })
    return
  }
  if (state.kind !== 'available') {
    if (manual) toast.show({ id: ID, type: 'success', title: `JustAIDesktop ${host.app.version} is the latest version` })
    return
  }
  if (state.version === offered && !manual) return
  offered = state.version
  toast.show({
    id: ID,
    type: 'info',
    title: `JustAIDesktop ${state.version} is available`,
    description: `You have ${host.app.version}. Restarting stops running sessions; they resume when you open them.`,
    timeout: 0,
    action: { label: 'Restart to update', onClick: () => void install(host) },
  })
}

/** Checks a little after launch and every few hours. */
export function useUpdate() {
  const host = useHost()

  useEffect(() => {
    if (!canUpdate(host)) return
    const first = setTimeout(() => void checkForUpdate(host), FIRST_CHECK)
    const every = setInterval(() => void checkForUpdate(host), EVERY)
    return () => {
      clearTimeout(first)
      clearInterval(every)
    }
  }, [host])
}
