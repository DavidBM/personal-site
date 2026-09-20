import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startServer} from '../scripts/serve.mjs';
import {connectCdp,getPageWebSocketUrl,launchChromium} from '../scripts/cdp.mjs';
const output=path.resolve(process.argv[2]??'/tmp/galaxy-recovery-ui');await mkdir(output,{recursive:true});
const server=await startServer(0,{distDir:process.argv[3]});let chrome,cdp;
async function state() {
  return cdp.evaluate(`({time:window.flightLab.time,simulated:window.flightLab.engine.now,solar:window.flightLab.engine.solar.time,
    recovery:window.flightLab.presentation.status,errors:[...window.flightLab.engine.errors,document.querySelector('#error').textContent].filter(Boolean)})`);
}
async function stall() {
  const before=await state();
  await cdp.evaluate(`{const until=performance.now()+1000;while(performance.now()<until){}}`);
  await cdp.waitForFunction(`window.flightLab.presentation.status.recoveries>${before.recovery.recoveries}`);
  const after=await state();assert(after.time>before.time+.9);assert.equal(after.time,after.solar);assert.deepEqual(after.errors,[]);
  return {before,after};
}
async function offset() {
  await cdp.evaluate(`{const lab=window.flightLab,c=lab.presentation.clock,h=performance.now();c.synchronize({revision:1,serverMs:lab.engine.solar.sceneEpochMs+(lab.engine.now+35)*1000,sentAt:h,receivedAt:h});}`);
  await cdp.waitForFunction('window.flightLab.time>35');const forward=await state();assert.deepEqual(forward.errors,[]);
  await cdp.evaluate(`{const lab=window.flightLab,c=lab.presentation.clock,h=performance.now();c.synchronize({revision:2,serverMs:lab.engine.solar.sceneEpochMs+(lab.engine.now-2)*1000,sentAt:h,receivedAt:h});window.clockHoldStart=performance.now();window.clockHoldTime=lab.engine.now;}`);
  await cdp.waitForFunction('performance.now()>window.clockHoldStart+250');
  const held=await state(),start=await cdp.evaluate('window.clockHoldTime');
  assert(held.time>=start&&held.time-start<1/60);assert(held.recovery.clock.holding);assert.equal(held.time,held.solar);
  return {forward,held};
}
async function receiptGap() {
  await cdp.evaluate(`{const lab=window.flightLab,e=lab.engine,h=performance.now(),sequence=e.events.inbox.nextSequence;
    window.missingReceipt=sequence;e.receiveEvent({id:'after-gap',sequence:sequence+1,effectiveAt:e.now,commands:[]},e.lifetime);
    lab.presentation.clock.synchronize({revision:3,serverMs:e.solar.sceneEpochMs+(e.now+5)*1000,sentAt:h,receivedAt:h});}`);
  await cdp.waitForFunction('Boolean(window.flightLab.presentation.status.error)');
  const held=await state();assert(held.recovery.error.includes('missing receipts'));assert.equal(held.time,held.solar);
  await cdp.evaluate(`{const e=window.flightLab.engine;e.receiveEvent({id:'missing',sequence:window.missingReceipt,effectiveAt:e.now,commands:[]},e.lifetime);}`);
  await cdp.waitForFunction(`window.flightLab.presentation.status.recoveries>${held.recovery.recoveries}&&!window.flightLab.presentation.status.error`);
  const released=await state();assert(released.time>held.time+4);assert.equal(released.time,released.solar);assert.deepEqual(released.errors,[]);
  return {held,released};
}
async function scopeScenario() {
  await cdp.evaluate(`document.querySelector('#scenario').value='5';document.querySelector('#scenario').dispatchEvent(new Event('change'));`);
  await cdp.waitForFunction('window.flightLab?.engine?.scenario===5');
  await cdp.evaluate(`{const lab=window.flightLab,h=performance.now();lab.presentation.clock.synchronize({revision:1,serverMs:lab.engine.solar.sceneEpochMs+30000,sentAt:h,receivedAt:h});}`);
  await cdp.waitForFunction('window.flightLab.time>=30&&window.flightLab.presentation.status.recoveries>0');
  const result=await cdp.evaluate(`({active:window.flightLab.engine.pressure.activeCount,joined:Array.from(window.flightLab.engine.director.groups).filter((_,i)=>i%8===3),
    history:window.flightLab.engine.sequence.history,errors:[...window.flightLab.engine.errors,document.querySelector('#error').textContent].filter(Boolean)})`);
  assert.equal(result.active,1);assert(result.joined.every(value=>value===0));assert(result.history.some(row=>row.id==='peace'&&row.status==='reconciled'));assert.deepEqual(result.errors,[]);
  return result;
}
try {
  chrome=await launchChromium({headless:false,insecureOrigin:`http://127.0.0.1:${server.port}`});
  cdp=await connectCdp(await getPageWebSocketUrl(chrome.debugPort));await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await cdp.send('Page.navigate',{url:`http://127.0.0.1:${server.port}/tests/demo-ship-flight-poc/index.html?scenario=2&count=1000`});
  await cdp.waitForFunction('Boolean(window.flightLab?.engine)');
  const suspended=await stall(),synchronization=await offset(),gap=await receiptGap(),scopes=await scopeScenario();
  await cdp.waitForFunction('window.flightLab.time>30.6');
  const capture=await cdp.send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(output,'recovered-scopes.png'),Buffer.from(capture.data,'base64'));
  const result={suspended,synchronization,gap,scopes};await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{cdp?.close();chrome?.kill();await server.close();}
