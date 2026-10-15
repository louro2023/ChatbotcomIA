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
        bulkSimulatedTypingEnabled: true,
        bulkContacts: [],
        emailContacts: [],
        instagramReplyComment: true,
        instagramSendDirect: false,
        instagramMessage: 'Mensagem antiga compartilhada',
        instagramMonitorIntervalSeconds: 20
      };
      const waStatusCallbacks = [];
      let statusCallback = null;
      let bulkSafetyState = { locked: false, incident: null };
      const noopListener = () => () => {};
      window.electronAPI = {
        readConfig: async () => structuredClone(config),
        writeConfig: async next => {
          config = structuredClone(next);
          window.__savedInstagramConfig = structuredClone(next);
          return { ok: true };
        },
        onWaQr: noopListener,
        onWaStatus: callback => {
          waStatusCallbacks.push(callback);
          window.__emitWaStatus = data => waStatusCallbacks.forEach(listener => listener(data));
        },
        selectWhatsAppAccountType: async accountType => {
          window.__selectedWhatsAppAccountType = accountType;
          return { ok: true, accountType };
        },
        onBulkProgress: callback => { window.__emitBulkProgress = data => callback(data); },
        onBulkImportProgress: callback => { window.__emitBulkImportProgress = data => callback(data); },
        getBulkSafetyStatus: async () => ({ ok: true, ...structuredClone(bulkSafetyState) }),
        unlockBulkSafety: async () => {
          bulkSafetyState = { locked: false, incident: null };
          return { ok: true, ...structuredClone(bulkSafetyState) };
        },
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
    await page.evaluate(() => window.__emitWaStatus({
      connected: false,
      phase: 'account-type',
      progress: 0,
      message: 'Escolha o aplicativo.'
    }));
    await page.waitForFunction(() => document.getElementById('whatsappAccountTypeArea').style.display !== 'none');
    await page.$eval('[data-whatsapp-account-type="business"]', element => element.click());
    await page.waitForFunction(() => window.__selectedWhatsAppAccountType === 'business');
    await page.$eval('[data-section="instagram"]', element => element.click());
    await page.evaluate(() => {
      window.__legacyInstagramMessageMigrated = document.getElementById('instagramCommentMessage').value === 'Mensagem antiga compartilhada'
        && document.getElementById('instagramDirectMessage').value === 'Mensagem antiga compartilhada';
      document.getElementById('instagramCommentMessage').value = '';
      document.getElementById('instagramDirectMessage').value = '';
    });
    await page.type('#instagramPostUrl', 'https://www.instagram.com/p/ABC_123/');
    await page.type('#instagramKeywords', 'curso, CURRÍCULO');
    await page.type('#instagramCommentMessage', 'Resposta pública para ');
    await page.$eval('.instagram-tag-chip[data-target="instagramCommentMessage"][data-tag="{Nome}"]', element => element.click());
    await page.$eval('#instagramSendDirect', element => element.click());
    await page.type('#instagramDirectMessage', 'Mensagem privada com ');
    await page.$eval('.instagram-tag-chip[data-target="instagramDirectMessage"][data-tag="{Link}"]', element => element.click());
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

    await page.$eval('[data-section="bulk"]', element => element.click());
    for (let index = 0; index < 5; index++) {
      await page.$eval('#bulkAddVariation', element => element.click());
    }
    await page.type('.bulk-message-variation:last-child textarea', 'Última variação ');
    await page.$eval('.tag-chip[data-tag="{Nome}"]', element => element.click());
    await page.evaluate(() => {
      window.__emitBulkImportProgress({ percent: 45, message: 'Importando contatos salvos...' });
      window.__emitBulkProgress({
        pauseUpdate: true,
        current: 50,
        total: 100,
        sent: 50,
        failed: 0,
        remainingSeconds: 899,
        longPauseMinutes: 15
      });
      window.__bulkPauseText = document.getElementById('bulkProgressText').textContent;
      window.__emitBulkProgress({
        current: 5,
        total: 20,
        sent: 2,
        failed: 3,
        contact: { name: 'Cliente teste', phone: '5511999999999' },
        error: 'Too many requests',
        nextDelaySeconds: null,
        safetyStop: {
          type: 'restriction',
          title: 'Possível limite ou restrição do WhatsApp',
          reason: 'A campanha foi interrompida para proteger a conta.',
          technicalError: 'Too many requests',
          occurredAt: new Date().toISOString(),
          sent: 2,
          failed: 3
        }
      });
    });
    await page.evaluate(() => {
      window.__bulkResult = {
        simulatedTypingEnabled: document.getElementById('bulkSimulatedTypingEnabled').checked,
        progress: document.getElementById('bulkImportProgressPercent').textContent,
        progressMessage: document.getElementById('bulkImportProgressText').textContent,
        variationCount: document.querySelectorAll('.bulk-message-variation-text').length,
        variationCounter: document.getElementById('bulkVariationCount').textContent,
        addVariationDisabled: document.getElementById('bulkAddVariation').disabled,
        lastVariation: document.querySelector('.bulk-message-variation:last-child textarea').value,
        pauseEveryMessages: document.getElementById('bulkPauseEveryMessages').value,
        longPauseMinutes: document.getElementById('bulkLongPauseMinutes').value,
        pauseText: window.__bulkPauseText,
        safetyVisible: document.getElementById('bulkSafetyAlert').style.display === 'flex',
        safetyTitle: document.getElementById('bulkSafetyTitle').textContent,
        startDisabled: document.getElementById('bulkStart').disabled
      };
    });
    await page.$eval('[data-section="instagram"]', element => element.click());

    const result = await page.evaluate(() => ({
      monitorStatus: document.getElementById('instagramMonitorStatus').textContent,
      scanned: document.getElementById('instagramScannedCount').textContent,
      matches: document.getElementById('instagramMatchCount').textContent,
      log: document.getElementById('instagramActivityLog').textContent,
      typingWorks: document.getElementById('instagramKeywords').value.includes('ebook'),
      startPayload: window.__instagramStartPayload,
      savedCommentMessage: window.__savedInstagramConfig.instagramCommentMessage,
      savedDirectMessage: window.__savedInstagramConfig.instagramDirectMessage,
      processVisibleCalled: window.__instagramProcessVisibleCalled,
      bulkSimulatedTypingEnabled: window.__bulkResult.simulatedTypingEnabled,
      bulkImportProgress: window.__bulkResult.progress,
      bulkImportProgressMessage: window.__bulkResult.progressMessage,
      bulkVariationCount: window.__bulkResult.variationCount,
      bulkVariationCounter: window.__bulkResult.variationCounter,
      bulkAddVariationDisabled: window.__bulkResult.addVariationDisabled,
      bulkLastVariation: window.__bulkResult.lastVariation,
      bulkPauseEveryMessages: window.__bulkResult.pauseEveryMessages,
      bulkLongPauseMinutes: window.__bulkResult.longPauseMinutes,
      bulkPauseText: window.__bulkResult.pauseText,
      bulkSafetyVisible: window.__bulkResult.safetyVisible,
      bulkSafetyTitle: window.__bulkResult.safetyTitle,
      bulkStartDisabled: window.__bulkResult.startDisabled,
      selectedWhatsAppAccountType: window.__selectedWhatsAppAccountType,
      whatsappChoiceCount: document.querySelectorAll('[data-whatsapp-account-type]').length,
      legacyMessageMigrated: window.__legacyInstagramMessageMigrated,
      directFieldVisible: !document.getElementById('instagramDirectMessageField').hidden,
      tagGap: document.querySelector('#instagramCommentMessageField .instagram-tag-toolbar').getBoundingClientRect().top
        - document.getElementById('instagramCommentMessage').getBoundingClientRect().bottom,
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
    assert.match(result.savedCommentMessage, /Resposta pública para \{Nome\}/);
    assert.match(result.savedDirectMessage, /Mensagem privada com \{Link\}/);
    assert.equal(result.startPayload.replyComment, true);
    assert.equal(result.startPayload.sendDirect, true);
    assert.equal(result.startPayload.commentMessage, result.savedCommentMessage);
    assert.equal(result.startPayload.directMessage, result.savedDirectMessage);
    assert.notEqual(result.startPayload.commentMessage, result.startPayload.directMessage);
    assert.equal(result.legacyMessageMigrated, true);
    assert.equal(result.directFieldVisible, true);
    assert.equal(result.processVisibleCalled, true);
    assert.equal(result.bulkSimulatedTypingEnabled, true);
    assert.equal(result.bulkImportProgress, '45%');
    assert.equal(result.bulkImportProgressMessage, 'Importando contatos salvos...');
    assert.equal(result.bulkVariationCount, 5);
    assert.equal(result.bulkVariationCounter, '5 de 5 variações');
    assert.equal(result.bulkAddVariationDisabled, true);
    assert.match(result.bulkLastVariation, /Última variação \{Nome\}/);
    assert.equal(result.bulkPauseEveryMessages, '50');
    assert.equal(result.bulkLongPauseMinutes, '15');
    assert.match(result.bulkPauseText, /14:59/);
    assert.equal(result.bulkSafetyVisible, true);
    assert.match(result.bulkSafetyTitle, /limite ou restrição/);
    assert.equal(result.bulkStartDisabled, true);
    assert.equal(result.selectedWhatsAppAccountType, 'business');
    assert.equal(result.whatsappChoiceCount, 2);
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
