# Polling / Voting App

A small full-stack polling app: Express + MongoDB backend, React (Vite) frontend.
Built as interview prep — see [INTERVIEW_NOTES.md](INTERVIEW_NOTES.md) for the
design reasoning and likely interview questions.

## Stack
Node.js, Express, MongoDB, Mongoose, JWT, bcrypt, React (Vite), axios, plain CSS.
No TypeScript, Docker, Redis, Socket.IO, or test frameworks.
UI is plain CSS with design tokens, no UI library.

## Setup

### 1. Server
```bash
cd server
npm install
cp .env.example .env   # then edit values if needed
npm run dev
```
Server runs on `http://localhost:5001`. If `MONGO_URI` is unreachable, it
automatically falls back to an in-memory MongoDB (`mongodb-memory-server`) —
fine for development, but data won't persist across restarts.

### 2. Client
```bash
cd client
npm install
npm run dev
```
Client runs on `http://localhost:5173` and talks to the API at `localhost:5001`.

### 3. Concurrency proof script
With the server already running:
```bash
cd server
npm run concurrency
```
Fires 50 parallel vote requests (alternating option) from the same user
and confirms they all succeed (200/201 — voting upserts, so a repeat
request changes the vote instead of being rejected) while exactly 1 vote
row exists for that poll afterward, proving the race is still handled
safely by MongoDB's atomic upsert and the unique index underneath it.

### 4. Link-only poll + close-early proof script
With the server already running:
```bash
cd server
npm run linkonly-test
```
Checks: a link-only poll is absent from the public list, fetching it by
`_id` with no token 404s, fetching with the right token 200s, the old
token 404s immediately after regenerating the link, a non-creator calling
`/close` or `DELETE` gets 403, and voting on a closed poll returns 403.

## Environment variables (`server/.env`)
See `server/.env.example`:
- `MONGO_URI` — MongoDB connection string
- `JWT_SECRET` — secret used to sign JWTs
- `PORT` — port the Express server listens on

## Folder structure
```
server/   Express API (auth, polls, voting, results)
client/   React frontend (login/register, poll list, poll detail)
```

## Poll options at creation
- **Results visibility**: "Show results live" (default) or "Hide results until
  poll closes". When hidden, only the poll's creator can see results before
  `expiresAt` passes — everyone else gets a 403 with a clear message.
- **Voter list**: an optional checkbox lets the creator see who voted for
  what (email + chosen option) after creation, via a button on the poll page.
  Voters are shown a notice that their vote isn't anonymous when this is on.
- **Visibility**: "Public" (default, appears in the poll list) or "Link only"
  (hidden from the list entirely, reachable only via its share link at
  `/p/:token`). The creator can copy the link or regenerate it — regenerating
  invalidates the old link immediately. See INTERVIEW_NOTES.md for the IDOR
  risk this relies on and its limitation (anyone with the link can share it).

## Creator actions on a poll
- **Close poll early**: stops new votes immediately, regardless of
  `expiresAt`. Results and the poll itself stay viewable as before.
- **Extend deadline**: push `expiresAt` to a later date. Only allows
  extending, never pulling the deadline earlier (that's what close-early
  is for). Re-opens a poll that was closed by natural expiry, but does
  NOT re-open a poll the creator deliberately closed early.
- **Delete poll**: permanently removes the poll and all its votes. Creator
  or an admin can delete; both actions ask for confirmation in the UI.

## Admin
A user can be made an admin by setting `isAdmin: true` directly on their
`User` document in the database — there's no in-app flow to grant this.
An admin can delete any poll, not just ones they created, via the same
`DELETE /api/polls/:id` route (one extra server-side check: creator OR
admin). `GET /api/auth/me` returns the logged-in user's `isAdmin` status so
the frontend knows whether to show the admin delete option.

## Voting
A voter can change their mind any time before the poll closes — voting
again updates the existing vote instead of being rejected. Once the poll
closes (naturally or early), voting is blocked with a 403.

## New users and shared links
A brand-new user who clicks a shared link-only poll link is redirected
through registration/login and lands back on that exact poll afterward,
not the generic poll list.
