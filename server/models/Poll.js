const mongoose = require('mongoose');

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
  },
  // timestamps: true → Mongoose auto-adds createdAt and updatedAt fields
  { timestamps: true }
);

module.exports = mongoose.model('Poll', pollSchema);
