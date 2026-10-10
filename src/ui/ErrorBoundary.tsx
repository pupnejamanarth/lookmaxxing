import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './Button'

export interface ErrorBoundaryProps {
  children: ReactNode
  /** When this value changes (pass the route path) a shown error is cleared and the children render again. */
  resetKey?: string
}

interface State {
  error: Error | null
}

/** Shown instead of a blank screen. Also used by main.tsx for failures before React starts. */
export function FatalNotice({ detail }: { detail?: string }) {
  return (
    <div className="ui-fatal" role="alert">
      <p className="ui-fatal__text">Something broke. Your data is safe on this device.</p>
      <Button variant="primary" onClick={() => window.location.reload()}>
        Reload
      </Button>
      {detail ? (
        <details className="ui-fatal__detail">
          <summary>Technical detail</summary>
          <pre>{detail}</pre>
        </details>
      ) : null}
    </div>
  )
}

/** Catches render errors below it. Nothing is sent anywhere; the error goes to the console only. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Render error', error, info.componentStack)
  }

  override componentDidUpdate(previous: ErrorBoundaryProps): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  override render() {
    const { error } = this.state
    if (error) return <FatalNotice detail={`${error.name}: ${error.message}`} />
    return this.props.children
  }
}
