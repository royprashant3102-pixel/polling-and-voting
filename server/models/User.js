const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

// ---------- Schema ----------
const userSchema = new mongoose.Schema({
  // unique: true creates a MongoDB unique index → no two users share an email
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
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
