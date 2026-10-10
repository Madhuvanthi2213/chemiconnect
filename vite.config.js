import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The PHP backend runs separately (npm run api -> http://localhost:8000).
// Every /api/<action> call from the React app is forwarded to backend/api.php?action=<action>.
const API = process.env.API_TARGET || 'http://localhost:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: API,
        changeOrigin: true,
        rewrite: p => '/api.php?action=' + p.replace(/^\/api\//, '')
      }
    }
  }
});
