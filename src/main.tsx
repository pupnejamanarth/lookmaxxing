import { boot } from './boot'
import './ui/theme.css'

// The network guard goes in before any UI code is evaluated: React and the app are imported only after boot().
boot()

const container = document.getElementById('root')

/** Plain DOM, for the case where React or the app chunk itself could not load. */
function showFatal(root: HTMLElement): void {
  const box = document.createElement('div')
  box.className = 'ui-fatal'
  box.setAttribute('role', 'alert')
  const text = document.createElement('p')
  text.className = 'ui-fatal__text'
  text.textContent = 'Something broke. Your data is safe on this device.'
  const reload = document.createElement('button')
  reload.type = 'button'
  reload.className = 'ui-btn ui-btn--primary ui-btn--md'
  reload.textContent = 'Reload'
  reload.addEventListener('click', () => window.location.reload())
  box.append(text, reload)
  root.replaceChildren(box)
}

async function start(root: HTMLElement): Promise<void> {
  const [{ createRoot }, { StrictMode }, { App }, { ErrorBoundary }] = await Promise.all([
    import('react-dom/client'),
    import('react'),
    import('./App'),
    import('./ui'),
  ])
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
}

if (container) {
  start(container).catch((error: unknown) => {
    console.error('App failed to start', error)
    showFatal(container)
  })
}
