const assert=require('assert/strict'),fs=require('fs'),vm=require('vm');const {EventEmitter}=require('events');
const source=fs.readFileSync('Electron/main.js','utf8');
const events=source.slice(source.indexOf("client.on('loading_screen'"),source.indexOf("client.on('disconnected'"));
const client=new EventEmitter();let scans=0,readerStarts=0,stops=0,timers=0;const statuses=[];
const ctx=vm.createContext({client,connectionState:{connected:false,attempting:false,initializing:false,retryCount:0},groupReaderStatus:{groups:{}},groupReader:{start:()=>{readerStarts++;}},startUnreadScanner:()=>{scans++;},stopUnreadScanner:()=>{stops++;},mainWindow:{webContents:{send:(name,data)=>{if(name==='wa-status')statuses.push(data);}}},loadConfig:()=>({whatsappAccountType:'personal'}),normalizeWhatsAppAccountType:()=> 'personal',whatsappAccountTypeLabel:()=> 'WhatsApp',logMessageTracker:()=>{},setTimeout:()=>{timers++;},console:{log:()=>{},error:()=>{}}});
vm.runInContext(events,ctx);
client.emit('ready');ctx.groupReaderStatus.groups.test={sent:7};
for(let index=0;index<10;index++){client.emit('loading_screen',99,'SYNC');client.emit('authenticated');client.emit('ready');}
assert.equal(scans,1);assert.equal(readerStarts,1);assert.equal(stops,0);assert.equal(ctx.groupReaderStatus.groups.test.sent,7);assert.ok(statuses.every(status=>status.connected));
client.emit('auth_failure','rejected');assert.equal(ctx.connectionState.connected,false);assert.equal(stops,1);assert.equal(timers,0);
client.emit('ready');assert.equal(scans,2);assert.equal(ctx.connectionState.connected,true);
console.log('Eventos reais do main: autenticação/loading/ready repetidos não desconectam a interface nem zeram contadores; falha real é exibida sem agendar destruição de sessão recuperada.');
