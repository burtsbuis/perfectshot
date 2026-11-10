-- One row per (eval run, scenario). Written only by the server (secret key); no public access.
create table if not exists public.eval_runs (
  id uuid primary key default gen_random_uuid(),
  run_id text not null,                 -- groups the 10 scenarios of one run
  scenario_id integer not null,
  created_at timestamptz not null default now(),
  agent_stage smallint not null,
  model text not null,
  request jsonb not null,
  facts jsonb,
  plan jsonb,
  checks jsonb,
  judge jsonb,                          -- rubric scores + reasons
  judge_model text,
  error text,
  latency_ms integer,
  turns integer,
  input_tokens integer,
  output_tokens integer,
  judge_input_tokens integer,
  judge_output_tokens integer
);
create index if not exists eval_runs_run_idx on public.eval_runs (run_id, scenario_id);
alter table public.eval_runs enable row level security;
-- No policies: only the server's secret key can read or write.
