/// <reference types="vitest/config" />
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = createRequire(import.meta.url)('./package.json') as { version: string };

function git(args: string): string {
  try {
    return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

// Vercel exposes the build's commit metadata as env vars; fall back to local git.
const sha = (process.env.VERCEL_GIT_COMMIT_SHA ?? git('rev-parse HEAD')).slice(0, 7);
const ref = process.env.VERCEL_GIT_COMMIT_REF ?? git('rev-parse --abbrev-ref HEAD');
const env = process.env.VERCEL_ENV ?? 'local';

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GIT_SHA__: JSON.stringify(sha),
    __GIT_REF__: JSON.stringify(ref),
    __BUILD_ENV__: JSON.stringify(env),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: false,
  },
});
