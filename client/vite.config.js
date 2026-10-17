import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite dev server runs on 5173 by default; the Express API runs on 5001 (see server/.env).
export default defineConfig({
  plugins: [react()],
});
