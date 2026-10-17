import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api';

export default function PollList() {
  const [polls, setPolls] = useState([]);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']); // start with 2 empty options (the minimum)
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

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
        expiresAt,
      });
      setPolls([res.data, ...polls]);
      setQuestion('');
      setOptions(['', '']);
      setExpiresAt('');
    } catch (err) {
      if (err.response?.status === 401) {
        setError('You must be logged in to create a poll');
      } else {
        setError(err.response?.data?.error || 'Failed to create poll');
      }
    }
  }

  function logout() {
    localStorage.removeItem('token');
    navigate('/login');
  }

  return (
    <div>
      <button className="link" onClick={logout}>Logout</button>
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
          <button type="submit">Create Poll</button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="card">
        <h2>Polls</h2>
        {polls.map((p) => (
          <div key={p._id} className="poll-row">
            <Link to={`/polls/${p._id}`}>{p.question}</Link>
            <span className="muted"> — expires {new Date(p.expiresAt).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
