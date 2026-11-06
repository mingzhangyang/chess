import path from 'path';
import { defineConfig } from 'vite';

// Builds the profiling page with the app's worker settings (ES worker format,
// so the kernel stays a separate on-demand chunk). Output: research/browser/dist.
export default defineConfig({
  root: __dirname,
  base: './',
  build: { outDir: path.resolve(__dirname, 'dist'), emptyOutDir: true, sourcemap: false },
  worker: { format: 'es' },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
