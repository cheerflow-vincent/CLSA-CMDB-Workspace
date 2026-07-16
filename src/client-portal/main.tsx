import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { bootstrapAuth } from './api/servicenow'
import './tailwind.css'

// Read the username synchronously from ServiceNow's injected g_user global —
// no HTTP request, no auth challenge, no loading delay.
const { username } = bootstrapAuth()

function Root() {
  return <App username={username} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
