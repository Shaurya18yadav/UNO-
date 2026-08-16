# UNO Night — real-time multiplayer UNO

A mobile-first React/Tailwind client with an Express + Socket.io, server-authoritative UNO engine. It runs immediately with an in-memory development repository, and can use PostgreSQL/Supabase for accounts, stats, reports, and match history.

## Structure

```text
client/                  React + Vite + Tailwind user interface
  src/App.tsx            landing, lobby, game table, chat, account views
server/
  src/game-engine.ts     server-authoritative UNO rules
  src/room-manager.ts    rooms, reconnects, timers, per-viewer state
  src/index.ts           secure HTTP and Socket.io API
  src/repository.ts      parameterized in-memory/Postgres persistence
  supabase/migrations/   RLS-protected schema
.github/workflows/       CI: test, build, audit, git-secrets
```

## What is included

- 108-card UNO deck; deal, discard reshuffle, directional turns, Skip, Reverse, Draw Two, Wild, and Wild Draw Four.
- Legal-move enforcement entirely on the server, including Wild Draw Four challenge decisions, UNO calls/catches, round scoring, target-score/max-round matches, and turn timeout auto-play.
- 2–10 seat public or short-code private rooms, with server-run UNO bots, ready check, reconnect support, late spectators, shareable links, chat/reactions, and unanimous rematches. The landing-page **Play vs bot** option starts a two-seat bot match immediately.
- Optional stacking, 7-0, and jump-in rules. The custom-room dialog exposes these as toggles.
- Guest sessions plus password accounts (bcrypt); encrypted email storage, match history, leaderboard, avatar URL, and report endpoint.
- A React landing page, lobby, game table, sound cue, card animation, ready screen, leaderboard, and history view.

## Run locally

1. Copy `.env.example` to `.env` and change `SESSION_SECRET` and `EMAIL_ENCRYPTION_KEY`. The encryption key must be 64 random hexadecimal characters.

2. Install dependencies:

   ```sh
   npm install
   ```

3. Start both apps:

   ```sh
   npm run dev
   ```

   The web client is at `http://localhost:5173`; the API and Socket.io server are at `http://localhost:3001`.

4. Open two browser profiles/windows, click **Play now** in one, share the six-character room code, and have both players select **Ready up**. The host starts the match.

## PostgreSQL / Supabase setup

1. Create a Supabase Postgres project.
2. Run `server/supabase/migrations/001_initial.sql` in the SQL Editor or with the Supabase CLI.
3. Set `DATABASE_URL` to the server-side connection string. If your deployment needs it, set `DATABASE_SSL=true`.
4. Leave `SUPABASE_SERVICE_ROLE_KEY` server-only. It is intentionally not read by client code. The only permitted browser-side Supabase variables are `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; this MVP does not require either because API access is mediated by the game server.

The migration enables RLS on every personal-data table and grants no anonymous table access. The Node server executes only parameterized queries through its trusted server-side database connection. Public leaderboard fields contain no emails, tokens, or private match data.

## Commands

```sh
npm run test       # engine tests
npm run build      # production client/server builds
npm run audit      # dependency vulnerability scan
npm run secrets:scan
```

Install `git-secrets` before the first push and run `npm run secrets:scan`; `.env` is ignored by git. Enable Dependabot using the included `.github/dependabot.yml`.

## Security model

- Browser identity is a signed httpOnly session cookie (`Secure` and `SameSite=Strict` in production). The socket handshake verifies this cookie and ignores client-claimed identity.
- Every HTTP body and socket payload is schema-validated. The game engine independently verifies the active player, possession of the card, legal move, hand mutations, scores, and card draws.
- Per-viewer snapshots provide only the viewer’s hand; other players receive counts only. Draw pile internals, hidden discard history, WDF challenge evidence, and database credentials are never sent to clients.
- Helmet enables CSP, framing protection, and production HSTS. Production HTTP requests are redirected to HTTPS; deploy the service behind a TLS terminator so Socket.io uses WSS.
- Login/signup and room creation have IP rate limits; chat has a per-user socket rate limit. Usernames and chat text are stripped of HTML before persistence/broadcast.
- Passwords use bcrypt. Emails are AES-256-GCM encrypted at application level and searched via a keyed hash, so plaintext emails are not stored. No avatar file upload endpoint exists; avatars are direct HTTPS-style URL references only.

## Deployment checklist

- Use a strong unique `SESSION_SECRET`, a random 32-byte `EMAIL_ENCRYPTION_KEY`, and a production `DATABASE_URL`; do not use `.env.example` values.
- Set `NODE_ENV=production`, `CLIENT_ORIGIN=https://your-domain`, `VITE_API_URL=https://api.your-domain`, and terminate TLS at your platform/load balancer.
- Apply the SQL migration, confirm RLS is enabled, and never put a Supabase service-role key in the client build or CI logs.
- Run `npm run test`, `npm run build`, `npm run audit`, and `npm run secrets:scan` in CI before release.
- Configure database backups, monitoring/alerting, an abuse-report review process, and a regular dependency update cadence.

## Notes on rules

Wild Draw Four follows the common challenge flow: if the offender held the active color, the offender draws the penalty and the challenger keeps the turn; otherwise the challenger draws the penalty plus two and loses the turn. With stacking enabled, only like penalties stack (+2 onto +2, WDF onto WDF). 7 swaps hands with a selected opponent and 0 rotates hands in the current direction.
