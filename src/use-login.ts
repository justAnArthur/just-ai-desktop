import { useHost } from '@just-apps/app-kit'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AUTH_EXIT, AUTH_LINE, type AuthExit, type AuthLine, INSTALL_COMMAND, type LoginState } from '@just-apps/claude-code'
import { loginIdle, notInstalled, reduceLogin, subscriptionLabel } from '@just-apps/claude-code'
import { native } from './native/commands'

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** One `claude auth login` at a time, for the config dir it was started in. */
export function useLogin(onSignedIn: (configDir: string) => void) {
  const host = useHost()
  const call = useMemo(() => native(host), [host])
  const [login, setLogin] = useState<LoginState>(loginIdle)
  // The events of an earlier sign-in, in another dir, must not reach this one.
  const dir = useRef<string | undefined>(undefined)
  const signedIn = useRef(onSignedIn)
  signedIn.current = onSignedIn

  useEffect(() => {
    const offLine = host.on(AUTH_LINE, payload => {
      const line = payload as AuthLine
      if (line.configDir === dir.current) setLogin(l => reduceLogin(l, line))
    })
    const offExit = host.on(AUTH_EXIT, payload => {
      const exit = payload as AuthExit
      if (exit.configDir !== dir.current) return
      setLogin(l => reduceLogin(l, exit))
      if (exit.code !== 0) return
      call('auth_status', { configDir: exit.configDir })
        .then(status => setLogin(l => ({ ...l, account: status.email, plan: subscriptionLabel(status) })))
        .catch(error => console.error('[login] status:', error))
        .finally(() => signedIn.current(exit.configDir))
    })
    return () => {
      offLine()
      offExit()
    }
  }, [host, call])

  const fail = (error: unknown) =>
    setLogin({ ...loginIdle, state: 'failed', error: notInstalled(error) ? `claude is not installed. Install it with ${INSTALL_COMMAND}` : message(error) })

  const running = login.state === 'idle' || login.state === 'waiting'
  return {
    login,
    async start(configDir: string) {
      dir.current = configDir
      setLogin(loginIdle)
      await call('auth_login', { configDir }).catch(fail)
    },
    fail,
    paste: (code: string) => dir.current && call('auth_write', { configDir: dir.current, line: code }).catch(fail),
    /** Stops a sign-in still waiting; one that ended is left as it is. */
    cancel() {
      const configDir = dir.current
      dir.current = undefined
      if (configDir && running) void call('auth_cancel', { configDir }).catch(() => {})
      setLogin(loginIdle)
    },
  }
}
