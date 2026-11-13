import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
// ZIP (stored entries): small, cross-platform packaging without another dependency.
const crcTable = Array.from({ length: 256 }, (_, i) => { let n = i; for (let j = 0; j < 8; j++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc32(data) { let crc = 0xffffffff; for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function files(dir, skip = new Set()) { return readdirSync(dir).flatMap(name => { if (skip.has(name) || name.endsWith('.tsbuildinfo') || name.endsWith('.backup.json') || name.startsWith('.env')) return []; const path = join(dir, name); return statSync(path).isDirectory() ? files(path, skip) : [path]; }); }
function zip(root, paths, output) {
  const body = [], directory = []; let offset = 0;
  for (const path of paths) {
    const name = Buffer.from(relative(root, path).replaceAll('\\', '/'));
    const data = readFileSync(path), crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x314, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(((path.endsWith('.command') ? 0o100755 : 0o100644) << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
    body.push(local, name, data); directory.push(central, name); offset += local.length + name.length + data.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(paths.length, 8); end.writeUInt16LE(paths.length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  writeFileSync(output, Buffer.concat([...body, central, end]));
}
mkdirSync('release', { recursive: true });
zip('dist', files('dist'), 'release/daynote-site.zip');
// Explicit source allowlist: never bundle personal backups or hidden credential folders.
const roots = ['src', 'public', 'scripts', 'tests', '.github', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'vitest.config.ts', 'playwright.config.ts', 'index.html', '.gitignore', '.nvmrc', 'README.md', '시작하기.md', '시작-Mac.command', '시작-Windows.cmd', '배포파일-Mac.command', '배포파일-Windows.cmd'];
const source = roots.flatMap(path => statSync(path).isDirectory() ? files(path) : [path]);
zip('.', source, 'release/daynote-source.zip');
console.log('완료: release/daynote-site.zip (배포용), release/daynote-source.zip (수정 가능한 원본)');
