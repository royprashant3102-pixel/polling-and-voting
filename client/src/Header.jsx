import { Link, useNavigate } from 'react-router-dom';

// Persistent header across all logged-in pages — pure presentation, no
// routes or API calls live here, just the nav links the app already has.
export default function Header() {
  const navigate = useNavigate();
  const loggedIn = !!localStorage.getItem('token');

  function logout() {
    localStorage.removeItem('token');
    navigate('/login');
  }

  return (
    <header className="site-header">
      <Link to="/polls" className="logo" style={{ textDecoration: 'none', color: 'inherit' }}>
        PollBox
      </Link>
      {loggedIn && (
        <nav>
          <Link to="/polls">Polls</Link>
          <Link to="/polls/new">Create poll</Link>
          <button type="button" onClick={logout} style={{ width: 'auto' }}>
            Logout
          </button>
        </nav>
      )}
    </header>
  );
}
