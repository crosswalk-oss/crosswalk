// Plain-SQL migration runner (AGENT_RULES §5 rule 19): applies migrations/NNN_*.sql in order, once each,
// and records them in schema_migrations. Used by scripts/migrate.mjs at deploy time and by the tests.
import type { Exec } from './repo'

export interface Migration { name: string; sql: string }

export async function migrate(exec: Exec, runScript: (sql: string) => Promise<unknown>, migrations: Migration[]): Promise<string[]> {
  await runScript('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())')
  const done = new Set((await exec('select name from schema_migrations')).map((r) => String(r.name)))
  const applied: string[] = []
  for (const m of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
    if (done.has(m.name)) continue
    await runScript(m.sql)
    await exec('insert into schema_migrations (name) values ($1)', [m.name])
    applied.push(m.name)
  }
  return applied
}
