// Read-only diagnosis of the running developer session. Never sends messages.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const puppeteer = require('puppeteer');
const { readGroupMessagesFromPage } = require('../Electron/group-reader');
const { createGroupMonitor } = require('../Electron/group-monitor');
(async () => {
 const root = path.join(process.env.APPDATA, 'cchatbot', 'app-data');
 const port = fs.readFileSync(path.join(root, 'whatsapp-session', 'session-cchatbot', 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0];
 const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` });
 try {
  const page = (await browser.pages()).find(page => page.url().includes('web.whatsapp.com'));
  if (!page) throw new Error('Sessão do WhatsApp não encontrada.');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'group-monitor.json'), 'utf8'));
  const account = await page.evaluate(() => {const me=window.require('WAWebUserPrefsMeUser');return (me.getMaybeMePnUser()||me.getMaybeMeLidUser())?._serialized;});
  const accountKey = crypto.createHash('sha256').update(account).digest('hex');
  const settings = config[accountKey] || {};
  const raw = await page.evaluate(readGroupMessagesFromPage);
  const modelStatus = await page.evaluate(() => {
   const messages = window.require('WAWebCollections').Msg.getModelsArray();
   return { oldIdAvailable: messages.filter(m => typeof m.id?._serialized === 'string').length,
     newIdAvailable: messages.filter(m => typeof m.id?.$1 === 'string').length,
     libraryBridge: !!window.WWebJS?.getMessageModel?.turboWhatsMessageKeyCompatibility };
  });
  let simulatedReplies = 0;
  const monitor = createGroupMonitor({read:()=>config,write:()=>{throw new Error('Diagnóstico somente leitura');},account:()=>account,send:async()=>{simulatedReplies++;}});
  for (const message of raw) await monitor.handle(message);
  console.log(JSON.stringify({readOnly:true,accountConfigFound:!!config[accountKey],...modelStatus,messagesRead:raw.length,
   groups:Object.entries(settings).map(([id,group])=>({enabled:group.enabled,activeCommands:group.commands.filter(c=>c.enabled).length,
    receivedCommandMatches:raw.filter(m=>m.from===id&&!m.fromMe&&group.commands.some(c=>c.enabled&&c.trigger===m.body.trim().toLowerCase())).length})),
   simulatedReplies,actualMessagesSent:0},null,2));
 } finally { await browser.disconnect(); }
})().catch(error => {console.error(error.message);process.exitCode=1;});
