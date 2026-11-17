import { Input, Select } from '@justanarthur/modo-ui'
import type { Profile, Project } from '@justanarthur/modo-ui-ai'
import Composer from '@justanarthur/modo-ui-ai/blocks/conversation/composer'
import { basename } from '../sessions'
import { COMPOSER } from './options'

export interface Target {
  cwd?: string
  profileId?: string
}

interface NewSessionProps {
  projects: Project[]
  profiles: Profile[]
  target: Target
  onTargetChange: (target: Target) => void
  onStart: (options: { cwd: string; profileId: string; text: string }) => void
}

export function NewSession({ projects, profiles, target, onTargetChange, onStart }: NewSessionProps) {
  const cwd = target.cwd ?? projects[0]?.path ?? ''
  const profileId = target.profileId ?? profiles[0]?.id
  if (!profileId) return null

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 overflow-auto px-6 pb-8 pt-16">
      <h1 className="m-0 text-display text-foreground">What should we work on?</h1>
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-caption text-muted-foreground">Project</span>
        {projects.length > 0 ? (
          <Select value={cwd} onValueChange={path => onTargetChange({ ...target, cwd: String(path) })}>
            <Select.Trigger variant="borderless" className="min-w-0" />
            <Select.Content>
              {projects.map((p, i) => (
                <Select.Item key={p.path} index={i} value={p.path}>
                  {p.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        ) : (
          <Input
            aria-label="Project folder"
            placeholder="/path/to/project"
            value={cwd}
            onValueChange={path => onTargetChange({ ...target, cwd: path })}
          />
        )}
        <span className="min-w-0 truncate font-mono text-caption text-muted-foreground">{cwd}</span>
      </div>
      <Composer
        // The composer's project picker reads its projects once.
        key={projects.length > 0 ? cwd : 'typed'}
        {...COMPOSER}
        target
        projects={cwd ? [{ label: basename(cwd), path: cwd }] : []}
        branches={[]}
        profiles={profiles}
        defaultProfile={profileId}
        onProfileChange={id => onTargetChange({ ...target, profileId: id })}
        placeholder="Describe the task, or type / for commands"
        context={0}
        onSend={text => cwd && onStart({ cwd, profileId, text })}
      />
    </main>
  )
}
