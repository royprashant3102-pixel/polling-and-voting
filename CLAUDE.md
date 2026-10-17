# Polling / Voting App — CLAUDE.md

## 1. Project overview
A small Polling / Voting App (Express + MongoDB backend, React frontend) built as
interview prep. The owner must be able to explain every line from memory — code
stays short, plain, and heavily commented on the WHY, not the WHAT.

## 2. Tech stack
- Backend: Node.js, Express, MongoDB, Mongoose, JWT, bcrypt
- Frontend: React (Vite), axios, plain CSS
- Live results: `setInterval` polling every 3 seconds (no WebSockets/SSE)
- **Not used**: TypeScript, Docker, Redis, Socket.IO, test frameworks

## 3. Folder structure (current)
```
server/
  server.js          — app setup, Mongo connect (with in-memory fallback), route mounting
  models/User.js      — email+password schema, bcrypt pre-save hook, comparePassword
  models/Poll.js      — question/options(2-5)/expiresAt/createdBy/resultsVisibility/showVoters
  models/Vote.js      — pollId/userId/option + UNIQUE compound index (pollId, userId)
  middleware/auth.js   — verifies Bearer JWT, sets req.user.id
  routes/auth.js       — POST /register, POST /login
  routes/polls.js      — CRUD polls, POST vote (insert+catch 11000), GET results (aggregation,
                          gated by resultsVisibility), GET voters (creator-only)
  .env                 — MONGO_URI, JWT_SECRET, PORT
client/                — React (Vite) app: Auth, PollList, PollDetail pages
server/scripts/concurrency-test.js — fires 50 parallel votes, expects 1 success + 49 conflicts
README.md, INTERVIEW_NOTES.md — setup guide + interview prep doc
```

## 4. Commands
- Server install: `cd server && npm install`
- Server run: `npm run dev` (from `server/`)
- Concurrency script (once built): `npm run concurrency` (from `server/`)
- Client install/run (once built): `cd client && npm install && npm run dev`
- Required env vars (`server/.env`): `MONGO_URI`, `JWT_SECRET`, `PORT`

## 5. Key design decisions (do not change without asking)
- Unique compound index on Vote `(pollId, userId)`; insert directly and catch
  Mongo error 11000 → HTTP 409. Never check-then-insert (race condition).
- Poll expiry enforced server-side at vote time → 403 if expired.
- JWT payload contains only `userId`; auth middleware sets `req.user.id`.
- Results use one aggregation (`$match` + `$group` with `$sum: 1`), then merge
  in options with 0 votes (aggregation omits options nobody picked).
- Frontend polling (once built) must clear its interval on unmount.
- expiresAt is always converted client-side to a UTC ISO string
  (`new Date(input).toISOString()`) before being sent — never send the raw
  `datetime-local` string, which has no timezone and is ambiguous. Display
  uses `.toLocaleString()`, which renders in the viewer's own local time.
- resultsVisibility ("live"/"afterClose") is checked in GET /:id/results.
  The route stays public (no required auth) but optionally reads a JWT if
  sent, so the creator can see their own results early without needing a
  separate "preview" endpoint.
- GET /:id/voters is creator-only (403 otherwise) and requires auth —
  unlike results, this route has no legitimate anonymous use case.

## 6. Coding rules
- Keep files under ~100 lines where possible.
- Comments explain WHY, not just WHAT.
- No new libraries or features unless asked.
- Env vars for Mongo URI, JWT secret, port — never hardcode.
- Correct status codes: 200, 201, 400, 401, 403, 404, 409.

## 7. Working style
- Work in small steps; stop after each with a 3-line summary.
- Before adding anything not in this file, ask first.
- When asked "explain", go line by line in simple language and name which
  interview question it relates to.
- Be honest about limitations; never overclaim (e.g. say "MongoDB enforces the
  unique index atomically," not "atomic at the storage engine level").
- Do NOT add a "Co-Authored-By: Claude" (or similar) trailer to git commits in
  this repo. All commits should show the owner as sole author.

## 8. Current status
- [x] Phase 1 — Auth (register, login, bcrypt, JWT, authMiddleware)
- [x] Phase 2 — Polls + voting (CRUD, unique index, insert+catch 11000, expiry, option validation)
- [x] Phase 3 — Results review + React frontend (login/register, poll list/create, poll detail with vote + live results)
- [x] Phase 4 — concurrency-test.js (verified: 1 success/49 conflicts) + README.md + INTERVIEW_NOTES.md

## 9. Known limitations
- JWT cannot be revoked before expiry (no server-side blocklist).
- Live results use polling, not WebSockets/SSE — simpler, slightly higher latency
  and server load at scale.
- Token stored in localStorage (XSS exposure trade-off vs. httpOnly cookie).
- No email verification on registration.
- No rate limiting on auth or vote endpoints.
- Client-side JWT decode (for `isCreator` checks in the UI) is read-only and
  never trusted for authorization — the server independently re-checks
  creator identity on every gated route. But it does mean a user could edit
  localStorage to make the UI render creator-only buttons; those buttons
  would just hit a 403 from the server, so nothing is actually exposed.
- resultsVisibility "afterClose" hides aggregate counts, but does not hide
  the fact that votes exist or how many total votes were cast if that number
  leaks elsewhere (it currently doesn't — results are an all-or-nothing 403).
