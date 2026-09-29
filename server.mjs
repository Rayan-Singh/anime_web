import express from 'express';
import { createServer as createViteServer, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { closePool } from './http.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const production = process.argv.includes('--production');
const mode = production ? 'production' : 'development';
Object.assign(process.env, loadEnv(mode, root, ''), process.env);

const { default: app, providerConfigured } = await import('./api.mjs');
const port = Number(process.env.PORT || 5173);

if (production) {
  app.use(express.static(path.join(root, 'dist')));
  app.use((_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
} else {
  const vite = await createViteServer({ root, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Kairo ${mode} server running at http://127.0.0.1:${port}`);
  console.log(`Catalog: AniList · Playback: ${providerConfigured ? 'configured provider' : 'not configured'}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => closePool().finally(() => process.exit(0))));
}
