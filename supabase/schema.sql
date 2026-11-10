-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- CampusSpot database (Postgres, made for Supabase).
--
-- Every round belongs to a campus (through its map). Each campus has its own daily round, schedule
-- and leaderboards; a player belongs to one campus at a time (memberships) and can switch.
--
-- Security model: every table has row-level security ON and NO policies, so the public API can't
-- read or change any table directly. Everything goes through the functions below. Each one checks
-- who is calling before acting: guests, signed-in players (auth.uid()), approved contributors
-- (is_contributor), and admins (is_admin(): Google accounts on the admins list).
-- The answers to rounds are only ever returned to someone who has already guessed.
--
-- Safe to run again, and upgrades older versions in place: tables use IF NOT EXISTS, new columns
-- use ADD COLUMN IF NOT EXISTS, and functions use CREATE OR REPLACE.
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

-- ── tables ──────────────────────────────────────────────────────────────────────────────────────

create table if not exists public.settings (
  key   text primary key,
  value jsonb not null
);

-- Google accounts allowed to host rounds, edit maps and moderate names (keep this to 1–2 people).
create table if not exists public.admins (
  email text primary key check (email = lower(email))
);

-- Colleges players can pick. Filled from public/data/campuses.json by the setup script.
create table if not exists public.campuses (
  id         text primary key check (id ~ '^[a-z0-9-]{1,40}$'),
  name       text not null,
  short_name text not null,
  kind       text not null,                -- uc | csu | private | cc
  city       text not null default '',
  lat        double precision not null,
  lng        double precision not null,
  size       double precision not null default 0.006   -- half the default play area, in degrees latitude
);

create table if not exists public.maps (
  id         text primary key,
  data       jsonb not null,               -- { type: 'latlng', name, units, bounds: { sw, ne }, features, … }
  updated_at timestamptz not null default now()
);

create table if not exists public.rounds (
  id           uuid primary key default gen_random_uuid(),
  map_id       text not null references public.maps(id),
  title        text not null default '' check (length(title) <= 80),
  photo_path   text not null,              -- file name in the "photos" storage bucket
  difficulty   text not null,
  release_date date,                       -- the day it is "today's round" (campus time zone)
  created_by   uuid,
  created_at   timestamptz not null default now()
);
-- Added for contributor submissions (no-ops once present).
alter table public.rounds add column if not exists status text not null default 'published';
alter table public.rounds add column if not exists review_note text;
alter table public.rounds alter column release_date drop not null;
-- stored = approved but not scheduled yet; an admin picks its day later.
alter table public.rounds drop constraint if exists rounds_status_valid;
alter table public.rounds add constraint rounds_status_valid check (status in ('pending', 'stored', 'published', 'rejected'));
do $$ begin
  alter table public.rounds add constraint rounds_published_have_date check (status <> 'published' or release_date is not null);
exception when duplicate_object then null; end $$;
create index if not exists rounds_release_date on public.rounds (release_date desc);
-- Each map (and so each round) belongs to one campus. Older single-campus maps are assigned to
-- Cal Poly Pomona by the setup script.
alter table public.maps add column if not exists campus_id text references public.campuses(id);
create index if not exists maps_campus on public.maps (campus_id);
create index if not exists rounds_map on public.rounds (map_id);

-- Players who asked to submit photos. An admin approves or denies each request; approved
-- contributors' photos still go through review before they're scheduled.
create table if not exists public.contributors (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  note       text not null default '' check (length(note) <= 300),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

-- The secret part of a round, kept apart so it can never leak through a round listing.
create table if not exists public.round_answers (
  round_id uuid primary key references public.rounds(id) on delete cascade,
  pos      jsonb not null,
  heading  double precision not null
);

create table if not exists public.profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  hidden       boolean not null default false,   -- set by an admin to take a name off the leaderboard
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists profiles_display_name_unique on public.profiles (lower(display_name));
alter table public.profiles add column if not exists grad_year integer check (grad_year between 1950 and 2100);

-- The one campus a player belongs to. Their scores count on that campus's leaderboards only.
create table if not exists public.memberships (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  campus_id text not null references public.campuses(id),
  joined_at timestamptz not null default now()
);
create index if not exists memberships_campus on public.memberships (campus_id);

create table if not exists public.guesses (
  id               uuid primary key default gen_random_uuid(),
  round_id         uuid not null references public.rounds(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  pos              jsonb not null,
  heading          double precision not null,
  distance         double precision not null,
  angle_error      double precision not null,
  position_points  integer not null,
  direction_points integer not null,
  multiplier       double precision not null,
  total            integer not null,
  max              integer not null,
  ranked           boolean not null,            -- counts on the leaderboard
  created_at       timestamptz not null default now()
);
create index if not exists guesses_round on public.guesses (round_id);
create index if not exists guesses_user on public.guesses (user_id);
-- At most one leaderboard entry per player per round.
create unique index if not exists guesses_one_ranked on public.guesses (round_id, user_id) where ranked;

alter table public.campuses      enable row level security;
alter table public.memberships   enable row level security;
alter table public.settings      enable row level security;
alter table public.admins        enable row level security;
alter table public.maps          enable row level security;
alter table public.contributors  enable row level security;
alter table public.rounds        enable row level security;
alter table public.round_answers enable row level security;
alter table public.profiles      enable row level security;
alter table public.guesses       enable row level security;

-- ── small helpers ───────────────────────────────────────────────────────────────────────────────

create or replace function public.setting(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select value from settings where key = p_key
$$;

create or replace function public.today_local() returns date
language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce((select value #>> '{}' from settings where key = 'timezone'), 'America/Los_Angeles'))::date
$$;

-- Admin = signed in with an allowed provider (Google) using an email on the admins list.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'provider') in (
      select jsonb_array_elements_text(coalesce((select value from settings where key = 'admin_providers'), '["google"]'))
    )
    and exists (select 1 from admins where email = lower(auth.jwt() ->> 'email')),
    false)
$$;

create or replace function public.assert_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can do that' using errcode = '42501';
  end if;
end $$;

-- Contributor = signed-in player whose request to submit photos an admin approved.
create or replace function public.is_contributor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from contributors where user_id = auth.uid() and status = 'approved')
$$;

-- May upload round photos: admins and approved contributors (used by the storage rules).
create or replace function public.can_upload() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_contributor()
$$;

-- Functions whose arguments changed when campuses were added (dropped so no old versions linger).
drop function if exists public.next_free_date();
drop function if exists public.get_maps();
drop function if exists public.get_today();
drop function if exists public.list_rounds(boolean);
drop function if exists public.leaderboard_round(uuid);
drop function if exists public.leaderboard_overall(integer);

create or replace function public.round_campus(r public.rounds) returns text
language sql stable security definer set search_path = public as $$
  select campus_id from maps where id = r.map_id
$$;

-- Is this player a member of that campus right now? (Only members show on its leaderboards.)
create or replace function public.is_member(p_user uuid, p_campus text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where user_id = p_user and campus_id = p_campus)
$$;

create or replace function public.my_campus() returns text
language sql stable security definer set search_path = public as $$
  select campus_id from memberships where user_id = auth.uid()
$$;

create or replace function public.assert_campus(p_campus text) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if p_campus is null or not exists (select 1 from campuses where id = p_campus) then
    raise exception 'Pick a campus' using errcode = '22023', hint = 'needs_campus';
  end if;
  return p_campus;
end $$;

-- The first day from today on that has no published round at that campus.
create or replace function public.next_free_date(p_campus text) returns date
language sql stable security definer set search_path = public as $$
  select min(d)::date from generate_series(public.today_local(), public.today_local() + 3650, interval '1 day') d
  where not exists (select 1 from rounds r join maps m on m.id = r.map_id
                    where m.campus_id = p_campus and r.status = 'published' and r.release_date = d::date)
$$;

create or replace function public.assert_signed_in() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Please sign in first' using errcode = '28000';
  end if;
  return auth.uid();
end $$;

-- ── geometry and scoring (mirrors public/shared/geo.js and scoring.js; tests check they agree) ──

create or replace function public.norm360(d double precision) returns double precision
language sql immutable as $$ select d - 360 * floor(d / 360) $$;

create or replace function public.angle_error(a double precision, b double precision) returns double precision
language sql immutable as $$
  select case when x > 180 then 360 - x else x end
  from (select abs(public.norm360(a) - public.norm360(b)) as x) t
$$;

create or replace function public.haversine(a jsonb, b jsonb) returns double precision
language sql immutable as $$
  select 2 * 6371008.8 * asin(least(1, sqrt(
    sin((radians((b->>'lat')::float8) - radians((a->>'lat')::float8)) / 2) ^ 2
    + cos(radians((a->>'lat')::float8)) * cos(radians((b->>'lat')::float8))
      * sin(radians((b->>'lng')::float8 - (a->>'lng')::float8) / 2) ^ 2)))
$$;

-- Positions are { lat, lng }. `m` is the map (its play area bounds the positions).
create or replace function public.valid_pos(m jsonb, p jsonb) returns boolean
language sql immutable as $$
  select coalesce(jsonb_typeof(p->'lat') = 'number' and jsonb_typeof(p->'lng') = 'number', false)
$$;

create or replace function public.clamp_pos(m jsonb, p jsonb) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'lat', least(greatest((p->>'lat')::float8, (m#>>'{bounds,sw,lat}')::float8), (m#>>'{bounds,ne,lat}')::float8),
    'lng', least(greatest((p->>'lng')::float8, (m#>>'{bounds,sw,lng}')::float8), (m#>>'{bounds,ne,lng}')::float8))
$$;

create or replace function public.map_distance(m jsonb, a jsonb, b jsonb) returns double precision
language sql immutable as $$ select public.haversine(a, b) $$;

create or replace function public.map_span(m jsonb) returns double precision
language sql immutable as $$ select public.haversine(m#>'{bounds,sw}', m#>'{bounds,ne}') $$;

-- Same formulas as shared/scoring.js. Rounding is floor(x + 0.5) to match JavaScript's Math.round.
create or replace function public.score_guess(
  m jsonb, difficulty text, truth_pos jsonb, truth_heading double precision,
  pos jsonb, heading double precision, cfg jsonb
) returns jsonb
language plpgsql immutable as $$
declare
  d jsonb := coalesce(cfg->'difficulties'->difficulty, cfg->'difficulties'->(cfg->>'defaultDifficulty'));
  pmax float8 := (cfg#>>'{position,max}')::float8;
  dmax float8 := (cfg#>>'{direction,max}')::float8;
  dist float8 := public.map_distance(m, truth_pos, pos);
  ang float8 := public.angle_error(truth_heading, heading);
  scale float8;
  p int; dir int; mult float8;
begin
  scale := greatest((cfg#>>'{position,minScaleMeters}')::float8,
                    public.map_span(m) * (cfg#>>'{position,scaleFraction}')::float8 * coalesce((d->>'scale')::float8, 1));
  p := floor(pmax * exp(-dist / scale) + 0.5);
  dir := floor(dmax * (1 - ang / 180) + 0.5);
  mult := case when coalesce((cfg->>'useDifficultyMultiplier')::boolean, false) then coalesce((d->>'multiplier')::float8, 1) else 1 end;
  return jsonb_build_object(
    'distance', dist, 'angleError', ang, 'scale', scale,
    'position', p, 'direction', dir, 'multiplier', mult,
    'total', floor((p + dir) * mult + 0.5)::int,
    'max', floor((pmax + dmax) * mult + 0.5)::int);
end $$;

-- ── JSON shapes sent to the app ─────────────────────────────────────────────────────────────────

create or replace function public.round_json(r public.rounds) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.id, 'mapId', r.map_id, 'campusId', public.round_campus(r), 'title', r.title, 'difficulty', r.difficulty, 'status', r.status,
    'date', to_char(r.release_date, 'YYYY-MM-DD'), 'photoPath', r.photo_path, 'createdAt', r.created_at,
    'plays', (select count(*) from guesses g where g.round_id = r.id and g.ranked),
    'mine', (select jsonb_build_object('played', true, 'best', max(g.total))
             from guesses g where g.round_id = r.id and g.user_id = auth.uid() having count(*) > 0))
$$;

create or replace function public.guess_json(g public.guesses) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', g.id, 'roundId', g.round_id, 'pos', g.pos, 'heading', g.heading,
    'distance', g.distance, 'angleError', g.angle_error, 'position', g.position_points, 'direction', g.direction_points,
    'multiplier', g.multiplier, 'total', g.total, 'max', g.max, 'ranked', g.ranked, 'createdAt', g.created_at)
$$;

create or replace function public.map_json(p_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  select data || jsonb_build_object('id', id, 'campusId', campus_id) from maps where id = p_id
$$;

create or replace function public.campus_json(c public.campuses) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'short', c.short_name, 'kind', c.kind, 'city', c.city, 'lat', c.lat, 'lng', c.lng)
$$;

-- A round is visible once it's published and its day has arrived. Admins see every round, and
-- contributors see the ones they submitted.
create or replace function public.visible_round(p_id uuid) returns public.rounds
language plpgsql stable security definer set search_path = public as $$
declare r rounds;
begin
  select * into r from rounds where id = p_id;
  if not found or not (
       (r.status = 'published' and r.release_date <= public.today_local())
       or public.is_admin()
       or (auth.uid() is not null and r.created_by = auth.uid())) then
    raise exception 'Round not found' using errcode = 'P0002';
  end if;
  return r;
end $$;

create or replace function public.result_json(r public.rounds, guesses_json jsonb, already boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'round', public.round_json(r),
    'map', public.map_json(r.map_id),
    'truth', (select jsonb_build_object('pos', a.pos, 'heading', a.heading) from round_answers a where a.round_id = r.id),
    'guesses', guesses_json,
    'alreadyPlayed', already,
    'rank', (select jsonb_build_object(
               'place', 1 + count(*) filter (where g.total > mine.total),
               'of', count(*))
             from guesses g,
                  (select total from guesses where round_id = r.id and user_id = auth.uid() and ranked
                   and public.is_member(auth.uid(), public.round_campus(r))) mine
             where g.round_id = r.id and g.ranked and public.is_member(g.user_id, public.round_campus(r))
             having count(*) > 0))
$$;

-- ── player API ──────────────────────────────────────────────────────────────────────────────────

create or replace function public.get_bootstrap() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'today', to_char(public.today_local(), 'YYYY-MM-DD'),
    'timezone', coalesce((select value #>> '{}' from settings where key = 'timezone'), 'America/Los_Angeles'),
    'scoring', (select value from settings where key = 'scoring'),
    'signedIn', auth.uid() is not null,
    'isAdmin', public.is_admin(),
    'profile', (select jsonb_build_object('displayName', display_name, 'hidden', hidden, 'gradYear', grad_year) from profiles where user_id = auth.uid()),
    'campus', (select public.campus_json(c) from memberships mm join campuses c on c.id = mm.campus_id where mm.user_id = auth.uid()),
    'contributor', (select status from contributors where user_id = auth.uid()))
$$;

-- A campus's maps. Every campus starts with one: a box around its center that admins can adjust.
create or replace function public.get_maps(p_campus text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare c campuses;
begin
  select * into c from campuses where id = public.assert_campus(p_campus);
  if not exists (select 1 from maps where campus_id = c.id) then
    insert into maps (id, campus_id, data) values (
      case when exists (select 1 from maps where id = c.id) then substr(md5(gen_random_uuid()::text), 1, 10) else c.id end,
      c.id,
      jsonb_build_object('type', 'latlng', 'name', c.name, 'units', 'ft', 'features', '[]'::jsonb, 'bounds', jsonb_build_object(
        'sw', jsonb_build_object('lat', c.lat - c.size, 'lng', c.lng - c.size / cos(radians(c.lat))),
        'ne', jsonb_build_object('lat', c.lat + c.size, 'lng', c.lng + c.size / cos(radians(c.lat))))));
  end if;
  return (select coalesce(jsonb_agg(data || jsonb_build_object('id', id, 'campusId', campus_id) order by updated_at), '[]'::jsonb)
          from maps where campus_id = c.id);
end $$;

create or replace function public.get_campuses() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.campus_json(c) order by c.name), '[]'::jsonb) from campuses c
$$;

-- Today's round at a campus.
create or replace function public.get_today(p_campus text) returns jsonb
language sql stable security definer set search_path = public as $$
  select public.round_json(r) from rounds r join maps m on m.id = r.map_id
  where m.campus_id = p_campus and r.status = 'published' and r.release_date = public.today_local()
  order by r.created_at desc limit 1
$$;

-- A campus's released rounds, newest first (admins: pass true to include scheduled ones).
create or replace function public.list_rounds(p_campus text, p_include_scheduled boolean default false) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.round_json(r) order by r.release_date desc, r.created_at desc), '[]'::jsonb)
  from rounds r join maps m on m.id = r.map_id
  where m.campus_id = p_campus and r.status = 'published'
    and (r.release_date <= public.today_local() or (p_include_scheduled and public.is_admin()))
$$;

create or replace function public.get_round(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r rounds := public.visible_round(p_id);
begin
  return jsonb_build_object('round', public.round_json(r), 'map', public.map_json(r.map_id),
                            'isToday', r.status = 'published' and r.release_date = public.today_local());
end $$;

-- Score a guess. Today's round, signed in: one attempt. It's ranked when the player is a member of the
-- round's campus (and didn't make the round). Guests (any round) and older rounds: scored but not
-- ranked; guests' guesses aren't stored.
create or replace function public.submit_guess(p_round uuid, p_pos jsonb, p_heading double precision) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  r rounds := public.visible_round(p_round);
  m jsonb := public.map_json(r.map_id);
  a round_answers;
  uid uuid := auth.uid();
  is_today boolean := r.status = 'published' and r.release_date = public.today_local();
  pos jsonb; heading float8; s jsonb; g guesses; is_ranked boolean := false;
begin
  if not public.valid_pos(m, p_pos) then
    raise exception 'Place your guess on the map' using errcode = '22023';
  end if;
  if p_heading is null or p_heading in ('NaN'::float8, 'Infinity'::float8, '-Infinity'::float8) then
    raise exception 'Set a direction' using errcode = '22023';
  end if;
  pos := public.clamp_pos(m, p_pos);
  heading := public.norm360(p_heading);
  select * into a from round_answers where round_id = r.id;

  if is_today and uid is not null then
    if not exists (select 1 from profiles where user_id = uid) then
      raise exception 'Choose a leaderboard name first' using errcode = 'P0001', hint = 'needs_name';
    end if;
    -- one try at today's round: a second submission just shows the first result again
    if exists (select 1 from guesses where round_id = r.id and user_id = uid) then
      return public.result_json(r, (select jsonb_agg(public.guess_json(x) order by x.created_at) from guesses x
                                    where x.round_id = r.id and x.user_id = uid), true);
    end if;
    is_ranked := r.created_by is distinct from uid and public.is_member(uid, public.round_campus(r));
  end if;

  s := public.score_guess(m, r.difficulty, a.pos, a.heading, pos, heading, public.setting('scoring'));

  if uid is null then
    -- guest practice: scored, not stored
    return public.result_json(r, jsonb_build_array(s || jsonb_build_object(
      'id', null, 'roundId', r.id, 'pos', pos, 'heading', heading, 'ranked', false, 'createdAt', now())), false);
  end if;

  begin
    insert into guesses (round_id, user_id, pos, heading, distance, angle_error, position_points, direction_points,
                         multiplier, total, max, ranked)
    values (r.id, uid, pos, heading, (s->>'distance')::float8, (s->>'angleError')::float8, (s->>'position')::int,
            (s->>'direction')::int, (s->>'multiplier')::float8, (s->>'total')::int, (s->>'max')::int, is_ranked);
  exception when unique_violation then
    null; -- a parallel submission won the race; fall through and return what's stored
  end;
  return public.result_json(r, (select jsonb_agg(public.guess_json(x) order by x.created_at) from guesses x
                                where x.round_id = r.id and x.user_id = uid), false);
end $$;

-- Your guesses on a round (and the answer, once you've guessed).
create or replace function public.get_my_result(p_round uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r rounds := public.visible_round(p_round);
  mine jsonb;
begin
  select jsonb_agg(public.guess_json(g) order by g.created_at) into mine
  from guesses g where g.round_id = r.id and g.user_id = auth.uid();
  if mine is null then
    return jsonb_build_object('round', public.round_json(r), 'map', public.map_json(r.map_id), 'guesses', '[]'::jsonb, 'truth', null);
  end if;
  return public.result_json(r, mine, false);
end $$;

-- Leaderboard for one round (default: today's at p_campus). Only the campus's current members count.
create or replace function public.leaderboard_round(p_round uuid default null, p_campus text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  rid uuid := p_round;
  r rounds;
begin
  if rid is null then
    rid := (public.get_today(p_campus))->>'id';
    if rid is null then return jsonb_build_object('round', null, 'rows', '[]'::jsonb); end if;
  end if;
  r := public.visible_round(rid);
  return jsonb_build_object('round', public.round_json(r), 'rows', coalesce((
    select jsonb_agg(jsonb_build_object('place', t.place, 'name', t.name, 'gradYear', t.grad_year, 'total', t.total, 'distance', t.distance,
                                        'angleError', t.angle_error, 'me', t.me) order by t.place, t.created_at)
    from (
      select rank() over (order by g.total desc) as place, p.display_name as name, p.grad_year, g.total, g.distance, g.angle_error,
             g.user_id = auth.uid() as me, g.created_at
      from guesses g join profiles p on p.user_id = g.user_id
      join memberships mm on mm.user_id = g.user_id and mm.campus_id = public.round_campus(r)
      where g.round_id = r.id and g.ranked and not p.hidden
      order by g.total desc, g.created_at
      limit 100) t), '[]'::jsonb));
end $$;

-- A campus's overall leaderboard: its current members' points on its rounds, all time or the last p_days days.
create or replace function public.leaderboard_overall(p_campus text, p_days integer default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('place', t.place, 'name', t.name, 'gradYear', t.grad_year, 'total', t.total, 'rounds', t.rounds,
                                               'average', t.average, 'me', t.me) order by t.place, t.name), '[]'::jsonb)
  from (
    select rank() over (order by sum(g.total) desc) as place, p.display_name as name, p.grad_year, sum(g.total)::int as total,
           count(*)::int as rounds, round(avg(g.total))::int as average, bool_or(g.user_id = auth.uid()) as me
    from guesses g
    join profiles p on p.user_id = g.user_id
    join rounds r on r.id = g.round_id
    join maps m on m.id = r.map_id and m.campus_id = p_campus
    join memberships mm on mm.user_id = g.user_id and mm.campus_id = p_campus
    where g.ranked and not p.hidden
      and (p_days is null or r.release_date > public.today_local() - p_days)
    group by g.user_id, p.display_name, p.grad_year
    order by sum(g.total) desc
    limit 100) t
$$;

-- Choose or change your leaderboard name.
create or replace function public.set_display_name(p_name text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := public.assert_signed_in();
  clean text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  squashed text := lower(regexp_replace(clean, '[^A-Za-z0-9]', '', 'g'));
  bad text;
begin
  if length(clean) < 3 or length(clean) > 20 then
    raise exception 'Names are 3 to 20 characters' using errcode = '22023';
  end if;
  if clean !~ '^[A-Za-z0-9][A-Za-z0-9 _.\-]*$' then
    raise exception 'Use letters, numbers, spaces, and - _ . only' using errcode = '22023';
  end if;
  for bad in select jsonb_array_elements_text(coalesce(public.setting('blocked_names'), '[]'::jsonb)) loop
    if squashed like '%' || bad || '%' then
      raise exception 'Please pick a different name' using errcode = '22023';
    end if;
  end loop;
  begin
    insert into profiles (user_id, display_name) values (uid, clean)
    on conflict (user_id) do update set display_name = excluded.display_name, hidden = false, updated_at = now();
  exception when unique_violation then
    raise exception 'That name is taken' using errcode = '23505';
  end;
  return jsonb_build_object('displayName', clean, 'hidden', false);
end $$;

-- Join a campus (or switch to another). Your scores count on your current campus's leaderboards only;
-- switching back later brings your scores there back.
create or replace function public.join_campus(p_campus text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare uid uuid := public.assert_signed_in();
begin
  perform public.assert_campus(p_campus);
  insert into memberships (user_id, campus_id) values (uid, p_campus)
  on conflict (user_id) do update set campus_id = excluded.campus_id,
    joined_at = case when memberships.campus_id = excluded.campus_id then memberships.joined_at else now() end;
  return (select public.campus_json(c) from campuses c where id = p_campus);
end $$;

-- Optional class year shown next to your name. null clears it.
create or replace function public.set_grad_year(p_year integer) returns void
language plpgsql volatile security definer set search_path = public as $$
declare uid uuid := public.assert_signed_in();
begin
  if p_year is not null and (p_year < 1950 or p_year > extract(year from now())::int + 10) then
    raise exception 'Pick a real graduation year' using errcode = '22023';
  end if;
  update profiles set grad_year = p_year, updated_at = now() where user_id = uid;
  if not found then raise exception 'Choose a leaderboard name first' using errcode = 'P0001', hint = 'needs_name'; end if;
end $$;

-- Delete your account and everything linked to it (name, guesses).
create or replace function public.delete_my_account() returns void
language plpgsql volatile security definer set search_path = public as $$
declare uid uuid := public.assert_signed_in();
begin
  delete from auth.users where id = uid; -- profiles and guesses are removed with it (on delete cascade)
end $$;

-- ── admin API ───────────────────────────────────────────────────────────────────────────────────

create or replace function public.admin_save_map(p_map jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  map_id text := coalesce(nullif(p_map->>'id', ''), substr(md5(gen_random_uuid()::text), 1, 10));
  m jsonb;
  feats jsonb;
begin
  perform public.assert_admin();
  if map_id !~ '^[a-z0-9-]{1,40}$' then raise exception 'Bad map id' using errcode = '22023'; end if;
  if not (public.valid_pos(null, p_map#>'{bounds,sw}') and public.valid_pos(null, p_map#>'{bounds,ne}'))
     or (p_map#>>'{bounds,sw,lat}')::float8 >= (p_map#>>'{bounds,ne,lat}')::float8
     or (p_map#>>'{bounds,sw,lng}')::float8 >= (p_map#>>'{bounds,ne,lng}')::float8
     or abs((p_map#>>'{bounds,sw,lat}')::float8) > 85 or abs((p_map#>>'{bounds,ne,lat}')::float8) > 85 then
    raise exception 'Invalid play area' using errcode = '22023';
  end if;

  m := jsonb_build_object(
    'type', 'latlng',
    'name', coalesce(nullif(left(trim(coalesce(p_map->>'name', '')), 60), ''), 'Untitled map'),
    'units', case when p_map->>'units' = 'm' then 'm' else 'ft' end,
    'bounds', jsonb_build_object(
      'sw', jsonb_build_object('lat', (p_map#>>'{bounds,sw,lat}')::float8, 'lng', (p_map#>>'{bounds,sw,lng}')::float8),
      'ne', jsonb_build_object('lat', (p_map#>>'{bounds,ne,lat}')::float8, 'lng', (p_map#>>'{bounds,ne,lng}')::float8)));
  if public.map_span(m) > 50000 then raise exception 'Play area is too big (max 50 km across)' using errcode = '22023'; end if;
  if p_map->>'osmImportedAt' ~ '^\d{4}-\d{2}-\d{2}T' then m := m || jsonb_build_object('osmImportedAt', left(p_map->>'osmImportedAt', 40)); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', coalesce(nullif(left(f->>'id', 30), ''), substr(md5(gen_random_uuid()::text), 1, 8)),
           'label', coalesce(nullif(left(trim(coalesce(f->>'label', '')), 60), ''), 'Label'),
           'kind', case when f->>'kind' in ('building', 'parking', 'place', 'custom') then f->>'kind' else 'custom' end,
           'source', case when f->>'source' = 'osm' then 'osm' else 'user' end,
           'pos', public.clamp_pos(m, f->'pos'))), '[]'::jsonb)
    into feats
  from (select f from jsonb_array_elements(case when jsonb_typeof(p_map->'features') = 'array' then p_map->'features' else '[]' end) f
        limit 400) x
  where public.valid_pos(m, f->'pos');
  m := m || jsonb_build_object('features', feats);

  if not exists (select 1 from maps where id = map_id) then
    perform public.assert_campus(p_map->>'campusId');
  end if;
  insert into maps (id, data, campus_id) values (map_id, m, p_map->>'campusId')
  on conflict (id) do update set data = excluded.data, updated_at = now();
  return public.map_json(map_id);
end $$;

-- Checks a new round (photo, spot, direction, difficulty) and returns its map, or raises.
create or replace function public.check_round_input(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m jsonb := public.map_json(p->>'mapId');
begin
  if m is null then raise exception 'Pick a map' using errcode = '22023'; end if;
  if not public.valid_pos(m, p#>'{truth,pos}') then raise exception 'Set where the photo was taken' using errcode = '22023'; end if;
  if jsonb_typeof(p#>'{truth,heading}') is distinct from 'number' then raise exception 'Set the camera direction' using errcode = '22023'; end if;
  if not coalesce((public.setting('scoring')->'difficulties') ? (p->>'difficulty'), false) then raise exception 'Pick a difficulty' using errcode = '22023'; end if;
  if coalesce(p->>'photoPath', '') !~ '^[A-Za-z0-9][A-Za-z0-9/_.-]{0,199}$' then raise exception 'Add a photo' using errcode = '22023'; end if;
  return m;
end $$;

-- Stores a round and its answer.
create or replace function public.insert_round(p jsonb, m jsonb, p_status text, p_date date) returns public.rounds
language plpgsql volatile security definer set search_path = public as $$
declare r rounds;
begin
  insert into rounds (map_id, title, photo_path, difficulty, release_date, created_by, status)
  values (m->>'id', left(trim(coalesce(p->>'title', '')), 80), p->>'photoPath', p->>'difficulty', p_date, auth.uid(), p_status)
  returning * into r;
  insert into round_answers (round_id, pos, heading)
  values (r.id, public.clamp_pos(m, p#>'{truth,pos}'), public.norm360((p#>>'{truth,heading}')::float8));
  return r;
end $$;

create or replace function public.admin_create_round(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare m jsonb;
begin
  perform public.assert_admin();
  m := public.check_round_input(p);
  if coalesce(p->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Pick a release date' using errcode = '22023'; end if;
  return public.round_json(public.insert_round(p, m, 'published', (p->>'date')::date));
end $$;

-- Change title, difficulty or release date.
create or replace function public.admin_update_round(p_id uuid, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare r rounds;
begin
  perform public.assert_admin();
  if p ? 'difficulty' and not coalesce((public.setting('scoring')->'difficulties') ? (p->>'difficulty'), false) then
    raise exception 'Pick a difficulty' using errcode = '22023';
  end if;
  if p ? 'date' and coalesce(p->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Pick a release date' using errcode = '22023';
  end if;
  update rounds set
    title = case when p ? 'title' then left(trim(coalesce(p->>'title', '')), 80) else title end,
    difficulty = case when p ? 'difficulty' then p->>'difficulty' else difficulty end,
    release_date = case when p ? 'date' then (p->>'date')::date else release_date end
  where id = p_id returning * into r;
  if not found then raise exception 'Round not found' using errcode = 'P0002'; end if;
  return public.round_json(r);
end $$;

-- Deletes a round with its guesses. Returns the photo path so the app can delete the file too.
create or replace function public.admin_delete_round(p_id uuid) returns text
language plpgsql volatile security definer set search_path = public as $$
declare path text;
begin
  perform public.assert_admin();
  delete from rounds where id = p_id returning photo_path into path;
  if path is null then raise exception 'Round not found' using errcode = 'P0002'; end if;
  return path;
end $$;

create or replace function public.admin_round_answer(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_admin();
  return (select jsonb_build_object('pos', pos, 'heading', heading) from round_answers where round_id = p_id);
end $$;

create or replace function public.admin_players() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('userId', p.user_id, 'name', p.display_name, 'hidden', p.hidden, 'createdAt', p.created_at,
                                        'campus', (select c.short_name from memberships mm join campuses c on c.id = mm.campus_id where mm.user_id = p.user_id),
                                        'plays', coalesce(s.plays, 0), 'total', coalesce(s.total, 0)) order by p.created_at desc)
    from profiles p
    left join (select user_id, count(*) filter (where ranked) as plays, sum(total) filter (where ranked) as total
               from guesses group by user_id) s on s.user_id = p.user_id), '[]'::jsonb);
end $$;

-- Hide/unhide a player's name on the leaderboard (they're asked to pick a new one).
create or replace function public.admin_set_hidden(p_user uuid, p_hidden boolean) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.assert_admin();
  update profiles set hidden = p_hidden, updated_at = now() where user_id = p_user;
end $$;

create or replace function public.admin_list_admins() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_admin();
  return (select coalesce(jsonb_agg(email order by email), '[]'::jsonb) from admins);
end $$;

-- ── contributors ────────────────────────────────────────────────────────────────────────────────

-- Ask to submit photos. A denied player can ask again; an approved one stays approved.
create or replace function public.request_contributor(p_note text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare uid uuid := public.assert_signed_in();
begin
  if not exists (select 1 from profiles where user_id = uid) then
    raise exception 'Choose a leaderboard name first' using errcode = 'P0001', hint = 'needs_name';
  end if;
  if public.my_campus() is null then raise exception 'Join a campus first' using errcode = 'P0001', hint = 'needs_campus'; end if;
  insert into contributors (user_id, note) values (uid, left(trim(coalesce(p_note, '')), 300))
  on conflict (user_id) do update
    set status = case when contributors.status = 'approved' then 'approved' else 'pending' end,
        note = excluded.note, created_at = case when contributors.status = 'approved' then contributors.created_at else now() end;
  return (select status from contributors where user_id = uid);
end $$;

-- A contributor's photo + answer. It waits in the review queue until an admin approves it.
create or replace function public.submit_round(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare m jsonb;
begin
  perform public.assert_signed_in();
  if not public.can_upload() then raise exception 'Only approved contributors can submit photos' using errcode = '42501'; end if;
  if (select count(*) from rounds where created_by = auth.uid() and status = 'pending') >= 10 then
    raise exception 'You have 10 photos waiting for review; please wait for those first' using errcode = 'P0001';
  end if;
  m := public.check_round_input(p);
  if not public.is_admin() and m->>'campusId' is distinct from public.my_campus() then
    raise exception 'You can only submit photos of your own campus' using errcode = '42501';
  end if;
  return public.round_json(public.insert_round(p, m, 'pending', null));
end $$;

-- Everything you've submitted, newest first, with its review status.
create or replace function public.my_submissions() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.round_json(r) || jsonb_build_object('reviewNote', r.review_note) order by r.created_at desc), '[]'::jsonb)
  from rounds r where r.created_by = auth.uid() and auth.uid() is not null
$$;

-- ── review (admins) ─────────────────────────────────────────────────────────────────────────────

create or replace function public.admin_review_queue() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_admin();
  return coalesce((
    select jsonb_agg(public.round_json(r) || jsonb_build_object(
             'submittedBy', coalesce(p.display_name, '(no name)'), 'submitterEmail', u.email, 'campus', c.short_name) order by r.created_at)
    from rounds r left join profiles p on p.user_id = r.created_by left join auth.users u on u.id = r.created_by
    left join maps m on m.id = r.map_id left join campuses c on c.id = m.campus_id
    where r.status in ('pending', 'stored')), '[]'::jsonb);
end $$;

-- Publishes a submission (waiting or in storage) on the given day, or the next day without a round.
create or replace function public.admin_approve_round(p_id uuid, p_date date default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare r rounds;
begin
  perform public.assert_admin();
  if p_date < public.today_local() then raise exception 'Pick today or a later day' using errcode = '22023'; end if;
  update rounds set status = 'published', review_note = null,
    release_date = coalesce(p_date, public.next_free_date(public.round_campus(rounds)))
  where id = p_id and status in ('pending', 'stored') returning * into r;
  if not found then raise exception 'That submission is no longer waiting for review' using errcode = 'P0002'; end if;
  return public.round_json(r);
end $$;

-- Approves a submission without scheduling it: it waits in storage until an admin picks a day.
create or replace function public.admin_store_round(p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare r rounds;
begin
  perform public.assert_admin();
  update rounds set status = 'stored', review_note = null
  where id = p_id and status = 'pending' returning * into r;
  if not found then raise exception 'That submission is no longer waiting for review' using errcode = 'P0002'; end if;
  return public.round_json(r);
end $$;

-- Rejects a submission (the contributor sees the note). Returns the photo path so the app can delete it.
create or replace function public.admin_reject_round(p_id uuid, p_note text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare path text;
begin
  perform public.assert_admin();
  update rounds set status = 'rejected', review_note = left(trim(coalesce(p_note, '')), 300)
  where id = p_id and status in ('pending', 'stored') returning photo_path into path;
  if path is null then raise exception 'That submission is no longer waiting for review' using errcode = 'P0002'; end if;
  return path;
end $$;

create or replace function public.admin_contributors() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('userId', c.user_id, 'name', coalesce(p.display_name, '(no name)'), 'email', u.email,
                                        'campus', (select x.short_name from memberships mm join campuses x on x.id = mm.campus_id where mm.user_id = c.user_id),
                                        'status', c.status, 'note', c.note, 'requestedAt', c.created_at,
                                        'submitted', (select count(*) from rounds r where r.created_by = c.user_id),
                                        'published', (select count(*) from rounds r where r.created_by = c.user_id and r.status = 'published'))
                     order by c.status = 'pending' desc, c.created_at desc)
    from contributors c left join profiles p on p.user_id = c.user_id left join auth.users u on u.id = c.user_id), '[]'::jsonb);
end $$;

create or replace function public.admin_set_contributor(p_user uuid, p_status text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.assert_admin();
  if p_status not in ('approved', 'denied') then raise exception 'Bad status' using errcode = '22023'; end if;
  update contributors set status = p_status, decided_at = now() where user_id = p_user;
  if not found then raise exception 'No request from that player' using errcode = 'P0002'; end if;
end $$;

-- ── who may call what ───────────────────────────────────────────────────────────────────────────

revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.is_admin(), public.can_upload(), public.get_bootstrap(), public.get_campuses(), public.get_maps(text), public.get_today(text),
  public.list_rounds(text, boolean), public.get_round(uuid), public.submit_guess(uuid, jsonb, double precision), public.get_my_result(uuid),
  public.leaderboard_round(uuid, text), public.leaderboard_overall(text, integer)
  to anon, authenticated;

grant execute on function
  public.set_display_name(text), public.delete_my_account(), public.join_campus(text), public.set_grad_year(integer),
  public.admin_save_map(jsonb), public.admin_create_round(jsonb), public.admin_update_round(uuid, jsonb),
  public.admin_delete_round(uuid), public.admin_round_answer(uuid), public.admin_players(),
  public.admin_set_hidden(uuid, boolean), public.admin_list_admins(),
  public.request_contributor(text), public.submit_round(jsonb), public.my_submissions(),
  public.admin_review_queue(), public.admin_approve_round(uuid, date), public.admin_store_round(uuid), public.admin_reject_round(uuid, text),
  public.admin_contributors(), public.admin_set_contributor(uuid, text)
  to authenticated;
