import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';

// Shows every poll, split into "Open" (still votable) and "Closed" (past
// expiresAt) sections, so a voter can tell at a glance which polls they
// can still act on.
export default function PollList() {
  const [polls, setPolls] = useState([]);

  useEffect(() => {
    api.get('/polls').then((res) => setPolls(res.data));
  }, []);

  function renderRow(p) {
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
  }

  const openPolls = polls.filter((p) => new Date() <= new Date(p.expiresAt));
  const closedPolls = polls.filter((p) => new Date() > new Date(p.expiresAt));

  return (
    <div>
      <div className="card">
        <h2>Open polls</h2>
        {openPolls.length === 0 && <p className="muted">No open polls right now.</p>}
        {openPolls.map(renderRow)}
      </div>

      <div className="card">
        <h2>Closed polls</h2>
        {closedPolls.length === 0 && <p className="muted">No closed polls yet.</p>}
        {closedPolls.map(renderRow)}
      </div>
    </div>
  );
}
