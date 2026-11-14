-- Shared state for the hosted demo (AGENT_RULES §5: plain SQL migrations, Postgres only).
--
-- A "generation" is one run of the shared dataset. It starts from a full snapshot (seq 0) and grows by an
-- ordered log of changes (immer patches). "Reset demo data" starts a new generation; nothing is ever
-- updated or deleted (rule 21: append-only), so every past edit stays on record.

create table if not exists generations (
  id             bigserial primary key,
  schema_version integer     not null,
  started_at     timestamptz not null default now(),
  started_by     text        not null,
  reason         text        not null default ''
);

create table if not exists changes (
  generation_id bigint      not null references generations (id),
  seq           integer     not null check (seq > 0),
  at            timestamptz not null default now(),
  actor         text        not null,
  summary       text        not null default '',
  patches       text        not null, -- JSON array of immer patches, stored as text and passed through untouched
  primary key (generation_id, seq)    -- two writers racing for the same seq: the second gets a conflict
);

create table if not exists snapshots (
  generation_id bigint      not null references generations (id),
  seq           integer     not null check (seq >= 0),
  at            timestamptz not null default now(),
  state_gz      text        not null, -- base64 of the gzipped JSON state after change `seq`
  primary key (generation_id, seq)
);

create index if not exists generations_schema_idx on generations (schema_version, id desc);

-- Append-only: refuse every UPDATE and DELETE (and TRUNCATE) on the three tables.
create or replace function crosswalk_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'crosswalk: % is append-only; % is not allowed', tg_table_name, tg_op;
end $$;

drop trigger if exists generations_append_only on generations;
create trigger generations_append_only before update or delete on generations for each row execute function crosswalk_append_only();
drop trigger if exists generations_no_truncate on generations;
create trigger generations_no_truncate before truncate on generations for each statement execute function crosswalk_append_only();

drop trigger if exists changes_append_only on changes;
create trigger changes_append_only before update or delete on changes for each row execute function crosswalk_append_only();
drop trigger if exists changes_no_truncate on changes;
create trigger changes_no_truncate before truncate on changes for each statement execute function crosswalk_append_only();

drop trigger if exists snapshots_append_only on snapshots;
create trigger snapshots_append_only before update or delete on snapshots for each row execute function crosswalk_append_only();
drop trigger if exists snapshots_no_truncate on snapshots;
create trigger snapshots_no_truncate before truncate on snapshots for each statement execute function crosswalk_append_only();
