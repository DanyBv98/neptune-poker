import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' + HashRouter = works on any static host or sub-path (GitHub Pages, Netlify, S3…)
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
} as any);
