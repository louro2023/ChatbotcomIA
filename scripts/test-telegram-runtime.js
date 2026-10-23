const { spawnSync } = require('child_process');
const path = require('path');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
if (process.argv[2]) env.TELEGRAM_TEST_PACKAGE = path.resolve(process.argv[2]);
const result = spawnSync(require('electron'), [path.join(__dirname, 'test-telegram-electron.cjs')], { env, windowsHide: true, encoding: 'utf8', timeout: 45000 });
process.stdout.write(result.stdout || '');
if (result.status !== 0) { console.error(result.stderr || result.error?.message || `Electron encerrou com ${result.status}`); process.exitCode = 1; }
