import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const db = new PGlite();
const schema = fs.readFileSync(process.argv[2] ?? new URL('../schema.sql', import.meta.url), 'utf8');

await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub','')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb $$;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  insert into auth.users values
   ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b'),
   ('00000000-0000-0000-0000-00000000000c'),('00000000-0000-0000-0000-00000000000d'),
   ('00000000-0000-0000-0000-00000000000e');
`);
await db.exec(schema);
await db.exec(schema); // idempotent re-run
console.log('schema applied twice OK');

const U = (c) => `00000000-0000-0000-0000-00000000000${c}`;
async function as(user, anonUser, sql, params = []) {
  await db.exec(`reset role`);
  const claims = JSON.stringify({ sub: U(user), role: 'authenticated', is_anonymous: anonUser });
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  await db.exec(`set role authenticated`);
  try { return (await db.query(sql, params)).rows; }
  finally { await db.exec(`reset role`); }
}
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
async function expectErr(p, msg, match) {
  try { await p; ok(false, msg + ' (expected error)'); }
  catch (e) { ok(!match || String(e.message).includes(match), `${msg} -> ${e.message}`); }
}

// a = manager (email), b = FE dev, c = FS dev, d = QA, e = BE dev (all anonymous)
await expectErr(as('b', true, `select public.create_team('X','B','{}','🐙')`), 'anon cannot create team', 'manager_account_required');
const [{ create_team: team }] = await as('a', false, `select public.create_team('Team Neptune','Mia','{}','🔱')`);
ok(!!team, 'manager created team');
const [{ invite_code }] = await as('a', false, `select invite_code from teams where id=$1`, [team]);
const prev = await as('b', true, `select * from public.team_preview($1)`, [invite_code.toUpperCase()]);
ok(prev[0]?.name === 'Team Neptune', 'team preview by invite');
const nonmember = await as('b', true, `select * from teams`);
ok(nonmember.length === 0, 'non-member cannot read team');

const join = async (u, name, roles) => (await as(u, true, `select public.join_team($1,$2,$3,'🐠') j`, [invite_code, name, roles]))[0].j;
const jb = await join('b', 'Ben', ['FE']);
const jc = await join('c', 'Cleo', ['FS', 'bogus']);
const jd = await join('d', 'Dan', ['QA']);
const je = await join('e', 'Eve', ['BE']);
ok(jb.member_id && !jb.existing, 'Ben joined');
ok((await join('b', 'Ben', ['FE'])).existing === true, 're-join returns existing');
const [cleo] = await as('c', true, `select roles from members where id=$1`, [jc.member_id]);
ok(JSON.stringify(cleo.roles) === '["FS"]', 'bogus role stripped');
ok((await as('b', true, `select * from members`)).length === 5, 'member sees teammates');
ok((await as('b', true, `select * from member_tokens`)).length === 1, 'member sees only own token');
ok((await as('a', false, `select * from member_tokens`)).length === 5, 'owner sees all tokens');

// profile editing limits
await as('b', true, `update members set display_name='Benny', roles='{FE,QA}' where id=$1`, [jb.member_id]);
ok((await as('b', true, `select display_name from members where id=$1`, [jb.member_id]))[0].display_name === 'Benny', 'edit own profile');
await expectErr(as('b', true, `update members set is_facilitator=true where id=$1`, [jb.member_id]), 'cannot self-promote', 'permission denied');
await as('b', true, `update members set display_name='Hacked' where id=$1`, [jc.member_id]);
ok((await as('a', false, `select display_name from members where id=$1`, [jc.member_id]))[0].display_name === 'Cleo', 'cannot edit others profile');
await as('b', true, `update members set roles='{FE}' where id=$1`, [jb.member_id]);

// sessions & tickets
await expectErr(as('b', true, `insert into sessions(team_id,name) values ($1,'x')`, [team]), 'member cannot create session', 'row-level security');
const [{ id: sess }] = await as('a', false, `insert into sessions(team_id,name) values ($1,'Refinement') returning id`, [team]);
const [{ id: t1 }] = await as('a', false, `insert into tickets(team_id,session_id,title,kind) values ($1,$2,'[FE] Login page','FE') returning id`, [team, sess]);
const [{ id: t2 }] = await as('a', false, `insert into tickets(team_id,session_id,title,kind,position) values ($1,$2,'[BE][FE] Payments','FS',1) returning id`, [team, sess]);
await expectErr(as('b', true, `select public.start_round($1, '{FE,QA}')`, [t1]), 'member cannot start round', 'forbidden');

// round 1: FE ticket with QA
const [{ start_round: r1 }] = await as('a', false, `select public.start_round($1, '{QA,FE}', 60)`, [t1]);
const vote = (u, m, r, track, v) => as(u, true, `insert into votes(team_id,session_id,round_id,member_id,track,value) values ($1,$2,$3,$4,$5,$6)
  on conflict (round_id,member_id,track) do update set value = excluded.value`, [team, sess, r, m, track, v]);
await vote('b', jb.member_id, r1, 'FE', '3'); ok(true, 'FE dev votes FE');
await vote('c', jc.member_id, r1, 'FE', '5'); ok(true, 'FS dev votes FE');
await vote('d', jd.member_id, r1, 'QA', '2'); ok(true, 'QA votes QA');
await expectErr(vote('e', je.member_id, r1, 'FE', '8'), 'BE dev cannot vote FE', 'row-level security');
await expectErr(vote('e', je.member_id, r1, 'BE', '8'), 'no BE track on FE ticket', 'row-level security');
await expectErr(vote('b', jc.member_id, r1, 'FE', '1'), 'cannot vote as someone else', 'row-level security');
await vote('b', jb.member_id, r1, 'FE', '5'); ok(true, 'change own vote');
ok((await as('b', true, `select * from votes`)).length === 1, 'before reveal: only own vote visible');
ok((await as('e', true, `select * from vote_marks`)).length === 3, 'vote marks visible to all');
await as('e', true, `insert into guesses(round_id,member_id,track,value,team_id,session_id) values ($1,$2,'FE',4.5,$3,$4)`, [r1, je.member_id, team, sess]);
ok(true, 'spectator guess saved');
await as('a', false, `select public.reveal_round($1)`, [r1]);
ok((await as('e', true, `select * from votes`)).length === 3, 'after reveal: all votes visible');
await expectErr(vote('b', jb.member_id, r1, 'FE', '8'), 'no voting after reveal', 'row-level security');

// round 2: fullstack ticket, no QA → FS dev gets two votes
const [{ start_round: r2 }] = await as('a', false, `select public.start_round($1, '{FE,BE}')`, [t2]);
await vote('c', jc.member_id, r2, 'FE', '3');
await vote('c', jc.member_id, r2, 'BE', '8');
ok(true, 'FS dev votes FE and BE on fullstack ticket');
await vote('e', je.member_id, r2, 'BE', '5'); ok(true, 'BE dev votes BE');
await expectErr(vote('d', jd.member_id, r2, 'QA', '1'), 'QA cannot vote when no QA needed', 'row-level security');
const [{ save_estimate: nxt }] = await as('a', false, `select public.save_estimate($1, '{"FE":"3","BE":"8"}', true)`, [t2]);
ok(nxt === null, 'advance returns next pending (none left)');
const [s2] = await as('b', true, `select * from sessions where id=$1`, [sess]);
ok(s2.current_ticket_id === null, 'session advanced');
ok((await as('b', true, `select status from rounds where id=$1`, [r2]))[0].status === 'revealed', 'save reveals round');

// login link flow
const [{ token: benTok }] = await as('b', true, `select token from member_tokens where member_id=$1`, [jb.member_id]);
const pv = await as('e', true, `select * from public.token_preview($1)`, [benTok]);
ok(pv[0]?.display_name === 'Benny', 'token preview');
// Eve's browser opens Ben's link: Eve's profile detaches, Ben's binds to Eve's session
const cl = (await as('e', true, `select public.claim_member($1) j`, [benTok]))[0].j;
ok(cl.member_id === jb.member_id, 'claim returns member');
const rows = await as('a', false, `select id, user_id from members where id in ($1,$2)`, [jb.member_id, je.member_id]);
ok(rows.find(r => r.id === jb.member_id).user_id === U('e') && rows.find(r => r.id === je.member_id).user_id === null, 'rebinding + detach');
const [{ token: ownerTok }] = await as('a', false, `select k.token from member_tokens k join members m on m.id=k.member_id where m.is_owner`);
await expectErr(as('d', true, `select public.claim_member($1)`, [ownerTok]), 'owner profile cannot be claimed by link', 'owner_must_sign_in');
await expectErr(as('a', false, `select public.claim_member($1)`, [benTok]), 'owner cannot claim others', 'signed_in_as_owner');
await expectErr(as('d', true, `select public.claim_member('nope')`), 'bad token', 'invalid_token');

// facilitator
await expectErr(as('c', true, `select public.set_facilitator($1, true)`, [jd.member_id]), 'non-owner cannot promote', 'forbidden');
await as('a', false, `select public.set_facilitator($1, true)`, [jd.member_id]);
const [{ id: t3 }] = await as('d', true, `insert into tickets(team_id,session_id,title,kind) values ($1,$2,'[AQA] e2e suite','QA') returning id`, [team, sess]);
const [{ start_round: r3 }] = await as('d', true, `select public.start_round($1, '{QA}')`, [t3]);
ok(!!r3, 'co-host can run rounds');
await expectErr(as('d', true, `select public.regenerate_invite($1)`, [team]), 'co-host cannot regenerate invite', 'forbidden');
await as('d', true, `delete from members where is_owner`);
ok((await as('a', false, `select count(*)::int n from members where is_owner`))[0].n === 1, 'owner still present');
await as('d', true, `delete from members where id=$1`, [je.member_id]);
ok((await as('a', false, `select count(*)::int n from members`))[0].n === 4, 'co-host removes member');

const pubs = await db.query(`select tablename from pg_publication_tables where pubname='supabase_realtime' order by 1`);
ok(pubs.rows.length === 8, 'realtime publication has 8 tables');

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
