// ---------- Concurrency proof script ----------
// Proves the unique-index + atomic upsert design still prevents double
// voting under a real race, even though voting now allows changing your
// mind (POST /vote upserts instead of insert-then-reject). The invariant
// that matters is unchanged: exactly ONE vote row per (pollId, userId),
// no matter how many requests race for it.
const BASE_URL = `http://localhost:${process.env.PORT || 5001}/api`;

async function main() {
  const email = `concurrency-${Date.now()}@test.com`;
  const password = 'password123';

  // 1. Register + login one user — all 50 requests come from THIS single
  //    user, which is the whole point: same (pollId, userId) pair every time.
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

  // 2. Create a poll with two options — alternating the option across
  //    requests below also proves CHANGING a vote under a race is safe,
  //    not just repeating the same one.
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
  //    makes it a real race. Sequential requests would never expose a bug
  //    here, since each one fully completes before the next starts.
  const requests = Array.from({ length: 50 }, (_, i) =>
    fetch(`${BASE_URL}/polls/${poll._id}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ option: i % 2 === 0 ? 'A' : 'B' }),
    })
  );

  const responses = await Promise.all(requests);
  const statusCounts = {};
  for (const res of responses) {
    statusCounts[res.status] = (statusCounts[res.status] || 0) + 1;
  }
  console.log('Status code breakdown:', statusCounts);

  // 4. The real proof: ask the results endpoint how many total votes
  //    exist for this poll. 50 racing upserts from ONE user must still
  //    collapse to exactly 1 vote row — never 2, never 0.
  const resultsRes = await fetch(`${BASE_URL}/polls/${poll._id}/results`);
  const { results } = await resultsRes.json();
  const totalVotes = results.reduce((sum, r) => sum + r.count, 0);

  console.log(`Total votes recorded for this poll: ${totalVotes} (expected: 1)`);
  console.log(
    totalVotes === 1 && (statusCounts[200] || 0) + (statusCounts[201] || 0) === 50
      ? '✅ PASS — all 50 requests succeeded (200/201), but exactly 1 vote row exists'
      : '❌ FAIL — expected 50 successful responses collapsing to exactly 1 vote row'
  );
}

main().catch((err) => {
  console.error('Script failed — is the server running? (npm run dev)', err.message);
  process.exit(1);
});
