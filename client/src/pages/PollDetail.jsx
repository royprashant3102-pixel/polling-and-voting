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
  // Tracks which option THIS browser session voted for, purely to highlight
  // it in the results bars — set after a successful vote. Not fetched from
  // the server (results/vote endpoints don't return per-user data), so a
  // page refresh forgets it; that's a display nicety, not a source of truth.
  const [myVote, setMyVote] = useState(null);

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
      setMyVote(option);
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

  const isCreator = poll.createdBy === currentUserId();
  const closed = new Date() > new Date(poll.expiresAt);
  const totalVotes = results ? results.results.reduce((sum, r) => sum + r.count, 0) : 0;

  // Human-readable "time left" for the badge — small, local calc, no new data.
  function timeLeftLabel() {
    if (closed) return 'Closed';
    const ms = new Date(poll.expiresAt) - new Date();
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${minutes}m left`;
    return `${minutes}m left`;
  }

  function loadVoters() {
    api.get(`/polls/${id}/voters`).then((res) => setVoters(res.data));
  }

  return (
    <div className="poll-layout">
      <div className="poll-main card">
        <div>
          <span className={`badge ${closed ? 'badge-closed' : 'badge-open'}`}>
            {closed ? 'Closed' : 'Open'}
          </span>
          {!closed && <span className="badge badge-time">{timeLeftLabel()}</span>}
        </div>

        <h1>{poll.question}</h1>

        {poll.showVoters && (
          <p className="muted">The creator of this poll can see who voted.</p>
        )}

        <div>
          {poll.options.map((opt) => (
            <button key={opt} onClick={() => vote(opt)} className="option-btn">
              {opt}
            </button>
          ))}
        </div>
        {message && <p className="error">{message}</p>}

        {resultsHidden ? (
          <p className="muted">Results will be visible after the poll closes.</p>
        ) : (
          results?.results.map((r) => {
            const pct = totalVotes > 0 ? Math.round((r.count / totalVotes) * 100) : 0;
            const isMine = r.option === myVote;
            return (
              <div key={r.option} className="bar-row">
                <div
                  className={`bar-fill ${isMine ? 'own-vote' : ''}`}
                  style={{ width: `${pct}%` }}
                />
                <div className={`bar-label ${isMine ? 'own-vote-label' : ''}`}>
                  <span>{r.option}{isMine ? ' (your vote)' : ''}</span>
                  <span>{pct}%</span>
                </div>
              </div>
            );
          })
        )}

        {!resultsHidden && (
          <p className="muted">{totalVotes} votes · refreshes every 3 seconds</p>
        )}
      </div>

      {isCreator && (
        <div className="creator-panel">
          <h3>Creator view</h3>
          {poll.showVoters ? (
            <>
              <p>Voters can see this notice: "The creator of this poll can see who voted."</p>
              {voters === null ? (
                <button type="button" onClick={loadVoters}>
                  Show voter list
                </button>
              ) : (
                <ul className="voter-list">
                  {voters.map((v, i) => (
                    <li key={i}>
                      <span>{v.email}</span>
                      <span>{v.option}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="muted">Voter list is off for this poll.</p>
          )}
        </div>
      )}
    </div>
  );
}
