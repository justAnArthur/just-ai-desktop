import 'virtual:uno.css'
import '@just-apps/app-kit/styles.css'
import { createApp } from '@just-apps/app-kit'
import Home from './home'

createApp({ name: 'Agents', version: '0.1.0', routes: { '/': Home } })
