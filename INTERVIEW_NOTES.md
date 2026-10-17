# Interview Notes

UI is plain CSS with design tokens, no UI library.

## 1. Request flow

**Login**
1. Client sends `{ email, password }` to `POST /api/auth/login`.
2. Server looks up the user by email, runs `bcrypt.compare` against the stored hash.
3. On match, signs a JWT (`{ userId }`, 24h expiry) and returns it.
4. Client stores the token in `localStorage` and attaches it as
   `Authorization: Bearer <token>` on every future request.

**Vote**
1. `POST /api/polls/:id/vote` hits `authMiddleware` first — verifies the JWT,
   sets `req.user.id`. Invalid/missing token → 401, request never reaches the route.
2. Route fetches the poll, checks `expiresAt` against `new Date()` → 403 if expired.
3. Checks the submitted `option` is actually one of the poll's options → 400 if not.
4. Calls `Vote.create({ pollId, userId, option })` directly — no "has this user
   voted?" check first.
5. If a vote already exists for this `(pollId, userId)`, MongoDB's unique index
   rejects the insert with error code `11000`, caught and returned as 409.

**Results**
1. `GET /api/polls/:id/results` — no auth strictly required, but the route
   reads an `Authorization` header if one is present (without requiring it)
   so it can tell whether the caller is the poll's creator.
2. If `resultsVisibility === "afterClose"` and the poll hasn't expired yet
   and the caller isn't the creator → 403 with a clear message.
3. Otherwise: one aggregation pipeline, `$match` on `pollId`, then
   `$group by option` with `$sum: 1` to count votes per option in a single
   DB pass.
4. Options with zero votes are merged in manually, since the aggregation only
   returns options that have at least one vote.

**Voters (creator-only)**
1. `GET /api/polls/:id/voters` requires a valid JWT (unlike results, which
   stays public) — `authMiddleware` runs first.
2. Route checks `poll.createdBy` against `req.user.id` → 403 for anyone else,
   regardless of whether `showVoters` is on.
3. `Vote.find({ pollId }).populate('userId', 'email')` joins in just the
   voter's email — never the full `User` document (no password hash).

**My vote**
1. `GET /api/polls/:id/my-vote` requires auth — `authMiddleware` sets `req.user.id`.
2. `Vote.findOne({ pollId, userId: req.user.id })` — a single lookup against
   the exact same `(pollId, userId)` pair the unique index and the vote
   route already key on. Returns `{ option: "<choice>" }` or `{ option: null }`.
3. The poll detail page calls this on load (alongside fetching the poll
   itself) to highlight the user's own bar — so the highlight is correct
   after a refresh, not just immediately after clicking vote.

## 2. Why I chose this

**Unique index vs. check-then-insert** — Check-then-insert (`findOne` then
`create`) has a race window: two concurrent requests can both pass the check
before either one inserts, so both succeed, producing two votes from one user.
A unique index moves the invariant into the database itself. MongoDB enforces
the unique index atomically, so only one of the concurrent inserts succeeds —
the second throws `11000`, which the app catches and turns into a 409. This
is also one DB round-trip instead of two.

**Polling vs. WebSockets vs. SSE** — Polling every 3 seconds is a `setInterval`
+ `fetch` on the client; no new server infrastructure, no persistent
connections to manage. WebSockets or SSE would give true push updates (no
latency, less wasted bandwidth) but add real complexity: connection
lifecycle, reconnect logic, and (at scale) a pub/sub layer so all connected
clients learn about a vote regardless of which server instance handled it.
**At scale** (many concurrent viewers per poll), I'd move to SSE for one-way
result pushes, backed by Redis pub/sub so any server node can broadcast a new
vote to all subscribers.

**Aggregation vs. stored counters** — An aggregation recomputes counts from
the `Vote` collection on every request: always correct, no extra write path,
no risk of a counter drifting out of sync with actual votes. A stored
counter (incrementing a `count` field on the poll on every vote) would be
faster to read at very high vote volume, but introduces a second source of
truth that can desync if a write fails partway, and needs its own care under
concurrent increments. For this app's scale, aggregation is simpler and safer.

**JWT** — Stateless: the server verifies the signature and `exp` without a DB
lookup per request, so auth doesn't add a database round-trip to every
protected route. Trade-off: can't revoke a token before it expires (see
limitations).

**MongoDB** — Natural fit for polls: variable number of options per poll,
no joins needed for the core read/write paths, and unique compound indexes
give us exactly the atomicity guarantee the voting logic depends on.

**Timezone handling** — `<input type="datetime-local">` returns a bare
string like `"2026-10-25T14:30"` with no timezone marker. Sending that
string as-is to the server makes the eventual `Date` parse ambiguous —
behavior isn't guaranteed to anchor to the value the user actually picked.
The fix is to convert explicitly on the client, where we know the browser's
local timezone: `new Date(inputValue).toISOString()` turns it into an
unambiguous UTC string before it ever leaves the browser. The server only
ever stores and compares UTC `Date` objects; display converts back to the
viewer's local time via `.toLocaleString()`, which is also why two viewers
in different timezones can look at the same poll and see correct local
times without any per-user timezone field being stored anywhere.

**Results visibility: public route reading an optional JWT, not a protected
route** — I considered making `/results` require auth like `/vote` does and
just returning different data depending on who's calling. I didn't, because
results need to stay visible to anonymous viewers in the common case
("live" visibility, no login needed to check in on a poll). So the route
stays public, but reads a JWT if one happens to be sent, purely to identify
the creator for the one case where visibility is gated.

**Voter list: separate endpoint, not a field embedded in /results** — Voter
identities are a strictly more sensitive piece of data than an aggregate
count, with a narrower audience (creator only, always, regardless of
`resultsVisibility`). Mixing that into `/results` would mean every call to
a public endpoint has to carry branching logic for a completely different
trust level. A separate route with its own `authMiddleware` + ownership
check keeps the two concerns — "can you see the tally" vs. "can you see who
voted for what" — independently auditable.

**"Your vote" from the server, not local state** — The first version tracked
`myVote` purely as a `useState` set after a successful `POST /vote` call.
That broke on refresh (state resets) and on a second device (never set at
all), because it wasn't backed by anything durable. The fix is a tiny
read-only endpoint, `GET /:id/my-vote`, doing exactly the lookup the vote
route and its unique index already make possible: one `Vote.findOne({
pollId, userId })`. The poll page now calls it on load, so the highlight
reflects the database, not "did this tab happen to see the vote succeed."
The optimistic `setMyVote(option)` right after voting stays in place too —
it just means the UI updates instantly instead of waiting on a round trip,
and it's always consistent with what that same `my-vote` call would return.

**Result bar text contrast** — The first version made the label text white
whenever it sat on the user's own (accent-colored) bar, on the assumption
the whole label area would be accent-colored. That's only true near 100%
fill — a bar at 7% is mostly white background with a thin accent sliver,
so white text over white background is close to invisible. The fix keeps
label text a constant `var(--ink)` regardless of fill color or width (ink
has sufficient contrast against both the white card background and the
accent/yellow fills), and moves the "your vote" indicator into its own
small pill with its own background — a self-contained element that's never
relying on what's behind it for contrast.

## 3. Fifteen likely interviewer questions

1. **How do you prevent double voting under concurrent requests?**
   A unique compound index on `(pollId, userId)` in the `Vote` collection.
   Insert directly; MongoDB rejects the second insert atomically with error
   `11000`, which the route catches and returns as 409.

2. **Why not check if a vote exists before inserting?**
   Race condition — two requests can both pass the check before either
   inserts. The index makes the database the single source of truth instead
   of relying on an app-level check with a timing gap.

3. **What if the index hadn't finished building when a vote request came in?**
   Mongoose builds indexes asynchronously on `model` registration. In this
   app it's fine because the index finishes building before the app
   accepts traffic in any realistic startup — but in a system with high
   startup-time load, you'd want to confirm the index is built (e.g. via
   `Model.init()`) before serving traffic, or create the index via a
   migration ahead of deploy rather than relying on app startup.

4. **How would this scale to 1,000,000 votes on one poll?**
   Reads are the concern, not writes — the aggregation on `$match` by
   `pollId` uses the compound index's leading field, so it stays fast. For
   extremely high read traffic on `results`, I'd add a short cache
   (a few seconds TTL) in front of the aggregation rather than recomputing
   on every poll from every client.

5. **How do you scale 1,000,000 concurrent voters across servers?**
   The unique index still works correctly across multiple app server
   instances since the guarantee lives in MongoDB, not in app memory. I'd
   put a load balancer in front of multiple stateless Express instances;
   JWT auth means no session affinity is needed.

6. **Can you revoke a JWT before it expires?**
   Not with this design — JWTs are stateless and valid until `exp`. To
   support revocation you'd need a server-side blocklist (e.g. a Redis set
   of revoked token IDs) checked on every request, which reintroduces a
   lookup per request — the exact cost JWTs are meant to avoid. Short
   expiries (this app uses 24h) limit the blast radius of a leaked token.

7. **Why JWT over sessions?**
   No server-side session store to manage or scale; any server instance can
   verify a request independently. Trade-off is #6 — no easy revocation.

8. **Why poll every 3 seconds instead of WebSockets?**
   Simplicity for this app's scope — a few lines of `setInterval`, no
   connection lifecycle to manage. At higher scale or lower-latency
   requirements I'd move to SSE or WebSockets with a pub/sub backend.

9. **What happens if the client's polling interval isn't cleared?**
   It keeps firing requests after the component unmounts — wasted requests,
   and potentially a "setState on unmounted component" issue. The `useEffect`
   cleanup function calls `clearInterval` specifically to prevent this.

10. **How is a password stored, and why bcrypt?**
    Never in plain text — a bcrypt hash with salt, generated in a Mongoose
    `pre('save')` hook. bcrypt is deliberately slow (adjustable cost factor),
    which makes brute-forcing stolen hashes impractical; a fast hash like
    SHA-256 would not.

11. **Why check `isModified('password')` in the pre-save hook?**
    Without it, saving a user for any other reason (e.g. a future profile
    update) would re-hash the already-hashed password, corrupting it and
    locking the user out.

12. **How do you validate that a vote's option is legitimate?**
    The route checks `poll.options.includes(option)` before inserting —
    rejects votes for options that don't belong to that poll, protecting
    against a tampered request body.

13. **Why is expiry checked at vote time instead of via a MongoDB TTL index?**
    A TTL index would delete the whole poll document once expired, but
    expired polls still need to be viewable (showing final results). Expiry
    is a business rule enforced in the route, not a storage-layer deletion.

14. **What's the weakest part of this design?**
    No JWT revocation, and storing the token in `localStorage` is readable
    by any script on the page (XSS risk) rather than an httpOnly cookie.
    Both are deliberate scope cuts for a small app, not oversights.

15. **How would you test this without a test framework?**
    The concurrency script (`scripts/concurrency-test.js`) is the one
    automated proof in this project — it fires 50 parallel votes and asserts
    the 1-success/49-conflict split. Everything else was verified manually
    via curl and the browser during development; a real project would add
    Jest/Supertest integration tests for the auth and voting routes.

16. **Why does `/results` stay a public route instead of requiring login?**
    Live poll results are meant to be checkable by anyone with the link,
    which is the common case. Requiring auth there would break that for no
    security benefit — the data isn't sensitive by default. The route reads
    a JWT only if one is sent, purely to identify the creator for the
    `afterClose` visibility check; it doesn't reject requests without one.

17. **How do you know the creator is really the creator, on a route that
    doesn't require login?**
    `jwt.verify()` still runs if a token is present — it's optional to send,
    not optional to validate. An invalid or expired token is treated the
    same as no token (anonymous), never trusted. The actual authorization
    decision (`isCreator = callerId === String(poll.createdBy)`) only fires
    after that verification succeeds.

18. **Could a user fake the "I'm the creator" UI state in the browser?**
    The frontend decodes its own JWT payload (base64, not encrypted) just
    to decide whether to render creator-only buttons like "show voter list."
    A user could edit `localStorage` to make those buttons appear for a poll
    they don't own, but clicking them would still hit the server's real
    `poll.createdBy !== req.user.id` check and get a 403. The UI check is a
    convenience, never the actual authorization boundary.

19. **Why is the voter list a separate endpoint instead of a flag on `/results`?**
    Different trust boundaries: results can be public, voter identity never
    is. Keeping them as separate routes means the public endpoint never has
    a code path that could leak who-voted-for-what, even by a future bug —
    there's no branch in `/results` that touches voter emails at all.

20. **Why add a whole endpoint just to know "did I vote and for what"
    instead of keeping that in React state?**
    Component state doesn't survive a page refresh or a different device —
    it's not backed by anything durable, so it can silently go stale or
    wrong. `GET /my-vote` is a one-line `Vote.findOne({ pollId, userId })`
    against data that already exists (the same row the unique index
    protects), so it's a cheap, always-correct source of truth instead of
    trusting whatever the client happened to remember.

21. **A result bar at 7% width had invisible white text on white background
    — what was the actual bug, and why didn't just "making text black fix
    it everywhere"?**
    The original CSS set label color based on *which option was the user's
    vote* (white if "my bar", default otherwise), not on *how much of the
    bar was actually colored behind the text*. At high fill %, the label
    sits entirely over the accent color, so white reads fine; at low fill %,
    most of the label sits over the plain white card background, where
    white text has ~1:1 contrast. The fix removes the conditional entirely —
    label text is always ink, which has enough contrast against the card
    background, the yellow bar, and the accent bar — so correctness doesn't
    depend on fill percentage at all.

## 4. Known limitations
- JWTs cannot be revoked before they expire (no server-side blocklist).
- Live results use polling, not WebSockets/SSE — simpler, but has up to 3s
  latency and scales worse than push-based updates under heavy concurrent
  viewers.
- JWT is stored in `localStorage`, which is readable by any script running
  on the page — an XSS vulnerability could steal it. An httpOnly cookie
  would be safer but adds CSRF considerations.
- No email verification on registration.
- No rate limiting on auth or vote endpoints — vulnerable to brute-force
  login attempts or vote spam from a single actor with many accounts.
- No automated test suite beyond the concurrency script.
- `resultsVisibility: "afterClose"` is all-or-nothing — there's no partial
  view (e.g. "show total vote count but hide the breakdown").
- The creator identity check on `/results` and the `isCreator` UI check both
  rely on decoding a JWT payload that's never re-verified against a fresh
  DB lookup of the user — fine here since JWTs already carry a verified
  signature, but worth knowing this is "trust the token," not "trust the DB,"
  for the lifetime of that token (max 24h).
- No way to edit `resultsVisibility` or `showVoters` after a poll is created.
