# Interview Notes

UI is plain CSS with design tokens, no UI library.

## 1. Request flow

**Login**
1. Client sends `{ email, password }` to `POST /api/auth/login`.
2. Server looks up the user by email, runs `bcrypt.compare` against the stored hash.
3. On match, signs a JWT (`{ userId }`, 24h expiry) and returns it.
4. Client stores the token in `localStorage` and attaches it as
   `Authorization: Bearer <token>` on every future request.

**Vote (cast OR change)**
1. `POST /api/polls/:id/vote` hits `authMiddleware` first — verifies the JWT,
   sets `req.user.id`. Invalid/missing token → 401, request never reaches the route.
2. Route loads the poll via `loadPollForRequest`, checks `isPollClosed(poll)`
   → 403 if closed (either expired or closed early).
3. Checks the submitted `option` is actually one of the poll's options → 400 if not.
4. Calls `Vote.findOneAndUpdate({ pollId, userId }, { option }, { upsert: true })`
   — one call, no "has this user voted?" check first, and no separate
   insert-vs-update branch. This single atomic operation either creates
   the vote (first time) or updates it in place (voter changed their
   mind) — MongoDB decides which, based on whether a row matching
   `(pollId, userId)` already exists, and there's no gap between "check"
   and "write" for two parallel requests to race through.
5. Without `new: true`, this call returns the document as it was BEFORE
   the update — `null` if nothing matched (this upsert just created the
   first vote → 201 "Vote recorded"), or the previous vote document if one
   already existed (→ 200 "Vote changed"). This is read entirely from the
   same atomic write, not a separate lookup, so it can't reintroduce a race.

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

**Link-only poll access (every poll-by-id route)**
1. Every route that loads a poll by `:id` — get, vote, my-vote, results,
   voters, close, delete — calls one shared `loadPollForRequest(req, res)`
   helper first instead of `Poll.findById` directly.
2. `loadPollForRequest` loads the poll; if missing, 404. If the poll's
   `visibility` is `"linkOnly"`, it also requires EITHER a matching token
   (sent as the `x-share-token` header or a `?token=` query param) OR the
   caller being the poll's own creator (identified via JWT — never via the
   token itself, so the creator is never locked out of their own poll). If
   neither holds, 404 again (never 403).
3. `GET /api/polls/by-token/:token` is the one entry point that doesn't need
   the Mongo `_id` at all — it looks the poll up by `shareToken` directly,
   which is how the frontend's `/p/:token` route resolves a poll it only
   has the token for.
4. `POST /api/polls/:id/regenerate-link` is creator-only (checked via JWT,
   not the token) and overwrites `shareToken` with a new
   `crypto.randomBytes(16).toString('hex')` value — the old token is simply
   gone, not kept as a second valid value, so it 404s on the very next request.
   It deliberately uses `Poll.findById` directly, not `loadPollForRequest` —
   the whole point is letting a creator recover even after losing their
   current token, so the route can't require a currently-valid one to run.

**Close early / Delete**
1. `isPollClosed(poll)` — defined once on the `Poll` model — returns
   `poll.closedAt != null || new Date() > poll.expiresAt`. The vote route
   and the `resultsVisibility === "afterClose"` check both call this
   instead of re-deriving "is this poll closed," so the rule can't drift.
2. `POST /api/polls/:id/close` is creator-only (403 otherwise), sets
   `closedAt = new Date()` only if it isn't already set — calling it twice
   is a no-op that still returns 200 with the unchanged `closedAt`, not an
   error.
3. `DELETE /api/polls/:id` is creator-only, deletes the poll, and runs
   `Vote.deleteMany({ pollId })` first — so no vote is left pointing at a
   `pollId` that no longer resolves to anything.

## 2. Why I chose this

**Unique index vs. check-then-insert** — Check-then-insert (`findOne` then
`create`/`update`) has a race window: two concurrent requests can both pass
the check before either one writes, so both succeed, producing two votes
from one user. A unique index moves the invariant into the database itself.

This project went through two versions of "what happens on a second vote
from the same user":

- **v1 (insert-only, original design)**: `Vote.create()` directly, no
  existence check. MongoDB enforces the unique index atomically, so only
  one of two concurrent inserts succeeds — the second throws `11000`,
  caught and turned into 409 "You have already voted." Voting was
  permanent.
- **v2 (current — changing your vote is allowed)**: `Vote.findOneAndUpdate(
  { pollId, userId }, { option }, { upsert: true })`. Still one atomic
  database operation, still built on the same unique index — but now the
  "second write" updates the existing row instead of being rejected.
  There's still no check-then-write gap: this isn't "check if a vote
  exists, then decide whether to insert or update" in the app — it's one
  call, and MongoDB resolves "does a row already exist for this
  (pollId, userId)?" atomically as part of the same operation.

Both versions share the same core property: the unique index is what
makes "exactly one vote row per (pollId, userId), even under a real race"
true. What changed is only the *outcome* for a repeat request — reject vs.
update — not the mechanism that keeps it race-safe. concurrency-test.js
was rewritten to match: it no longer asserts "1 success, 49 conflicts"
(that was true for v1); it asserts "50 successful responses, but exactly
1 vote row exists afterward" (true for v2, and honestly a stronger proof,
since it checks the actual database state rather than just HTTP statuses).

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

**Link-only polls: 404, not 403, and one shared gate function** — Two
decisions here, both load-bearing:

First, every denial for a wrong/missing token on a linkOnly poll returns
404, matching "poll doesn't exist," rather than 403 ("exists, but you can't
see it"). A 403 is itself a leak: it tells an attacker guessing IDs that
*this specific _id* is a real, hidden poll, even without the token — now
they know where to focus a brute-force attempt on the token. A uniform 404
makes "wrong ID" and "right ID, wrong token" indistinguishable from outside.

Second, the check lives in exactly one function, `loadPollForRequest`, and
EVERY route that loads a poll by `:id` calls it instead of `Poll.findById`
directly — get, vote, my-vote, results, voters, close, delete. The
alternative — repeating an `if (poll.visibility === 'linkOnly' && token !==
poll.shareToken)` block in seven different routes — is the classic way this
kind of check gets accidentally skipped on an eighth route added later.
Centralizing it means adding a new poll-by-id route is either "call
loadPollForRequest" (correct by construction) or a visible, obvious
omission in review, not a silent gap. The one exception is deliberate:
`regenerate-link` uses `Poll.findById` directly, because requiring a
currently-valid token to regenerate the token would make it impossible to
recover a lost link — that route's authorization is "are you the creator,"
full stop, checked via JWT.

Inside `loadPollForRequest`, the creator always bypasses the token check
(identified via a JWT read the same way `/results` does — optional, not
required). Without this, a creator who lost their own link would be
locked out of their own poll until they thought to call regenerate-link
first, which is a confusing failure mode for something they created.

**IDOR risk, named explicitly** — This whole feature is an IDOR (Insecure
Direct Object Reference) mitigation pattern turned into the actual access
control: normally you'd worry about an attacker swapping `:id` in a URL to
reach someone else's resource; here, `shareToken` is deliberately the
*only* legitimate way (besides being the creator) to reach a linkOnly poll
by design, not a bug to fix. That only holds up because the token is
unguessable — 16 bytes from `crypto.randomBytes`, never a counter or
anything derived from the poll's `_id` or creation time. **Specifically,
it is never the poll's `_id` itself** — a Mongo ObjectId is partly
time-derived and gets exposed constantly (every public poll's `_id` is
visible in its own URL and API response), so using it as the "secret"
would mean an attacker who's seen *any* poll's `_id` has a head start on
guessing nearby ones. If the token were guessable the same way, every
linkOnly poll would be exactly as exposed as a public one, just with
extra steps.

**isPollClosed as a single source of truth** — Before this feature,
"is the poll still open" was one check (`new Date() > poll.expiresAt`)
duplicated in the vote route and the results visibility gate. Adding a
second way for a poll to become closed (closing early) without
consolidating that check first would have meant finding and updating two
places, with a real chance of missing one — exactly the bug class
`loadPollForRequest` was built to avoid for linkOnly access. So
`isPollClosed(poll)` lives once on the model and both call sites use it.

**Post-login redirect via router state, not a query param** — When an
unauthenticated visitor hits a protected route (most commonly: a
brand-new user clicking a shared `/p/:token` link), `RequireAuth`
redirects to `/login`. Without remembering where they were headed,
`Auth.jsx` always sent them to `/polls` after logging in — so someone
invited to a specific poll would register, log in, and land on an
unrelated list, with no obvious way back to the thing they were actually
invited to. The fix passes the original path as React Router `state`
(`<Navigate to="/login" state={{ from: location.pathname }} />`), which
`Auth.jsx` reads back (`location.state?.from`) and navigates to after a
successful login — falling back to `/polls` for a normal, unprompted
visit to the login page. Router state rather than a `?redirect=` query
param because it doesn't show up in the URL bar, isn't persisted in
browser history as a separate entry, and doesn't need URL-encoding for
paths that might contain special characters (a share token is just hex
here, but the pattern should hold for anything).

## 3. Fifteen likely interviewer questions

1. **How do you prevent double voting under concurrent requests?**
   A unique compound index on `(pollId, userId)` in the `Vote` collection,
   combined with `findOneAndUpdate(..., { upsert: true })` instead of a
   separate check-then-write. There's no app-level gap between "does a
   vote exist?" and "write the vote" for two parallel requests to race
   through — MongoDB resolves that atomically as part of the one operation.
   The index guarantees at most one row per `(pollId, userId)` no matter
   how many requests arrive at once; whether the second one *inserts* or
   *updates* that row, it can never create a second one.

2. **Why not check if a vote exists before writing?**
   Race condition — two requests can both pass the check before either
   writes. The index (plus the atomic upsert) makes the database the
   single source of truth instead of relying on an app-level check with a
   timing gap. (Earlier versions of this app rejected a second vote
   outright with 409; the current version allows changing your vote, so
   the "second write" now updates instead of being rejected — but the
   underlying race-safety mechanism, atomicity at the database level,
   hasn't changed.)

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

22. **Why 404 instead of 403 when someone hits a link-only poll without
    the right token?**
    403 means "I know this exists, but no." That's itself information
    leakage for a feature whose entire point is that the poll's existence
    is secret to anyone without the link — a 403 confirms the `_id` is real
    and worth attacking further (e.g. brute-forcing the token). 404 makes
    "this ID doesn't exist" and "this ID exists but you lack the token"
    indistinguishable from the outside.

23. **What stops someone from just guessing shareTokens?**
    The token is 16 bytes (128 bits) from `crypto.randomBytes`, rendered as
    32 hex characters — cryptographically random, not sequential or
    derived from anything predictable like the poll's `_id` or creation
    time. Brute-forcing that keyspace is infeasible at any practical rate
    a server would allow. This *is* the access control, not a convenience
    on top of one — see the IDOR discussion above.

24. **Why does `regenerate-link` use `Poll.findById` instead of the shared
    `loadPollForRequest` helper?**
    `loadPollForRequest` answers "can this caller reach this poll" —
    correct for reads/votes, but wrong here: regeneration exists
    specifically so a creator who's *lost* their current token can still
    get a new one. Gating it on already holding a valid token would make
    that impossible. Authorization for this route comes entirely from the
    JWT (`poll.createdBy === req.user.id`), not from token possession.

25. **Is "link only" real privacy/security, or just obscurity?**
    Honestly, closer to obscurity with a cryptographically strong secret —
    anyone who legitimately has the link can always re-share it, and the
    server has no way to distinguish an authorized viewer from someone they
    forwarded it to. It's "not discoverable and not guessable," which is a
    real and useful property (keeps it out of search, off the public list,
    safe from ID-enumeration attacks), but it is not the same guarantee as
    per-user access control — there's no login-gated allowlist of who's
    permitted to view it.

26. **Why consolidate "is this poll closed" into `isPollClosed` instead of
    just adding a `closedAt` check next to the existing expiry check in the
    vote route?**
    Because there were already two places deciding "is voting still
    allowed": the vote route's expiry check, and the results route's
    `afterClose` visibility gate. Adding a second condition (closed early)
    to only one of those two would silently desync them — e.g. voting
    correctly blocked after closing early, but results still treating the
    poll as "not yet closed" because that route never learned about
    `closedAt`. One function both call sites use removes that possibility.

27. **What's the difference between closing a poll and deleting it?**
    Closing is non-destructive — the poll, its votes, and its results stay
    exactly as they were, voting just stops. Delete is destructive: the
    poll document and `Vote.deleteMany({ pollId })` both run, so the poll
    and every vote on it are gone, with no soft-delete or undo.

28. **Closing an already-closed poll — what should happen?**
    Nothing changes. The route checks `if (poll.closedAt == null)` before
    setting it, so a second call doesn't overwrite the original close
    timestamp — it just returns 200 with the poll as it already was. This
    matters if two tabs or a retried request both call `/close`: neither
    one errors, and `closedAt` reflects the *first* time it happened, not
    whichever request happened to run last.

29. **Why does `DELETE` need to touch the `Vote` collection at all — isn't
    deleting the `Poll` document enough?**
    MongoDB has no foreign keys or cascading deletes — `Vote.pollId` is
    just an `ObjectId` field with no enforced relationship to `Poll._id`.
    Deleting only the poll would leave every vote on it as an orphan: rows
    referencing a `pollId` that resolves to nothing, invisible in the UI
    but still occupying space and still countable by anything that queries
    `Vote` directly (like a future admin report). `Vote.deleteMany({
    pollId })` has to run explicitly as part of the same delete operation.

30. **How does `POST /vote` know whether to return 201 (new vote) or 200
    (changed vote) when it's one call, not a branch for each case?**
    `findOneAndUpdate` without `new: true` returns the document as it was
    *before* the update — not after. For a true upsert (no prior vote),
    that's `null`; for an update (a vote already existed), it's the
    previous vote. The route checks `previousVote === null` to decide the
    status code and message. This is still one atomic database call — the
    "which case was it" answer comes from what that single call returns,
    not from a second query that could introduce its own race.

31. **Can a malicious or buggy client spam vote-changes — vote A, then B,
    then A, thousands of times?**
    Nothing currently rate-limits this beyond whatever auth/network
    friction exists (see known limitations — there's no rate limiting
    anywhere in this app yet). Each call is still safe individually
    (atomic upsert, correct final state), so spamming it wouldn't corrupt
    data or create duplicate votes — just unnecessary write load. A
    production version would want rate limiting on this route specifically,
    separate from the general "no rate limiting" gap.

32. **Walk me through what happens end-to-end when a brand-new user clicks
    a shared link-only poll link.**
    They hit `/p/:token` → `RequireAuth` finds no token in `localStorage`
    → redirects to `/login`, passing `{ from: '/p/:token' }` as router
    state → they register, then log in on the same page → `Auth.jsx`
    reads `location.state.from` and navigates there → `PollDetail` (via
    the `/p/:token` route) resolves the poll by calling
    `GET /by-token/:token`, learns the real `_id`, and from then on
    attaches `x-share-token` on every request for that poll, the same as
    if they'd had the token from the start.

33. **What did a security review of this app turn up?**
    Two real bugs, both fixed: (1) `expiresAt` wasn't validated on poll
    creation — garbage input became an Invalid Date, and `new Date() >
    invalidDate` is always `false`, so `isPollClosed()` would never
    consider that poll expired by time (the creator could still close it
    manually, so impact was limited, but it's a genuine unvalidated-input
    bug). Fixed with `isNaN(Date.parse(expiresAt))` before creating the
    poll. (2) `GET /:id/voters` checked that the caller was the creator,
    but never checked `poll.showVoters` — so a creator could fetch every
    voter's email directly via the API even on a poll created with
    `showVoters: false`, bypassing the anonymity promise shown to voters.
    The frontend only hid the button; the API didn't enforce the rule it
    claimed to in its own comment. Fixed by adding the `showVoters` check
    server-side, where it actually belongs — the UI was never the
    boundary, the endpoint was.

34. **What's the general lesson from finding #2 above?**
    A comment describing a security property (`"Only meaningful when
    showVoters was enabled"`) is not the same as code enforcing it. The
    frontend correctly hid the button, which made the gap easy to miss in
    normal use — nothing in the UI ever exercised the broken path. The
    actual authorization boundary has to live in the route handler itself,
    checked against the database, not inferred from "well, the button that
    calls this is conditionally rendered."

35. **Why is "extend deadline" a separate route instead of letting the
    creator PATCH `expiresAt` directly, any direction?**
    Two reasons. First, pulling a deadline *earlier* already has a
    dedicated, well-defined action: close-early, which sets `closedAt`
    rather than mutating `expiresAt` at all — letting `expiresAt` also
    move backward would create two different ways to "close" a poll with
    different side effects, which is exactly the kind of duplicate-logic
    situation `isPollClosed()` was built to avoid. Second, an unrestricted
    PATCH on `expiresAt` has no natural validation boundary — "any new
    date" includes nonsense like setting it to a date in the past (which
    is just close-early with extra steps) or far enough in the future to
    be meaningless. Scoping the route to "forward only" makes the
    validation trivial and the intent explicit in the route name.

36. **Why didn't extending the deadline just un-close a poll that was
    closed early?**
    Because `closedAt` and `expiresAt` represent different decisions.
    `expiresAt` is "when does this poll naturally end" — a date, set once
    at creation, extendable. `closedAt` is "the creator decided to end
    this early, on purpose" — a deliberate action with its own
    confirmation dialog in the UI. If extending `expiresAt` silently
    un-closed a poll, a creator who closed a poll on purpose (maybe
    because of an abusive vote, or because they got the answer they
    needed) could have it reopened as an unintended side effect of
    fixing the deadline on an unrelated, still-open poll they're managing
    at the same time. Keeping them independent means each action only
    does the one thing it says it does.

37. **Why isn't `isAdmin` just added to the JWT payload like `userId`?**
    The JWT payload is deliberately minimal — `{ userId }` only — a
    design decision made from the start of this project, so the token
    stays small and nothing beyond identity needs to be re-signed if it
    changes. Admin status is exactly the kind of thing that *can* change
    while a user's existing token is still valid (promoted or demoted
    mid-session), and embedding it in the JWT would mean that change
    doesn't take effect until the user logs in again — a confusing,
    silent staleness. Instead, `isAdmin` is looked up fresh from the
    database, but only on the routes that actually need it (`DELETE /:id`
    when the caller isn't the poll's creator, and `GET /auth/me` for the
    frontend), not on every authenticated request — so the "small, fast
    JWT" property is preserved everywhere else.

38. **How is someone actually made an admin?**
    There's no API route for it — `isAdmin` is flipped by directly
    editing the `User` document in the database (e.g. a one-off script
    run by whoever operates the server). This is intentional for a small
    app with one operator: a self-service "become admin" endpoint would
    obviously need its own strict authorization, and building that for a
    single-operator app is complexity with no payoff. A larger app would
    need an actual admin-management UI and audit trail; this one
    explicitly doesn't have one yet (see known limitations).

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
- Link-only polls rely on "anyone with the link can view and vote" — the
  server has no way to tell a legitimate recipient from someone the
  creator's link was forwarded to without permission. Regenerating the
  link is the only recourse once a link leaks further than intended.
- The shareToken is the entire access-control mechanism for a linkOnly
  poll, so its unguessability (16 random bytes) is doing real security
  work, not just acting as a nicer-looking ID — worth being explicit about
  rather than treating "hidden from the list" as equivalent to "protected."
- No way to switch a poll between public and linkOnly after creation, or
  to set an explicit "only these emails can vote" allowlist — link-only is
  possession-based access, not identity-based.
- Deleting a poll is permanent and immediate — no soft-delete, no undo, no
  confirmation beyond the frontend's `window.confirm()` (which only guards
  against misclicks, not a compromised account or a scripted request).
- Closing a poll early has no effect on `resultsVisibility` — a poll
  closed early with `"afterClose"` visibility still keeps results hidden
  from non-creators until the closing moment (closing counts as the poll
  becoming closed, so this actually makes results visible immediately,
  which is correct, but worth being explicit that these are two
  independent settings, not one toggling the other).
- Vote changes have no history — only the current vote is stored, so
  there's no way to see "voted A, then changed to B" after the fact,
  either as the voter or as the creator viewing the voter list.
- No rate limiting on vote-changing specifically. Each call is atomic and
  safe individually, but nothing stops a client from calling it repeatedly
  in a tight loop — not a correctness problem, just unnecessary load.
- The post-login redirect only remembers one hop: if a logged-out user
  bounces through `/login` → registers → logs in, they land back on the
  original path, but if they then manually navigate elsewhere and get
  logged out again, the "from" state from the first bounce is gone —
  there's no persistent "return to this later" beyond a single redirect.
- No "forgot password" flow — no recovery path for a lost password. A
  real one needs an email-sending dependency (nodemailer + a provider),
  deliberately left out of this project's scope.
- No admin management UI — `isAdmin` is flipped by hand, directly in the
  database. No "promote this user" button, no list of current admins, no
  way to demote one from inside the app.
- Admin deletes have no audit trail, same as a creator's own delete —
  just gone, with no log of who deleted what poll or when.
- `extend` has no upper bound either — a creator could extend a poll's
  deadline to a date far enough in the future to be effectively
  permanent, same "no cap" philosophy as the unlimited options list.
