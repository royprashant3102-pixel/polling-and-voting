# Polling / Voting App

A full-stack polling app: create a poll, share it, vote, watch results update live.
Built as interview prep for a software developer role — every design decision is
documented and defensible. See [INTERVIEW_NOTES.md](INTERVIEW_NOTES.md) for the
full reasoning behind each choice and a set of likely interview questions with
model answers.

**Live demo**: https://polling-and-voting-three.vercel.app
(React frontend on Vercel, Express API on Render, MongoDB on Atlas)

## Features

- **Auth**: register/login with JWT, bcrypt-hashed passwords
- **Polls**: create with 2+ options (no upper limit), a deadline, and per-poll
  settings for results visibility, voter anonymity, and link-only sharing
- **Voting**: cast a vote, or change it any time before the poll closes —
  race-safe under concurrent requests, proven by an automated test
- **Live results**: percentage bars that refresh every 3 seconds, with your
  own vote highlighted — clicking any option both votes and shows its bar
  in the same row
- **Winner banner**: once a poll closes, a clear "🏆 Winner: X (N%)" banner
  appears, or "Tie between: X, Y" if two or more options share the top spot
- **Share**: a Share button on every poll, for anyone viewing it — uses the
  native share sheet on mobile, falls back to copy-to-clipboard
- **Results visibility**: show results live, or hide them from everyone but
  the creator until the poll closes
- **Voter list**: optionally let the creator see who voted for what
- **Link-only polls**: hide a poll from the public list entirely — reachable
  only by a private share link, which the creator can regenerate at any time
- **Close early / extend deadline / delete**: creator controls over a poll's
  lifecycle, plus an admin override to delete any poll
- **New-user redirect**: clicking a shared poll link while logged out takes
  you straight back to that poll after registering/logging in

## Stack

Node.js, Express, MongoDB, Mongoose, JWT, bcrypt, React (Vite), axios, plain CSS.
No TypeScript, Docker, Redis, Socket.IO, or test frameworks. UI is plain CSS
with design tokens ("Warm Cards" style), no UI library.

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
Fires 50 parallel vote requests (alternating option) from the same user and
confirms they all succeed (200/201 — voting upserts, so a repeat request
changes the vote instead of being rejected) while exactly 1 vote row exists
for that poll afterward, proving the race is still handled safely by
MongoDB's atomic upsert and the unique index underneath it.

### 4. Link-only poll + close-early proof script
With the server already running:
```bash
cd server
npm run linkonly-test
```
Checks: a link-only poll is absent from the public list, fetching it by
`_id` with no token 404s, fetching with the right token 200s, the old token
404s immediately after regenerating the link, a non-creator calling `/close`
or `DELETE` gets 403, and voting on a closed poll returns 403.

## Environment variables (`server/.env`)
See `server/.env.example`:
- `MONGO_URI` — MongoDB connection string
- `JWT_SECRET` — secret used to sign JWTs
- `PORT` — port the Express server listens on

## Folder structure
```
server/
  server.js              app setup, Mongo connect (+ in-memory fallback), route mounting
  models/User.js          email + bcrypt password + isAdmin
  models/Poll.js          question, options, expiresAt, closedAt, resultsVisibility,
                           showVoters, visibility, shareToken — plus isPollClosed() and
                           generateShareToken() helpers
  models/Vote.js          pollId + userId + option, with the unique (pollId, userId) index
  middleware/auth.js      verifies the JWT, sets req.user.id
  routes/auth.js          register, login, /me
  routes/polls.js         everything poll-related — see API below
  scripts/concurrency-test.js   race-condition proof
  scripts/linkonly-test.js      link-only + close-early proof
client/
  src/pages/Auth.jsx       login/register
  src/pages/PollList.jsx   open/closed poll list
  src/pages/CreatePoll.jsx poll creation form
  src/pages/PollDetail.jsx voting, results, creator/admin controls
  src/Header.jsx           nav
  src/api.js               shared axios instance, attaches the JWT
```

## API

All poll routes are under `/api/polls`. Routes that load a poll by `:id` share
one access-control helper, `loadPollForRequest`, so a link-only poll's
existence is never leaked to someone without its share token (see
INTERVIEW_NOTES.md for why this returns 404, not 403).

| Method | Route | Auth | Notes |
|---|---|---|---|
| POST | `/api/auth/register` | — | |
| POST | `/api/auth/login` | — | returns a JWT |
| GET | `/api/auth/me` | required | `{ email, isAdmin }` |
| POST | `/api/polls` | required | creates a poll |
| GET | `/api/polls` | — | public polls only |
| GET | `/api/polls/by-token/:token` | — | resolve a link-only poll |
| GET | `/api/polls/:id` | — / token | |
| POST | `/api/polls/:id/vote` | required | upsert — cast or change a vote |
| GET | `/api/polls/:id/my-vote` | required | what did I vote |
| GET | `/api/polls/:id/results` | — / token | gated by `resultsVisibility` |
| GET | `/api/polls/:id/voters` | required | creator-only, gated by `showVoters` |
| POST | `/api/polls/:id/regenerate-link` | required | creator-only |
| POST | `/api/polls/:id/close` | required | creator-only, idempotent |
| POST | `/api/polls/:id/extend` | required | creator-only, forward-only |
| DELETE | `/api/polls/:id` | required | creator **or admin** |

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

## Voting
A voter can change their mind any time before the poll closes — voting again
updates the existing vote instead of being rejected. Once the poll closes
(naturally or early), voting is blocked with a 403.

## Creator actions on a poll
- **Close poll early**: stops new votes immediately, regardless of
  `expiresAt`. Results and the poll itself stay viewable as before.
- **Extend deadline**: push `expiresAt` to a later date. Only allows
  extending, never pulling the deadline earlier (that's what close-early
  is for). Re-opens a poll that was closed by natural expiry, but does NOT
  re-open a poll the creator deliberately closed early.
- **Delete poll**: permanently removes the poll and all its votes. Creator
  or an admin can delete; both actions ask for confirmation in the UI.

## Admin
A user can be made an admin by setting `isAdmin: true` directly on their
`User` document in the database — there's no in-app flow to grant this.
An admin can delete any poll, not just ones they created, via the same
`DELETE /api/polls/:id` route (one extra server-side check: creator OR
admin). `GET /api/auth/me` returns the logged-in user's `isAdmin` status so
the frontend knows whether to show the admin delete option.

## New users and shared links
A brand-new user who clicks a shared link-only poll link is redirected
through registration/login and lands back on that exact poll afterward, not
the generic poll list.

## Deployment
- **Client**: Vercel, with a `vercel.json` rewrite so client-side routes
  (e.g. `/polls/:id`) don't 404 on a hard refresh. `VITE_API_URL` points at
  the Render API.
- **Server**: Render, connected to MongoDB Atlas. CORS is restricted to the
  Vercel origin and local dev — no wildcard.
- **Database**: MongoDB Atlas, with a unique compound index on
  `(pollId, userId)` in the `Vote` collection — the core guarantee the whole
  voting design rests on.

## Known limitations
See [INTERVIEW_NOTES.md](INTERVIEW_NOTES.md) for the full, honest list —
among them: no JWT revocation, no rate limiting, no "forgot password" flow,
no admin management UI, and link-only polls rely on the share token staying
private (anyone holding it can forward it further).
