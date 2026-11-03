// Data-access interface (AGENT_RULES rule 17). ALL persistence goes through an implementation of this
// interface; nothing else in the app touches storage. Two implementations are planned:
//   - browser (localStorage) — the demo, in ./browser.ts
//   - Postgres behind the app's own API — later, after hosting approval (not built yet)
import type { AppState } from '../types'

export interface DataAccess {
  /** Human-readable name of the backing store, shown in Configuration → Data. */
  readonly kind: 'browser' | 'postgres'
  /** Load the saved application state, or null when there is none (or it is from another schema version). */
  loadState(schemaVersion: number): AppState | null
  /** Save the whole application state (the browser version debounces). */
  saveState(state: AppState): void
  /** Forget saved application state (used by "Reset demo data"). */
  clearState(): void
  /** Small per-user UI preferences (last tab, filters). Raw string values. */
  getPref(key: string): string | null
  setPref(key: string, value: string): void
}
