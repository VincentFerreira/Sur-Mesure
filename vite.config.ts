/// <reference types="vitest" />
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  // Overridable so e2e (playwright.config.ts) can spawn its own client+API pair on
  // ports distinct from the normal dev ones — otherwise `npm run test:e2e` can never
  // run alongside an already-running `npm start`, since Playwright would either
  // collide on the port or (via reuseExistingServer) silently reuse the dev server,
  // which has no test hooks and no isolated data dir.
  const apiPort = process.env.API_PORT || env.API_PORT || '3001';
  const clientPort = Number(process.env.CLIENT_PORT || env.CLIENT_PORT) || 3000;
  return {
    server: {
      port: clientPort,
      host: '0.0.0.0',
      // Bind-mounted volumes (e.g. Docker on macOS/Windows) often don't propagate
      // inotify events, so file changes go unnoticed without polling.
      watch: process.env.CHOKIDAR_USEPOLLING === 'true' ? { usePolling: true } : undefined,
      proxy: {
        '/api/latex': {
          target: 'https://latexonline.cc',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/latex/, ''),
          secure: true,
        },
      },
    },
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.ANTHROPIC_API_KEY': JSON.stringify(env.ANTHROPIC_API_KEY),
      // Read by services/apiClient.ts / cvStorageService.ts / pdfService.ts — the
      // Express API server's port, so the client bundle calls wherever server.js
      // actually ended up listening instead of a hardcoded 3001.
      'process.env.API_PORT': JSON.stringify(apiPort),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
    test: {
      environment: 'node',
      // vitest 4 switched to tinyglobby, which (unlike vitest 3's globber) descends
      // into dot-directories by default — so a locally checked-out git worktree under
      // `.claude/worktrees/**` (gitignored, CI never has one) now gets its own nested
      // `tests/e2e/**` picked up as unit tests unless excluded explicitly here too.
      exclude: ['**/node_modules/**', 'tests/e2e/**', '.claude/**'],
      setupFiles: ['./tests/setup/serverTestData.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html'],
        include: [
          'lib/**/*.ts',
          'services/**/*.ts',
          'constants.ts',
        ],
        exclude: ['**/*.test.*', '**/*.d.ts'],
      },
    },
  };
});
