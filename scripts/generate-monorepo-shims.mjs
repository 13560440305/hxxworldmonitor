import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (name.endsWith('.ts')) files.push(full);
  }
  return files;
}

function shimShared() {
  const srcDir = path.join(root, 'packages/shared/src');
  const outDir = path.join(root, 'server/_shared');
  for (const file of readdirSync(srcDir)) {
    if (!file.endsWith('.ts')) continue;
    const base = file.replace(/\.ts$/, '');
    const content = `/** @deprecated Import from @hxxworldmonitor/shared — compatibility shim */\nexport * from '../../packages/shared/src/${base}.js';\n`;
    writeFileSync(path.join(outDir, file), content);
  }
}

function shimPlatformCore() {
  const srcDir = path.join(root, 'packages/platform-core/src');
  const outDir = path.join(root, 'server/platform');
  for (const file of walk(srcDir)) {
    const rel = path.relative(srcDir, file).replace(/\\/g, '/');
    const outPath = path.join(outDir, rel);
    mkdirSync(path.dirname(outPath), { recursive: true });
    const relDirDepth = rel.includes('/') ? rel.split('/').length - 1 : 0;
    const up = '../'.repeat(2 + relDirDepth);
    const importPath = `${up}packages/platform-core/src/${rel.replace(/\.ts$/, '.js')}`;
    const content = `/** @deprecated Import from @hxxworldmonitor/platform-core — compatibility shim */\nexport * from '${importPath}';\n`;
    writeFileSync(outPath, content);
  }
}

shimShared();
shimPlatformCore();
console.log('Compatibility shims written to server/_shared and server/platform');
