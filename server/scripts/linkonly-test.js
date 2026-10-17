// ---------- Link-only poll proof script ----------
// Proves the requireAccess gate actually hides a linkOnly poll from anyone
// without the token, and that regenerating the link kills the old one.
// Requires the server to already be running (npm run dev) on BASE_URL.
const BASE_URL = `http://localhost:${process.env.PORT || 5001}/api`;

let pass = 0;
let fail = 0;

function check(label, condition) {
  if (condition) {
    console.log(`PASS — ${label}`);
    pass++;
  } else {
    console.log(`FAIL — ${label}`);
    fail++;
  }
}

async function main() {
  const email = `linkonly-${Date.now()}@test.com`;
  const password = 'password123';

  await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const { token } = await loginRes.json();

  // Create a linkOnly poll.
  const pollRes = await fetch(`${BASE_URL}/polls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      question: 'Link-only test poll',
      options: ['A', 'B'],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      visibility: 'linkOnly',
    }),
  });
  const poll = await pollRes.json();
  const originalToken = poll.shareToken;

  // (a) Absent from GET /polls (the public list).
  const listRes = await fetch(`${BASE_URL}/polls`);
  const list = await listRes.json();
  check('link-only poll is absent from the poll list', !list.some((p) => p._id === poll._id));

  // (b) Fetching it by _id with no token returns 404.
  const noTokenRes = await fetch(`${BASE_URL}/polls/${poll._id}`);
  check('fetching by _id without a token returns 404', noTokenRes.status === 404);

  // (c) Fetching it with the correct token returns 200.
  const withTokenRes = await fetch(`${BASE_URL}/polls/${poll._id}`, {
    headers: { 'x-share-token': originalToken },
  });
  check('fetching with the correct token returns 200', withTokenRes.status === 200);

  // (d) After regenerating, the OLD token returns 404.
  await fetch(`${BASE_URL}/polls/${poll._id}/regenerate-link`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const oldTokenAfterRegenRes = await fetch(`${BASE_URL}/polls/${poll._id}`, {
    headers: { 'x-share-token': originalToken },
  });
  check('old token returns 404 after regenerating the link', oldTokenAfterRegenRes.status === 404);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Script failed — is the server running? (npm run dev)', err.message);
  process.exit(1);
});
