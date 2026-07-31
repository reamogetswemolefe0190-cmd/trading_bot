import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api/alpaca-paper': {
        target: 'https://paper-api.alpaca.markets',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/alpaca-paper/, ''),
        headers: {
          'Origin': 'https://paper-api.alpaca.markets'
        }
      },
      '/api/alpaca-live': {
        target: 'https://api.alpaca.markets',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/alpaca-live/, ''),
        headers: {
          'Origin': 'https://api.alpaca.markets'
        }
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
