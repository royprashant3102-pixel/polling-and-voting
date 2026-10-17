import axios from 'axios';

// One shared axios instance pointed at the Express API.
const api = axios.create({ baseURL: 'http://localhost:5001/api' });

// Attach the JWT (if we have one) to every outgoing request.
// This runs before each request, so login/register don't need special-casing —
// they just won't have a token in localStorage yet.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default api;
