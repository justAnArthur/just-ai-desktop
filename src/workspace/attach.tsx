import { readAttachments } from '../attachments'
import type { Attachment } from '@just-apps/claude-code'

/** Reads the files to send, and says on `onSkipped` which were left out and why; undefined when nothing is left to send. */
export async function attach(text: string, files: File[], onSkipped: (reasons: string[]) => void): Promise<Attachment[] | undefined> {
  const { attachments, rejected } = await readAttachments(files)
  onSkipped(rejected)
  return text || attachments.length ? attachments : undefined
}

/** Why attached files were left out of the last message. */
export const Skipped = ({ reasons }: { reasons: string[] }) =>
  reasons.length > 0 && <p className="m-0 text-caption text-destructive">Not sent: {reasons.join('; ')}.</p>
