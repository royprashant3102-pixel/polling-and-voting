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
  models/Poll.js      — question/options(2+, no max)/expiresAt/createdBy/resultsVisibility/showVoters/
                          visibility("public"|"linkOnly")/shareToken(unique, sparse)/closedAt.
                          Exports isPollClosed(poll), generateShareToken().
  models/Vote.js      — pollId/userId/option + UNIQUE compound index (pollId, userId)
  middleware/auth.js   — verifies Bearer JWT, sets req.user.id
  routes/auth.js       — POST /register, POST /login
  routes/polls.js      — CRUD polls, POST vote (upsert — first vote OR change an existing one),
                          GET my-vote (what did I vote), GET results (aggregation, gated by
                          resultsVisibility),
                          GET voters (creator-only), GET by-token/:token (linkOnly lookup),
                          POST :id/regenerate-link (creator-only), POST :id/close (creator-only,
                          idempotent), DELETE :id (creator-only, cascades Vote.deleteMany).
                          loadPollForRequest() is the one shared gate every poll-by-id route
                          goes through for linkOnly checks (creator always bypasses it).
  .env                 — MONGO_URI, JWT_SECRET, PORT
client/                — React (Vite) app: Auth (/login), PollList (/polls),
                          CreatePoll (/polls/new), PollDetail (/polls/:id and /p/:token)
server/scripts/concurrency-test.js — fires 50 parallel votes (alternating option) from one
                          user, expects 50 successful responses but exactly 1 vote row
server/scripts/linkonly-test.js — link-only checks (list-exclusion, 404-without-token,
                          200-with-token, 404-after-regenerate) + close-early checks
                          (non-creator 403 on close/delete, vote-after-close 403)
README.md, INTERVIEW_NOTES.md — setup guide + interview prep doc
```

## 4. Commands
- Server install: `cd server && npm install`
- Server run: `npm run dev` (from `server/`)
- Concurrency script (once built): `npm run concurrency` (from `server/`)
- Client install/run (once built): `cd client && npm install && npm run dev`
- Required env vars (`server/.env`): `MONGO_URI`, `JWT_SECRET`, `PORT`

## 5. Key design decisions (do not change without asking)
- Voting is an UPSERT, not insert-only: `Vote.findOneAndUpdate({ pollId,
  userId }, { option }, { upsert: true })`. A voter can change their mind
  any time before the poll closes — calling vote() again updates the
  existing row instead of being rejected. The unique compound index on
  `(pollId, userId)` is still what makes this safe: findOneAndUpdate with
  upsert is ONE atomic operation on MongoDB's side, so there's still no
  check-then-write gap for two parallel requests to race through — there's
  no separate "does a vote exist?" step to race on at all. The index
  guarantees exactly one vote document per (pollId, userId) no matter how
  many requests arrive in parallel; this used to mean "the second one gets
  rejected (409)," now it means "the second one updates the first (200)."
  concurrency-test.js proves the new invariant: 50 parallel requests from
  one user (alternating option) all return 200/201, but exactly 1 vote row
  exists for that poll afterward.
- Poll expiry enforced server-side at vote time → 403 if closed/expired.
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
- Poll "closed" state is decided in exactly ONE place: isPollClosed(poll) =
  closedAt != null || now > expiresAt. The vote route and the results
  "afterClose" gate both call this instead of re-deriving the expiry check,
  so "is this poll closed" can never drift between call sites.
- Link-only polls: a 404 (never 403) is returned for a missing/wrong
  shareToken on a linkOnly poll, on every route — a 403 would confirm the
  poll's existence to someone without the link, defeating the feature.
  This check lives in ONE shared helper, loadPollForRequest(), which every
  route that loads a poll by :id calls (get, vote, my-vote, results,
  voters, close, delete) — so a future new route can't forget it. The
  creator always bypasses the token check (identified via JWT, not
  possession of the link), so they're never locked out of their own poll.
  GET /polls excludes linkOnly polls outright (not just "no link shown" —
  actually absent from the response). regenerate-link uses Poll.findById
  directly (not loadPollForRequest), since it must work even for a creator
  who's lost their current token entirely.
- Why a random shareToken instead of just using the poll's _id as the
  "secret"? A Mongo ObjectId is NOT a secret — it's largely sequential/
  time-derived and routinely exposed in URLs, logs, and API responses
  throughout the app (every public poll's _id is visible). Using it as
  an access-control value would mean "link only" protects nothing, since
  anyone could predict or enumerate nearby IDs. shareToken is a separate
  16-byte value from crypto.randomBytes, generated ONLY for linkOnly polls,
  whose sole job is being unguessable — unrelated to the poll's identity.
- Close early vs. delete: closing keeps the poll (and its votes, and its
  results) around — voting stops, everything else works as before. Delete
  is destructive and removes the poll AND cascades Vote.deleteMany({
  pollId }) so no vote is left pointing at a pollId that no longer exists.
- Post-login redirect: RequireAuth passes the path it bounced the visitor
  from as router state (`{ from: location.pathname }`) on the Navigate to
  /login; Auth.jsx reads `location.state?.from` and navigates there after
  a successful login, falling back to /polls otherwise. This matters most
  for a brand-new user clicking a shared /p/:token link — without it
  they'd land on the generic poll list after registering, with no way
  back to the poll they were actually invited to.
- `POST /api/polls` validates `expiresAt` with `isNaN(Date.parse(expiresAt))`
  before creating the poll — garbage input becomes an Invalid Date, and
  `new Date() > invalidDate` is always false, which would make
  `isPollClosed()` silently never consider the poll expired by time.
- `GET /:id/voters` checks `poll.showVoters` in addition to the creator
  check — the frontend only shows the "Show voter list" button when
  `showVoters` is true, but that was only a UI hint; the API itself didn't
  enforce it, so the creator could fetch every voter's email directly even
  for a poll created with `showVoters: false`, silently breaking the
  anonymity promise shown to voters on that poll.

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
- Deleting a poll is permanent and immediate — no soft-delete/undo. A
  creator who deletes by mistake has no recovery path.
- Closing a poll early does not retroactively hide results that were
  already visible (if resultsVisibility is "live") — it only stops new
  votes; it has no effect on visibility, which stays governed by
  resultsVisibility independently.
- Vote changes are not tracked historically — only the current vote is
  stored. There's no audit trail of "voted A at 2pm, changed to B at
  3pm," and `createdAt`/`updatedAt` on the Vote document are the only
  trace that a change happened at all.
- A poll creator cannot see whether a voter changed their mind (only the
  current state, via the voter list) — same "no history" limitation as
  above, just from the creator's side.
