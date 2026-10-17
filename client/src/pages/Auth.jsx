import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../api';

// One page handles both register and login — same two fields, different endpoint.
export default function Auth() {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  // Set by RequireAuth when it bounced an unauthenticated visitor here —
  // e.g. a brand-new user who clicked a shared /p/:token link. Falls back
  // to the poll list for a normal, unprompted visit to /login.
  const redirectTo = location.state?.from || '/polls';

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      if (isRegister) {
        await api.post('/auth/register', { email, password });
        setIsRegister(false); // after registering, flip to login
        setError('Registered — now log in.');
        return;
      }
      const res = await api.post('/auth/login', { email, password });
      localStorage.setItem('token', res.data.token);
      navigate(redirectTo);
    } catch (err) {
      // Server sends { error: "..." } for 400/401/409 — surface it directly.
      setError(err.response?.data?.error || 'Something went wrong');
    }
  }

  return (
    <div className="auth-page">
      <div className="card">
        <h2>{isRegister ? 'Register' : 'Login'}</h2>
        <form onSubmit={handleSubmit}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button type="submit">{isRegister ? 'Register' : 'Login'}</button>
        </form>
        {error && <p className="error">{error}</p>}
        <button className="link" onClick={() => setIsRegister(!isRegister)}>
          {isRegister ? 'Have an account? Login' : "No account? Register"}
        </button>
      </div>
    </div>
  );
}
