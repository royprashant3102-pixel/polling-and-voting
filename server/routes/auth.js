const router = require('express').Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// ---------- POST /api/auth/register ----------
// Creates a new user. The pre-save hook in User.js hashes the password.
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    // Minimal shape checks — the DB unique index is what actually guarantees
    // no duplicate emails; this just rejects obviously-bad input early.
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const user = await User.create({ email, password });
    // Return 201 Created — we don't auto-login; the client calls /login next.
    res.status(201).json({ message: 'User registered', userId: user._id });
  } catch (err) {
    // Mongoose duplicate key error → email already taken
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ---------- POST /api/auth/login ----------
// Verifies credentials and returns a JWT.
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    // 1. Find user by email
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    // 2. Compare plain-text password with the stored bcrypt hash
    const match = await user.comparePassword(password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    // 3. Sign a JWT containing the userId — expires in 24 hours
    //    The payload is minimal on purpose: JWTs are sent with every request,
    //    so keep them small. Fetch user details from DB if needed.
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: '24h',
    });

    res.json({ token, userId: user._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
