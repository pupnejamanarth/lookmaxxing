// Side-effect module: import it first in every worker entry (and the main entry) so the guard
// is active before any other code in that global scope runs.
import { installNetGuard } from './netGuard'

installNetGuard()
