// Apply migrations/*.sql to the database in DATABASE_URL (run at deploy time). Plain SQL, each file once.
import fs from 'node:fs'
import path from 'node:path'
import { Pool } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL is not set'); process.exit(1) }
const dir = path.resolve('migrations')
const migrations = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), 'utf8') }))

const pool = new Pool({ connectionString: url })
try {
  await pool.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())')
  const done = new Set((await pool.query('select name from schema_migrations')).rows.map((r) => r.name))
  for (const m of migrations) {
    if (done.has(m.name)) continue
    await pool.query(m.sql)
    await pool.query('insert into schema_migrations (name) values ($1)', [m.name])
    console.log('applied', m.name)
  }
  console.log('migrations up to date')
} finally {
  await pool.end()
}
