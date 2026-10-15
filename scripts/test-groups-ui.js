const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer');
const { createGroupMonitor } = require('../Electron/group-monitor');
const { recordGroupActivity } = require('../Electron/group-runtime');
(async () => {
  const browser = await puppeteer.launch({ headless: true });
  let state = {}, activeAccount = '123@c.us', failNextUpdate = false, failNextSend = false;
  const sent = [], runtimeGroups = {};
  const options = {
    read: () => structuredClone(state), write: next => { state = structuredClone(next); },
    account: () => activeAccount, send: async (...args) => { if (failNextSend) { failNextSend = false; throw new Error('Envio recusado pelo WhatsApp'); } sent.push(args); },
    report: event => { runtimeGroups[event.groupId] = recordGroupActivity(runtimeGroups[event.groupId], event); }
  };
  const monitor = createGroupMonitor(options);
  const groupId = '1@g.us', secondId = '2@g.us';
  const groups = Array.from({ length: 40 }, (_, i) => ({ id: `${i + 1}@g.us`, name: i === 0 ? 'Proteção Animal' : `Grupo de teste ${String(i + 1).padStart(2, '0')}`, photo: '' }));
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    await page.setBypassCSP(true);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.exposeFunction('mockListGroups', async () => ({ ok: true, account: activeAccount, groups, settings: monitor.settings() }));
    await page.exposeFunction('mockGroupRuntime', async () => ({ connected: true, account: activeAccount, running: true, lastScanAt: new Date().toISOString(), error: '', groups: runtimeGroups }));
    await page.exposeFunction('mockUpdateGroup', async payload => {
      if (failNextUpdate) { failNextUpdate = false; return { ok: false, error: 'Falha simulada ao salvar' }; }
      try { return { ok: true, settings: monitor.update(payload) }; }
      catch (error) { return { ok: false, error: error.message }; }
    });
    const html = fs.readFileSync(path.join(__dirname, '../Electron/index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
    const base = pathToFileURL(path.join(__dirname, '../Electron/')).href;
    await page.setContent(html.replace('<head>', `<head><base href="${base}">`));
    await page.addStyleTag({ path: path.join(__dirname, '../Electron/style.css') });
    const logo = `data:image/png;base64,${fs.readFileSync(path.join(__dirname, '../Electron/assets/turbowhats-icon.png')).toString('base64')}`;
    await page.$$eval('img[src="assets/turbowhats-icon.png"]', (images, src) => images.forEach(image => { image.src = src; }), logo);
    await page.evaluate(() => {
      window.askConfirmation = async () => true;
      document.getElementById('waStatus').textContent = 'TurboWhats online · Simulação';
      window.electronAPI = {
        listGroups: () => window.mockListGroups(), updateGroup: payload => window.mockUpdateGroup(payload),
        getGroupRuntimeStatus: () => window.mockGroupRuntime(),
        onWaStatus: callback => { window.emitStatus = callback; },
        getGroupPhoto: async () => { await new Promise(resolve => setTimeout(resolve, 80)); return 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; }
      };
      document.querySelectorAll('.section').forEach(section => section.classList.remove('active'));
      document.getElementById('groups-section').classList.add('active');
      document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.section === 'groups'));
    });
    await page.addScriptTag({ path: path.join(__dirname, '../Electron/groups-renderer.js') });
    await page.evaluate(() => window.emitStatus({ connected: true }));
    await page.waitForFunction(() => document.querySelectorAll('.group-row').length === 40);
    assert.equal(await page.$eval('#groups-form', e => e.hidden), true);
    assert.equal(await page.$$eval('.nav-item svg', nodes => nodes.length), 9);
    // Reproduce the reported action: mark Monitorar without clicking the name.
    const firstToggle = `[data-group-id="${groupId}"] .group-monitor-toggle input`;
    await page.click(firstToggle);
    await page.waitForFunction(() => !document.getElementById('groups-form').hidden && !document.getElementById('groups-save').disabled);
    assert.equal(await page.$eval('#groups-form', e => e.hidden), false);
    assert.equal(await page.$eval('#groups-selected', e => e.textContent), 'Proteção Animal');
    assert.equal(await page.$eval('#group-trigger', e => !!e.getBoundingClientRect().height), true);
    assert.equal(monitor.settings()[groupId].enabled, true);
    assert.equal(await page.$eval('.groups-browser', e => getComputedStyle(e).display), 'none');
    assert.equal(await page.$eval('#groups-change', e => e.hidden), false);
    // Real pointer clicks and native HTML validation, not requestSubmit bypasses.
    await page.type('#group-trigger', '!ajuda');
    const reply = 'Olá! 👋\nhttps://example.com/ajuda';
    await page.type('#group-response', reply);
    await page.click('#groups-save');
    await page.waitForFunction(() => document.querySelectorAll('.group-command').length === 1);
    assert.equal(monitor.settings()[groupId].commands[0].response, reply);
    await monitor.handle({ from: groupId, body: '!AJUDA', id: { _serialized: 'ui-send-1' } });
    assert.deepEqual(sent, [[groupId, reply]]);
    await page.waitForFunction(() => document.getElementById('groups-reader-status').textContent.includes('Resposta enviada com sucesso'));
    assert.equal(await page.$eval('#groups-live-sent', e => e.textContent), '1');
    assert.equal(await page.$eval('#groups-live-received', e => e.textContent), '1');
    assert.equal(await page.$$eval('#groups-live-activity li', nodes => nodes.length), 3);
    await page.click('#groups-simulated-typing');
    await page.waitForFunction(() => !document.getElementById('groups-save').disabled);
    assert.equal(monitor.settings()[groupId].simulatedTypingEnabled, false);
    assert.equal(await page.$eval('#groups-simulated-typing', e => e.checked), false);
    await page.type('#group-trigger', '!ajuda'); await page.type('#group-response', 'Duplicado'); await page.click('#groups-save');
    await page.waitForFunction(() => document.getElementById('groups-feedback').textContent.includes('já existe'));
    assert.equal(monitor.settings()[groupId].commands.length, 1);
    await page.click('#groups-cancel-edit');
    await page.type('#group-trigger', 'sem-prefixo'); await page.type('#group-response', 'x'); await page.click('#groups-save');
    assert.equal(await page.$eval('#group-trigger', e => e.checkValidity()), false);
    assert.equal(monitor.settings()[groupId].commands.length, 1);
    await page.click('#groups-cancel-edit');
    await page.click('.group-command button');
    await page.$eval('#group-trigger', e => { e.value = '!suporte'; });
    await page.$eval('#group-response', e => { e.value = 'Resposta editada'; });
    await page.click('#groups-save');
    await page.waitForFunction(() => document.querySelector('.group-command strong').textContent === '!suporte');
    assert.equal(monitor.settings()[groupId].commands[0].trigger, '!suporte');
    await page.click('.group-command input');
    await page.waitForFunction(() => !document.getElementById('groups-save').disabled);
    assert.equal(await monitor.handle({ from: groupId, body: '!suporte', id: { _serialized: 'disabled' } }), false);
    // Switching groups exposes an independent form even when monitoring is off.
    await page.click('#groups-change');
    assert.equal(await page.$eval('.groups-editor', e => e.hidden), true);
    await page.click(`[data-group-id="${secondId}"] .group-configure`);
    assert.equal(await page.$eval('#groups-form', e => e.hidden), false);
    assert.equal(await page.$eval('#group-trigger', e => e.value), '');
    assert.equal(await page.$eval('#groups-selected-enabled', e => e.checked), false);
    await page.type('#group-trigger', '!ajuda'); await page.type('#group-response', 'Outro grupo'); await page.click('#groups-save');
    await page.waitForFunction(() => document.querySelectorAll('.group-command').length === 1);
    assert.equal(monitor.settings()[secondId].commands[0].response, 'Outro grupo');
    assert.equal(await monitor.handle({ from: secondId, body: '!ajuda', id: { _serialized: 'inactive-group' } }), false);
    failNextUpdate = true;
    await page.click('#groups-selected-enabled');
    await page.waitForFunction(() => document.getElementById('groups-feedback').textContent.includes('Falha simulada'));
    assert.equal(await page.$eval('#groups-selected-enabled', e => e.checked), false);
    await page.click('#groups-selected-enabled');
    await page.waitForFunction(() => !document.getElementById('groups-save').disabled);
    assert.equal(monitor.settings()[secondId].enabled, true);
    assert.equal(monitor.settings()[groupId].enabled, false);
    failNextSend = true;
    await assert.rejects(() => monitor.handle({ from: secondId, body: '!ajuda', id: { _serialized: 'ui-failed-send' } }), /Envio recusado/);
    await page.waitForFunction(() => document.getElementById('groups-live-errors').textContent === '1');
    assert.equal(await page.$eval('#groups-live-error', e => e.hidden), false);
    assert.ok((await page.$eval('#groups-live-error', e => e.textContent)).includes('Envio recusado'));
    await monitor.handle({ from: secondId, body: '!ajuda', id: { _serialized: 'ui-recovered-send' } });
    await page.waitForFunction(() => document.getElementById('groups-live-sent').textContent === '1');
    assert.equal(await page.$eval('#groups-live-errors', e => e.textContent), '1');
    assert.equal(await page.$eval('#groups-live-error', e => e.hidden), true);
    assert.ok(await page.$('#groups-live-activity .group-activity-error'));
    // Search without accents and preserve selection/draft across photo updates.
    await page.click('#groups-change');
    await page.type('#groups-search', 'protecao');
    assert.equal(await page.$$eval('.group-row', nodes => nodes.length), 1);
    await page.click('.group-configure');
    await page.type('#group-trigger', '!rascunho');
    await page.type('#group-response', 'Texto em edição');
    await page.waitForFunction(() => document.querySelector('.group-avatar img'));
    assert.equal(await page.$eval('#group-response', e => e.value), 'Texto em edição');
    // Save screenshots with real CSS at desktop and narrow Electron sizes.
    const out = path.join(__dirname, '../.build-cache/group-ui-tests'); fs.mkdirSync(out, { recursive: true });
    for (const width of [1440, 1024, 900]) {
      await page.setViewport({ width, height: 900 });
      const layout = await page.evaluate(() => {
        const form = document.getElementById('groups-form').getBoundingClientRect();
        const content = document.querySelector('.content').getBoundingClientRect();
        return { formLeft: form.left, formRight: form.right, contentLeft: content.left, contentRight: content.right, width: document.documentElement.scrollWidth, viewport: innerWidth };
      });
      assert.ok(layout.formLeft >= layout.contentLeft && layout.formRight <= layout.contentRight + 1, JSON.stringify(layout));
      assert.ok(layout.width <= layout.viewport, JSON.stringify(layout));
      await page.$eval('#groups-section', e => { e.scrollTop = 0; });
      await page.screenshot({ path: path.join(out, `groups-${width}.png`), fullPage: true });
      if (width <= 1150) {
        assert.equal(await page.$eval('.groups-browser', e => getComputedStyle(e).display), 'none');
        assert.equal(await page.$eval('#group-trigger', e => e.value), '!rascunho');
        await page.screenshot({ path: path.join(out, `groups-editor-${width}.png`), fullPage: true });
      }
    }
    await page.setViewport({ width: 1440, height: 1000 });
    // Delete, reconnect and reload persisted settings.
    await page.click('.group-command button:last-child');
    await page.waitForFunction(() => document.querySelectorAll('.group-command').length === 0);
    assert.equal(monitor.settings()[groupId].commands.length, 0);
    assert.equal(createGroupMonitor(options).settings()[secondId].commands.length, 1);
    await page.evaluate(() => window.emitStatus({ connected: false }));
    assert.equal(await page.$eval('#group-trigger', e => e.disabled), true);
    assert.equal(await page.$eval('#groups-live-state', e => e.textContent), 'Desconectado');
    assert.equal(await page.$eval('#groups-live-error', e => e.hidden), false);
    await page.evaluate(() => window.emitStatus({ connected: true }));
    await page.waitForFunction(() => document.querySelectorAll('.group-row').length === 1);
    assert.equal(await page.$eval('#groups-form', e => e.hidden), false);
    assert.deepEqual(errors, []);
    console.log('Simulação com 40 grupos: seleção única oculta lista, troca de grupo, apenas um monitor ativo, contadores reais, erros de envio, recuperação, atividade, CRUD e reconexão OK. Layout validado em 1440, 1024 e 900 px.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
