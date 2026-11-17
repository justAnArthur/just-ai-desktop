import 'virtual:uno.css'
import '@just-apps/app-kit/styles.css'
import { createApp } from '@just-apps/app-kit'
import { version } from '../package.json'
import { mockCommands } from './native/mock'
import Workspace from './workspace'

createApp({ name: 'AI Desktop', version, routes: { '/': Workspace }, commands: mockCommands, frame: false })
