import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api';

// Handles both /polls/:id (normal polls, reached by JWT + public access)
// and /p/:token (linkOnly polls, reached only by the share token). The
// share token — once known — is attached as 'x-share-token' on every call
// this page makes, which is what requireAccess on the server checks.
export default function PollDetail() {
  const { id: idParam, token: tokenParam } = useParams();
  const navigate = useNavigate();
  const [poll, setPoll] = useState(null);
  const [results, setResults] = useState(null);
  const [resultsHidden, setResultsHidden] = useState(false);
  const [voters, setVoters] = useState(null);
  const [message, setMessage] = useState('');
  // Which option the logged-in user voted for, fetched from the server
  // (GET /my-vote) rather than kept only in local state — so the highlight
  // survives a page refresh or logging in again on another device.
  const [myVote, setMyVote] = useState(null);
  // The poll's actual Mongo _id, once known — for /p/:token we only have
  // the token at first, and learn the _id from GET /by-token/:token.
  const [id, setId] = useState(idParam || null);
  // Sent as 'x-share-token' on every request once this page is reached via
  // /p/:token, or once we've loaded a poll and learned it's linkOnly.
  const [shareToken, setShareToken] = useState(tokenParam || null);

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

  // Every call this page makes includes the share token (if we have one) as
  // a header — a no-op for normal public polls, required for /p/:token ones.
  function authHeaders() {
    return shareToken ? { headers: { 'x-share-token': shareToken } } : {};
  }

  // /p/:token arrives with only the token, not the poll's _id — resolve it
  // via by-token first, which also tells us the real _id for later calls.
  useEffect(() => {
    if (tokenParam) {
      api.get(`/polls/by-token/${tokenParam}`).then((res) => {
        setId(res.data._id);
        setPoll(res.data);
      });
    }
  }, [tokenParam]);

  useEffect(() => {
    if (!id) return;
    api.get(`/polls/${id}`, authHeaders()).then((res) => {
      setPoll(res.data);
      // Keep shareToken in sync with what the server has (e.g. after the
      // creator regenerates it), not just whatever came in via the URL.
      if (res.data.shareToken) setShareToken(res.data.shareToken);
    });
    api.get(`/polls/${id}/my-vote`, authHeaders()).then((res) => setMyVote(res.data.option));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Live updates: poll the results endpoint every 3 seconds instead of
  // WebSockets/SSE — far less code for a feature that just needs "close to
  // real-time", and this project has no need for push-on-every-vote latency.
  useEffect(() => {
    if (!id) return;
    function fetchResults() {
      api
        .get(`/polls/${id}/results`, authHeaders())
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function vote(option) {
    setMessage('');
    try {
      await api.post(`/polls/${id}/vote`, { option }, authHeaders());
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
  // Mirrors the server's isPollClosed(poll): closed early OR past expiry.
  // Keeping this as one expression (not two separate checks sprinkled
  // around the component) is the frontend's version of the same rule the
  // backend centralizes in models/Poll.js.
  const closed = poll.closedAt != null || new Date() > new Date(poll.expiresAt);
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
    api.get(`/polls/${id}/voters`, authHeaders()).then((res) => setVoters(res.data));
  }

  function copyLink() {
    const url = `${window.location.origin}/p/${shareToken}`;
    navigator.clipboard.writeText(url);
    setMessage('Link copied!');
  }

  function regenerateLink() {
    api.post(`/polls/${id}/regenerate-link`).then((res) => {
      setShareToken(res.data.shareToken);
      setMessage('Link regenerated — the old link no longer works.');
    });
  }

  function closePoll() {
    if (!window.confirm('Close this poll early? Voters will no longer be able to vote.')) return;
    api.post(`/polls/${id}/close`, {}, authHeaders()).then((res) => setPoll(res.data));
  }

  function deletePoll() {
    if (!window.confirm('Delete this poll permanently? This also deletes all its votes.')) return;
    api.delete(`/polls/${id}`, authHeaders()).then(() => navigate('/polls'));
  }

  return (
    <div className="poll-layout">
      <div className="poll-main card">
        <div>
          <span className={`badge ${closed ? 'badge-closed' : 'badge-open'}`}>
            {closed ? 'Closed' : 'Open'}
          </span>
          {!closed && <span className="badge badge-time">{timeLeftLabel()}</span>}
          {poll.visibility === 'linkOnly' && <span className="badge badge-link">Link only</span>}
        </div>

        <h1>{poll.question}</h1>

        {poll.showVoters && (
          <p className="muted">The creator of this poll can see who voted.</p>
        )}

        <div>
          {poll.options.map((opt) => (
            <button
              key={opt}
              onClick={() => vote(opt)}
              className="option-btn"
              disabled={closed}
            >
              {opt}
            </button>
          ))}
        </div>
        {closed && <p className="muted">Voting is closed for this poll.</p>}
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
                <div className="bar-label">
                  <span>
                    {r.option}
                    {isMine && <span className="your-vote-pill">your vote</span>}
                  </span>
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

          <div>
            {!closed && (
              <button type="button" onClick={closePoll}>Close poll early</button>
            )}
            <button type="button" onClick={deletePoll}>Delete poll</button>
          </div>

          {poll.visibility === 'linkOnly' && (
            <div>
              <p className="muted">Anyone with this link can view and vote — share carefully.</p>
              <button type="button" onClick={copyLink}>Copy link</button>
              <button type="button" onClick={regenerateLink}>Regenerate link</button>
            </div>
          )}

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
