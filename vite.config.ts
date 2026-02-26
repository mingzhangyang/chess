import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv, splitVendorChunkPlugin} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const buildId =
    env.APP_BUILD_ID
    || process.env.CF_PAGES_COMMIT_SHA?.slice(0, 8)
    || new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return {
    plugins: [react(), tailwindcss(), splitVendorChunkPlugin()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      __APP_BUILD_ID__: JSON.stringify(buildId),
    },
    build: {
      cssCodeSplit: true,
      sourcemap: mode === 'production' ? 'hidden' : true,
      chunkSizeWarningLimit: 450,
      rollupOptions: {
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
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify - file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
