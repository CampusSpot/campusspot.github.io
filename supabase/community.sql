-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- CampusSpot: round chat and announcements. Runs after schema.sql (setup.sql includes it).
--
-- Round chat: every round has its own chat. You can read it once you've guessed on that round;
-- you can write in it once you've guessed, are signed in and have a leaderboard name.
-- Guests' guesses aren't stored, so the database can't check that a guest guessed: guests may read
-- (a guest guess already shows the answer anyway), but only signed-in players can write.
--
-- Announcements: admins post them; everyone can read them. Each account remembers when it last
-- read them, so the app can show an "unread" dot.
--
-- Same security model as schema.sql: row-level security ON with no policies, so the tables are only
-- reachable through the functions below. Safe to run again.
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

-- ── tables ──────────────────────────────────────────────────────────────────────────────────────

create table if not exists public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  round_id   uuid not null references public.rounds(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  body       text not null check (length(body) between 1 and 300),
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_round on public.chat_messages (round_id, created_at desc);
create index if not exists chat_messages_user on public.chat_messages (user_id, created_at desc);

create table if not exists public.announcements (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (length(title) between 1 and 80),
  body       text not null default '' check (length(body) <= 2000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists announcements_created on public.announcements (created_at desc);

-- When each player last read the announcements (signed-out players keep this in their browser).
create table if not exists public.announcement_reads (
  user_id uuid primary key references auth.users(id) on delete cascade,
  read_at timestamptz not null
);

alter table public.chat_messages      enable row level security;
alter table public.announcements      enable row level security;
alter table public.announcement_reads enable row level security;

-- ── round chat ──────────────────────────────────────────────────────────────────────────────────

-- May the caller read this round's chat? Signed in: only after guessing (admins and the round's
-- maker always). Guests: yes (see the note at the top).
create or replace function public.can_read_chat(r public.rounds) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is null
      or public.is_admin()
      or r.created_by = auth.uid()
      or exists (select 1 from guesses g where g.round_id = r.id and g.user_id = auth.uid())
$$;

create or replace function public.chat_message_json(m public.chat_messages, p public.profiles) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', m.id, 'body', m.body, 'createdAt', m.created_at, 'name', p.display_name, 'gradYear', p.grad_year,
    'me', m.user_id = auth.uid(),
    'admin', exists (select 1 from admins a join auth.users u on lower(u.email) = a.email where u.id = m.user_id))
$$;

-- A round's chat: the latest 100 messages, oldest first. Messages from hidden names aren't shown.
create or replace function public.get_round_chat(p_round uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r rounds := public.visible_round(p_round);
begin
  if not public.can_read_chat(r) then
    raise exception 'Make your guess to see the chat' using errcode = '42501', hint = 'needs_guess';
  end if;
  return jsonb_build_object(
    'canPost', auth.uid() is not null and (public.is_admin() or r.created_by = auth.uid()
               or exists (select 1 from guesses g where g.round_id = r.id and g.user_id = auth.uid())),
    'messages', coalesce((
      select jsonb_agg(t.j order by t.created_at, t.id) from (
        select public.chat_message_json(m, p) as j, m.created_at, m.id
        from chat_messages m join profiles p on p.user_id = m.user_id
        where m.round_id = r.id and not p.hidden
        order by m.created_at desc, m.id desc
        limit 100) t), '[]'::jsonb));
end $$;

-- Post in a round's chat: signed in, with a (visible) leaderboard name, after guessing on the round.
create or replace function public.post_chat_message(p_round uuid, p_body text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := public.assert_signed_in();
  r rounds := public.visible_round(p_round);
  clean text := trim(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g'));
  p profiles;
  m chat_messages;
begin
  select * into p from profiles where user_id = uid;
  if not found or p.hidden then
    raise exception 'Choose a leaderboard name first' using errcode = 'P0001', hint = 'needs_name';
  end if;
  if not (public.is_admin() or r.created_by = uid or exists (select 1 from guesses g where g.round_id = r.id and g.user_id = uid)) then
    raise exception 'Make your guess before chatting' using errcode = '42501', hint = 'needs_guess';
  end if;
  if length(clean) = 0 then raise exception 'Write a message first' using errcode = '22023'; end if;
  if length(clean) > 300 then raise exception 'Messages are up to 300 characters' using errcode = '22023'; end if;
  if exists (select 1 from chat_messages where user_id = uid and created_at > now() - interval '3 seconds') then
    raise exception 'Slow down a little' using errcode = 'P0001';
  end if;
  insert into chat_messages (round_id, user_id, body) values (r.id, uid, clean) returning * into m;
  return public.chat_message_json(m, p);
end $$;

-- Delete a chat message: your own, or any (admins).
create or replace function public.delete_chat_message(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare uid uuid := public.assert_signed_in();
begin
  delete from chat_messages where id = p_id and (user_id = uid or public.is_admin());
  if not found then raise exception 'Message not found' using errcode = 'P0002'; end if;
end $$;

-- ── announcements ───────────────────────────────────────────────────────────────────────────────

create or replace function public.announcement_json(a public.announcements) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', a.id, 'title', a.title, 'body', a.body, 'createdAt', a.created_at)
$$;

-- When the newest announcement was posted, and when you last read them (null for guests).
create or replace function public.announcements_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'latest', (select max(created_at) from announcements),
    'readAt', (select read_at from announcement_reads where user_id = auth.uid()))
$$;

-- The latest 50 announcements, newest first.
create or replace function public.get_announcements() returns jsonb
language sql stable security definer set search_path = public as $$
  select public.announcements_status() || jsonb_build_object('items', coalesce((
    select jsonb_agg(t.j order by t.created_at desc) from (
      select public.announcement_json(a) as j, a.created_at from announcements a order by a.created_at desc limit 50) t), '[]'::jsonb))
$$;

-- Marks announcements read up to p_upto (the newest one you were shown), so one posted while you
-- were reading still shows as new.
create or replace function public.mark_announcements_read(p_upto timestamptz) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  uid uuid := public.assert_signed_in();
  t timestamptz := least(coalesce(p_upto, now()), now());
begin
  insert into announcement_reads (user_id, read_at) values (uid, t)
  on conflict (user_id) do update set read_at = greatest(announcement_reads.read_at, excluded.read_at);
end $$;

create or replace function public.admin_post_announcement(p_title text, p_body text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  clean_title text := trim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g'));
  clean_body text := trim(coalesce(p_body, ''));
  a announcements;
begin
  perform public.assert_admin();
  if length(clean_title) = 0 then raise exception 'Add a title' using errcode = '22023'; end if;
  if length(clean_title) > 80 then raise exception 'Titles are up to 80 characters' using errcode = '22023'; end if;
  if length(clean_body) > 2000 then raise exception 'Announcements are up to 2,000 characters' using errcode = '22023'; end if;
  insert into announcements (title, body, created_by) values (clean_title, clean_body, auth.uid()) returning * into a;
  return public.announcement_json(a);
end $$;

create or replace function public.admin_delete_announcement(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.assert_admin();
  delete from announcements where id = p_id;
  if not found then raise exception 'Announcement not found' using errcode = 'P0002'; end if;
end $$;

-- ── who may call what ───────────────────────────────────────────────────────────────────────────

revoke all on public.chat_messages, public.announcements, public.announcement_reads from anon, authenticated;
revoke execute on function
  public.can_read_chat(public.rounds), public.chat_message_json(public.chat_messages, public.profiles),
  public.get_round_chat(uuid), public.post_chat_message(uuid, text), public.delete_chat_message(uuid),
  public.announcement_json(public.announcements), public.announcements_status(), public.get_announcements(),
  public.mark_announcements_read(timestamptz), public.admin_post_announcement(text, text), public.admin_delete_announcement(uuid)
  from public, anon, authenticated;

grant execute on function public.get_round_chat(uuid), public.announcements_status(), public.get_announcements()
  to anon, authenticated;

grant execute on function
  public.post_chat_message(uuid, text), public.delete_chat_message(uuid), public.mark_announcements_read(timestamptz),
  public.admin_post_announcement(text, text), public.admin_delete_announcement(uuid)
  to authenticated;
