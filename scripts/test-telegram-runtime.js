const { spawnSync } = require('child_process');
const { createRequire } = require('module');
const path = require('path');
const load = createRequire(require.resolve('teleproto'));
const cipher = load('cifrante').aes.ige(Buffer.alloc(32, 1));
const expected = Buffer.from(cipher.encryptSync(Buffer.alloc(32, 3), { iv: Buffer.alloc(32, 2) })).toString('hex');
cipher.dispose();
const env = { ...process.env, TELEGRAM_TEST_CIPHER: expected };
delete env.ELECTRON_RUN_AS_NODE;
if (process.argv[2]) env.TELEGRAM_TEST_PACKAGE = path.resolve(process.argv[2]);
const result = spawnSync(require('electron'), [path.join(__dirname, 'test-telegram-electron.cjs')], { env, windowsHide: true, encoding: 'utf8', timeout: 30000 });
process.stdout.write(result.stdout || '');
if (result.status !== 0) { console.error(result.stderr || result.error?.message || `Electron encerrou com ${result.status}`); process.exitCode = 1; }
