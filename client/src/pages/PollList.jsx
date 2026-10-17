import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';

export default function PollList() {
  const [polls, setPolls] = useState([]);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']); // start with 2 empty options (the minimum)
  const [expiresAt, setExpiresAt] = useState('');
  const [resultsVisibility, setResultsVisibility] = useState('live');
  const [showVoters, setShowVoters] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/polls').then((res) => setPolls(res.data));
  }, []);

  function updateOption(i, value) {
    const next = [...options];
    next[i] = value;
    setOptions(next);
  }

  function addOption() {
    if (options.length < 5) setOptions([...options, '']);
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    try {
      const res = await api.post('/polls', {
        question,
        options: options.filter((o) => o.trim() !== ''),
        // <input type="datetime-local"> gives a bare string with no timezone
        // (e.g. "2026-10-25T14:30"), interpreted ambiguously if sent as-is.
        // Convert explicitly here, anchored to the browser's local time,
        // into a UTC ISO string — so the server always stores unambiguous UTC.
        expiresAt: new Date(expiresAt).toISOString(),
        resultsVisibility,
        showVoters,
      });
      setPolls([res.data, ...polls]);
      setQuestion('');
      setOptions(['', '']);
      setExpiresAt('');
      setResultsVisibility('live');
      setShowVoters(false);
    } catch (err) {
      if (err.response?.status === 401) {
        setError('You must be logged in to create a poll');
      } else {
        setError(err.response?.data?.error || 'Failed to create poll');
      }
    }
  }

  return (
    <div>
      <div className="card">
        <h2>Create a poll</h2>
        <form onSubmit={handleCreate}>
          <input
            placeholder="Question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            required
          />
          {options.map((opt, i) => (
            <input
              key={i}
              placeholder={`Option ${i + 1}`}
              value={opt}
              onChange={(e) => updateOption(i, e.target.value)}
              required
            />
          ))}
          {options.length < 5 && (
            <button type="button" className="link" onClick={addOption}>
              + Add option
            </button>
          )}
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            required
          />
          <select value={resultsVisibility} onChange={(e) => setResultsVisibility(e.target.value)}>
            <option value="live">Show results live</option>
            <option value="afterClose">Hide results until poll closes</option>
          </select>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={showVoters}
              onChange={(e) => setShowVoters(e.target.checked)}
            />
            Let me (the creator) see who voted for what
          </label>
          {/* Notice shown at creation time so the CREATOR understands what
              they're turning on — voters see their own notice on the vote page. */}
          {showVoters && (
            <p className="muted">Voters will be told their vote is not anonymous.</p>
          )}
          <button type="submit">Create Poll</button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="card">
        <h2>Polls</h2>
        {polls.map((p) => {
          const closed = new Date() > new Date(p.expiresAt);
          return (
            <div key={p._id} className="poll-row">
              <div>
                <span className={`badge ${closed ? 'badge-closed' : 'badge-open'}`}>
                  {closed ? 'Closed' : 'Open'}
                </span>
                <Link to={`/polls/${p._id}`}>{p.question}</Link>
              </div>
              {/* expiresAt is stored as UTC; toLocaleString() renders it in the viewer's own local timezone */}
              <span className="muted">expires {new Date(p.expiresAt).toLocaleString()}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
