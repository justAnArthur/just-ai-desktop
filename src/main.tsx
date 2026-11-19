import 'virtual:uno.css'
import '@just-apps/app-kit/styles.css'
// The kit's own build of its utilities: the app's UnoCSS left out the sizes of its glyphs (send arrow, stop square, working dots).
import '@justanarthur/modo-ui-ai/styles.css'
import { createApp } from '@just-apps/app-kit'
import { version } from '../package.json'
import { mockCommands } from './native/mock'
import Workspace from './workspace'

createApp({ name: 'JustAIDesktop', version, routes: { '/': Workspace }, commands: mockCommands, frame: false })
