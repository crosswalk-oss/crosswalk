// Data-access interface (AGENT_RULES rule 17). ALL persistence goes through an implementation of this
// interface; nothing else in the app touches storage or the network for data.
//
// The shared implementation (./server.ts) talks to the app's own API, which keeps the data in Postgres:
// a starting snapshot plus an append-only log of changes. When no API answers (the standalone HTML file,
// a static host, local dev without the API), the app runs in memory and says so; nothing is saved.
//
// Only small UI preferences (last tab, the persona you are acting as, the edit passcode) stay in the browser.

export interface RemoteChange { seq: number; actor: string; summary: string; patches: string }
export interface RemoteState { generation: number | null; snapshotGz: string | null; snapshotSeq: number; changes: RemoteChange[]; head: number }
export type CommitResult = 'ok' | 'conflict' | 'unauthorized' | 'error'

export interface DataAccess {
  readonly kind: 'shared'
  /** null when no API is reachable. */
  health(): Promise<{ editable: boolean } | null>
  /** True when the passcode is accepted for edits. */
  auth(passcode: string): Promise<boolean>
  loadState(schemaVersion: number): Promise<RemoteState>
  changesSince(schemaVersion: number, generation: number, after: number): Promise<{ reset: true } | { reset: false; changes: RemoteChange[]; head: number }>
  appendChange(passcode: string, c: { generation: number; seq: number; actor: string; summary: string; patches: unknown[] }): Promise<CommitResult>
  addSnapshot(passcode: string, generation: number, seq: number, stateGz: string): Promise<boolean>
  /** Start a new generation from a full snapshot (first edit, or "Reset demo data"). Returns its id. */
  startGeneration(passcode: string, schemaVersion: number, reason: string, actor: string, stateGz: string): Promise<number | null>
  /** Small per-user UI preferences (last tab, filters, passcode). Raw string values, kept in this browser. */
  getPref(key: string): string | null
  setPref(key: string, value: string): void
  removePref(key: string): void
}
