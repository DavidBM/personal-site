import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startServer} from '../scripts/serve.mjs';
import {connectCdp,getPageWebSocketUrl,launchChromium} from '../scripts/cdp.mjs';
const output=path.resolve(process.argv[2]??'/tmp/galaxy-reclamation-ui');await mkdir(output,{recursive:true});
const server=await startServer(0,{distDir:process.argv[3]});let chrome,cdp;
try {
  chrome=await launchChromium({headless:false,insecureOrigin:`http://127.0.0.1:${server.port}`});
  cdp=await connectCdp(await getPageWebSocketUrl(chrome.debugPort));await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1400,height:1050,deviceScaleFactor:1,mobile:false});
  await cdp.send('Page.navigate',{url:`http://127.0.0.1:${server.port}/tests/demo-ship-flight-poc/index.html?scenario=2&count=1000`});
  await cdp.waitForFunction('window.flightLab?.time>.25');
  await cdp.evaluate(`(()=>{const e=window.flightLab.engine,original=e.reclaim;window.oldShip=e.captureShip(0);e.reclaim=async()=>{const result=await original();window.reclaimResult=result;return result;};document.querySelector('#destroy').click();window.lossAt=e.now;})()`);
  await cdp.waitForFunction('window.flightLab.time>window.lossAt+2.3&&window.flightLab.engine.director.alive===500');
  await cdp.evaluate(`document.querySelector('#reclaim-storage').click()`);
  await cdp.waitForFunction('window.reclaimResult&&!document.querySelector("#reclaim-storage").disabled');
  const first=await cdp.evaluate(`({result:window.reclaimResult,count:window.flightLab.engine.count,old:window.flightLab.engine.resolveShip(window.oldShip)})`);
  assert.equal(first.result.status,'applied');assert.equal(first.count,500);assert.equal(first.old,null);
  await cdp.waitForFunction('!window.flightLab.engine.shipStorage.status.pending');
  await cdp.evaluate(`document.querySelector('#reinforce').click()`);
  await cdp.waitForFunction('window.flightLab.engine.count===599&&!window.flightLab.engine.shipStorage.status.pending');
  await cdp.evaluate(`window.reclaimResult=null;document.querySelector('#reclaim-storage').click()`);
  await cdp.waitForFunction('window.reclaimResult&&!document.querySelector("#reclaim-storage").disabled');
  const resumed=await cdp.evaluate(`({result:window.reclaimResult,alive:window.flightLab.engine.director.alive,nextId:window.flightLab.engine.director.population.nextId,errors:[...window.flightLab.engine.errors,document.querySelector('#error').textContent].filter(Boolean)})`);
  assert.equal(resumed.result.status,'unchanged');assert.equal(resumed.alive,599);assert.equal(resumed.nextId,1100);assert.deepEqual(resumed.errors,[]);
  const capture=await cdp.send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(output,'reclamation.png'),Buffer.from(capture.data,'base64'));
  const result={first,resumed};await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{cdp?.close();chrome?.kill();await server.close();}
