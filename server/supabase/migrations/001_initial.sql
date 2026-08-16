-- Apply with the Supabase CLI or SQL editor. The browser never receives the service-role key.
create table if not exists public.app_users (
  id uuid primary key,
  username varchar(24) not null unique,
  avatar_url text,
  email_ciphertext text not null,
  email_hash char(64) not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.player_stats (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  rating integer not null default 1000,
  updated_at timestamptz not null default now()
);
create table if not exists public.matches (
  id uuid primary key,
  room_code char(6) not null,
  winner_id uuid not null,
  rounds integer not null check (rounds > 0),
  completed_at timestamptz not null default now()
);
create table if not exists public.match_players (
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null,
  username varchar(24) not null,
  score integer not null check (score >= 0),
  primary key (match_id, user_id)
);
create table if not exists public.abuse_reports (
  id uuid primary key,
  reporter_id uuid not null,
  room_code char(6),
  category varchar(16) not null,
  details text not null,
  created_at timestamptz not null default now()
);

create or replace view public.leaderboard with (security_invoker = true) as
  select u.id, u.username, s.wins, s.losses, s.rating
  from public.app_users u join public.player_stats s on s.user_id = u.id
  order by s.rating desc, s.wins desc;

alter table public.app_users enable row level security;
alter table public.player_stats enable row level security;
alter table public.matches enable row level security;
alter table public.match_players enable row level security;
alter table public.abuse_reports enable row level security;

-- Direct database access is restricted to the authenticated user represented by auth.uid().
-- The Node server uses its server-only connection and never proxies arbitrary SQL.
create policy "read own user record" on public.app_users for select using (auth.uid() = id);
create policy "read own stats" on public.player_stats for select using (auth.uid() = user_id);
create policy "read own matches" on public.matches for select using (exists (select 1 from public.match_players mp where mp.match_id = matches.id and mp.user_id = auth.uid()));
create policy "read own match rows" on public.match_players for select using (auth.uid() = user_id);
create policy "create own report" on public.abuse_reports for insert with check (auth.uid() = reporter_id);

revoke all on public.app_users, public.player_stats, public.matches, public.match_players, public.abuse_reports from anon;
grant select on public.leaderboard to authenticated;
