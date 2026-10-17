import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api';

export default function PollDetail() {
  const { id } = useParams();
  const [poll, setPoll] = useState(null);
  const [results, setResults] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    api.get(`/polls/${id}`).then((res) => setPoll(res.data));
  }, [id]);

  // Live updates: poll the results endpoint every 3 seconds instead of
  // WebSockets/SSE — far less code for a feature that just needs "close to
  // real-time", and this project has no need for push-on-every-vote latency.
  useEffect(() => {
    function fetchResults() {
      api.get(`/polls/${id}/results`).then((res) => setResults(res.data));
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

  return (
    <div className="card">
      <h2>{poll.question}</h2>
      <p className="muted">Expires {new Date(poll.expiresAt).toLocaleString()}</p>

      <div>
        {poll.options.map((opt) => (
          <button key={opt} onClick={() => vote(opt)} className="option-btn">
            {opt}
          </button>
        ))}
      </div>
      {message && <p className="error">{message}</p>}

      <h3>Results (updates every 3s)</h3>
      {results?.results.map((r) => (
        <div key={r.option} className="bar-row">
          <span>{r.option} ({r.count})</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(r.count / maxCount) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
