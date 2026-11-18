// Postgres access for the shared demo state, in plain SQL (AGENT_RULES §5). `Exec` is any driver that runs a
// parameterized query and returns rows: Neon's HTTP driver in production, PGlite in tests.

export type Exec = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>

export interface Generation { id: number; schemaVersion: number; startedAt: string; startedBy: string; reason: string }
export interface ChangeRow { seq: number; at: string; actor: string; summary: string; patches: string }
export interface SnapshotRow { seq: number; stateGz: string }

export class Conflict extends Error { constructor() { super('conflict') } }

const n = (v: unknown) => Number(v)
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v))

export function sqlRepo(exec: Exec) {
  return {
    async latestGeneration(schemaVersion: number): Promise<Generation | null> {
      const r = await exec('select id, schema_version, started_at, started_by, reason from generations where schema_version = $1 order by id desc limit 1', [schemaVersion])
      if (!r.length) return null
      const g = r[0]
      return { id: n(g.id), schemaVersion: n(g.schema_version), startedAt: iso(g.started_at), startedBy: String(g.started_by), reason: String(g.reason) }
    },
    /** New generation with its starting snapshot (seq 0). */
    async createGeneration(schemaVersion: number, startedBy: string, reason: string, stateGz: string): Promise<Generation> {
      const r = await exec('insert into generations (schema_version, started_by, reason) values ($1, $2, $3) returning id, started_at', [schemaVersion, startedBy, reason])
      const id = n(r[0].id)
      await exec('insert into snapshots (generation_id, seq, state_gz) values ($1, 0, $2)', [id, stateGz])
      return { id, schemaVersion, startedAt: iso(r[0].started_at), startedBy, reason }
    },
    async head(generationId: number): Promise<number> {
      const r = await exec('select coalesce(max(seq), 0) as head from changes where generation_id = $1', [generationId])
      return n(r[0].head)
    },
    async latestSnapshot(generationId: number): Promise<SnapshotRow | null> {
      const r = await exec('select seq, state_gz from snapshots where generation_id = $1 order by seq desc limit 1', [generationId])
      return r.length ? { seq: n(r[0].seq), stateGz: String(r[0].state_gz) } : null
    },
    async changesAfter(generationId: number, after: number, limit = 500): Promise<ChangeRow[]> {
      const r = await exec('select seq, at, actor, summary, patches from changes where generation_id = $1 and seq > $2 order by seq limit $3', [generationId, after, limit])
      return r.map((c) => ({ seq: n(c.seq), at: iso(c.at), actor: String(c.actor), summary: String(c.summary), patches: String(c.patches) }))
    },
    /** Append change `seq`; throws Conflict when someone else already wrote that seq (or the client is behind). */
    async appendChange(generationId: number, seq: number, actor: string, summary: string, patches: string): Promise<void> {
      if (seq !== (await this.head(generationId)) + 1) throw new Conflict()
      try {
        await exec('insert into changes (generation_id, seq, actor, summary, patches) values ($1, $2, $3, $4, $5)', [generationId, seq, actor, summary, patches])
      } catch (e) {
        if (/duplicate key|unique/i.test(String((e as Error).message))) throw new Conflict()
        throw e
      }
    },
    async addSnapshot(generationId: number, seq: number, stateGz: string): Promise<void> {
      await exec('insert into snapshots (generation_id, seq, state_gz) values ($1, $2, $3) on conflict do nothing', [generationId, seq, stateGz])
    },
  }
}
export type Repo = ReturnType<typeof sqlRepo>
