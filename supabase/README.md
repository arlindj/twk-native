# Supabase migrations (mobile backend)

Database schema for the TWK Participate mobile backend
(Supabase project `thfaxqvcgmkeyfxkaakc`). The dev server
(`server/index.js`) runs against it when `server/.env` is present.

## Rules

- **One numbered file per change**: `0001_init.sql`, `0002_<short-name>.sql`, …
- **Never edit a migration that has already been applied** — add a new file.
- Every migration must be **idempotent** (`create table if not exists`,
  `on conflict do nothing` for seeds) so re-running is always safe.

## How to apply

Paste the new file into the **Supabase SQL Editor** of the project and Run.
(The server checks table reachability at boot and prints a warning naming
anything missing, so a forgotten migration is caught immediately.)

Optional, instead of the SQL Editor: link the Supabase CLI once
(`supabase link --project-ref thfaxqvcgmkeyfxkaakc`, needs the DB password)
and apply with `supabase db push`.

## Applied so far

| File | Applied | Contents |
|---|---|---|
| `0001_init.sql` | 2026-07-14 | 8 tables (test_links, sessions, session_events, idempotency_keys, answers, recordings, screens, frames), indexes, RLS enabled (service-role only), demo seeds DEMO123/DEMOFIGMA |

Storage buckets (`recordings`, `frames`) are NOT in SQL — the server
creates them idempotently at boot with the service key.
