-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- PolySpot database (Postgres, made for Supabase).
--
-- Security model: every table has row-level security ON and NO policies, so the public API can't
-- read or change any table directly. Everything goes through the functions below. Each one checks
-- who is calling (auth.uid() = signed-in player, is_admin() = one of the admin emails) before acting.
-- The answers to rounds are only ever returned to someone who has already guessed.
--
-- Safe to run again: tables use IF NOT EXISTS and functions use CREATE OR REPLACE.
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

create table if not exists public.maps (
  id         text primary key,
  data       jsonb not null,               -- { type, name, units, width/length or bounds, features, … }
  updated_at timestamptz not null default now()
);

create table if not exists public.rounds (
  id           uuid primary key default gen_random_uuid(),
  map_id       text not null references public.maps(id),
  title        text not null default '' check (length(title) <= 80),
  photo_path   text not null,              -- file name in the "photos" storage bucket
  difficulty   text not null,
  release_date date not null,              -- the day it is "today's round" (campus time zone)
  created_by   uuid,
  created_at   timestamptz not null default now()
);
create index if not exists rounds_release_date on public.rounds (release_date desc);

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

alter table public.settings      enable row level security;
alter table public.admins        enable row level security;
alter table public.maps          enable row level security;
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

create or replace function public.valid_pos(m jsonb, p jsonb) returns boolean
language sql immutable as $$
  select coalesce(case m->>'type'
    when 'floorplan' then jsonb_typeof(p->'x') = 'number' and jsonb_typeof(p->'y') = 'number'
    when 'latlng' then jsonb_typeof(p->'lat') = 'number' and jsonb_typeof(p->'lng') = 'number'
    else false end, false)
$$;

create or replace function public.clamp_pos(m jsonb, p jsonb) returns jsonb
language sql immutable as $$
  select case m->>'type'
    when 'floorplan' then jsonb_build_object(
      'x', least(greatest((p->>'x')::float8, 0), (m->>'width')::float8),
      'y', least(greatest((p->>'y')::float8, 0), (m->>'length')::float8))
    else jsonb_build_object(
      'lat', least(greatest((p->>'lat')::float8, (m#>>'{bounds,sw,lat}')::float8), (m#>>'{bounds,ne,lat}')::float8),
      'lng', least(greatest((p->>'lng')::float8, (m#>>'{bounds,sw,lng}')::float8), (m#>>'{bounds,ne,lng}')::float8))
  end
$$;

create or replace function public.map_distance(m jsonb, a jsonb, b jsonb) returns double precision
language sql immutable as $$
  select case m->>'type'
    when 'floorplan' then sqrt(((b->>'x')::float8 - (a->>'x')::float8) ^ 2 + ((b->>'y')::float8 - (a->>'y')::float8) ^ 2)
    else public.haversine(a, b) end
$$;

create or replace function public.map_span(m jsonb) returns double precision
language sql immutable as $$
  select case m->>'type'
    when 'floorplan' then sqrt((m->>'width')::float8 ^ 2 + (m->>'length')::float8 ^ 2)
    else public.haversine(m#>'{bounds,sw}', m#>'{bounds,ne}') end
$$;

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
    'id', r.id, 'mapId', r.map_id, 'title', r.title, 'difficulty', r.difficulty,
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
  select data || jsonb_build_object('id', id) from maps where id = p_id
$$;

-- A round is visible once its release date has arrived; admins also see scheduled ones.
create or replace function public.visible_round(p_id uuid) returns public.rounds
language plpgsql stable security definer set search_path = public as $$
declare r rounds;
begin
  select * into r from rounds where id = p_id;
  if not found or (r.release_date > public.today_local() and not public.is_admin()) then
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
                  (select total from guesses where round_id = r.id and user_id = auth.uid() and ranked) mine
             where g.round_id = r.id and g.ranked
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
    'profile', (select jsonb_build_object('displayName', display_name, 'hidden', hidden) from profiles where user_id = auth.uid()))
$$;

create or replace function public.get_maps() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(data || jsonb_build_object('id', id) order by (data->>'type') = 'latlng' desc, id), '[]'::jsonb) from maps
$$;

create or replace function public.get_today() returns jsonb
language sql stable security definer set search_path = public as $$
  select public.round_json(r) from rounds r
  where r.release_date = public.today_local()
  order by r.created_at desc limit 1
$$;

-- Released rounds, newest first (admins: pass true to include scheduled ones).
create or replace function public.list_rounds(p_include_scheduled boolean default false) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.round_json(r) order by r.release_date desc, r.created_at desc), '[]'::jsonb)
  from rounds r
  where r.release_date <= public.today_local() or (p_include_scheduled and public.is_admin())
$$;

create or replace function public.get_round(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r rounds := public.visible_round(p_id);
begin
  return jsonb_build_object('round', public.round_json(r), 'map', public.map_json(r.map_id),
                            'isToday', r.release_date = public.today_local());
end $$;

-- Score a guess. Today's round: signed-in players only, one attempt, goes on the leaderboard
-- (except for the admin who made it). Older rounds: practice, anyone can play, not ranked.
create or replace function public.submit_guess(p_round uuid, p_pos jsonb, p_heading double precision) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  r rounds := public.visible_round(p_round);
  m jsonb := public.map_json(r.map_id);
  a round_answers;
  uid uuid := auth.uid();
  is_today boolean := r.release_date = public.today_local();
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

  if is_today then
    if uid is null then
      raise exception 'Sign in to play today''s round' using errcode = '28000';
    end if;
    if not exists (select 1 from profiles where user_id = uid) then
      raise exception 'Choose a leaderboard name first' using errcode = 'P0001', hint = 'needs_name';
    end if;
    -- one try at today's round: a second submission just shows the first result again
    if exists (select 1 from guesses where round_id = r.id and user_id = uid) then
      return public.result_json(r, (select jsonb_agg(public.guess_json(x) order by x.created_at) from guesses x
                                    where x.round_id = r.id and x.user_id = uid), true);
    end if;
    is_ranked := r.created_by is distinct from uid;
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

-- Leaderboard for one round (default: today's).
create or replace function public.leaderboard_round(p_round uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  rid uuid := p_round;
  r rounds;
begin
  if rid is null then
    select id into rid from rounds where release_date = public.today_local() order by created_at desc limit 1;
    if rid is null then return jsonb_build_object('round', null, 'rows', '[]'::jsonb); end if;
  end if;
  r := public.visible_round(rid);
  return jsonb_build_object('round', public.round_json(r), 'rows', coalesce((
    select jsonb_agg(jsonb_build_object('place', t.place, 'name', t.name, 'total', t.total, 'distance', t.distance,
                                        'angleError', t.angle_error, 'me', t.me) order by t.place, t.created_at)
    from (
      select rank() over (order by g.total desc) as place, p.display_name as name, g.total, g.distance, g.angle_error,
             g.user_id = auth.uid() as me, g.created_at
      from guesses g join profiles p on p.user_id = g.user_id
      where g.round_id = r.id and g.ranked and not p.hidden
      order by g.total desc, g.created_at
      limit 100) t), '[]'::jsonb));
end $$;

-- Overall leaderboard: total points over ranked rounds, all time or the last p_days days.
create or replace function public.leaderboard_overall(p_days integer default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('place', t.place, 'name', t.name, 'total', t.total, 'rounds', t.rounds,
                                               'average', t.average, 'me', t.me) order by t.place, t.name), '[]'::jsonb)
  from (
    select rank() over (order by sum(g.total) desc) as place, p.display_name as name, sum(g.total)::int as total,
           count(*)::int as rounds, round(avg(g.total))::int as average, bool_or(g.user_id = auth.uid()) as me
    from guesses g
    join profiles p on p.user_id = g.user_id
    join rounds r on r.id = g.round_id
    where g.ranked and not p.hidden
      and (p_days is null or r.release_date > public.today_local() - p_days)
    group by g.user_id, p.display_name
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
  map_type text := p_map->>'type';
  map_id text := coalesce(nullif(p_map->>'id', ''), substr(md5(gen_random_uuid()::text), 1, 10));
  existing jsonb;
  m jsonb;
  feats jsonb;
begin
  perform public.assert_admin();
  if map_id !~ '^[a-z0-9-]{1,40}$' then raise exception 'Bad map id' using errcode = '22023'; end if;
  select data into existing from maps where id = map_id;
  if existing is not null then map_type := existing->>'type'; end if; -- a map can't change type
  if map_type not in ('floorplan', 'latlng') then raise exception 'Unknown map type' using errcode = '22023'; end if;

  m := jsonb_build_object(
    'type', map_type,
    'name', coalesce(nullif(left(trim(coalesce(p_map->>'name', '')), 60), ''), 'Untitled map'),
    'units', case when p_map->>'units' = 'm' then 'm' else 'ft' end);

  if map_type = 'floorplan' then
    if jsonb_typeof(p_map->'width') is distinct from 'number' or jsonb_typeof(p_map->'length') is distinct from 'number'
       or (p_map->>'width')::float8 not between 0.3 and 5000 or (p_map->>'length')::float8 not between 0.3 and 5000 then
      raise exception 'Width and length must be between 0.3 m (1 ft) and 5 km' using errcode = '22023';
    end if;
    m := m || jsonb_build_object('width', (p_map->>'width')::float8, 'length', (p_map->>'length')::float8,
      'topBearing', case when jsonb_typeof(p_map->'topBearing') = 'number' then public.norm360((p_map->>'topBearing')::float8) end);
  else
    if not (public.valid_pos('{"type":"latlng"}', p_map#>'{bounds,sw}') and public.valid_pos('{"type":"latlng"}', p_map#>'{bounds,ne}'))
       or (p_map#>>'{bounds,sw,lat}')::float8 >= (p_map#>>'{bounds,ne,lat}')::float8
       or (p_map#>>'{bounds,sw,lng}')::float8 >= (p_map#>>'{bounds,ne,lng}')::float8
       or abs((p_map#>>'{bounds,sw,lat}')::float8) > 85 or abs((p_map#>>'{bounds,ne,lat}')::float8) > 85 then
      raise exception 'Invalid play area' using errcode = '22023';
    end if;
    m := m || jsonb_build_object('bounds', jsonb_build_object(
      'sw', jsonb_build_object('lat', (p_map#>>'{bounds,sw,lat}')::float8, 'lng', (p_map#>>'{bounds,sw,lng}')::float8),
      'ne', jsonb_build_object('lat', (p_map#>>'{bounds,ne,lat}')::float8, 'lng', (p_map#>>'{bounds,ne,lng}')::float8)),
      'topBearing', 0);
    if public.map_span(m) > 50000 then raise exception 'Play area is too big (max 50 km across)' using errcode = '22023'; end if;
    if p_map->>'osmImportedAt' ~ '^\d{4}-\d{2}-\d{2}T' then m := m || jsonb_build_object('osmImportedAt', left(p_map->>'osmImportedAt', 40)); end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', coalesce(nullif(left(f->>'id', 30), ''), substr(md5(gen_random_uuid()::text), 1, 8)),
           'label', coalesce(nullif(left(trim(coalesce(f->>'label', '')), 60), ''), 'Feature'),
           'kind', case when f->>'kind' in ('building', 'parking', 'place', 'custom') then f->>'kind' else 'custom' end,
           'source', case when f->>'source' = 'osm' then 'osm' else 'user' end,
           'pos', public.clamp_pos(m, f->'pos'))), '[]'::jsonb)
    into feats
  from (select f from jsonb_array_elements(case when jsonb_typeof(p_map->'features') = 'array' then p_map->'features' else '[]' end) f
        limit 400) x
  where public.valid_pos(m, f->'pos');
  m := m || jsonb_build_object('features', feats);

  insert into maps (id, data) values (map_id, m)
  on conflict (id) do update set data = excluded.data, updated_at = now();
  return public.map_json(map_id);
end $$;

create or replace function public.admin_create_round(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  m jsonb;
  r rounds;
begin
  perform public.assert_admin();
  m := public.map_json(p->>'mapId');
  if m is null then raise exception 'Pick a map' using errcode = '22023'; end if;
  if not public.valid_pos(m, p#>'{truth,pos}') then raise exception 'Set where the photo was taken' using errcode = '22023'; end if;
  if jsonb_typeof(p#>'{truth,heading}') is distinct from 'number' then raise exception 'Set the camera direction' using errcode = '22023'; end if;
  if not coalesce((public.setting('scoring')->'difficulties') ? (p->>'difficulty'), false) then raise exception 'Pick a difficulty' using errcode = '22023'; end if;
  if coalesce(p->>'photoPath', '') !~ '^[A-Za-z0-9][A-Za-z0-9/_.-]{0,199}$' then raise exception 'Add a photo' using errcode = '22023'; end if;
  if coalesce(p->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Pick a release date' using errcode = '22023'; end if;

  insert into rounds (map_id, title, photo_path, difficulty, release_date, created_by)
  values (p->>'mapId', left(trim(coalesce(p->>'title', '')), 80), p->>'photoPath', p->>'difficulty', (p->>'date')::date, auth.uid())
  returning * into r;
  insert into round_answers (round_id, pos, heading)
  values (r.id, public.clamp_pos(m, p#>'{truth,pos}'), public.norm360((p#>>'{truth,heading}')::float8));
  return public.round_json(r);
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

-- ── who may call what ───────────────────────────────────────────────────────────────────────────

revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.is_admin(), public.get_bootstrap(), public.get_maps(), public.get_today(), public.list_rounds(boolean),
  public.get_round(uuid), public.submit_guess(uuid, jsonb, double precision), public.get_my_result(uuid),
  public.leaderboard_round(uuid), public.leaderboard_overall(integer)
  to anon, authenticated;

grant execute on function
  public.set_display_name(text), public.delete_my_account(),
  public.admin_save_map(jsonb), public.admin_create_round(jsonb), public.admin_update_round(uuid, jsonb),
  public.admin_delete_round(uuid), public.admin_round_answer(uuid), public.admin_players(),
  public.admin_set_hidden(uuid, boolean), public.admin_list_admins()
  to authenticated;
