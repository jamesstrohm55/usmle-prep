import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/usmle-prep/',
  plugins: [react()],
  test: { environment: 'jsdom', globals: true, include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts', 'supabase/tests/**/*.test.ts'] },
});
