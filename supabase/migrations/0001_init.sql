-- TWK Participate — Supabase schema for the dev server (server/index.js in
-- Supabase mode). Paste this whole file into the Supabase SQL Editor
-- (Dashboard → SQL Editor → New query → Run). It is additive and safe to
-- re-run: tables/indexes use IF NOT EXISTS and seeds use ON CONFLICT.
--
-- Storage buckets ("recordings", "frames") are NOT created here — the dev
-- server creates them itself at boot with the secret key.
--
-- All access goes through the server's service-role key, so RLS is enabled
-- on every table with NO policies: anon/authenticated clients get nothing.

create extension if not exists pgcrypto;

/* ------------------------------ Tables ---------------------------- */

-- A shareable test link (deep link token). "bootstrap" holds the full study
-- payload served to the app; the server injects sessionId + expiresAt per
-- session and substitutes "{{BASE}}" in prototype.entryUrl with its own
-- LAN address at serve time.
create table if not exists test_links (
  token       text primary key,
  study_name  text,
  bootstrap   jsonb not null,
  expires_at  timestamptz,
  active      boolean not null default true
);

create table if not exists sessions (
  id           text primary key,
  token        text not null,
  test_token   text references test_links(token),
  device       jsonb,
  status       text not null default 'started',
  consent      jsonb,
  participant  jsonb,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists sessions_test_token_idx on sessions(test_token);
create index if not exists sessions_created_at_idx on sessions(created_at);

-- Raw telemetry events. event_id is deterministic per batch item, so a
-- retried batch INSERTs with ON CONFLICT (event_id) DO NOTHING.
create table if not exists session_events (
  event_id   text primary key,
  session_id text not null references sessions(id) on delete cascade,
  seq        integer,
  type       text,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists session_events_session_idx
  on session_events(session_id, created_at, seq);

-- Batch-level idempotency: a replayed events/batch claims no key here and
-- the API answers {accepted: 0} without touching session_events.
create table if not exists idempotency_keys (
  key        text primary key,
  session_id text references sessions(id) on delete cascade
);

-- One row per (session, question); re-sent answers upsert, never duplicate.
create table if not exists answers (
  session_id  text not null references sessions(id) on delete cascade,
  question_id text not null,
  payload     jsonb not null,
  primary key (session_id, question_id)
);

create table if not exists recordings (
  recording_id    text primary key,
  session_id      text not null references sessions(id) on delete cascade,
  segment         integer default 0,
  storage_key     text,
  duration_ms     bigint,
  checksum        text,
  file_size_bytes bigint,
  width           integer,
  height          integer,
  completed_at    timestamptz
);
create index if not exists recordings_session_idx on recordings(session_id, segment);

-- Perceptual-hash screen clusters (per session). canonical_storage_key
-- points at the first captured JPEG for the cluster in the "frames" bucket.
create table if not exists screens (
  session_id            text not null references sessions(id) on delete cascade,
  screen_key            text not null,
  phash                 text not null,
  canonical_storage_key text,
  first_seen_at_ms      bigint,
  primary key (session_id, screen_key)
);
-- Screen keys embed the session id (globally unique), so the dashboard can
-- resolve /frames/:key by key alone.
create index if not exists screens_key_idx on screens(screen_key);

-- Every captured frame, mapped to its screen cluster.
create table if not exists frames (
  id         uuid primary key default gen_random_uuid(),
  session_id text not null references sessions(id) on delete cascade,
  screen_key text not null,
  at_ms      bigint,
  created_at timestamptz not null default now()
);
create index if not exists frames_session_idx on frames(session_id, at_ms);

/* -------------------------------- RLS ------------------------------ */
-- Enabled with no policies: only the service-role key (the dev server)
-- can read or write these tables.

alter table test_links       enable row level security;
alter table sessions         enable row level security;
alter table session_events   enable row level security;
alter table idempotency_keys enable row level security;
alter table answers          enable row level security;
alter table recordings       enable row level security;
alter table screens          enable row level security;
alter table frames           enable row level security;

/* ------------------------- Demo test links ------------------------- */
-- Mirrors demoBootstrap() in server/index.js. sessionId/expiresAt are
-- injected per session by the server; "{{BASE}}" becomes the server's URL.

insert into test_links (token, study_name, bootstrap) values (
  'DEMO123',
  'Checkout flow — mobile app',
  $json$
  {
    "studyVersionId": "stv_demo_01",
    "studyName": "Checkout flow — mobile app",
    "recordingRequired": true,
    "prototype": {
      "type": "html_package",
      "platform": "mobile_app",
      "entryUrl": "{{BASE}}/prototype/index.html",
      "viewport": { "width": 390, "height": 844 }
    },
    "consent": {
      "version": "consent_v1",
      "body": "By continuing you agree that your screen, taps and answers will be recorded during this test and shared with the research team. Recordings are deleted according to the study retention policy."
    },
    "intake": {
      "enabled": true,
      "askFullName": true,
      "askAge": true,
      "askRole": true,
      "roleOptions": [
        "Product designer",
        "UX researcher",
        "Product manager",
        "Engineer",
        "Student",
        "Other professional"
      ]
    },
    "tasks": [
      {
        "id": "task_browse",
        "title": "Find a product you like",
        "instruction": "Browse the shop and open the product that looks most interesting to you.",
        "required": true
      },
      {
        "id": "task_checkout",
        "title": "Buy the product",
        "instruction": "Add the product to your cart and complete the checkout.",
        "required": true
      }
    ],
    "questionBlocks": [
      {
        "id": "q_task_difficulty",
        "afterTaskId": "task_checkout",
        "type": "opinion_scale",
        "title": "How easy was it to complete the checkout?",
        "required": true,
        "scaleMin": 1,
        "scaleMax": 5,
        "scaleMinLabel": "Very hard",
        "scaleMaxLabel": "Very easy"
      },
      {
        "id": "q_feedback",
        "type": "open_text",
        "title": "What would you improve about this app?",
        "description": "Anything that confused or annoyed you.",
        "required": false
      },
      {
        "id": "q_recommend",
        "type": "yes_no",
        "title": "Would you use this app again?",
        "required": true
      }
    ]
  }
  $json$::jsonb
)
on conflict (token) do nothing;

insert into test_links (token, study_name, bootstrap) values (
  'DEMOFIGMA',
  'Uber app — Figma prototype test',
  $json$
  {
    "studyVersionId": "stv_demo_figma",
    "studyName": "Uber app — Figma prototype test",
    "recordingRequired": true,
    "prototype": {
      "type": "figma_proto",
      "platform": "mobile_app",
      "entryUrl": "https://www.figma.com/proto/xMgEQPqRS7X9rLEvQotYFk/UBER-APP?node-id=9-93&page-id=0%3A1&starting-point-node-id=9%3A93&t=C0PL3b4TnaoDUuEF-1",
      "viewport": { "width": 390, "height": 844 }
    },
    "consent": {
      "version": "consent_v1",
      "body": "By continuing you agree that your screen, taps and answers will be recorded during this test and shared with the research team. Recordings are deleted according to the study retention policy."
    },
    "intake": {
      "enabled": true,
      "askFullName": true,
      "askAge": true,
      "askRole": true,
      "roleOptions": [
        "Product designer",
        "UX researcher",
        "Product manager",
        "Engineer",
        "Student",
        "Other professional"
      ]
    },
    "tasks": [
      {
        "id": "task_figma",
        "title": "Explore the app",
        "instruction": "Tap around the prototype like you would in the real app.",
        "required": true
      }
    ],
    "questionBlocks": [
      {
        "id": "q_recommend",
        "type": "yes_no",
        "title": "Would you use this app again?",
        "required": true
      }
    ]
  }
  $json$::jsonb
)
on conflict (token) do nothing;
