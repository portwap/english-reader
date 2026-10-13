// Vite settings: builds the pages in web/ into web/dist, which Netlify publishes.
// In development, /api requests go to a deployed site (API_ORIGIN), since the API runs on Netlify.

import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const root = resolve(import.meta.dirname, 'web');

export default defineConfig({
  root,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      input: { home: resolve(root, 'index.html'), text: resolve(root, 'text.html') },
    },
  },
  server: {
    proxy: {
      '/api': { target: process.env.API_ORIGIN ?? 'https://simple-english-reader.netlify.app', changeOrigin: true },
    },
  },
});
