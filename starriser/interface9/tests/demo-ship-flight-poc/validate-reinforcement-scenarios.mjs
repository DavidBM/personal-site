import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startServer} from '../scripts/serve.mjs';
import {connectCdp,getPageWebSocketUrl,launchChromium} from '../scripts/cdp.mjs';
const output=path.resolve(process.argv[2]??'/tmp/galaxy-reinforcement-scenarios');await mkdir(output,{recursive:true});
const server=await startServer(0,{distDir:process.argv[3]}),results=[];
try {
  for(const scenario of [0,1,2,3,4,5]) {
    let chrome,cdp;
    try {
      chrome=await launchChromium({headless:false,insecureOrigin:`http://127.0.0.1:${server.port}`});cdp=await connectCdp(await getPageWebSocketUrl(chrome.debugPort));await cdp.send('Page.enable');
      await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
      await cdp.send('Page.navigate',{url:`http://127.0.0.1:${server.port}/tests/demo-ship-flight-poc/index.html?scenario=${scenario}&count=1000`});
      await cdp.waitForFunction('window.flightLab?.time>.25');
      await cdp.evaluate(`document.querySelector('#pause').click();window.birthStart=window.flightLab.time;window.aliveStart=window.flightLab.engine.director.alive;document.querySelector('#reinforce').click();`);
      await cdp.waitForFunction('window.flightLab.engine.count===1099&&!window.flightLab.engine.shipStorage.status.pending');
      await cdp.evaluate(`document.querySelector('#pause').click()`);await cdp.waitForFunction('window.flightLab.time>window.birthStart+.5');
      const result=await cdp.evaluate(`(async()=>{
        const e=window.flightLab.engine,w=new Uint32Array(await e.read(e.state,e.count*192)),f=new Float32Array(w.buffer),p=await e.readProgress();
        return {count:e.count,added:e.director.alive-window.aliveStart,finite:f.every(Number.isFinite),ids:new Set(Array.from({length:e.count},(_,i)=>w[i*48+23])).size,
          progress:p.groups.reduce((n,g)=>n+g.live,0),alive:e.director.alive,errors:[...e.errors,document.querySelector('#error').textContent].filter(Boolean)};
      })()`);
      assert.equal(result.added,99);assert.equal(result.ids,1099);assert.equal(result.progress,result.alive);assert(result.finite);assert.deepEqual(result.errors,[]);
      const capture=await cdp.send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(output,`scenario-${scenario}.png`),Buffer.from(capture.data,'base64'));
      results.push({scenario,...result});console.log(JSON.stringify(results.at(-1)));
    }finally{cdp?.close();chrome?.kill();}
  }
  await writeFile(path.join(output,'result.json'),JSON.stringify(results,null,2)+'\n');
}finally{await server.close();}
