const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

// ---------- Schema ----------
const userSchema = new mongoose.Schema({
  // unique: true creates a MongoDB unique index → no two users share an email
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },

  // isAdmin: no registration flow sets this — it's flipped manually (e.g.
  // directly in the DB) for whoever runs this site, not something a user
  // can grant themselves through the app. Admins can delete any poll, not
  // just ones they created, for removing content without a reporting system.
  isAdmin: { type: Boolean, default: false },
});

// ---------- Pre-save hook: hash password before writing to DB ----------
// "pre('save')" runs before every .save() call.
// We only hash when the password field is new or changed (isModified check)
// so that updating other fields doesn't re-hash an already-hashed password.
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  // 10 = salt rounds — higher is slower but more secure; 10 is the standard
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// ---------- Instance method: compare plain-text password to hash ----------
// Used at login time. bcrypt.compare handles salt extraction internally.
userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);
