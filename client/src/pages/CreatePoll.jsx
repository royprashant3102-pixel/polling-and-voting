import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

// Just the create-poll form, on its own route — separate from the poll
// list so "Create poll" in the nav takes the user straight here.
export default function CreatePoll() {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']); // start with 2 empty options (the minimum)
  const [expiresAt, setExpiresAt] = useState('');
  const [resultsVisibility, setResultsVisibility] = useState('live');
  const [showVoters, setShowVoters] = useState(false);
  const [visibility, setVisibility] = useState('public');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  function updateOption(i, value) {
    const next = [...options];
    next[i] = value;
    setOptions(next);
  }

  function addOption() {
    setOptions([...options, '']);
  }

  function removeOption(i) {
    setOptions(options.filter((_, idx) => idx !== i));
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
        visibility,
      });
      // linkOnly polls have no public /polls/:id route — only the share
      // link (/p/:token) works, since that's the whole point of the feature.
      if (res.data.visibility === 'linkOnly') {
        navigate(`/p/${res.data.shareToken}`);
      } else {
        navigate(`/polls/${res.data._id}`);
      }
    } catch (err) {
      if (err.response?.status === 401) {
        setError('You must be logged in to create a poll');
      } else {
        setError(err.response?.data?.error || 'Failed to create poll');
      }
    }
  }

  return (
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
          <div key={i} className="option-row">
            <input
              placeholder={`Option ${i + 1}`}
              value={opt}
              onChange={(e) => updateOption(i, e.target.value)}
              required
            />
            {options.length > 2 && (
              <button
                type="button"
                className="link"
                onClick={() => removeOption(i)}
                aria-label={`Remove option ${i + 1}`}
              >
                Remove
              </button>
            )}
          </div>
        ))}
        <button type="button" className="link" onClick={addOption}>
          + Add option
        </button>
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
        <select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
          <option value="public">Public — anyone can find it in the poll list</option>
          <option value="linkOnly">Link only — hidden from the list, reachable only by link</option>
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
  );
}
