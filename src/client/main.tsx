import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { initUserToken } from './api/servicenow'
import { waitForStylesheets } from './waitForStylesheets'
import './tailwind.css'

function Root() {
  return <App />
}

// Fetch the ServiceNow user token and wait for Tailwind CSS before rendering
// so the first paint is styled (avoids FOUC on instances that load CSS async).
Promise.all([initUserToken(), waitForStylesheets()]).then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  )
})
