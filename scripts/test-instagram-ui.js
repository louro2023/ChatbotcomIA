const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files', '--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.evaluateOnNewDocument(() => {
      let config = {
        defaultMessagesEnabled: true,
        aiEnabled: false,
        bulkContacts: [],
        emailContacts: [],
        instagramReplyComment: true,
        instagramMonitorIntervalSeconds: 20
      };
      let statusCallback = null;
      const noopListener = () => () => {};
      window.electronAPI = {
        readConfig: async () => structuredClone(config),
        writeConfig: async next => {
          config = structuredClone(next);
          window.__savedInstagramConfig = structuredClone(next);
          return { ok: true };
        },
        onWaQr: noopListener,
        onWaStatus: noopListener,
        onBulkProgress: noopListener,
        onEmailProgress: noopListener,
        onInstagramStatus: callback => {
          statusCallback = callback;
          window.__emitInstagramStatus = data => callback(data);
        },
        onInstagramLog: callback => { window.__emitInstagramLog = data => callback(data); },
        getGeminiUsage: async () => ({ ok: true, requests: 0, promptTokens: 0, responseTokens: 0, thoughtTokens: 0, totalTokens: 0, model: 'teste' }),
        getMetrics: async () => ({ ok: true, sentToday: 0, attemptsToday: 0, averageIntervalMs: 0, totalPauseMs: 0, aiResponseRate: 0, aiResponses: 0, aiAttempts: 0, failureRate: 0, failedToday: 0, sentThisHour: 0, sentThisMinute: 0, hourly: [], byMinute: [] }),
        getInstagramStatus: async () => ({ ok: true, active: false, loggedIn: true, scanned: 0, matches: 0, commentsSent: 0, directsSent: 0 }),
        openInstagramLogin: async () => ({ ok: true, loggedIn: true }),
        checkInstagramSession: async () => ({ ok: true, loggedIn: true }),
        startInstagramMonitor: async payload => {
          window.__instagramStartPayload = structuredClone(payload);
          return { ok: true, postUrl: payload.postUrl };
        },
        stopInstagramMonitor: async () => {
          setTimeout(() => statusCallback?.({ active: false, loggedIn: true, message: 'Monitoramento interrompido.' }), 0);
          return { ok: true };
        },
        processVisibleInstagramComments: async () => {
          window.__instagramProcessVisibleCalled = true;
          return { ok: true };
        }
      };
    });

    await page.goto(pathToFileURL(path.resolve(__dirname, '..', 'Electron', 'index.html')).href, { waitUntil: 'load' });
    await page.$eval('[data-section="instagram"]', element => element.click());
    await page.type('#instagramPostUrl', 'https://www.instagram.com/p/ABC_123/');
    await page.type('#instagramKeywords', 'curso, CURRÍCULO');
    await page.type('#instagramMessage', 'Olá ');
    await page.$eval('.instagram-tag-chip[data-tag="{Nome}"]', element => element.click());
    await page.type('#instagramMessage', '! Veja ');
    await page.$eval('.instagram-tag-chip[data-tag="{Link}"]', element => element.click());
    await page.$eval('#instagramConsent', element => element.click());
    await page.$eval('#instagramStart', element => element.click());
    await page.waitForFunction(() => window.__instagramStartPayload && !document.getElementById('instagramStop').disabled);
    await page.evaluate(() => {
      window.__emitInstagramStatus({ active: true, loggedIn: true, scanned: 12, matches: 2, commentsSent: 1, directsSent: 1, message: 'Publicação verificada.' });
      window.__emitInstagramLog({ type: 'match', message: '@teste ativou curso', timestamp: new Date().toISOString() });
    });
    await page.type('#instagramKeywords', '\nebook');
    await page.$eval('#instagramProcessVisible', element => element.click());
    await page.waitForSelector('#confirmationDialog[open]');
    await page.$eval('#confirmationDialogConfirm', element => element.click());
    await page.waitForFunction(() => window.__instagramProcessVisibleCalled === true);

    const result = await page.evaluate(() => ({
      monitorStatus: document.getElementById('instagramMonitorStatus').textContent,
      scanned: document.getElementById('instagramScannedCount').textContent,
      matches: document.getElementById('instagramMatchCount').textContent,
      log: document.getElementById('instagramActivityLog').textContent,
      typingWorks: document.getElementById('instagramKeywords').value.includes('ebook'),
      startPayload: window.__instagramStartPayload,
      savedMessage: window.__savedInstagramConfig.instagramMessage,
      processVisibleCalled: window.__instagramProcessVisibleCalled,
      tagGap: document.querySelector('.instagram-tag-toolbar').getBoundingClientRect().top
        - document.getElementById('instagramMessage').getBoundingClientRect().bottom,
      dialogOffset: (() => {
        const dialog = document.getElementById('confirmationDialog');
        dialog.showModal();
        const rect = dialog.getBoundingClientRect();
        const offset = {
          x: Math.abs((rect.left + rect.width / 2) - window.innerWidth / 2),
          y: Math.abs((rect.top + rect.height / 2) - window.innerHeight / 2)
        };
        dialog.close();
        return offset;
      })()
    }));

    assert.deepEqual(pageErrors, []);
    assert.equal(result.monitorStatus, 'Monitor ativo');
    assert.equal(result.scanned, '12');
    assert.equal(result.matches, '2');
    assert.match(result.log, /@teste ativou curso/);
    assert.equal(result.typingWorks, true);
    assert.match(result.savedMessage, /\{Nome\}/);
    assert.match(result.savedMessage, /\{Link\}/);
    assert.equal(result.startPayload.replyComment, true);
    assert.equal(result.processVisibleCalled, true);
    assert.ok(result.tagGap >= 8, `A barra de tags está muito próxima do editor: ${result.tagGap}px`);
    assert.ok(result.dialogOffset.x <= 2 && result.dialogOffset.y <= 2, `O diálogo não está centralizado: ${JSON.stringify(result.dialogOffset)}`);
    console.log('Interface e controles do Bot Instagram validados com sucesso.');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
