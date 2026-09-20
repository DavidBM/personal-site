import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startServer} from '../scripts/serve.mjs';
import {connectCdp,getPageWebSocketUrl,launchChromium} from '../scripts/cdp.mjs';
const output=path.resolve(process.argv[2]??'/tmp/galaxy-storage-ui');await mkdir(output,{recursive:true});
const server=await startServer(0,{distDir:process.argv[3]});let chrome,cdp;
try {
  chrome=await launchChromium({headless:false,insecureOrigin:`http://127.0.0.1:${server.port}`});
  cdp=await connectCdp(await getPageWebSocketUrl(chrome.debugPort));await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await cdp.send('Page.navigate',{url:`http://127.0.0.1:${server.port}/tests/demo-ship-flight-poc/index.html?scenario=2&count=1000`});
  await cdp.waitForFunction('window.flightLab?.time>.25');
  await cdp.evaluate(`document.querySelector('#pause').click();window.storageTime=window.flightLab.time;`);
  await cdp.evaluate(`(async()=>{const e=window.flightLab.engine;window.storageBefore=Array.from(new Uint32Array(await e.read(e.state,e.count*192)));})()`);
  await cdp.evaluate(`document.querySelector('#grow-storage').click()`);
  await cdp.waitForFunction('window.flightLab.engine.shipStorage.status.capacity===2000&&!window.flightLab.engine.shipStorage.status.pending');
  const grown=await cdp.evaluate(`(async()=>{
    const e=window.flightLab.engine,w=new Uint32Array(await e.read(e.state,e.count*192));
    return {unchanged:window.storageBefore.every((x,i)=>x===w[i]),time:e.now,paused:window.storageTime,status:e.shipStorage.status};
  })()`);
  assert(grown.unchanged);assert.equal(grown.time,grown.paused);
  await cdp.evaluate(`document.querySelector('#loss').click();`);
  await cdp.waitForFunction('window.flightLab.engine.director.alive===900');
  await cdp.evaluate(`document.querySelector('#pack-storage').click();`);
  await cdp.waitForFunction('window.flightLab.engine.director.alive===900&&window.flightLab.engine.packing.status.batches>0&&!window.flightLab.engine.packing.status.pending');
  await cdp.waitForFunction('!document.querySelector("#trim-storage").disabled');
  await cdp.evaluate(`document.querySelector('#trim-storage').click();document.querySelector('#pause').click();`);
  await cdp.waitForFunction('window.flightLab.time>window.storageTime+.3&&window.flightLab.engine.shipStorage.status.capacity===1000&&!window.flightLab.engine.shipStorage.status.pending');
  const running=await cdp.evaluate(`(async()=>{
    const e=window.flightLab.engine,w=new Uint32Array(await e.read(e.state,e.count*192)),progress=await e.readProgress();
    return {ids:new Set(Array.from({length:e.count},(_,i)=>w[i*48+23])).size,alive:progress.groups.reduce((n,g)=>n+g.live,0),
      status:e.shipStorage.status,errors:[...e.errors,document.querySelector('#error').textContent].filter(Boolean)};
  })()`);
  assert.equal(running.ids,1000);assert.equal(running.alive,900);assert.deepEqual(running.errors,[]);
  await cdp.waitForFunction('document.querySelector("#storage").textContent.includes("1,000 allocated slots")');
  const capture=await cdp.send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(output,'storage.png'),Buffer.from(capture.data,'base64'));
  const result={grown,running};await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{cdp?.close();chrome?.kill();await server.close();}
