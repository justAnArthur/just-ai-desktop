import type { Attachment } from '@just-apps/claude-code'

const IMAGES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const TEXT_EXTENSIONS = ['.md', '.txt', '.json', '.csv', '.log', '.yaml', '.yml', '.toml', '.xml', '.html', '.css', '.js', '.jsx', '.ts', '.tsx', '.py', '.rs', '.go', '.java', '.kt', '.swift', '.sh', '.sql']

/** What the composer's Attach and a drop take. */
export const ACCEPT = [...IMAGES, 'application/pdf', 'application/json', 'text/*', ...TEXT_EXTENSIONS].join(',')

const MB = 1024 * 1024
// The API takes an image up to 5 MB once base64-encoded, which adds a third.
const MAX_IMAGE = 3.7 * MB
const MAX_PDF = 10 * MB
const MAX_TEXT = 100 * 1024

/** The longest side of the thumbnail a sent message shows. */
const THUMB_PX = 320

/** An attachment as sent, with a small data URL of an image for the sent message to show. */
export type Attached = Attachment & { preview?: string }

const size = (bytes: number) => (bytes < MB ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / MB).toFixed(1)} MB`)

function base64(bytes: Uint8Array) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

const isText = (file: File) => file.type.startsWith('text/') || file.type === 'application/json' || TEXT_EXTENSIONS.some(e => file.name.toLowerCase().endsWith(e))

// Drawn small, so a long session keeps no full-size copy of each picture it shows.
async function thumbnail(file: File) {
  if (typeof document === 'undefined') return
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const scale = Math.min(1, THUMB_PX / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png')
  } catch {
    return
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function read(file: File): Promise<Attached | string> {
  const bytes = async () => new Uint8Array(await file.arrayBuffer())
  if (IMAGES.includes(file.type)) {
    if (file.size > MAX_IMAGE) return `${file.name} is ${size(file.size)}; images go up to ${size(MAX_IMAGE)}`
    const [data, preview] = await Promise.all([bytes().then(base64), thumbnail(file)])
    return { kind: 'image', mediaType: file.type, data, ...(preview && { preview }) }
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
    attachments: results.filter((r): r is Attached => typeof r !== 'string'),
    rejected: results.filter((r): r is string => typeof r === 'string'),
  }
}
