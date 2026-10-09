import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

// Short commit id of this build, shown faintly under Sign out so the owner can tell which deploy is live.
// CI provides GITHUB_SHA; locally ask git.
const sha = (() => {
  try { return (process.env.GITHUB_SHA ?? execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()).slice(0, 7); } catch { return 'unknown'; }
})();

export default defineConfig({
  base: '/usmle-prep/',
  plugins: [react()],
  define: { __BUILD_SHA__: JSON.stringify(sha), __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')) },
  test: { environment: 'jsdom', globals: true, include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts', 'supabase/tests/**/*.test.ts'] },
});
