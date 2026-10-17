// ---------- Concurrency proof script ----------
// Proves the unique-index + insert-then-catch design actually prevents
// double voting under a real race, not just "looks correct on paper".
// Requires the server to already be running (npm run dev) on BASE_URL.
const BASE_URL = `http://localhost:${process.env.PORT || 5001}/api`;

async function main() {
  const email = `concurrency-${Date.now()}@test.com`;
  const password = 'password123';

  // 1. Register + login one user — all 50 votes come from THIS single user,
  //    which is the whole point: same (pollId, userId) pair every time.
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

  // 2. Create a poll that won't expire during the test.
  const pollRes = await fetch(`${BASE_URL}/polls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      question: 'Concurrency test poll',
      options: ['A', 'B'],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }),
  });
  const poll = await pollRes.json();

  // 3. Fire 50 vote requests in parallel with Promise.all — this is what
  //    makes it a real race. Sequential requests would never expose the
  //    check-then-insert bug because each one fully completes before the next.
  const requests = Array.from({ length: 50 }, () =>
    fetch(`${BASE_URL}/polls/${poll._id}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ option: 'A' }),
    })
  );

  const responses = await Promise.all(requests);
  const statusCounts = {};
  for (const res of responses) {
    statusCounts[res.status] = (statusCounts[res.status] || 0) + 1;
  }

  console.log('Status code breakdown:', statusCounts);
  console.log(`201 (success): ${statusCounts[201] || 0}`);
  console.log(`409 (conflict): ${statusCounts[409] || 0}`);
  console.log(
    statusCounts[201] === 1 && statusCounts[409] === 49
      ? '✅ PASS — exactly 1 vote succeeded, 49 rejected by the unique index'
      : '❌ FAIL — expected exactly 1 success and 49 conflicts'
  );
}

main().catch((err) => {
  console.error('Script failed — is the server running? (npm run dev)', err.message);
  process.exit(1);
});
