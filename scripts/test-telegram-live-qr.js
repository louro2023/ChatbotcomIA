const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { createTelegramConnection } = require('../Electron/telegram-client');
(async () => {
  fs.mkdirSync('.build-cache/telegram-live', { recursive: true });
  const sessionPath = fs.mkdtempSync(path.resolve('.build-cache/telegram-live/session-'));
  let resolveQr, rejectQr;
  const qrReady = new Promise((resolve, reject) => { resolveQr = resolve; rejectQr = reject; });
  const connection = createTelegramConnection({ sessionPath, executablePath: require('puppeteer').executablePath(),
    onStatus: state => {
      if (state.qr) {
        const bytes = Buffer.from(state.qr.split(',')[1], 'base64');
        const png = PNG.sync.read(bytes); let dark = 0;
        for (let i = 0; i < png.data.length; i += 4) if (png.data[i + 3] && png.data[i] + png.data[i + 1] + png.data[i + 2] < 400) dark++;
        if (dark > 300) { fs.writeFileSync('.build-cache/telegram-live/official-qr.png', bytes); resolveQr(); }
      }
      if (state.phase === 'error') rejectQr(new Error(state.error));
    }
  });
  const timeout = setTimeout(() => rejectQr(new Error('O Telegram Web não exibiu o QR Code em 60 segundos.')), 60000);
  try {
    await connection.connect(); await qrReady;
    assert.equal(connection.account(), ''); assert.equal(connection.status().phase, 'qr');
    console.log('Telegram Web real: QR Code oficial exibido sem API ID/API Hash e sem autenticar uma conta.');
  } finally { clearTimeout(timeout); await connection.disconnect(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
