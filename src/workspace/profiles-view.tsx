import { useHost } from '@just-apps/app-kit'
import { Badge, Button, Copy, EditableText, Meter } from '@justanarthur/modo-ui'
import { useShape } from '@justanarthur/modo-ui/lib/shape-context'
import { cn } from '@justanarthur/modo-ui/lib/utils'
import type { Profile } from '@justanarthur/modo-ui-ai'
import { ProfileTile } from '@justanarthur/modo-ui-ai/blocks/profiles/profile-switcher'
import { useIcon } from '@justanarthur/modo-ui-ai/lib/icons'
import { useState } from 'react'
import { canUpdate, checkForUpdate } from '../use-update'
import type { Profiles } from '../use-profiles'

interface CardProps {
  profile: Profile
  isDefault: boolean
  signedOut: boolean
  state: Profiles
  onSignIn: () => void
}

function ProfileCard({ profile, isDefault, signedOut, state, onSignIn }: CardProps) {
  const host = useHost()
  const shape = useShape()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const compatible = profile.provider === 'compatible'

  const signOut = () => {
    setBusy(true)
    setError(undefined)
    state
      .signOut(profile.configDir)
      .catch(e => setError(String(e)))
      .finally(() => setBusy(false))
  }

  return (
    <article aria-label={profile.name} className={cn('flex min-w-0 flex-col gap-4 border border-border p-4', shape.container)}>
      <div className="flex min-w-0 items-start gap-3">
        <ProfileTile profile={profile} className="mt-1" />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 items-center gap-2">
            <EditableText
              label="Profile name"
              size="compact"
              className="min-w-0 text-subtitle weight-semibold"
              value={profile.name}
              onValueChange={name => name.trim() && state.rename(profile.id, name.trim())}
            />
            <Badge size="compact" color={compatible ? 'teal' : signedOut ? 'amber' : 'gray'}>
              {profile.plan}
            </Badge>
            {isDefault && (
              <Badge size="compact" variant="dot" color="gray">
                Default
              </Badge>
            )}
          </div>
          <span className="truncate pl-2 text-caption text-muted-foreground">
            {[profile.account || (signedOut ? 'No account' : ''), profile.defaultModel, `${profile.running} running`].filter(Boolean).join(' · ')}
          </span>
        </div>
      </div>
      <Copy size="compact" label={compatible ? 'Base URL' : 'Config dir'} value={compatible ? (profile.baseUrl ?? '') : profile.configDir} />
      <div className="flex flex-col gap-2.5">
        {profile.limits.length > 0 ? (
          profile.limits.map(limit => <Meter key={limit.label} label={limit.label} value={limit.value} detail={limit.detail} />)
        ) : (
          <span className="text-caption text-muted-foreground">{signedOut ? 'Sign in to see its usage.' : 'This plan reports no usage limits.'}</span>
        )}
      </div>
      {error && <p className="m-0 text-caption text-destructive">{error}</p>}
      <div className="mt-auto flex flex-wrap gap-2">
        {!isDefault && !signedOut && (
          <Button size="compact" variant="tertiary" onClick={() => state.setDefault(profile.id)}>
            Make default
          </Button>
        )}
        <Button size="compact" variant="ghost" onClick={() => void host.os.revealPath(profile.configDir)}>
          Open config dir
        </Button>
        <Button size="compact" variant="ghost" title="Takes it out of the app; its config dir stays." onClick={() => state.remove(profile.id)}>
          Remove
        </Button>
        {!compatible &&
          (signedOut ? (
            <Button size="compact" className="ml-auto" onClick={onSignIn}>
              Sign in
            </Button>
          ) : (
            <Button size="compact" variant="ghost" className="ml-auto" disabled={busy} onClick={signOut}>
              Sign out
            </Button>
          ))}
      </div>
    </article>
  )
}

interface ProfilesViewProps {
  /** With usage and running counts. */
  profiles: Profile[]
  state: Profiles
  onSignIn: (profile: Profile) => void
  onAdd: () => void
}

/** Every profile the app runs sessions under, as the kit's profiles page lays them out. */
export function ProfilesView({ profiles, state, onSignIn, onAdd }: ProfilesViewProps) {
  const host = useHost()
  const [checking, setChecking] = useState(false)
  const shape = useShape()
  const Plus = useIcon('plus')
  const running = profiles.reduce((n, p) => n + p.running, 0)
  return (
    <main className="@container flex min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 pb-8 pt-4">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-display text-foreground">Profiles</h1>
          <p className="m-0 text-body text-muted-foreground">
            {profiles.length} profiles · {running} sessions running
          </p>
        </div>
        <div className="grid gap-4 @2xl:grid-cols-2">
          {profiles.map(profile => (
            <ProfileCard
              key={profile.id}
              profile={profile}
              isDefault={profile.id === state.defaultId}
              signedOut={state.signedOut.includes(profile.id)}
              state={state}
              onSignIn={() => onSignIn(profile)}
            />
          ))}
        </div>
        <section aria-label="Add a profile" className={cn('flex flex-col gap-4 bg-muted p-4', shape.container)}>
          <div className="flex flex-col gap-0.5">
            <h2 className="m-0 text-title text-foreground">Add a profile</h2>
            <p className="m-0 text-caption text-muted-foreground">
              A Claude account gets its own config dir and signs in once. Name an existing dir to add it as it is.
            </p>
          </div>
          <div className="flex justify-end">
            <Button size="compact" leadingIcon={Plus} onClick={onAdd}>
              Add profile
            </Button>
          </div>
        </section>
        <footer className="flex items-center gap-3 px-1 text-caption text-muted-foreground">
          <span>
            {host.app.name} {host.app.version}
          </span>
          {canUpdate(host) && (
            <Button
              size="compact"
              variant="ghost"
              loading={checking}
              onClick={() => {
                setChecking(true)
                void checkForUpdate(host, true).finally(() => setChecking(false))
              }}
            >
              Check for updates
            </Button>
          )}
        </footer>
      </div>
    </main>
  )
}
