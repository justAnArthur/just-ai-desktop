import { useHost } from '@just-apps/app-kit'
import { Dialog } from '@justanarthur/modo-ui'
import type { Profile } from '@justanarthur/modo-ui-ai'
import ProfileOnboarding, { type OnboardingStep, type ProfileDraft } from '@justanarthur/modo-ui-ai/blocks/profiles/profile-onboarding'
import { type MouseEvent, useEffect, useMemo, useState } from 'react'
import { profileId } from '@just-apps/claude-code'
import { native } from '../native/commands'
import { useLogin } from '../use-login'
import type { Profiles } from '../use-profiles'

/** Adding a profile, or signing an existing one in again. */
export type SignInTarget = { kind: 'add' } | { kind: 'sign-in'; profile: Profile; onSignedIn?: () => void }

interface SignInDialogProps {
  target?: SignInTarget
  profiles: Profiles
  onClose: () => void
}

export function SignInDialog({ target, profiles, onClose }: SignInDialogProps) {
  const host = useHost()
  const call = useMemo(() => native(host), [host])
  const existing = target?.kind === 'sign-in' ? target.profile : undefined
  const [step, setStep] = useState<OnboardingStep>('kind')
  const { login, start, fail, paste, cancel } = useLogin(() => {
    profiles.refresh()
    if (target?.kind === 'sign-in') target.onSignedIn?.()
  })

  // Signing in again skips straight to the sign-in step, which the panel starts only when entered: start it here.
  useEffect(() => {
    setStep(existing ? 'sign-in' : 'kind')
    if (existing) void start(existing.configDir)
  }, [target])

  async function begin(draft: ProfileDraft) {
    if (existing) return start(existing.configDir)
    if (draft.kind === 'compatible')
      return fail('A compatible provider is set up in its config dir’s settings.json (ANTHROPIC_BASE_URL) for now.')
    const configDir = draft.configDir.trim() || `~/.claude-${draft.name}`
    const id = profileId(configDir)
    if (profiles.profiles.some(p => p.id === id)) return fail(`A profile already runs from ${configDir}.`)
    try {
      await call('create_profile_dir', { configDir })
    } catch (error) {
      return fail(error)
    }
    profiles.addDir(configDir)
    profiles.rename(id, draft.name)
    await start(configDir)
  }

  const close = () => {
    cancel()
    onClose()
  }

  // The kit's Open again is a plain link: a webview would open it inside the app, if at all.
  const openOutside = (e: MouseEvent) => {
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="https:"]')
    if (!link) return
    e.preventDefault()
    void host.os.openExternal(link.href)
  }

  return (
    <Dialog open={Boolean(target)} onOpenChange={open => !open && close()}>
      <Dialog.Content width="lg" aria-label={existing ? `Sign in to ${existing.name}` : 'Add a profile'}>
        <div className="flex flex-col gap-4" onClickCapture={openOutside}>
          <ProfileOnboarding.Panel
            key={existing?.id ?? 'add'}
            mode={existing ? 'sign-in' : 'add'}
            step={step}
            onStepChange={setStep}
            defaultDraft={existing && { name: existing.name, configDir: existing.configDir }}
            taken={existing ? [] : profiles.profiles.flatMap(p => [p.id, p.name])}
            signIn={login}
            onSignIn={draft => void begin(draft)}
            onSubmitCode={code => void paste(code)}
            onComplete={close}
            onCancel={close}
          />
        </div>
      </Dialog.Content>
    </Dialog>
  )
}
