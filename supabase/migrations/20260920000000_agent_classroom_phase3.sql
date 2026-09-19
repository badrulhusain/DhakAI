-- Agent Classroom Phase 3. The local Node server uses a secret/service-role key.
-- No browser or anonymous policies are created; answer keys and grading stay private.
create table if not exists public.agent_runs (
  id text primary key,
  status text not null,
  record jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.review_versions (
  agent_id text not null references public.agent_runs(id) on delete cascade,
  version text not null check (version ~ '^[a-f0-9]{64}$'),
  record jsonb not null,
  created_at timestamptz not null,
  primary key (agent_id, version)
);

create table if not exists public.explanations (
  agent_id text not null,
  review_version text not null,
  status text not null check (status in ('draft', 'completed')),
  record jsonb not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  primary key (agent_id, review_version),
  foreign key (agent_id, review_version) references public.review_versions(agent_id, version) on delete cascade
);

create table if not exists public.quiz_definitions (
  id uuid primary key,
  agent_id text not null,
  review_version text not null,
  provider text not null check (provider in ('demo', 'groq')),
  model text not null,
  record jsonb not null,
  created_at timestamptz not null,
  unique (agent_id, review_version),
  foreign key (agent_id, review_version) references public.review_versions(agent_id, version) on delete cascade
);

create table if not exists public.quiz_attempts (
  id uuid primary key,
  submission_id uuid not null unique,
  quiz_id uuid not null references public.quiz_definitions(id) on delete cascade,
  agent_id text not null,
  review_version text not null,
  score integer not null check (score between 0 and 3),
  passed boolean not null,
  record jsonb not null,
  created_at timestamptz not null,
  foreign key (agent_id, review_version) references public.review_versions(agent_id, version) on delete cascade
);

create table if not exists public.merge_operations (
  id uuid primary key,
  agent_id text not null,
  review_version text not null,
  status text not null check (status in ('pending', 'succeeded', 'record-pending', 'failed')),
  result_commit text,
  record jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (agent_id, review_version),
  foreign key (agent_id, review_version) references public.review_versions(agent_id, version) on delete cascade
);

alter table public.agent_runs enable row level security;
alter table public.review_versions enable row level security;
alter table public.explanations enable row level security;
alter table public.quiz_definitions enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.merge_operations enable row level security;

revoke all on table public.agent_runs, public.review_versions, public.explanations,
  public.quiz_definitions, public.quiz_attempts, public.merge_operations from anon, authenticated;
grant all on table public.agent_runs, public.review_versions, public.explanations,
  public.quiz_definitions, public.quiz_attempts, public.merge_operations to service_role;
