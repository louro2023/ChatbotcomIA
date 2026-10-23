const { app } = require('electron');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  let browser;
  try {
    const assert = require('assert/strict'), path = require('path');
    const { createRequire } = require('module');
    const packagePath = path.resolve(process.env.TELEGRAM_TEST_PACKAGE || 'package.json');
    const load = createRequire(packagePath);
    assert.equal(typeof load('./Electron/telegram-client').createTelegramConnection, 'function');
    const { telegramWebPage } = load('./Electron/telegram-web-page');
    const puppeteer = load('puppeteer');
    const executablePath = process.env.TELEGRAM_TEST_PACKAGE ? path.join(path.dirname(path.dirname(packagePath)), 'browser', 'chrome.exe') : puppeteer.executablePath();
    browser = await puppeteer.launch({ headless: true, executablePath });
    const page = await browser.newPage();
    await page.setContent('<canvas class="qrCanvas" width="240" height="240"></canvas>');
    const state = await page.evaluate(telegramWebPage, 'state', {});
    assert.equal(state.phase, 'qr'); assert.equal(state.connected, false); assert.match(state.qr, /^data:image\/png;base64,/);
    await browser.close(); browser = null;
    console.log('Telegram Web no Electron: navegador interno e captura de QR sem API ID/API Hash OK.'); app.exit(0);
  } catch (error) { console.error(error); if (browser) await browser.close().catch(() => {}); app.exit(1); }
});
