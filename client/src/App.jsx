import { Navigate, Route, Routes } from 'react-router-dom';
import Header from './Header';
import Auth from './pages/Auth';
import PollList from './pages/PollList';
import CreatePoll from './pages/CreatePoll';
import PollDetail from './pages/PollDetail';

// Minimal route guard: no token in localStorage → bounce to /login.
// We don't verify the token here (that's the server's job via authMiddleware);
// this just avoids showing protected pages to someone obviously logged out.
function RequireAuth({ children }) {
  const token = localStorage.getItem('token');
  return token ? children : <Navigate to="/login" />;
}

export default function App() {
  return (
    <>
      <Header />
      <div className="page">
        <Routes>
          <Route path="/login" element={<Auth />} />
          <Route path="/" element={<Navigate to="/polls" />} />
          <Route
            path="/polls"
            element={
              <RequireAuth>
                <PollList />
              </RequireAuth>
            }
          />
          <Route
            path="/polls/new"
            element={
              <RequireAuth>
                <CreatePoll />
              </RequireAuth>
            }
          />
          <Route
            path="/polls/:id"
            element={
              <RequireAuth>
                <PollDetail />
              </RequireAuth>
            }
          />
          <Route
            path="/p/:token"
            element={
              <RequireAuth>
                <PollDetail />
              </RequireAuth>
            }
          />
        </Routes>
      </div>
    </>
  );
}
