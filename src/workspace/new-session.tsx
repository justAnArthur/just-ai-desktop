import { Input } from '@justanarthur/modo-ui'
import type { Profile, Project } from '@justanarthur/modo-ui-ai'
import Composer from '@justanarthur/modo-ui-ai/blocks/conversation/composer'
import { useState } from 'react'
import type { Attached } from '../attachments'
import type { Commands } from '@just-apps/claude-code'
import { basename } from '../sessions'
import { attach, Skipped } from './attach'
import { COMPOSER, commandsOf, DEFAULT_RUN, type Run, runProps } from './options'

export interface Target {
  cwd?: string
  profileId?: string
}

interface NewSessionProps {
  projects: Project[]
  profiles: Profile[]
  /** Per profile, the commands its last session listed. */
  commands: Record<string, Commands>
  target: Target
  onTargetChange: (target: Target) => void
  onStart: (options: { cwd: string; profileId: string; text: string; attachments: Attached[]; run: Run }) => void
}

export function NewSession({ projects, profiles, commands, target, onTargetChange, onStart }: NewSessionProps) {
  const [run, setRun] = useState(DEFAULT_RUN)
  const [skipped, setSkipped] = useState<string[]>([])
  // As the composer resolves them: a pick its list doesn't hold stands for the first entry.
  const cwd = projects.length && !projects.some(p => p.path === target.cwd) ? projects[0].path : (target.cwd ?? '')
  const profileId = profiles.some(p => p.id === target.profileId) ? target.profileId : profiles[0]?.id
  if (!profileId) return null

  return (
    // Centred in the card, the composer's own project picker below: a path field only until there is a project to pick.
    <main className="flex min-h-0 flex-1 overflow-auto">
      <div className="m-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-8">
        <h1 className="m-0 text-display text-foreground">What should we work on?</h1>
        {projects.length === 0 && (
          <Input
            aria-label="Project folder"
            placeholder="/path/to/project"
            value={cwd}
            onValueChange={path => onTargetChange({ ...target, cwd: path })}
          />
        )}
        <Skipped reasons={skipped} />
        <Composer
          {...COMPOSER}
          commands={commandsOf(commands[profileId])}
          {...runProps(run, patch => setRun({ ...run, ...patch }))}
          target
          projects={projects.length > 0 ? projects : cwd ? [{ label: basename(cwd), path: cwd }] : []}
          project={cwd}
          onProjectChange={path => onTargetChange({ ...target, cwd: path })}
          branches={[]}
          profiles={profiles}
          profile={profileId}
          onProfileChange={id => onTargetChange({ ...target, profileId: id })}
          placeholder="Describe the task, or type / for commands"
          context={0}
          onSend={async (text, files) => {
            if (!cwd) return
            const attachments = await attach(text, files, setSkipped)
            if (attachments) onStart({ cwd, profileId, text, attachments, run })
          }}
        />
      </div>
    </main>
  )
}
