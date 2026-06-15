import { defineConfig, loadEnv } from 'vite';
import path from 'node:path';

const monorepoRoot = path.resolve(import.meta.dirname, '../..');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, monorepoRoot, '');
  const platformTarget = env.VITE_PLATFORM_API_URL?.trim() || 'http://localhost:8787';

  return {
    root: path.resolve(import.meta.dirname),
    envDir: monorepoRoot,
    server: {
      port: Number(env.ADMIN_DEV_PORT || 3001),
      strictPort: false,
      proxy: {
        '/platform': {
          target: platformTarget.replace(/\/+$/, ''),
          changeOrigin: true,
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  };
});
