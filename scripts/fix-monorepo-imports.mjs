import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platformCore = path.join(root, 'packages/platform-core/src');

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (name.endsWith('.ts')) files.push(full);
  }
  return files;
}

function fixPlatformCore(file) {
  let src = readFileSync(file, 'utf8');
  const original = src;

  src = src.replace(/from ['"](\.\.\/)+_shared\/([^'"]+)['"]/g, "from '@hxxworldmonitor/shared/$2'");
  src = src.replace(/from ['"]\.\.\/worldmonitor\//g, "from '../../../server/worldmonitor/");
  src = src.replace(/from ['"]\.\.\/\.\.\/deploy\//g, "from '../../../deploy/");

  if (src !== original) writeFileSync(file, src);
}

for (const file of walk(platformCore)) {
  fixPlatformCore(file);
}

console.log('Monorepo import paths updated');
