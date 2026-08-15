import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { I18nProvider } from './lib/i18n.tsx'
import './styles.css'

if (window.dshDesktop !== undefined) {
  document.documentElement.dataset['runtime'] = 'desktop'
  document.documentElement.dataset['platform'] = window.dshDesktop.platform
}

const root = document.getElementById('root')
if (root === null) throw new Error('Missing #root mount point')

createRoot(root).render(
  <StrictMode>
    <I18nProvider><App /></I18nProvider>
  </StrictMode>,
)
