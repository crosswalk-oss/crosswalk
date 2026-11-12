-- Private materials for the hosted demo: files (a video, slide images) that an editor uploads with the edit
-- passcode and that the API returns only to requests carrying that passcode. They live here and nowhere else:
-- never in the repository, the page bundle or the offline copy.
--
-- A file is stored as base64 text in chunks of about 1 MB so every request and response stays small.
-- A material becomes visible once all its chunks have arrived; at that moment older uploads with the same
-- name are deleted. Unlike the change log (rule 21), these rows can be deleted: withdrawing a material
-- removes it for good.

create table if not exists materials (
  id           bigserial primary key,
  name         text        not null,              -- stable key, e.g. 'overview-video' or 'deck/03'
  title        text        not null default '',
  content_type text        not null,
  bytes        integer     not null check (bytes > 0),
  chunks       integer     not null check (chunks > 0),
  sort         integer     not null default 0,
  meta         text        not null default '{}', -- small JSON for the viewer (e.g. video chapters)
  uploaded_at  timestamptz not null default now(),
  uploaded_by  text        not null default ''
);

create table if not exists material_chunks (
  material_id bigint  not null references materials (id) on delete cascade,
  idx         integer not null check (idx >= 0),
  data        text    not null, -- base64
  primary key (material_id, idx)
);

create index if not exists materials_name_idx on materials (name, id desc);
