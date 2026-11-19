import { Button, Copy, EmptyState } from '@justanarthur/modo-ui'
import { useIcon } from '@justanarthur/modo-ui-ai/lib/icons'
import { INSTALL_COMMAND } from '@just-apps/claude-code'

/** No `claude` to run: the kit's FailureState has no such kind, so an empty state with the install command. */
export function NotInstalled({ onCheck, className }: { onCheck: () => void; className?: string }) {
  const Terminal = useIcon('terminal')
  return (
    <EmptyState
        className={className}
        icon={Terminal}
        title="Claude Code isn't installed"
        description="JustAIDesktop runs the claude CLI, and finds none on your PATH. Install it in a terminal, then check again."
        actions={
          <div className="flex w-full flex-col items-center gap-3">
            <Copy value={INSTALL_COMMAND} className="w-full" />
            <Button variant="secondary" size="compact" onClick={onCheck}>
              Check again
            </Button>
          </div>
        }
      />
  )
}
