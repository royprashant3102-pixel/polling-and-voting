const jwt = require('jsonwebtoken');

// ---------- Auth middleware ----------
// Express middleware sits between the request and the route handler.
// This one checks for a valid JWT in the "Authorization: Bearer <token>" header.
// If valid, it attaches the decoded payload (userId) to req.user so routes can use it.
// If missing or invalid, it short-circuits with 401 Unauthorized.
module.exports = (req, res, next) => {
  // 1. Read the header — convention is "Bearer <token>"
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token provided' });

  const token = header.split(' ')[1]; // grab the part after "Bearer "

  try {
    // 2. jwt.verify throws if the token is expired or tampered with
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // 3. Attach userId so downstream route handlers know WHO is making the request
    req.user = { id: decoded.userId };
    next(); // pass control to the next middleware / route handler
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};
