-- Profile extensions for PostgreSQL database
alter table public.app_users 
  add column if not exists avatar_preset text,
  add column if not exists bio text,
  add column if not exists country varchar(8),
  add column if not exists preferences jsonb not null default '{"notifications":true,"sound":true,"theme":"midnight"}'::jsonb,
  add column if not exists session_version integer not null default 0;

alter table public.player_stats 
  add column if not exists games_played integer not null default 0 check (games_played >= 0),
  add column if not exists current_streak integer not null default 0 check (current_streak >= 0),
  add column if not exists longest_streak integer not null default 0 check (longest_streak >= 0),
  add column if not exists uno_calls integer not null default 0 check (uno_calls >= 0),
  add column if not exists caught_without_uno integer not null default 0 check (caught_without_uno >= 0);

create table if not exists public.friendships (
  user_low uuid not null references public.app_users(id) on delete cascade,
  user_high uuid not null references public.app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_low, user_high)
);

alter table public.friendships enable row level security;
create policy "read own friendships" on public.friendships for select using (auth.uid() = user_low or auth.uid() = user_high);
create policy "manage own friendships" on public.friendships for insert with check (auth.uid() = user_low or auth.uid() = user_high);
create policy "delete own friendships" on public.friendships for delete using (auth.uid() = user_low or auth.uid() = user_high);
