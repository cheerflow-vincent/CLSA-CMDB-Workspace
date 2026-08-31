import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import { App } from './App'
import { initUserToken } from './api/servicenow'
import { waitForStylesheets } from './waitForStylesheets'
import './tailwind.css'

function Root() {
  return <App />
}

// Fetch the ServiceNow user token and wait for Tailwind CSS before rendering
// so the first paint is styled (avoids FOUC on instances that load CSS async).
await Promise.all([initUserToken(), waitForStylesheets()]);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
