const assert = require('assert/strict');
const vm = require('vm');
const { EventEmitter } = require('events');
const { withWhatsAppCompatibility, installWhatsAppMessageKeyCompatibility } = require('../Electron/whatsapp-compat');
const { createGroupReader } = require('../Electron/group-reader');
const { createGroupMonitor } = require('../Electron/group-monitor');
const { recordGroupActivity } = require('../Electron/group-runtime');
const { createSessionRecovery } = require('../Electron/session-recovery');
(async () => {
 let epoch = 1792090000000, messages = [], syncing = false, stats = {}, state = {}, sent = 0;
 let injections = 0, listeners = 0, context;
 function newDocument() {
  context = vm.createContext({ window: { AuthStore: {}, WWebJS: {getMessageModel: value=>value}, require: name => name === 'WAWebSocketModel' ? {Socket:{state:'CONNECTED',hasSynced:true}} : {Chat:{getModelsArray:()=>[]},Msg:{getModelsArray:()=>[]}} } });
 }
 newDocument();
 class BaseClient extends EventEmitter {
  constructor() { super(); this.pupPage={evaluate:async fn=>vm.runInContext(`(${fn.toString()})()`,context)}; }
  async inject() { injections++; await new Promise(resolve=>setImmediate(resolve)); await this.attachEventListeners(); this.emit('authenticated'); this.emit('ready'); }
  async attachEventListeners() { listeners++; }
 }
 const client = new (withWhatsAppCompatibility(BaseClient))();
 const monitor = createGroupMonitor({read:()=>structuredClone(state),write:next=>{state=next;},account:()=> 'account@c.us',send:async()=>{sent++;},report:event=>{stats=recordGroupActivity(stats,event);}});
 monitor.update({groupId:'1@g.us',action:'save-command',trigger:'!teste',response:'OK',enabled:true});monitor.update({groupId:'1@g.us',action:'toggle-group',enabled:true});
 const reader = createGroupReader({snapshot:async()=>{if(syncing){const error=new Error('Sincronizando');error.code='WA_WEB_SYNCING';throw error;}return messages;},handle:msg=>monitor.handle(msg),now:()=>epoch,intervalMs:100000,onError:error=>{throw error;}});
 client.on('ready',()=>void reader.start());
 try {
  await Promise.all([client.inject(),client.inject(),client.inject()]);
  assert.equal(injections,1);assert.equal(listeners,1);
  await reader.start();
  for(let tick=1;tick<=300;tick++) {
   epoch+=2000;
   if(tick%15===0)messages.push({from:'1@g.us',body:'!teste',id:{_serialized:'message-'+tick},timestamp:Math.floor(epoch/1000)});
   if(tick%20===0)await Promise.all([client.inject(),client.inject()]);
   if(tick===90)syncing=true;
   if(tick===93)syncing=false;
   if(tick===150){newDocument();await Promise.all([client.inject(),client.inject()]);}
   await reader.scan();
  }
  assert.equal(injections,2);assert.equal(listeners,2);
  assert.equal(sent,20);assert.equal(stats.sent,20);assert.equal(stats.received,20);
  assert.equal(stats.failed,0);
  console.log('Estabilidade: 10 minutos simulados, 300 varreduras, navegações repetidas, atualização completa da página e sincronização temporária; 20 respostas únicas e contadores preservados.');
 } finally {reader.stop();}
 // Already-synced sockets can miss the change:hasSynced event at startup.
 newDocument(); delete context.window.WWebJS;
 class MissedSyncClient extends BaseClient { async inject() { injections++; } }
 const missed = new (withWhatsAppCompatibility(MissedSyncClient))();let initialSyncs=0;
 context.window.onAppStateHasSyncedEvent=async()=>{initialSyncs++;context.window.WWebJS={getMessageModel:value=>value};await missed.attachEventListeners();missed.emit('authenticated');missed.emit('ready');};
 await Promise.all([missed.inject(),missed.inject()]);
 await missed.inject();assert.equal(initialSyncs,1);assert.equal(context.window.turboWhatsListenersAttached,true);
 console.log('Inicialização: socket já sincronizado conclui o handshake uma única vez sem aguardar um evento passado.');
 // Session operations never destroy a healthy connection and serialize recovery.
 const connection={connected:true,initializing:false};let destroyed=0,initialized=0,stopped=0,release;
 const recovery=createSessionRecovery({state:connection,stop:()=>{stopped++;},destroy:async()=>{destroyed++;await new Promise(resolve=>{release=resolve;});},wait:async()=>{},initialize:async()=>{initialized++;connection.connected=true;return {ok:true};}});
 assert.equal((await recovery.reconnect()).alreadyConnected,true);assert.equal(destroyed,0);
 connection.connected=false;
 const first=recovery.reconnect(),second=recovery.reconnect();assert.equal(first,second);assert.equal(destroyed,1);release();await first;
 assert.equal(initialized,1);assert.equal(stopped,1);
 const loading={connected:false,initializing:false};let loadingInitializations=0;
 const loadingRecovery=createSessionRecovery({state:loading,stop:()=>{},destroy:async()=>{},wait:async()=>{},initialize:async()=>{loadingInitializations++;loading.initializing=true;return {ok:true};}});
 await loadingRecovery.reconnect();await loadingRecovery.reconnect();assert.equal(loadingInitializations,1);assert.equal(loading.initializing,true);
 const incomplete=vm.createContext({window:{}});
 const unavailable=vm.runInContext(`(${installWhatsAppMessageKeyCompatibility.toString()})()`,incomplete);
 assert.equal(unavailable.ready,false);
 console.log('Recuperação: conexão saudável preservada, pedidos simultâneos compartilham uma operação e página incompleta aguarda sincronização.');
})().catch(error=>{console.error(error);process.exitCode=1;});
