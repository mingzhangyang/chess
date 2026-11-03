import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv, splitVendorChunkPlugin} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  // Stockfish WASM is multi-threaded and needs SharedArrayBuffer, which
  // browsers only expose to cross-origin isolated pages. Production gets these
  // headers from worker/src/security.ts.
  const crossOriginIsolationHeaders = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  };
  const buildId =
    env.APP_BUILD_ID
    || process.env.CF_PAGES_COMMIT_SHA?.slice(0, 8)
    || new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return {
    plugins: [react(), tailwindcss(), splitVendorChunkPlugin()],
    define: {
      __APP_BUILD_ID__: JSON.stringify(buildId),
    },
    build: {
      cssCodeSplit: true,
      // Stockfish's pthread worker script must be a real same-origin file: as
      // an inlined data: URL its workers get an opaque origin and cannot boot.
      assetsInlineLimit: (filePath: string) => (filePath.includes('stockfish') ? false : undefined),
      sourcemap: mode !== 'production',
      chunkSizeWarningLimit: 450,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          zh: path.resolve(__dirname, 'zh/index.html'),
          fr: path.resolve(__dirname, 'fr/index.html'),
          es: path.resolve(__dirname, 'es/index.html'),
          ja: path.resolve(__dirname, 'ja/index.html'),
        },
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) {
              return undefined;
            }
            if (id.includes('react') || id.includes('scheduler')) {
              return 'vendor-react';
            }
            if (id.includes('chess.js') || id.includes('react-chessboard')) {
              return 'vendor-chess';
            }
            if (id.includes('lucide-react')) {
              return 'vendor-icons';
            }
            return 'vendor';
          },
        },
      },
    },
    worker: {
      // Worker entry can split chunks; ES format is required for that.
      format: 'es',
    },
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify - file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      headers: crossOriginIsolationHeaders,
    },
    preview: {
      headers: crossOriginIsolationHeaders,
    },
  };
});
