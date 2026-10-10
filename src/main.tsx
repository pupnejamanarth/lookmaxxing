import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Placeholder shell – replaced by the real App in the UI workflow.
function Boot() {
  return <p style={{ color: '#e8eaed', fontFamily: 'system-ui', padding: 24 }}>Booting…</p>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boot />
  </StrictMode>,
)
