# Polling / Voting App — CLAUDE.md

## 1. Project overview
A small Polling / Voting App (Express + MongoDB backend, React frontend) built as
interview prep. The owner must be able to explain every line from memory — code
stays short, plain, and heavily commented on the WHY, not the WHAT.

## 2. Tech stack
- Backend: Node.js, Express, MongoDB, Mongoose, JWT, bcrypt
- Frontend: React (Vite), axios, plain CSS
- Live results: `setInterval` polling every 3 seconds (no WebSockets/SSE)
- UI is plain CSS with design tokens ("Warm Cards" style), no UI library.
- **Not used**: TypeScript, Docker, Redis, Socket.IO, test frameworks

## 3. Folder structure (current)
```
server/
  server.js          — app setup, Mongo connect (with in-memory fallback), route mounting
  models/User.js      — email+password schema, bcrypt pre-save hook, comparePassword
  models/Poll.js      — question/options(2-5)/expiresAt/createdBy/resultsVisibility/showVoters/
                          visibility("public"|"linkOnly")/shareToken(unique, sparse)
  models/Vote.js      — pollId/userId/option + UNIQUE compound index (pollId, userId)
  middleware/auth.js   — verifies Bearer JWT, sets req.user.id
  routes/auth.js       — POST /register, POST /login
  routes/polls.js      — CRUD polls, POST vote (insert+catch 11000), GET my-vote (what did I
                          vote), GET results (aggregation, gated by resultsVisibility),
                          GET voters (creator-only), GET by-token/:token (linkOnly lookup),
                          POST :id/regenerate-link (creator-only). requireAccess() is the one
                          shared gate every poll-by-id route goes through for linkOnly checks.
  .env                 — MONGO_URI, JWT_SECRET, PORT
client/                — React (Vite) app: Auth (/login), PollList (/polls),
                          CreatePoll (/polls/new), PollDetail (/polls/:id and /p/:token)
server/scripts/concurrency-test.js — fires 50 parallel votes, expects 1 success + 49 conflicts
server/scripts/linkonly-test.js — list-exclusion, 404-without-token, 200-with-token,
                          404-after-regenerate
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
- "Your vote" highlight on the poll page comes from GET /:id/my-vote
  (auth required, simple `Vote.findOne({ pollId, userId })`), not local
  component state — so it's correct after a refresh or a login from a
  different device. The vote route and the unique index are untouched by
  this; my-vote is a pure read against the same (pollId, userId) pair.
- Result bar labels (option text + percentage) always render in var(--ink),
  never white-on-accent — a bar at low fill % (e.g. 7%) leaves most of the
  label over a white background, so a fixed white color fails contrast
  there. "Your vote" is shown as a small accent-colored pill next to the
  label instead of changing the label's own text color.
- Link-only polls: a 404 (never 403) is returned for a missing/wrong
  shareToken on a linkOnly poll, on every route — a 403 would confirm the
  poll's existence to someone without the link, defeating the feature.
  This check lives in ONE shared helper, requireAccess(), which every route
  that loads a poll by :id calls — so a future new route can't forget it.
  GET /polls excludes linkOnly polls outright (not just "no link shown" —
  actually absent from the response). regenerate-link uses Poll.findById
  directly (not requireAccess), since the creator must be able to recover
  access even after losing their current token — their identity comes from
  the JWT, not from already holding a valid link.

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
- Link-only polls are "security through possession of a URL," not real
  access control: anyone holding the link can view and vote, and can
  forward it to anyone else — the server has no way to tell a legitimate
  recipient from someone the link was shared with without permission.
  Regenerating the link is the only recourse once that happens.
- The shareToken itself is the entire IDOR defense for a linkOnly poll:
  if it were short, sequential, or guessable, an attacker could enumerate
  tokens and reach "hidden" polls directly. 16 random bytes (32 hex chars)
  from crypto.randomBytes makes brute-forcing infeasible, but this is worth
  being explicit about rather than assuming "it's hidden" is the same as
  "it's protected."
