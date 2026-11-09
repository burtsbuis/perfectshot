-- Saved shot plans. One row per generated plan.
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  title text,
  request jsonb not null,          -- PlanRequest
  facts jsonb not null,            -- ShootFacts (snapshot used for the plan)
  plan jsonb not null,             -- ShotPlan
  agent_stage smallint not null default 1,  -- which agent architecture produced it
  model text,
  latency_ms integer,
  input_tokens integer,
  output_tokens integer
);

create index if not exists plans_user_created_idx on public.plans (user_id, created_at desc);

alter table public.plans enable row level security;

create policy "Users read own plans" on public.plans
  for select using (auth.uid() = user_id);
create policy "Users insert own plans" on public.plans
  for insert with check (auth.uid() = user_id);
create policy "Users delete own plans" on public.plans
  for delete using (auth.uid() = user_id);

-- Simple usage counter for rate limiting /api/plan (written by the server with the service role)
create table if not exists public.plan_usage (
  day date not null,
  key text not null,               -- 'global' or a hashed IP
  count integer not null default 0,
  primary key (day, key)
);
alter table public.plan_usage enable row level security;
-- No policies: only the service role can read or write.
