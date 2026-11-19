import type { Attachment } from './engine/protocol'

const IMAGES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const TEXT_EXTENSIONS = ['.md', '.txt', '.json', '.csv', '.log', '.yaml', '.yml', '.toml', '.xml', '.html', '.css', '.js', '.jsx', '.ts', '.tsx', '.py', '.rs', '.go', '.java', '.kt', '.swift', '.sh', '.sql']

/** What the composer's Attach and a drop take. */
export const ACCEPT = [...IMAGES, 'application/pdf', 'application/json', 'text/*', ...TEXT_EXTENSIONS].join(',')

const MB = 1024 * 1024
// The API takes an image up to 5 MB once base64-encoded, which adds a third.
const MAX_IMAGE = 3.7 * MB
const MAX_PDF = 10 * MB
const MAX_TEXT = 100 * 1024

const size = (bytes: number) => (bytes < MB ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / MB).toFixed(1)} MB`)

function base64(bytes: Uint8Array) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

const isText = (file: File) => file.type.startsWith('text/') || file.type === 'application/json' || TEXT_EXTENSIONS.some(e => file.name.toLowerCase().endsWith(e))

async function read(file: File): Promise<Attachment | string> {
  const bytes = async () => new Uint8Array(await file.arrayBuffer())
  if (IMAGES.includes(file.type)) {
    if (file.size > MAX_IMAGE) return `${file.name} is ${size(file.size)}; images go up to ${size(MAX_IMAGE)}`
    return { kind: 'image', mediaType: file.type, data: base64(await bytes()) }
  }
  if (file.type === 'application/pdf') {
    if (file.size > MAX_PDF) return `${file.name} is ${size(file.size)}; PDFs go up to ${size(MAX_PDF)}`
    return { kind: 'document', name: file.name, data: base64(await bytes()) }
  }
  if (!isText(file)) return `${file.name} isn't an image, PDF or text file`
  if (file.size > MAX_TEXT) return `${file.name} is ${size(file.size)}; text files go up to ${size(MAX_TEXT)}`
  try {
    return { kind: 'text', name: file.name, text: new TextDecoder('utf-8', { fatal: true }).decode(await bytes()) }
  } catch {
    return `${file.name} isn't UTF-8 text`
  }
}

/** The files as the API takes them, and a reason for each one left out. */
export async function readAttachments(files: File[]) {
  const results = await Promise.all(files.map(read))
  return {
    attachments: results.filter((r): r is Attachment => typeof r !== 'string'),
    rejected: results.filter((r): r is string => typeof r === 'string'),
  }
}
