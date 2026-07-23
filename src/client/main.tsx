import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { initUserToken } from './api/servicenow'
import './tailwind.css'

function Root() {
  return <App />
}

// Fetch the ServiceNow user token before rendering so all API calls are
// authenticated. initUserToken() uses the existing session cookie and
// resolves in one round-trip with no browser auth popup.
initUserToken().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  )
})
