// Postgres access for the shared demo state, in plain SQL (AGENT_RULES §5). `Exec` is any driver that runs a
// parameterized query and returns rows: Neon's HTTP driver in production, PGlite in tests.

export type Exec = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>

export interface Generation { id: number; schemaVersion: number; startedAt: string; startedBy: string; reason: string }
export interface ChangeRow { seq: number; at: string; actor: string; summary: string; patches: string }
export interface SnapshotRow { seq: number; stateGz: string }
export interface MaterialRow { id: number; name: string; title: string; contentType: string; bytes: number; chunks: number; sort: number; meta: string; uploadedAt: string }

export class Conflict extends Error { constructor() { super('conflict') } }

const n = (v: unknown) => Number(v)
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v))
const material = (m: Record<string, unknown>): MaterialRow => ({ id: n(m.id), name: String(m.name), title: String(m.title), contentType: String(m.content_type), bytes: n(m.bytes), chunks: n(m.chunks), sort: n(m.sort), meta: String(m.meta), uploadedAt: iso(m.uploaded_at) })

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

    // ---- private materials (migrations/002_materials.sql) ----
    /** Every fully uploaded material, newest upload per name. */
    async listMaterials(): Promise<MaterialRow[]> {
      const r = await exec(`select m.id, m.name, m.title, m.content_type, m.bytes, m.chunks, m.sort, m.meta, m.uploaded_at from materials m
        where m.chunks = (select count(*) from material_chunks c where c.material_id = m.id) order by m.sort, m.name, m.id desc`)
      const seen = new Set<string>()
      return r.map(material).filter((m) => (seen.has(m.name) ? false : (seen.add(m.name), true)))
    },
    async material(id: number): Promise<MaterialRow | null> {
      const r = await exec('select id, name, title, content_type, bytes, chunks, sort, meta, uploaded_at from materials where id = $1', [id])
      return r.length ? material(r[0]) : null
    },
    /** Start an upload; the material stays hidden until every chunk has arrived. */
    async startMaterial(m: { name: string; title: string; contentType: string; bytes: number; chunks: number; sort: number; meta: string; by: string }): Promise<number> {
      const r = await exec('insert into materials (name, title, content_type, bytes, chunks, sort, meta, uploaded_by) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id',
        [m.name, m.title, m.contentType, m.bytes, m.chunks, m.sort, m.meta, m.by])
      return n(r[0].id)
    },
    /** Store one chunk. When it completes the upload, older uploads with the same name are deleted. Returns true when complete. */
    async addMaterialChunk(m: MaterialRow, idx: number, data: string): Promise<boolean> {
      await exec('insert into material_chunks (material_id, idx, data) values ($1, $2, $3) on conflict do nothing', [m.id, idx, data])
      const have = n((await exec('select count(*) as c from material_chunks where material_id = $1', [m.id]))[0].c)
      if (have < m.chunks) return false
      await exec('delete from materials where name = $1 and id < $2', [m.name, m.id])
      return true
    },
    async materialChunk(id: number, idx: number): Promise<string | null> {
      const r = await exec('select data from material_chunks where material_id = $1 and idx = $2', [id, idx])
      return r.length ? String(r[0].data) : null
    },
    /** Remove a material (every upload of that name) for good. Returns how many uploads were removed. */
    async deleteMaterial(name: string): Promise<number> {
      return (await exec('delete from materials where name = $1 returning id', [name])).length
    },
  }
}
export type Repo = ReturnType<typeof sqlRepo>
