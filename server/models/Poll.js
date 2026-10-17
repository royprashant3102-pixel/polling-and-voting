const mongoose = require('mongoose');
const crypto = require('crypto');

// ---------- Poll schema ----------
// Each poll has a question, an array of option strings, an expiry date,
// and a reference to the user who created it.
const pollSchema = new mongoose.Schema(
  {
    question: { type: String, required: true },

    // options is an array of plain strings — e.g. ["Red", "Blue", "Green"].
    // We validate that the array has between 2 and 5 elements.
    options: {
      type: [String],
      validate: {
        validator: (arr) => arr.length >= 2 && arr.length <= 5,
        message: 'A poll must have between 2 and 5 options',
      },
    },

    // expiresAt tells us when the poll stops accepting votes.
    // We check this server-side at vote time, NOT via a MongoDB TTL index,
    // because we still want to display expired polls and their results.
    expiresAt: { type: Date, required: true },

    // createdBy stores the userId of the poll creator (a reference to User).
    // 'ref' enables Mongoose .populate() if we ever need to join user info.
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // resultsVisibility: "live" (default) shows running results to everyone;
    // "afterClose" hides results from non-creators until expiresAt passes.
    resultsVisibility: {
      type: String,
      enum: ['live', 'afterClose'],
      default: 'live',
    },

    // showVoters: if true, the creator can see who voted for what via
    // GET /:id/voters. Voters are shown a notice at creation time so they
    // know their vote won't be anonymous.
    showVoters: { type: Boolean, default: false },

    // visibility: "public" (default) appears in GET /polls and is reachable
    // by _id. "linkOnly" is hidden from the list entirely and can only be
    // reached with the matching shareToken — see routes/polls.js's
    // requireAccess helper, which every poll-loading route goes through.
    visibility: {
      type: String,
      enum: ['public', 'linkOnly'],
      default: 'public',
    },

    // shareToken: only set for linkOnly polls. `sparse: true` means the
    // unique index ignores documents where this field is absent (every
    // "public" poll) — otherwise two public polls, both missing the field,
    // would collide on a plain unique index (which treats two nulls as
    // a duplicate).
    shareToken: {
      type: String,
      unique: true,
      sparse: true,
    },
  },
  // timestamps: true → Mongoose auto-adds createdAt and updatedAt fields
  { timestamps: true }
);

// Generates a new random token for a linkOnly poll's shareable link.
// crypto.randomBytes is cryptographically secure — unlike Math.random(),
// it can't be predicted, which matters here since the token IS the access
// control for the poll (anyone holding it can view/vote).
function generateShareToken() {
  return crypto.randomBytes(16).toString('hex');
}

const Poll = mongoose.model('Poll', pollSchema);
module.exports = Poll;
module.exports.generateShareToken = generateShareToken;
