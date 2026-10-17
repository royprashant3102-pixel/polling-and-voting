const mongoose = require('mongoose');

// ---------- Vote schema ----------
// Each vote records: which poll, which user, and which option they chose.
const voteSchema = new mongoose.Schema(
  {
    pollId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Poll',
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // option stores the exact string the user picked (must match a poll option)
    option: { type: String, required: true },
  },
  { timestamps: true }
);

// ---------- COMPOUND UNIQUE INDEX ----------
// This is the KEY design decision for preventing duplicate votes.
// { pollId: 1, userId: 1 } means "one vote per user per poll".
// If a second insert has the same (pollId, userId), MongoDB rejects it
// with error code 11000 (duplicate key) ATOMICALLY — no race condition.
//
// Why NOT "check then insert"?
//   1. Two requests can pass the check simultaneously before either inserts.
//   2. The unique index makes the DB the single source of truth.
//   3. It's faster: one DB round-trip instead of two.
voteSchema.index({ pollId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('Vote', voteSchema);
