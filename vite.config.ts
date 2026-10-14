// Vite settings: builds the pages in web/ into web/dist, which Netlify publishes.
// In development, /api requests go to a deployed site (API_ORIGIN), since the API runs on Netlify,
// and page addresses are rewritten the same way netlify.toml rewrites them on the site.

import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const root = resolve(import.meta.dirname, 'web');

/** Page addresses and the HTML file behind each; keep in step with the redirects in netlify.toml. */
const ROUTES: [RegExp, string][] = [
  [/^\/texts\/[^/]+$/, '/text.html'],
  [/^\/admin\/?$/, '/admin/index.html'],
  [/^\/admin\/(login|forgot|password)$/, '/admin/$1.html'],
  [/^\/admin\/new$/, '/admin/form.html'],
  [/^\/admin\/texts\/[^/]+\/edit$/, '/admin/form.html'],
  [/^\/admin\/texts\/[^/]+$/, '/admin/text.html'],
];

/** Serves pretty page addresses in development, like Netlify does on the site. */
const prettyUrls: Plugin = {
  name: 'pretty-urls',
  configureServer(server) {
    server.middlewares.use((request, _response, next) => {
      const [path = '', query = ''] = (request.url ?? '').split('?');
      for (const [pattern, file] of ROUTES) {
        if (pattern.test(path)) {
          request.url = path.replace(pattern, file) + (query ? `?${query}` : '');
          break;
        }
      }
      next();
    });
  },
};

export default defineConfig({
  root,
  plugins: [prettyUrls],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        home: resolve(root, 'index.html'),
        text: resolve(root, 'text.html'),
        'admin/index': resolve(root, 'admin/index.html'),
        'admin/form': resolve(root, 'admin/form.html'),
        'admin/text': resolve(root, 'admin/text.html'),
        'admin/login': resolve(root, 'admin/login.html'),
        'admin/forgot': resolve(root, 'admin/forgot.html'),
        'admin/password': resolve(root, 'admin/password.html'),
      },
    },
  },
  server: {
    proxy: {
      '/api': { target: process.env.API_ORIGIN ?? 'https://simple-english-reader.netlify.app', changeOrigin: true },
    },
  },
});
