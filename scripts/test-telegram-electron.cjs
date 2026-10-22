const { app } = require('electron');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  let client;
  try {
    const assert = require('assert/strict');
    const path = require('path');
    const { createRequire } = require('module');
    const load = createRequire(path.resolve(process.env.TELEGRAM_TEST_PACKAGE || 'package.json'));
    const { createTelegramTransport } = load('./Electron/telegram-client');
    const transport = createTelegramTransport({ apiId: 12345, apiHash: 'a'.repeat(32) });
    client = transport.client;
    assert.equal(typeof client.signInUserWithQrCode, 'function');
    assert.equal(typeof client.markAsRead, 'function');
    assert.equal(typeof transport.NewMessage, 'function');
    assert.equal(typeof transport.Api.auth.ExportLoginToken, 'function');
    const cryptoLoad = createRequire(load.resolve('teleproto'));
    const cipher = cryptoLoad('cifrante').aes.ige(Buffer.alloc(32, 1));
    assert.notEqual(cipher.backend, 'native');
    const iv = Buffer.alloc(32, 2), plain = Buffer.alloc(32, 3);
    const encrypted = Buffer.from(cipher.encryptSync(plain, { iv }));
    assert.equal(encrypted.toString('hex'), process.env.TELEGRAM_TEST_CIPHER);
    assert.deepEqual(Buffer.from(cipher.decryptSync(encrypted, { iv })), plain);
    cipher.dispose();
    await client.destroy();
    console.log('Telegram no Electron: cliente real, QR e criptografia portátil equivalentes à referência nativa, sem acesso à rede.');
    app.exit(0);
  } catch (error) {
    console.error(error);
    if (client) await client.destroy().catch(() => {});
    app.exit(1);
  }
});
