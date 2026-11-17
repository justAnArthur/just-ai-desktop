import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAppViteConfig } from '@just-apps/vite'

const kit = dirname(fileURLToPath(import.meta.resolve('@justanarthur/modo-ui-ai/package.json')))

export default createAppViteConfig({ root: import.meta.dirname, uno: { content: { filesystem: [`${kit}/dist/**/*.js`] } } })
