// ---------- Load environment variables FIRST ----------
// dotenv reads .env file and sets process.env.* variables.
// Must be called before any code that uses process.env.
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// ---------- Global middleware ----------
// cors() allows the React dev server (port 5173) to call this API (port 5001).
// Without it, browsers block cross-origin requests (CORS policy).
app.use(cors());
// express.json() parses incoming JSON request bodies into req.body.
app.use(express.json());

// ---------- Routes ----------
app.use('/api/auth', require('./routes/auth'));
app.use('/api/polls', require('./routes/polls'));

// ---------- Connect to MongoDB, then start listening ----------
// We try the real MONGO_URI first. If it fails, we fall back to
// mongodb-memory-server (an in-memory MongoDB for development).
const PORT = process.env.PORT || 5001;

async function startServer() {
  let mongoUri = process.env.MONGO_URI;

  try {
    await mongoose.connect(mongoUri);
    console.log('✅ MongoDB connected (external)');
  } catch (err) {
    // Fall back to in-memory MongoDB — perfect for dev without installing Mongo
    console.log('⚠️  External MongoDB unavailable, starting in-memory server...');
    const { MongoMemoryServer } = require('mongodb-memory-server');
    const memServer = await MongoMemoryServer.create();
    mongoUri = memServer.getUri();
    await mongoose.connect(mongoUri);
    console.log('✅ MongoDB connected (in-memory)');
  }

  app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
}

startServer().catch((err) => {
  console.error('❌ Failed to start server:', err.message);
  process.exit(1);
});
