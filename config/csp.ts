/**
 * Content-Security-Policy for the production build, delivered through a <meta> tag
 * (GitHub Pages cannot set HTTP headers).
 *
 * The point of this policy is the privacy promise: the page may only talk to its own
 * origin. connect-src 'self' means fetch/XHR/WebSocket/EventSource cannot reach any other
 * host, and there is no img-src/media-src/font-src/frame-src entry for a third party.
 *
 * NOTE: frame-ancestors, report-uri and sandbox are ignored in <meta> CSP, so they are
 * not listed. 'wasm-unsafe-eval' is required by MediaPipe (WebAssembly) and nothing else.
 */
export const CSP_DIRECTIVES: Readonly<Record<string, readonly string[]>> = {
  'default-src': ["'self'"],
  'script-src': ["'self'", "'wasm-unsafe-eval'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'blob:', 'data:'],
  'media-src': ["'self'", 'blob:', 'mediastream:'],
  'connect-src': ["'self'"],
  'worker-src': ["'self'", 'blob:'],
  'manifest-src': ["'self'"],
  'font-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'none'"],
}

export const CSP: string = Object.entries(CSP_DIRECTIVES)
  .map(([name, values]) => `${name} ${values.join(' ')}`)
  .join('; ')
