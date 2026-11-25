-- =====================================================================
--  Neptune Poker — Supabase schema
--  Run this whole file once in the Supabase SQL editor (Database → SQL).
--  It is safe to re-run: objects are dropped/recreated where needed.
--
--  Identity model
--  * Team creators (managers) sign in with email + password.
--  * Everyone else gets an anonymous Supabase session in their browser,
--    plus a personal login link (secret token) that re-binds their member
--    profile to a new browser/device.
--  * Enable "Anonymous sign-ins" in Authentication → Sign In / Providers.
-- =====================================================================

-- ---------------------------------------------------------------------
--  Helpers
-- ---------------------------------------------------------------------
create or replace function public.random_code(len int)
returns text language sql volatile as $$
  select substr(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 1, len);
$$;

-- ---------------------------------------------------------------------
--  Tables
-- ---------------------------------------------------------------------
create table if not exists public.teams (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 1 and 60),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  invite_code  text not null unique default public.random_code(12),
  deck         text not null default 'fibonacci' check (deck in ('fibonacci','modified','tshirt','powers')),
  theme        text not null default 'neptune' check (theme in ('neptune','mars','jupiter','saturn','uranus')),
  created_at   timestamptz not null default now()
);

create table if not exists public.members (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references public.teams(id) on delete cascade,
  user_id         uuid references auth.users(id) on delete set null,
  display_name    text not null check (char_length(display_name) between 1 and 40),
  roles           text[] not null default '{}' check (roles <@ array['FE','BE','FS','QA']::text[]),
  avatar          text not null default '🐙' check (char_length(avatar) <= 16),
  is_owner        boolean not null default false,
  is_facilitator  boolean not null default false,
  bubble_best     int not null default 0 check (bubble_best between 0 and 100000),
  created_at      timestamptz not null default now(),
  unique (team_id, user_id)
);
create index if not exists members_user_idx on public.members(user_id);

-- Personal login-link secrets live apart from members so teammates can't read them.
create table if not exists public.member_tokens (
  member_id  uuid primary key references public.members(id) on delete cascade,
  team_id    uuid not null references public.teams(id) on delete cascade,
  token      text not null unique
);

create table if not exists public.sessions (
  id                 uuid primary key default gen_random_uuid(),
  team_id            uuid not null references public.teams(id) on delete cascade,
  name               text not null check (char_length(name) between 1 and 80),
  status             text not null default 'active' check (status in ('active','closed')),
  current_ticket_id  uuid,
  current_round_id   uuid,
  created_at         timestamptz not null default now(),
  closed_at          timestamptz
);
create index if not exists sessions_team_idx on public.sessions(team_id, created_at desc);

create table if not exists public.tickets (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  session_id  uuid not null references public.sessions(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 300),
  url         text check (url is null or char_length(url) <= 500),
  kind        text not null default 'UNSET' check (kind in ('FE','BE','QA','FS','UNSET')),
  qa_needed   boolean not null default true,
  position    double precision not null default 0,
  status      text not null default 'pending' check (status in ('pending','voting','revealed','estimated','skipped')),
  estimates   jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists tickets_session_idx on public.tickets(session_id, position);

create table if not exists public.rounds (
  id             uuid primary key default gen_random_uuid(),
  team_id        uuid not null references public.teams(id) on delete cascade,
  session_id     uuid not null references public.sessions(id) on delete cascade,
  ticket_id      uuid not null references public.tickets(id) on delete cascade,
  round_no       int not null default 1,
  tracks         text[] not null check (cardinality(tracks) > 0 and tracks <@ array['FE','BE','QA']::text[]),
  status         text not null default 'voting' check (status in ('voting','revealed','cancelled')),
  timer_ends_at  timestamptz,
  started_at     timestamptz not null default now(),
  revealed_at    timestamptz
);
create index if not exists rounds_session_idx on public.rounds(session_id);
create index if not exists rounds_ticket_idx on public.rounds(ticket_id);

do $$ begin
  alter table public.sessions add constraint sessions_current_ticket_fk
    foreign key (current_ticket_id) references public.tickets(id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.sessions add constraint sessions_current_round_fk
    foreign key (current_round_id) references public.rounds(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists public.votes (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  session_id  uuid not null references public.sessions(id) on delete cascade,
  round_id    uuid not null references public.rounds(id) on delete cascade,
  member_id   uuid not null references public.members(id) on delete cascade,
  track       text not null check (track in ('FE','BE','QA')),
  value       text not null check (char_length(value) between 1 and 8),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (round_id, member_id, track)
);
create index if not exists votes_session_idx on public.votes(session_id);

-- "Has voted" markers, readable by the whole team while values stay hidden.
create table if not exists public.vote_marks (
  round_id    uuid not null references public.rounds(id) on delete cascade,
  member_id   uuid not null references public.members(id) on delete cascade,
  track       text not null,
  team_id     uuid not null references public.teams(id) on delete cascade,
  session_id  uuid not null references public.sessions(id) on delete cascade,
  primary key (round_id, member_id, track)
);
create index if not exists vote_marks_session_idx on public.vote_marks(session_id);

-- Fun: spectators predict the average of a track they don't vote on.
create table if not exists public.guesses (
  round_id    uuid not null references public.rounds(id) on delete cascade,
  member_id   uuid not null references public.members(id) on delete cascade,
  track       text not null check (track in ('FE','BE','QA')),
  value       numeric not null check (value >= 0 and value <= 1000),
  team_id     uuid not null references public.teams(id) on delete cascade,
  session_id  uuid not null references public.sessions(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (round_id, member_id, track)
);
create index if not exists guesses_session_idx on public.guesses(session_id);

-- ---------------------------------------------------------------------
--  Access helpers (security definer → bypass RLS, no recursion)
-- ---------------------------------------------------------------------
create or replace function public.is_team_member(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where team_id = p_team and user_id = auth.uid());
$$;

create or replace function public.is_team_owner(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from teams where id = p_team and owner_id = auth.uid());
$$;

create or replace function public.can_facilitate(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from teams where id = p_team and owner_id = auth.uid())
      or exists (select 1 from members where team_id = p_team and user_id = auth.uid() and (is_facilitator or is_owner));
$$;

create or replace function public.is_my_member(p_member uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where id = p_member and user_id = auth.uid());
$$;

create or replace function public.round_status(p_round uuid)
returns text language sql stable security definer set search_path = public as $$
  select status from rounds where id = p_round;
$$;

-- Voting eligibility: FE track ← FE or FS devs, BE track ← BE or FS devs, QA track ← QA.
create or replace function public.role_can_vote(p_roles text[], p_track text)
returns boolean language sql immutable as $$
  select case p_track
    when 'FE' then p_roles && array['FE','FS']
    when 'BE' then p_roles && array['BE','FS']
    when 'QA' then p_roles && array['QA']
    else false end;
$$;

create or replace function public.can_vote(p_round uuid, p_member uuid, p_track text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from rounds r join members m on m.team_id = r.team_id
    where r.id = p_round and m.id = p_member and m.user_id = auth.uid()
      and r.status = 'voting'
      and p_track = any(r.tracks)
      and public.role_can_vote(m.roles, p_track)
  );
$$;

-- ---------------------------------------------------------------------
--  Triggers: derive team/session ids from parents (never trust clients)
-- ---------------------------------------------------------------------
create or replace function public.tg_ticket_parent() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select team_id into new.team_id from sessions where id = new.session_id;
  return new;
end $$;
drop trigger if exists ticket_parent on public.tickets;
create trigger ticket_parent before insert or update of session_id on public.tickets
  for each row execute function public.tg_ticket_parent();

create or replace function public.tg_round_child_parent() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select team_id, session_id into new.team_id, new.session_id from rounds where id = new.round_id;
  return new;
end $$;
drop trigger if exists vote_parent on public.votes;
create trigger vote_parent before insert or update on public.votes
  for each row execute function public.tg_round_child_parent();
drop trigger if exists guess_parent on public.guesses;
create trigger guess_parent before insert or update on public.guesses
  for each row execute function public.tg_round_child_parent();

create or replace function public.tg_vote_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists vote_touch on public.votes;
create trigger vote_touch before update on public.votes
  for each row execute function public.tg_vote_touch();

create or replace function public.tg_vote_mark() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into vote_marks(round_id, member_id, track, team_id, session_id)
    values (new.round_id, new.member_id, new.track, new.team_id, new.session_id)
    on conflict do nothing;
    return new;
  elsif tg_op = 'DELETE' then
    delete from vote_marks where round_id = old.round_id and member_id = old.member_id and track = old.track;
    return old;
  end if;
  return null;
end $$;
drop trigger if exists vote_mark on public.votes;
create trigger vote_mark after insert or delete on public.votes
  for each row execute function public.tg_vote_mark();

-- ---------------------------------------------------------------------
--  Row level security
-- ---------------------------------------------------------------------
alter table public.teams          enable row level security;
alter table public.members        enable row level security;
alter table public.member_tokens  enable row level security;
alter table public.sessions       enable row level security;
alter table public.tickets        enable row level security;
alter table public.rounds         enable row level security;
alter table public.votes          enable row level security;
alter table public.vote_marks     enable row level security;
alter table public.guesses        enable row level security;

-- teams
drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams for select to authenticated
  using (owner_id = auth.uid() or public.is_team_member(id));
drop policy if exists teams_update on public.teams;
create policy teams_update on public.teams for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists teams_delete on public.teams;
create policy teams_delete on public.teams for delete to authenticated
  using (owner_id = auth.uid());

-- members (inserts happen through create_team / join_team)
drop policy if exists members_select on public.members;
create policy members_select on public.members for select to authenticated
  using (user_id = auth.uid() or public.is_team_member(team_id) or public.is_team_owner(team_id));
drop policy if exists members_update on public.members;
create policy members_update on public.members for update to authenticated
  using (user_id = auth.uid() or public.can_facilitate(team_id))
  with check (user_id = auth.uid() or public.can_facilitate(team_id));
drop policy if exists members_delete on public.members;
create policy members_delete on public.members for delete to authenticated
  using (not is_owner and (user_id = auth.uid() or public.can_facilitate(team_id)));

-- Only profile columns are directly editable; ownership/facilitator/binding go via RPCs.
revoke update on public.members from anon, authenticated;
grant update (display_name, roles, avatar, bubble_best) on public.members to authenticated;

-- member_tokens: your own, or every token if you run the team
drop policy if exists member_tokens_select on public.member_tokens;
create policy member_tokens_select on public.member_tokens for select to authenticated
  using (public.is_my_member(member_id) or public.can_facilitate(team_id));

-- sessions / tickets / rounds: team reads, facilitators write
drop policy if exists sessions_select on public.sessions;
create policy sessions_select on public.sessions for select to authenticated
  using (public.is_team_member(team_id));
drop policy if exists sessions_write on public.sessions;
create policy sessions_write on public.sessions for all to authenticated
  using (public.can_facilitate(team_id)) with check (public.can_facilitate(team_id));

drop policy if exists tickets_select on public.tickets;
create policy tickets_select on public.tickets for select to authenticated
  using (public.is_team_member(team_id));
drop policy if exists tickets_write on public.tickets;
create policy tickets_write on public.tickets for all to authenticated
  using (public.can_facilitate(team_id)) with check (public.can_facilitate(team_id));

drop policy if exists rounds_select on public.rounds;
create policy rounds_select on public.rounds for select to authenticated
  using (public.is_team_member(team_id));
-- rounds are written only through start_round / reveal_round / cancel_round
drop policy if exists rounds_write on public.rounds;

-- votes: your own always; everyone's once the round is revealed
drop policy if exists votes_select on public.votes;
create policy votes_select on public.votes for select to authenticated
  using (public.is_my_member(member_id)
         or (public.is_team_member(team_id) and public.round_status(round_id) = 'revealed'));
drop policy if exists votes_insert on public.votes;
create policy votes_insert on public.votes for insert to authenticated
  with check (public.can_vote(round_id, member_id, track));
drop policy if exists votes_update on public.votes;
create policy votes_update on public.votes for update to authenticated
  using (public.can_vote(round_id, member_id, track))
  with check (public.can_vote(round_id, member_id, track));
drop policy if exists votes_delete on public.votes;
create policy votes_delete on public.votes for delete to authenticated
  using (public.can_vote(round_id, member_id, track));

drop policy if exists vote_marks_select on public.vote_marks;
create policy vote_marks_select on public.vote_marks for select to authenticated
  using (public.is_team_member(team_id));

drop policy if exists guesses_select on public.guesses;
create policy guesses_select on public.guesses for select to authenticated
  using (public.is_team_member(team_id));
drop policy if exists guesses_write on public.guesses;
create policy guesses_write on public.guesses for all to authenticated
  using (public.is_my_member(member_id) and public.round_status(round_id) = 'voting')
  with check (public.is_my_member(member_id) and public.round_status(round_id) = 'voting');

-- ---------------------------------------------------------------------
--  RPCs
-- ---------------------------------------------------------------------
create or replace function public.clean_roles(p_roles text[])
returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct r order by r), '{}')
  from unnest(coalesce(p_roles, '{}')) r where r in ('FE','BE','FS','QA');
$$;

-- Manager creates a team (requires a real, non-anonymous account)
create or replace function public.create_team(
  p_name text, p_display_name text, p_roles text[], p_avatar text,
  p_deck text default 'fibonacci', p_theme text default 'neptune')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_team uuid; v_member uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'manager_account_required';
  end if;
  insert into teams(name, owner_id, deck, theme)
    values (trim(p_name), auth.uid(), coalesce(p_deck, 'fibonacci'), coalesce(p_theme, 'neptune'))
    returning id into v_team;
  insert into members(team_id, user_id, display_name, roles, avatar, is_owner, is_facilitator)
    values (v_team, auth.uid(), trim(p_display_name), public.clean_roles(p_roles), coalesce(p_avatar, '🔱'), true, true)
    returning id into v_member;
  insert into member_tokens(member_id, team_id, token) values (v_member, v_team, public.random_code(40));
  return v_team;
end $$;

-- Public preview of an invite link (callable before signing in)
create or replace function public.team_preview(p_invite_code text)
returns table (team_id uuid, name text, theme text) language sql stable security definer set search_path = public as $$
  select id, name, theme from teams where invite_code = lower(trim(p_invite_code));
$$;

-- Anyone with an invite link joins with name + roles
create or replace function public.join_team(
  p_invite_code text, p_display_name text, p_roles text[], p_avatar text)
returns json language plpgsql security definer set search_path = public as $$
declare v_team uuid; v_member uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select id into v_team from teams where invite_code = lower(trim(p_invite_code));
  if v_team is null then raise exception 'invalid_invite'; end if;
  select id into v_member from members where team_id = v_team and user_id = auth.uid();
  if v_member is not null then
    return json_build_object('team_id', v_team, 'member_id', v_member, 'existing', true);
  end if;
  insert into members(team_id, user_id, display_name, roles, avatar)
    values (v_team, auth.uid(), trim(p_display_name), public.clean_roles(p_roles), coalesce(p_avatar, '🐙'))
    returning id into v_member;
  insert into member_tokens(member_id, team_id, token) values (v_member, v_team, public.random_code(40));
  return json_build_object('team_id', v_team, 'member_id', v_member, 'existing', false);
end $$;

-- Preview who a personal login link belongs to
create or replace function public.token_preview(p_token text)
returns table (member_id uuid, display_name text, avatar text, team_id uuid, team_name text, theme text, is_owner boolean)
language sql stable security definer set search_path = public as $$
  select m.id, m.display_name, m.avatar, t.id, t.name, t.theme, m.is_owner
  from member_tokens k join members m on m.id = k.member_id join teams t on t.id = m.team_id
  where k.token = trim(p_token);
$$;

-- Personal login link: bind the member profile to the current browser session
create or replace function public.claim_member(p_token text)
returns json language plpgsql security definer set search_path = public as $$
declare v_member members%rowtype; v_other members%rowtype;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select m.* into v_member from member_tokens k join members m on m.id = k.member_id where k.token = trim(p_token);
  if v_member.id is null then raise exception 'invalid_token'; end if;
  if v_member.is_owner then raise exception 'owner_must_sign_in'; end if;
  if v_member.user_id = auth.uid() then
    return json_build_object('team_id', v_member.team_id, 'member_id', v_member.id);
  end if;
  select * into v_other from members where team_id = v_member.team_id and user_id = auth.uid();
  if v_other.id is not null then
    if v_other.is_owner then raise exception 'signed_in_as_owner'; end if;
    -- Detach the profile this browser used before; it stays reachable through its own link.
    update members set user_id = null where id = v_other.id;
  end if;
  update members set user_id = auth.uid() where id = v_member.id;
  return json_build_object('team_id', v_member.team_id, 'member_id', v_member.id);
end $$;

create or replace function public.regenerate_member_token(p_member uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_team uuid; v_token text := public.random_code(40);
begin
  select team_id into v_team from members where id = p_member;
  if v_team is null then raise exception 'not_found'; end if;
  if not (public.is_my_member(p_member) or public.can_facilitate(v_team)) then raise exception 'forbidden'; end if;
  insert into member_tokens(member_id, team_id, token) values (p_member, v_team, v_token)
    on conflict (member_id) do update set token = excluded.token;
  return v_token;
end $$;

create or replace function public.regenerate_invite(p_team uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text := public.random_code(12);
begin
  if not public.is_team_owner(p_team) then raise exception 'forbidden'; end if;
  update teams set invite_code = v_code where id = p_team;
  return v_code;
end $$;

create or replace function public.set_facilitator(p_member uuid, p_value boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_team uuid;
begin
  select team_id into v_team from members where id = p_member;
  if v_team is null or not public.is_team_owner(v_team) then raise exception 'forbidden'; end if;
  update members set is_facilitator = p_value where id = p_member and not is_owner;
end $$;

-- Start voting on a ticket (also used for re-votes)
create or replace function public.start_round(p_ticket uuid, p_tracks text[], p_timer_seconds int default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_ticket tickets%rowtype; v_round uuid; v_no int; v_tracks text[];
begin
  select * into v_ticket from tickets where id = p_ticket;
  if v_ticket.id is null then raise exception 'not_found'; end if;
  if not public.can_facilitate(v_ticket.team_id) then raise exception 'forbidden'; end if;
  if exists (select 1 from sessions where id = v_ticket.session_id and status <> 'active') then
    raise exception 'session_closed';
  end if;
  select coalesce(array_agg(t order by array_position(array['FE','BE','QA'], t)), '{}') into v_tracks
    from (select distinct unnest(p_tracks) t) s where t in ('FE','BE','QA');
  if cardinality(v_tracks) = 0 then raise exception 'no_tracks'; end if;

  -- Only one live round per session
  update rounds set status = 'cancelled' where session_id = v_ticket.session_id and status = 'voting';
  update tickets set status = case when estimates = '{}'::jsonb then 'pending' else 'estimated' end
    where session_id = v_ticket.session_id and status = 'voting' and id <> p_ticket;

  select coalesce(max(round_no), 0) + 1 into v_no from rounds where ticket_id = p_ticket;
  insert into rounds(team_id, session_id, ticket_id, round_no, tracks, timer_ends_at)
    values (v_ticket.team_id, v_ticket.session_id, p_ticket, v_no, v_tracks,
            case when p_timer_seconds is not null and p_timer_seconds > 0
                 then now() + make_interval(secs => least(p_timer_seconds, 3600)) end)
    returning id into v_round;
  update tickets set status = 'voting', qa_needed = ('QA' = any(v_tracks)) where id = p_ticket;
  update sessions set current_ticket_id = p_ticket, current_round_id = v_round where id = v_ticket.session_id;
  return v_round;
end $$;

create or replace function public.reveal_round(p_round uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_r rounds%rowtype;
begin
  select * into v_r from rounds where id = p_round;
  if v_r.id is null then raise exception 'not_found'; end if;
  if not public.can_facilitate(v_r.team_id) then raise exception 'forbidden'; end if;
  if v_r.status <> 'voting' then return; end if;
  update rounds set status = 'revealed', revealed_at = now() where id = p_round;
  update tickets set status = 'revealed' where id = v_r.ticket_id and status = 'voting';
end $$;

create or replace function public.cancel_round(p_round uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_r rounds%rowtype;
begin
  select * into v_r from rounds where id = p_round;
  if v_r.id is null then raise exception 'not_found'; end if;
  if not public.can_facilitate(v_r.team_id) then raise exception 'forbidden'; end if;
  update rounds set status = 'cancelled' where id = p_round and status = 'voting';
  update tickets set status = case when estimates = '{}'::jsonb then 'pending' else 'estimated' end
    where id = v_r.ticket_id;
  update sessions set current_round_id = null where id = v_r.session_id and current_round_id = p_round;
end $$;

-- Save final estimates; optionally move on to the next pending ticket
create or replace function public.save_estimate(p_ticket uuid, p_estimates jsonb, p_advance boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_ticket tickets%rowtype; v_next uuid;
begin
  select * into v_ticket from tickets where id = p_ticket;
  if v_ticket.id is null then raise exception 'not_found'; end if;
  if not public.can_facilitate(v_ticket.team_id) then raise exception 'forbidden'; end if;
  update tickets set estimates = coalesce(p_estimates, '{}'::jsonb), status = 'estimated' where id = p_ticket;
  update rounds set status = 'revealed', revealed_at = coalesce(revealed_at, now())
    where ticket_id = p_ticket and status = 'voting';
  if p_advance then
    select id into v_next from tickets
      where session_id = v_ticket.session_id and status = 'pending' and id <> p_ticket
      order by position, created_at limit 1;
    update sessions set current_ticket_id = v_next, current_round_id = null where id = v_ticket.session_id;
  end if;
  return v_next;
end $$;

-- Invite and login-link previews work before the visitor has a session
grant execute on function public.team_preview(text) to anon, authenticated;
grant execute on function public.token_preview(text) to anon, authenticated;

-- ---------------------------------------------------------------------
--  Realtime
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['teams','members','sessions','tickets','rounds','votes','vote_marks','guesses'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
