# Neptune Poker

Planning poker for **Team Neptune** (and any other crew). It's a static React app; Supabase handles sign-in, live updates and history.

Frontend, backend and QA each estimate the part they'll build:

| Ticket                        | Frontend devs | Backend devs | Fullstack devs                | QA                    |
| ----------------------------- | ------------- | ------------ | ----------------------------- | --------------------- |
| `[FE] …`                      | vote          | –            | vote (FE)                     | vote, unless "no QA"  |
| `[BE] …`                      | –             | vote         | vote (BE)                     | vote, unless "no QA"  |
| Fullstack (`[FE][BE]`, `[FS]`, or picked at start) | vote FE | vote BE | **two votes: FE and BE** | vote, unless "no QA"  |
| `[QA] …` / `[AQA] …`          | –             | –            | –                             | vote                  |

* The ticket type comes from tags in its name (`[FE]`, `[BE]`, `[QA]`, `[AQA]`, `[FS]`/`[Fullstack]`, `[No QA]`; brackets or parentheses, any case). The facilitator can change it, mark **Fullstack**, or untick **QA needed** when starting the vote.
* People can have several roles (e.g. FE + QA) and change them from their profile at any time. No role means watching only.
* Each estimate (FE / BE / QA) gets its own average, median, spread, consensus badge and final value. The total is the sum.

## What's in it

* **Manager account** (email + password) only for whoever creates the team. Everyone else joins through the **invite link** with a name, avatar and roles; no account.
* **Personal login link** for every member. It moves their profile to another browser or device. Managers can copy anyone's link from the team page, or replace it.
* **Co-hosts**: the manager can let others run sessions.
* **Sessions**: add tickets one by one or paste a list (URLs are picked out as links), reorder, skip, start/re-vote, optional timer, reveal, pick final estimates, *Save and go to next ticket*. Auto-reveal when everyone in the room has voted.
* **History**: closed sessions keep every round and vote; per-session summary with CSV export.
* **Votes stay hidden until reveal**, enforced by the database (row-level security), not just the UI.
* **While you wait**: poke people, throw fish / ice / tridents at them, emoji reactions, bubble-pop mini-game with a team leaderboard, a "guess the average" prediction for people not voting on the current ticket, Neptune facts, confetti on consensus. Sound and effects can be turned off per device.
* **Planet themes** for other teams: Neptune (default), Mars, Jupiter, Saturn, Uranus. Card decks: Fibonacci, modified Fibonacci, powers of two, T-shirt sizes.

### Connection handling

* One realtime channel per team (database changes + presence + broadcast) with its own reconnect loop: exponential backoff with jitter, fresh channel on every retry, immediate retry when the browser comes back online or the tab becomes visible, and a watchdog that notices sleep/wake and stuck channels.
* Heartbeats run in a Web Worker so background tabs don't silently drop.
* After every (re)connect the full room state is re-fetched, so missed events don't matter. While disconnected, the room keeps refreshing over plain HTTP.
* Votes cast while offline are kept on the device and sent when the connection returns (dropped with a notice if the round closed in the meantime).
* Connection pill in the header and a banner after a few seconds of trouble. Auto-reveal pauses while presence can't be trusted.
* Tab title flashes when it's your turn to vote or someone pokes you.

## Setup

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. **Authentication → Sign In / Providers**: turn on **Allow anonymous sign-ins**. Keep **Email** on.
   * Optional: turn off *Confirm email* if you don't want managers to confirm their address.
   * Recommended: enable CAPTCHA (Authentication → Attack protection) since anyone can create guest sessions.
3. **Authentication → URL Configuration**: set *Site URL* to where you'll host the app (e.g. `https://you.github.io/neptune-poker/`) and add it to *Redirect URLs* (also `http://localhost:5173/` for development).
4. **SQL editor**: paste and run [`supabase/schema.sql`](supabase/schema.sql). It creates the tables, security policies, functions and adds the tables to Realtime. It's safe to run again after updates.
5. **Project Settings → API**: copy the project URL and the anon (publishable) key.

### 2. Run locally

```bash
cp .env.example .env      # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

Open http://localhost:5173, choose *Sign in as team manager*, create an account and the team, then share the invite link from the team page.

### 3. Deploy (any static host)

```bash
npm run build             # outputs dist/
```

Upload `dist/` anywhere: GitHub Pages, Netlify, Vercel, Cloudflare Pages, S3. Routing uses `#/…` URLs and relative asset paths, so no rewrite rules are needed and sub-paths work.

**GitHub Pages**: the included workflow (`.github/workflows/deploy.yml`) tests, builds and deploys on every push to `main`. Add repository secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, and set *Settings → Pages → Source* to *GitHub Actions*.

The anon key is meant to be public; all access is controlled by the row-level security in `schema.sql`.

## Tests

```bash
npm test          # ticket-tag parsing, who-votes-on-what, averages and suggestions
npm run test:db   # runs schema.sql in an in-memory Postgres and checks the security rules:
                  # only eligible roles can vote, votes are hidden until reveal,
                  # only managers/co-hosts run sessions, login links, etc.
```

## Project layout

```
supabase/schema.sql        tables, RLS policies, RPCs, realtime publication
supabase/tests/            database security tests (PGlite)
src/lib/domain.ts          tag parsing, voting eligibility, decks, statistics
src/state/TeamContext.tsx  realtime channel, reconnect logic, presence, fun events
src/room/useRoom.ts        room state, optimistic + offline votes, facilitator actions
src/room/*                 orbit table, cards, results, ticket queue, fun zone
src/pages/*                home, manager sign-in, create/join team, login links, team page
```

## Notes

* Guest identities are Supabase anonymous users. If you clean up old anonymous users in Supabase, the matching member profiles are kept (just signed out) and can be reclaimed with their login link.
* Only the manager's email account can't be taken over by a login link; managers always sign in with email.
* Replacing the invite link doesn't affect people who already joined.
