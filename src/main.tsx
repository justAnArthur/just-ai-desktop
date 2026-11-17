import 'virtual:uno.css'
import '@just-apps/app-kit/styles.css'
import { createApp } from '@just-apps/app-kit'
import { version } from '../package.json'
import Home from './home'

createApp({ name: 'AI Desktop', version, routes: { '/': Home } })
