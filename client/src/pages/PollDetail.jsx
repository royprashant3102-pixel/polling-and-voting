import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api';

export default function PollDetail() {
  const { id } = useParams();
  const [poll, setPoll] = useState(null);
  const [results, setResults] = useState(null);
  const [resultsHidden, setResultsHidden] = useState(false);
  const [voters, setVoters] = useState(null);
  const [message, setMessage] = useState('');

  // Decode the JWT payload (not verify — the server already does that) just
  // to compare userId against poll.createdBy, so we know whether to show
  // the creator-only voter list. JWTs are base64, not encrypted, so this is
  // safe to read client-side; we never trust it for anything security-sensitive.
  function currentUserId() {
    const token = localStorage.getItem('token');
    if (!token) return null;
    try {
      return JSON.parse(atob(token.split('.')[1])).userId;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    api.get(`/polls/${id}`).then((res) => setPoll(res.data));
  }, [id]);

  // Live updates: poll the results endpoint every 3 seconds instead of
  // WebSockets/SSE — far less code for a feature that just needs "close to
  // real-time", and this project has no need for push-on-every-vote latency.
  useEffect(() => {
    function fetchResults() {
      api
        .get(`/polls/${id}/results`)
        .then((res) => {
          setResults(res.data);
          setResultsHidden(false);
        })
        .catch((err) => {
          // 403 here means resultsVisibility === "afterClose" and we're not the creator
          if (err.response?.status === 403) setResultsHidden(true);
        });
    }
    fetchResults();
    const interval = setInterval(fetchResults, 3000);
    return () => clearInterval(interval); // must clear on unmount or it keeps firing after we navigate away
  }, [id]);

  async function vote(option) {
    setMessage('');
    try {
      await api.post(`/polls/${id}/vote`, { option });
      setMessage('Vote recorded!');
    } catch (err) {
      const status = err.response?.status;
      const serverMsg = err.response?.data?.error;
      if (status === 401) setMessage('You must be logged in to vote.');
      else if (status === 403) setMessage(serverMsg || 'This poll has expired.');
      else if (status === 409) setMessage(serverMsg || 'You have already voted.');
      else setMessage(serverMsg || 'Vote failed.');
    }
  }

  if (!poll) return <p>Loading...</p>;

  const maxCount = results ? Math.max(1, ...results.results.map((r) => r.count)) : 1;
  const isCreator = poll.createdBy === currentUserId();

  function loadVoters() {
    api.get(`/polls/${id}/voters`).then((res) => setVoters(res.data));
  }

  return (
    <div className="card">
      <h2>{poll.question}</h2>
      <p className="muted">Expires {new Date(poll.expiresAt).toLocaleString()}</p>

      {poll.showVoters && (
        <p className="muted">Note: the poll creator can see who voted for what.</p>
      )}

      <div>
        {poll.options.map((opt) => (
          <button key={opt} onClick={() => vote(opt)} className="option-btn">
            {opt}
          </button>
        ))}
      </div>
      {message && <p className="error">{message}</p>}

      <h3>Results (updates every 3s)</h3>
      {resultsHidden ? (
        <p className="muted">Results will be visible after the poll closes.</p>
      ) : (
        results?.results.map((r) => (
          <div key={r.option} className="bar-row">
            <span>{r.option} ({r.count})</span>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(r.count / maxCount) * 100}%` }} />
            </div>
          </div>
        ))
      )}

      {isCreator && poll.showVoters && (
        <div>
          <h3>Voters</h3>
          {voters === null ? (
            <button type="button" className="link" onClick={loadVoters}>
              Show voter list
            </button>
          ) : (
            <ul>
              {voters.map((v, i) => (
                <li key={i}>{v.email} — {v.option}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
