// First import of the harness: the same network guard the app installs in src/boot.ts, so what the harness
// loads is judged exactly like the app's own requests. Vite's dev HMR socket is the only same-origin WebSocket.
import { installNetGuard } from '../src/privacy'

installNetGuard({ allowSameOriginWebSocket: import.meta.env.DEV })
