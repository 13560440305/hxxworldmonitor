import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adminRoot = path.join(root, 'apps/admin');

mkdirSync(path.join(adminRoot, 'src/services'), { recursive: true });
mkdirSync(path.join(adminRoot, 'src/styles'), { recursive: true });
mkdirSync(path.join(adminRoot, 'src/utils'), { recursive: true });
mkdirSync(path.join(adminRoot, 'src/config'), { recursive: true });

const copies = [
  ['src/platform-admin-main.ts', 'src/main.ts'],
  ['src/services/platform-admin-api.ts', 'src/services/platform-admin-api.ts'],
  ['src/styles/platform-admin.css', 'src/styles/platform-admin.css'],
  ['src/utils/sanitize.ts', 'src/utils/sanitize.ts'],
  ['src/utils/api-key-expiry.ts', 'src/utils/api-key-expiry.ts'],
  ['src/config/platform-api.ts', 'src/config/platform-api.ts'],
];

for (const [from, to] of copies) {
  copyFileSync(path.join(root, from), path.join(adminRoot, to));
}

console.log('Admin app sources copied to apps/admin');
