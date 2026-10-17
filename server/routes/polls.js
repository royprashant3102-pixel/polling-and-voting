const router = require('express').Router();
const jwt = require('jsonwebtoken');
const Poll = require('../models/Poll');
const Vote = require('../models/Vote');
const auth = require('../middleware/auth');

// ---------- Shared "load + gate" helper for every poll-by-id route ----------
// Loads the poll, then — if it's linkOnly — requires the matching
// shareToken (sent as an 'x-share-token' header or a ?token= query param).
// Returns 404, not 403, on both "poll doesn't exist" and "wrong/missing
// token for a linkOnly poll": a 403 would confirm the poll exists to
// someone without the link, which defeats the point of "link only."
// Every route below that loads a poll by :id goes through this one
// function, so the check can't be missed on a future route.
async function requireAccess(req, res) {
  const poll = await Poll.findById(req.params.id);
  if (!poll) {
    res.status(404).json({ error: 'Poll not found' });
    return null;
  }
  if (poll.visibility === 'linkOnly') {
    const token = req.headers['x-share-token'] || req.query.token;
    if (!token || token !== poll.shareToken) {
      res.status(404).json({ error: 'Poll not found' });
      return null;
    }
  }
  return poll;
}

// ---------- POST /api/polls — create a poll (login required) ----------
router.post('/', auth, async (req, res) => {
  try {
    const { question, options, expiresAt, resultsVisibility, showVoters, visibility } = req.body;
    const poll = await Poll.create({
      question,
      options,
      expiresAt,
      resultsVisibility, // undefined falls back to schema default ("live")
      showVoters,
      visibility, // undefined falls back to schema default ("public")
      // Only linkOnly polls get a token — a public poll has no use for one,
      // and leaving it unset is what keeps the sparse unique index happy.
      shareToken: visibility === 'linkOnly' ? Poll.generateShareToken() : undefined,
      createdBy: req.user.id, // set by auth middleware from JWT
    });
    res.status(201).json(poll);
  } catch (err) {
    // Mongoose validation errors (e.g. < 2 options) come here
    res.status(400).json({ error: err.message });
  }
});

// ---------- GET /api/polls — list all public polls ----------
// linkOnly polls are excluded entirely — not just unlinked, actually absent
// from this response — since the list is the one place an unauthorized
// visitor could otherwise discover a link-only poll's existence.
router.get('/', async (req, res) => {
  try {
    const polls = await Poll.find({ visibility: 'public' })
      .sort({ createdAt: -1 })
      .select('question options expiresAt createdAt');
    res.json(polls);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- GET /api/polls/by-token/:token — load a linkOnly poll ----------
// Separate from GET /:id because the frontend's /p/:token route only ever
// has the token, not the Mongo _id.
router.get('/by-token/:token', async (req, res) => {
  try {
    const poll = await Poll.findOne({ shareToken: req.params.token, visibility: 'linkOnly' });
    if (!poll) return res.status(404).json({ error: 'Poll not found' });
    res.json(poll);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- GET /api/polls/:id — single poll ----------
router.get('/:id', async (req, res) => {
  try {
    const poll = await requireAccess(req, res);
    if (!poll) return; // requireAccess already sent the 404
    res.json(poll);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- POST /api/polls/:id/vote — cast a vote (login required) ----------
router.post('/:id/vote', auth, async (req, res) => {
  try {
    const poll = await requireAccess(req, res);
    if (!poll) return;

    // --- Server-side expiry check ---
    // We check here (not in the DB query) so we can return a clear 403.
    if (new Date() > poll.expiresAt) {
      return res.status(403).json({ error: 'This poll has expired' });
    }

    // --- Validate that the chosen option exists in this poll ---
    const { option } = req.body;
    if (!poll.options.includes(option)) {
      return res.status(400).json({ error: 'Invalid option for this poll' });
    }

    // --- Insert the vote and let the unique index handle duplicates ---
    // We do NOT do: "if (await Vote.findOne({pollId, userId})) return 409"
    // because two parallel requests could both pass that check before
    // either inserts → both would succeed → broken invariant.
    // Instead, we insert directly. If the unique index rejects it,
    // MongoDB throws error code 11000 which we catch below.
    await Vote.create({
      pollId: req.params.id,
      userId: req.user.id,
      option,
    });

    res.status(201).json({ message: 'Vote recorded' });
  } catch (err) {
    // --- Catch duplicate key error from the unique index ---
    if (err.code === 11000) {
      return res.status(409).json({ error: 'You have already voted' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ---------- GET /api/polls/:id/my-vote — what did I vote? (login required) ----------
// Lets the frontend highlight "your vote" from the DB instead of local
// state, so it survives a refresh or logging in from a different device.
// Read-only lookup against the same unique (pollId, userId) pair the vote
// route relies on — no changes to that index or route.
router.get('/:id/my-vote', auth, async (req, res) => {
  try {
    const poll = await requireAccess(req, res);
    if (!poll) return;
    const vote = await Vote.findOne({ pollId: req.params.id, userId: req.user.id });
    res.json({ option: vote ? vote.option : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- GET /api/polls/:id/results — aggregated results ----------
// No auth required normally (results are public) — but when
// resultsVisibility is "afterClose" we need to know who's asking, since
// the creator is always allowed to see their own results early. So we
// read the token IF one was sent, without requiring it (unlike authMiddleware).
router.get('/:id/results', async (req, res) => {
  try {
    const poll = await requireAccess(req, res);
    if (!poll) return;

    const header = req.headers.authorization;
    let callerId = null;
    if (header) {
      try {
        callerId = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET).userId;
      } catch {
        // invalid/expired token on a public route — just treat as anonymous
      }
    }
    const isCreator = callerId === String(poll.createdBy);
    const isExpired = new Date() > poll.expiresAt;

    if (poll.resultsVisibility === 'afterClose' && !isExpired && !isCreator) {
      return res.status(403).json({ error: 'Results will be visible after the poll closes' });
    }

    // --- MongoDB Aggregation Pipeline ---
    // $match: filter votes to only this poll (uses the index on pollId)
    // $group: count votes per option using $sum: 1
    const voteCounts = await Vote.aggregate([
      { $match: { pollId: poll._id } },
      { $group: { _id: '$option', count: { $sum: 1 } } },
    ]);

    // --- Include options with 0 votes ---
    // The aggregation only returns options that have at least 1 vote.
    // We merge with the poll's options array to fill in zeros.
    const countsMap = {};
    voteCounts.forEach((v) => (countsMap[v._id] = v.count));

    const results = poll.options.map((opt) => ({
      option: opt,
      count: countsMap[opt] || 0,
    }));

    res.json({ question: poll.question, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- GET /api/polls/:id/voters — creator-only voter list ----------
// Only meaningful when showVoters was enabled at creation. Login required;
// 403 for anyone other than the poll's creator, regardless of showVoters,
// since this exposes who voted for what.
router.get('/:id/voters', auth, async (req, res) => {
  try {
    const poll = await requireAccess(req, res);
    if (!poll) return;

    if (String(poll.createdBy) !== req.user.id) {
      return res.status(403).json({ error: 'Only the poll creator can view voters' });
    }

    // populate('userId', 'email') joins in just the email field from User,
    // instead of a second manual query per vote.
    const votes = await Vote.find({ pollId: poll._id }).populate('userId', 'email');
    const voters = votes.map((v) => ({ email: v.userId.email, option: v.option }));

    res.json(voters);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- POST /api/polls/:id/regenerate-link — new token (creator-only) ----------
// Deliberately uses Poll.findById, NOT requireAccess: the creator must be
// able to regenerate even if they've lost their current link/token — their
// identity comes from the JWT, not from already holding a valid token.
// The old token stops working immediately since it's overwritten, not kept
// as a second valid value.
router.post('/:id/regenerate-link', auth, async (req, res) => {
  try {
    const poll = await Poll.findById(req.params.id);
    if (!poll) return res.status(404).json({ error: 'Poll not found' });

    if (String(poll.createdBy) !== req.user.id) {
      return res.status(403).json({ error: 'Only the poll creator can regenerate the link' });
    }
    if (poll.visibility !== 'linkOnly') {
      return res.status(400).json({ error: 'Only link-only polls have a share link' });
    }

    poll.shareToken = Poll.generateShareToken();
    await poll.save();

    res.json({ shareToken: poll.shareToken });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
