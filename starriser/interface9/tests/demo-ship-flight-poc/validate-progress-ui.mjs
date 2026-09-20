import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startServer} from '../scripts/serve.mjs';
import {connectCdp,getPageWebSocketUrl,launchChromium} from '../scripts/cdp.mjs';
const output=path.resolve(process.argv[2]??'/tmp/galaxy-progress-ui');
await mkdir(output,{recursive:true});
const server=await startServer(0,{distDir:process.argv[3]});let chrome,cdp;
try {
  chrome=await launchChromium({headless:false,insecureOrigin:`http://127.0.0.1:${server.port}`});
  cdp=await connectCdp(await getPageWebSocketUrl(chrome.debugPort));
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await cdp.send('Page.navigate',{url:`http://127.0.0.1:${server.port}/tests/demo-ship-flight-poc/index.html?scenario=0&count=1000`});
  await cdp.waitForFunction('Boolean(window.flightLab?.engine)');
  await cdp.evaluate(`(async()=>{
    document.querySelector('#pause').click();
    const e=window.flightLab.engine;window.beforeProgress=await e.readProgress();
    window.beforeState=new Uint8Array(await e.read(e.state));
    window.beforeHistory=new Uint8Array(await e.read(e.history));
    document.querySelector('#retarget').click();document.querySelector('#retarget').click();
  })()`);
  await cdp.waitForFunction('window.flightLab.engine.navigationStatus?.pending===false');
  const result=await cdp.evaluate(`(async()=>{
    const e=window.flightLab.engine,records=Array.from(e.routes.records),before=window.beforeProgress;
    const positionError=records.reduce((worst,[index,plan])=>{
      const body=e.solar.bodyAt(plan.request.planet,plan.request.at),anchor=before.groups[index].anchor;
      return Math.max(worst,...plan.request.start.map((x,i)=>Math.abs(x-(anchor[i]-body[i]))));
    },0);
    const state=new Uint8Array(await e.read(e.state)),history=new Uint8Array(await e.read(e.history));
    return {status:e.navigationStatus,records:records.length,liveGroups:before.groups.filter(r=>r.live).length,positionError,
      latest:records.every(([,p])=>p.revision===3&&p.request.planeShift===.12*Math.sin(Math.PI*1.6)),
      stateRetained:state.every((x,i)=>x===window.beforeState[i]),historyRetained:history.every((x,i)=>x===window.beforeHistory[i]),
      errors:[...e.errors,document.querySelector('#error').textContent].filter(Boolean)};
  })()`);
  assert.equal(result.errors.length,0);assert.equal(result.records,result.liveGroups);assert(result.latest);
  assert.equal(result.status.deferred,0);assert(result.positionError<.002);assert(result.stateRetained&&result.historyRetained);
  await cdp.evaluate(`document.querySelector('#pause').click()`);
  await cdp.waitForFunction('window.flightLab.time>window.beforeProgress.time+1');
  assert.deepEqual(await cdp.evaluate('window.flightLab.engine.errors'),[]);
  const capture=await cdp.send('Page.captureScreenshot',{format:'png'});
  await writeFile(path.join(output,'retarget.png'),Buffer.from(capture.data,'base64'));
  await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
}finally{cdp?.close();chrome?.kill();await server.close();}
