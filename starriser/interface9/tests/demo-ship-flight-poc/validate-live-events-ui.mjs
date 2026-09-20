import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startServer} from '../scripts/serve.mjs';
import {connectCdp,getPageWebSocketUrl,launchChromium} from '../scripts/cdp.mjs';
const output=path.resolve(process.argv[2]??'/tmp/galaxy-live-events-ui');
await mkdir(output,{recursive:true});
const server=await startServer(0,{distDir:process.argv[3]});let chrome,cdp;
try {
  chrome=await launchChromium({headless:false,insecureOrigin:`http://127.0.0.1:${server.port}`});
  cdp=await connectCdp(await getPageWebSocketUrl(chrome.debugPort));await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await cdp.send('Page.navigate',{url:`http://127.0.0.1:${server.port}/tests/demo-ship-flight-poc/index.html?scenario=2&count=1000`});
  await cdp.waitForFunction('Boolean(window.flightLab?.engine)');
  await cdp.evaluate(`document.querySelector('#pause').click();window.eventPauseTime=window.flightLab.time;
    document.querySelector('#type').value='2';document.querySelector('#attack').click();document.querySelector('#loss').click();`);
  await cdp.waitForFunction('window.flightLab.engine.events.history.length===2');
  const paused=await cdp.evaluate(`({time:window.flightLab.time,paused:window.eventPauseTime,alive:window.flightLab.engine.director.alive,
    events:window.flightLab.engine.events.history,errors:document.querySelector('#error').textContent})`);
  assert.equal(paused.time,paused.paused);assert.equal(paused.alive,900);assert.equal(paused.errors,'');
  assert(paused.events.every(event=>event.status==='applied'&&event.appliedAt===paused.paused));
  await cdp.evaluate(`document.querySelector('#pause').click()`);
  await cdp.waitForFunction('window.flightLab.time>window.eventPauseTime+.25');
  const running=await cdp.evaluate(`(async()=>{
    const e=window.flightLab.engine,{CLASS_BY_TYPE}=await import('/tests/demo-ship-battle-poc/classes.mjs');
    const raw=await e.read(e.state),f=new Float32Array(raw),w=new Uint32Array(raw);let targets=0,valid=true;
    for(let i=0;i<e.count;i++)if(w[i*48+21]===0&&w[i*48+22]===1&&f[i*48+16]>0){targets++;valid&&=CLASS_BY_TYPE[(w[(f[i*48+16]-1)*48+20]>>8)&255]===2;}
    return {targets,valid,errors:[...e.errors,document.querySelector('#error').textContent].filter(Boolean)};
  })()`);
  assert(running.targets>0&&running.valid);assert.deepEqual(running.errors,[]);
  const capture=await cdp.send('Page.captureScreenshot',{format:'png'});
  await writeFile(path.join(output,'live-events.png'),Buffer.from(capture.data,'base64'));
  await writeFile(path.join(output,'result.json'),JSON.stringify({paused,running},null,2)+'\n');
  console.log(JSON.stringify({paused,running}));
}finally{cdp?.close();chrome?.kill();await server.close();}
