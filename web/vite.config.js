import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  envDir: rootDir,
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': 'http://localhost:3001',
      '/uploads': 'http://localhost:3001',
      '/telegram': 'http://localhost:3001',
    },
  },
  build: {
    outDir: 'dist',
  },
});
