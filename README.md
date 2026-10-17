# Polling / Voting App

A small full-stack polling app: Express + MongoDB backend, React (Vite) frontend.
Built as interview prep — see [INTERVIEW_NOTES.md](INTERVIEW_NOTES.md) for the
design reasoning and likely interview questions.

## Stack
Node.js, Express, MongoDB, Mongoose, JWT, bcrypt, React (Vite), axios, plain CSS.
No TypeScript, Docker, Redis, Socket.IO, or test frameworks.
UI is plain CSS with design tokens, no UI library.

## Setup

### 1. Server
```bash
cd server
npm install
cp .env.example .env   # then edit values if needed
npm run dev
```
Server runs on `http://localhost:5001`. If `MONGO_URI` is unreachable, it
automatically falls back to an in-memory MongoDB (`mongodb-memory-server`) —
fine for development, but data won't persist across restarts.

### 2. Client
```bash
cd client
npm install
npm run dev
```
Client runs on `http://localhost:5173` and talks to the API at `localhost:5001`.

### 3. Concurrency proof script
With the server already running:
```bash
cd server
npm run concurrency
```
Fires 50 parallel vote requests from the same user and prints how many
succeeded (201) vs. were rejected as duplicates (409). Expected: 1 and 49.

## Environment variables (`server/.env`)
See `server/.env.example`:
- `MONGO_URI` — MongoDB connection string
- `JWT_SECRET` — secret used to sign JWTs
- `PORT` — port the Express server listens on

## Folder structure
```
server/   Express API (auth, polls, voting, results)
client/   React frontend (login/register, poll list, poll detail)
```

## Poll options at creation
- **Results visibility**: "Show results live" (default) or "Hide results until
  poll closes". When hidden, only the poll's creator can see results before
  `expiresAt` passes — everyone else gets a 403 with a clear message.
- **Voter list**: an optional checkbox lets the creator see who voted for
  what (email + chosen option) after creation, via a button on the poll page.
  Voters are shown a notice that their vote isn't anonymous when this is on.
