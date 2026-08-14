import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './styles.css'

if (window.dshDesktop !== undefined) document.documentElement.dataset['runtime'] = 'desktop'

const root = document.getElementById('root')
if (root === null) throw new Error('Missing #root mount point')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
