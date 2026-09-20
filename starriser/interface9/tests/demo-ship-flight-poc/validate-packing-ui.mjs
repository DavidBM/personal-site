import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startServer} from '../scripts/serve.mjs';
import {connectCdp,getPageWebSocketUrl,launchChromium} from '../scripts/cdp.mjs';
const output=path.resolve(process.argv[2]??'/tmp/galaxy-packing-ui');await mkdir(output,{recursive:true});
const server=await startServer(0,{distDir:process.argv[3]});let chrome,cdp;
try {
  chrome=await launchChromium({headless:false,insecureOrigin:`http://127.0.0.1:${server.port}`});
  cdp=await connectCdp(await getPageWebSocketUrl(chrome.debugPort));await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await cdp.send('Page.navigate',{url:`http://127.0.0.1:${server.port}/tests/demo-ship-flight-poc/index.html?scenario=2&count=1000`});
  await cdp.waitForFunction('window.flightLab?.time>.25');
  await cdp.evaluate(`document.querySelector('#pause').click();window.packPaused=window.flightLab.time;document.querySelector('#loss').click();`);
  await cdp.waitForFunction('window.flightLab.engine.director.alive===900');
  await cdp.evaluate(`document.querySelector('#pack-storage').click()`);
  await cdp.waitForFunction('window.flightLab.engine.packing.status.batches>0&&!window.flightLab.engine.packing.status.pending');
  const packed=await cdp.evaluate(`(async()=>{
    const e=window.flightLab.engine,w=new Uint32Array(await e.read(e.state));
    return {time:e.now,paused:window.packPaused,status:e.packing.status,alive:e.director.alive,
      prefix:Array.from({length:900},(_,i)=>w[i*48+22]).every(x=>x===1),tail:Array.from({length:100},(_,i)=>w[(i+900)*48+22]).every(x=>x===0),
      changed:e.slotLayout.physical.some((slot,id)=>slot!==id),errors:[...e.errors,document.querySelector('#error').textContent].filter(Boolean)};
  })()`);
  assert.equal(packed.time,packed.paused);assert(packed.prefix&&packed.tail&&packed.changed);assert(packed.status.lastSwaps<=64);if(packed.status.latestMs!==null)assert(packed.status.sampledSwaps>0&&packed.status.sampledBatch<=packed.status.batches);assert.deepEqual(packed.errors,[]);
  await cdp.evaluate(`document.querySelector('#pause').click()`);await cdp.waitForFunction('window.flightLab.time>window.packPaused+.3');
  const running=await cdp.evaluate(`(async()=>{
    const e=window.flightLab.engine,raw=await e.read(e.state),w=new Uint32Array(raw),f=new Float32Array(raw);let targets=0,valid=true;
    for(let i=0;i<e.count;i++)if(w[i*48+22]===1&&f[i*48+16]>0){const other=(f[i*48+16]-1)*48;targets++;valid&&=w[other+22]===1&&e.director.canTarget(w[i*48+21],w[other+21]);}
    return {targets,valid,errors:[...e.errors,document.querySelector('#error').textContent].filter(Boolean)};
  })()`);
  assert(running.targets>0&&running.valid);assert.deepEqual(running.errors,[]);
  await cdp.waitForFunction('document.querySelector("#timings").textContent.includes("pack batch")');
  const capture=await cdp.send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(output,'packing.png'),Buffer.from(capture.data,'base64'));
  const result={packed,running};await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{cdp?.close();chrome?.kill();await server.close();}
