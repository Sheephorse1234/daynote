import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const major = Number(process.versions.node.split('.')[0]);
if (major < 22) { console.error('Node.js 24 LTS 이상을 설치한 뒤 다시 실행하세요. https://nodejs.org/'); process.exit(1); }
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(args) { const result = spawnSync(npm, args, { stdio: 'inherit', shell: process.platform === 'win32' }); if (result.status !== 0) process.exit(result.status ?? 1); }
const hash = createHash('sha256').update(readFileSync('package-lock.json')).digest('hex');
const marker = 'node_modules/.daynote-installed';
if (!existsSync(marker) || readFileSync(marker, 'utf8') !== hash) {
  console.log('처음 실행에 필요한 도구를 준비합니다. 인터넷에 연결해 주세요.');
  run(['ci']); writeFileSync(marker, hash);
}
run(['run', 'check']);
if (process.argv.includes('--package')) run(['run', 'package']);
else { console.log('브라우저가 열리면 사용하세요. 종료하려면 이 창에서 Ctrl+C를 누르세요.'); run(['run', 'preview', '--', '--port', '4173', '--strictPort', '--open']); }
