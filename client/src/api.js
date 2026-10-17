import axios from 'axios';

// One shared axios instance pointed at the Express API.
// VITE_API_URL is set per-environment (Vercel env var in production);
// falls back to localhost for local dev when it's not set.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5001/api',
});

// Attach the JWT (if we have one) to every outgoing request.
// This runs before each request, so login/register don't need special-casing —
// they just won't have a token in localStorage yet.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default api;
