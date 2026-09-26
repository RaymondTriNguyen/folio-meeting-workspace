create table if not exists public.meetings (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  status text not null default 'queued',
  data jsonb not null,
  constraint meeting_owner_payload check (data->>'id' = id::text)
);
create index if not exists meetings_user_created_idx on public.meetings(user_id, created_at desc);
alter table public.meetings enable row level security;
drop policy if exists "Owners can read meetings" on public.meetings;
create policy "Owners can read meetings" on public.meetings for select to authenticated using ((select auth.uid()) = user_id);
-- All mutations go through validated server routes. The service role is never exposed to the browser.
revoke insert, update, delete on public.meetings from anon, authenticated;
grant select on public.meetings to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recordings', 'recordings', false, 104857600,
  array['audio/mpeg','audio/mp4','audio/wav','audio/x-wav','audio/ogg','audio/flac','video/mp4','video/quicktime','video/webm','video/x-matroska','application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = 104857600;
drop policy if exists "Owners can read recordings" on storage.objects;
create policy "Owners can read recordings" on storage.objects for select to authenticated
using (bucket_id = 'recordings' and (storage.foldername(name))[1] = (select auth.uid())::text);

create table if not exists public.request_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null,
  started_at timestamptz not null default now(),
  used integer not null default 0,
  primary key (user_id, bucket)
);
alter table public.request_limits enable row level security;
create or replace function public.consume_request(p_user uuid, p_bucket text, p_limit integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare current_count integer;
begin
  insert into public.request_limits(user_id, bucket, used) values(p_user, p_bucket, 1)
  on conflict (user_id, bucket) do update set
    used = case when request_limits.started_at < now() - interval '1 hour' then 1 else request_limits.used + 1 end,
    started_at = case when request_limits.started_at < now() - interval '1 hour' then now() else request_limits.started_at end
  returning used into current_count;
  return current_count <= p_limit;
end;
$$;
revoke all on function public.consume_request(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.consume_request(uuid,text,integer) to service_role;
