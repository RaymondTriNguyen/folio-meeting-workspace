create table if not exists public.provider_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  groq_api_key text,
  openai_api_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.provider_credentials enable row level security;
revoke all on public.provider_credentials from public, anon, authenticated;

-- Provider keys are encrypted by Folio before they reach this table.
-- Browser clients still have no direct table access; server routes use service_role.
