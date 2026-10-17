const router = require('express').Router();
const jwt = require('jsonwebtoken');
const Poll = require('../models/Poll');
const Vote = require('../models/Vote');
const auth = require('../middleware/auth');

// ---------- POST /api/polls — create a poll (login required) ----------
router.post('/', auth, async (req, res) => {
  try {
    const { question, options, expiresAt, resultsVisibility, showVoters } = req.body;
    const poll = await Poll.create({
      question,
      options,
      expiresAt,
      resultsVisibility, // undefined falls back to schema default ("live")
      showVoters,
      createdBy: req.user.id, // set by auth middleware from JWT
    });
    res.status(201).json(poll);
  } catch (err) {
    // Mongoose validation errors (e.g. < 2 options) come here
    res.status(400).json({ error: err.message });
  }
});

// ---------- GET /api/polls — list all polls ----------
router.get('/', async (req, res) => {
  try {
    // Sort newest first; select only fields the list page needs
    const polls = await Poll.find()
      .sort({ createdAt: -1 })
      .select('question options expiresAt createdAt');
    res.json(polls);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- GET /api/polls/:id — single poll ----------
router.get('/:id', async (req, res) => {
  try {
    const poll = await Poll.findById(req.params.id);
    if (!poll) return res.status(404).json({ error: 'Poll not found' });
    res.json(poll);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- POST /api/polls/:id/vote — cast a vote (login required) ----------
router.post('/:id/vote', auth, async (req, res) => {
  try {
    const poll = await Poll.findById(req.params.id);
    if (!poll) return res.status(404).json({ error: 'Poll not found' });

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

// ---------- GET /api/polls/:id/results — aggregated results ----------
// No auth required normally (results are public) — but when
// resultsVisibility is "afterClose" we need to know who's asking, since
// the creator is always allowed to see their own results early. So we
// read the token IF one was sent, without requiring it (unlike authMiddleware).
router.get('/:id/results', async (req, res) => {
  try {
    const poll = await Poll.findById(req.params.id);
    if (!poll) return res.status(404).json({ error: 'Poll not found' });

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
    const poll = await Poll.findById(req.params.id);
    if (!poll) return res.status(404).json({ error: 'Poll not found' });

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

module.exports = router;
