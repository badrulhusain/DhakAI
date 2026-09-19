-- Agent Classroom Phase 4: private drawings, rubric marks, immutable points, and badges.
-- The loopback Node backend uses the secret/service-role key. No browser policies exist.
create table if not exists public.drawings (
  id uuid primary key,
  agent_id text not null,
  review_version text not null,
  revision integer not null check (revision > 0),
  status text not null check (status in ('draft', 'completed')),
  storage_object_path text,
  record jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  unique (agent_id, review_version),
  foreign key (agent_id, review_version) references public.review_versions(agent_id, version) on delete cascade
);

create table if not exists public.drawing_checklists (
  drawing_id uuid not null references public.drawings(id) on delete cascade,
  agent_id text not null,
  review_version text not null,
  checklist jsonb not null,
  completed boolean not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (agent_id, review_version)
);

create table if not exists public.reviewer_rubric_marks (
  id uuid primary key,
  drawing_id uuid not null references public.drawings(id) on delete cascade,
  agent_id text not null,
  review_version text not null,
  total integer not null check (total between 0 and 20),
  record jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (agent_id, review_version)
);

create table if not exists public.point_transactions (
  id uuid primary key,
  agent_id text not null,
  review_version text not null,
  event_key text not null check (event_key in ('explanation_completed', 'quiz_passed', 'quiz_first_attempt', 'drawing_completed', 'drawing_checklist_complete', 'merge_verified')),
  points integer not null check (points > 0),
  record jsonb not null,
  created_at timestamptz not null,
  unique (agent_id, review_version, event_key),
  foreign key (agent_id, review_version) references public.review_versions(agent_id, version) on delete cascade
);

create table if not exists public.badge_awards (
  id uuid primary key,
  agent_id text not null,
  review_version text not null,
  badge_key text not null check (badge_key in ('code_reader', 'quiz_master', 'visual_thinker', 'safe_merger', 'full_journey')),
  record jsonb not null,
  created_at timestamptz not null,
  unique (agent_id, review_version, badge_key),
  foreign key (agent_id, review_version) references public.review_versions(agent_id, version) on delete cascade
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('learning-drawings', 'learning-drawings', false, 4194304, array['image/png'])
on conflict (id) do update set public = false, file_size_limit = 4194304, allowed_mime_types = array['image/png'];

alter table public.drawings enable row level security;
alter table public.drawing_checklists enable row level security;
alter table public.reviewer_rubric_marks enable row level security;
alter table public.point_transactions enable row level security;
alter table public.badge_awards enable row level security;

revoke all on table public.drawings, public.drawing_checklists, public.reviewer_rubric_marks,
  public.point_transactions, public.badge_awards from anon, authenticated;
grant all on table public.drawings, public.drawing_checklists, public.reviewer_rubric_marks,
  public.point_transactions, public.badge_awards to service_role;

-- No storage.objects policy is intentionally created: the bucket stays private and only
-- the server's service-role client may upload/download. The API validates agent/version access.
