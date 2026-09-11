import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// O build gera `public/`, que o Fastify ja serve como estatico (`PUBLIC_DIR` em
// src/index.ts). Por isso `public/` deixou de ser fonte e virou artefato — o
// codigo do painel vive em `web/`.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
  server: {
    port: 4001,
    // `npm run dev:web` sobe o Vite com HMR e manda API e SSE para o hub real na
    // 4000. Sem isto o dev do frontend exigiria um `vite build` a cada alteracao.
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
});
