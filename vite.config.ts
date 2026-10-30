import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist/client' },
  server: { proxy: {
    '/api': 'http://127.0.0.1:8877',
    // The share page's own JSON fetch goes to the worker; opening /s/<slug> in the browser stays on Vite's app.
    '/s/': { target: 'http://127.0.0.1:8877', bypass: request => request.headers.accept?.includes('application/json') ? undefined : '/index.html' },
  } },
});
