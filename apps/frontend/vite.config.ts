/**
 * Frontend workspace dev/build entry — reuses root Vite config (sebuf, PWA, variants).
 * Sources remain at repository `src/` until full migration completes.
 */
import path from 'node:path';
import { defineConfig, mergeConfig, type UserConfig } from 'vite';
import rootConfig from '../../vite.config.ts';

const monorepoRoot = path.resolve(import.meta.dirname, '../..');

export default defineConfig(
  mergeConfig(rootConfig as UserConfig, {
    envDir: monorepoRoot,
    root: monorepoRoot,
  }),
);
