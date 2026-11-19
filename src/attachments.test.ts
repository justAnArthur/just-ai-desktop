import { expect, test } from 'bun:test'
import { readAttachments } from './attachments'

test('images and PDFs as base64, text inlined, the rest left out with a reason', async () => {
  const png = new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' })
  const pdf = new File(['%PDF'], 'spec.pdf', { type: 'application/pdf' })
  const md = new File(['# hi'], 'notes.md', { type: '' })
  const big = new File([new Uint8Array(4 * 1024 * 1024)], 'huge.jpg', { type: 'image/jpeg' })
  const zip = new File(['PK'], 'a.zip', { type: 'application/zip' })
  const binary = new File([new Uint8Array([0xff, 0xfe, 0xfd])], 'x.txt', { type: 'text/plain' })
  const { attachments, rejected } = await readAttachments([png, pdf, md, big, zip, binary])
  expect(attachments).toEqual([
    { kind: 'image', mediaType: 'image/png', data: 'iVBORw==' },
    { kind: 'document', name: 'spec.pdf', data: 'JVBERg==' },
    { kind: 'text', name: 'notes.md', text: '# hi' },
  ])
  expect(rejected).toEqual(["huge.jpg is 4.0 MB; images go up to 3.7 MB", "a.zip isn't an image, PDF or text file", "x.txt isn't UTF-8 text"])
})
