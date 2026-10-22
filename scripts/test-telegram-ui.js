const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setBypassCSP(true);
    await page.setViewport({ width: 1440, height: 1000 });
    await page.setContent(fs.readFileSync(path.join(__dirname, '../Electron/index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ''));
    await page.addStyleTag({ path: path.join(__dirname, '../Electron/style.css') });
    const qr = await require('qrcode').toDataURL('tg://login?token=ui-test-token');
    await page.evaluate(qr => {
      window.askConfirmation = async () => true;
      const wa = [], tg = [];
      window.tgState = { connected: false, phase: 'idle' };
      window.emitWa = data => wa.forEach(fn => fn(data));
      window.emitTg = data => { window.tgState = data; tg.forEach(fn => fn(data)); };
      window.updates = []; window.connections = []; window.passwords = []; window.waConnected = false;
      const waSettings = { '1@g.us': { enabled: true, commands: [] } }, tgSettings = { 'telegram:-100123': { enabled: false, commands: [] } };
      window.electronAPI = {
        onWaStatus: callback => wa.push(callback), onTelegramStatus: callback => tg.push(callback),
        getTelegramState: async () => window.tgState,
        connectTelegram: async credentials => {
          window.connections.push(credentials);
          if (credentials?.apiId !== '12345') return { ok: false, error: 'Credenciais inválidas' };
          window.emitTg({ connected: false, phase: 'qr', qr }); return { ok: true };
        },
        submitTelegramPassword: async password => {
          window.passwords.push(password); window.emitTg({ connected: true, phase: 'ready', account: 'telegram:77', label: '@teste' }); return { ok: true };
        },
        logoutTelegram: async () => { window.emitTg({ connected: false, phase: 'idle' }); return { ok: true }; },
        listGroups: async () => ({ ok: true, account: '1@c.us', groups: [{ id: '1@g.us', name: 'Grupo WhatsApp' }], settings: waSettings }),
        listTelegramGroups: async () => ({ ok: true, account: 'telegram:77', groups: [{ id: 'telegram:-100123', name: 'Grupo Telegram' }], settings: tgSettings }),
        updateGroup: async payload => { window.updates.push(['whatsapp', payload]); return { ok: true, settings: waSettings }; },
        updateTelegramGroup: async payload => { window.updates.push(['telegram', payload]); tgSettings[payload.groupId].enabled = payload.enabled; return { ok: true, settings: tgSettings }; },
        getGroupRuntimeStatus: async () => ({ account: '1@c.us', connected: true, running: true, groups: {} }),
        getTelegramGroupRuntime: async () => ({ account: 'telegram:77', connected: true, running: true, groups: {} })
      };
    }, qr);
    await page.addScriptTag({ path: path.join(__dirname, '../Electron/telegram-renderer.js') });
    await page.addScriptTag({ path: path.join(__dirname, '../Electron/groups-renderer.js') });
    await page.type('#telegram-api-id', '1'); await page.type('#telegram-api-hash', 'a'.repeat(32));
    await page.click('#telegram-connect');
    await page.waitForFunction(() => document.getElementById('telegram-feedback').textContent.includes('inválidas'));
    assert.equal(await page.$eval('#telegram-api-id', e => e.disabled), false);
    await page.$eval('#telegram-api-id', e => { e.value = '12345'; });
    await page.type('#telegram-api-hash', 'a'.repeat(32));
    await page.click('#telegram-connect');
    await page.waitForFunction(() => !document.getElementById('telegram-qr-area').hidden);
    assert.equal(await page.$eval('#telegram-api-hash', e => e.value), '');
    await page.evaluate(() => window.emitTg({ connected: false, phase: 'password', passwordRequired: true, hint: 'Minha dica' }));
    assert.equal(await page.$eval('#telegram-qr-area', e => e.hidden), true);
    await page.type('#telegram-password', 'senha-teste');
    await page.click('#telegram-password-form button');
    await page.waitForFunction(() => document.getElementById('telegram-status').textContent.includes('Conectado'));
    assert.equal(await page.$eval('#telegram-password', e => e.value), '');
    // Both platforms stay connected while the panel switches between their groups.
    await page.evaluate(() => {
      document.querySelectorAll('.section').forEach(e => e.classList.remove('active'));
      document.getElementById('groups-section').classList.add('active');
      window.emitWa({ connected: true });
    });
    await page.waitForFunction(() => document.querySelector('.group-select')?.textContent === 'Grupo WhatsApp');
    await page.select('#groups-platform', 'telegram');
    await page.waitForFunction(() => document.querySelector('.group-select')?.textContent === 'Grupo Telegram');
    await page.click('.group-monitor-toggle input');
    await page.waitForFunction(() => !document.getElementById('groups-save').disabled);
    assert.equal(await page.evaluate(() => window.updates.at(-1)[0]), 'telegram');
    assert.equal(await page.$eval('#groups-selected', e => e.textContent), 'Grupo Telegram');
    await page.select('#groups-platform', 'whatsapp');
    await page.waitForFunction(() => document.querySelector('.group-select')?.textContent === 'Grupo WhatsApp');
    assert.equal(await page.$eval('.group-monitor-toggle input', e => e.checked), true);
    // Telegram logout does not change WhatsApp state or disable its controls.
    await page.evaluate(() => {
      document.getElementById('groups-section').classList.remove('active');
      document.getElementById('status-section').classList.add('active');
    });
    await page.click('#telegram-logout');
    await page.waitForFunction(() => document.getElementById('telegram-status').textContent === 'Desconectado');
    assert.equal(await page.$eval('#groups-refresh', e => e.disabled), false);
    const out = path.join(__dirname, '../.build-cache/telegram-ui-tests'); fs.mkdirSync(out, { recursive: true });
    for (const width of [1440, 1024, 900]) {
      await page.setViewport({ width, height: 1000 });
      await page.$eval('.telegram-connection', e => e.scrollIntoView({ block: 'start' }));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(out, `telegram-${width}.png`) });
    }
    assert.deepEqual(errors, []);
    console.log('Interface Telegram: QR, senha 2FA, correção de credenciais, seleção por plataforma, sessões simultâneas, logout isolado e layouts OK.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
