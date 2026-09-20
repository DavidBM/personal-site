import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startServer} from '../scripts/serve.mjs';
import {connectCdp,getPageWebSocketUrl,launchChromium} from '../scripts/cdp.mjs';
const output=path.resolve(process.argv[2]??'/tmp/galaxy-flight-layout');
await mkdir(output,{recursive:true});
const server=await startServer(0,{distDir:process.argv[4]});let chrome,cdp;
try {
  chrome=await launchChromium({headless:false,insecureOrigin:`http://127.0.0.1:${server.port}`});
  cdp=await connectCdp(await getPageWebSocketUrl(chrome.debugPort));
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await cdp.send('Page.navigate',{url:`http://127.0.0.1:${server.port}/tests/demo-ship-optimization/index.html?run=0`});
  await cdp.waitForFunction('Boolean(document.querySelector("canvas"))');
  for(const [name,scenario,count,seconds,distance,density] of [['orbits',0,1000,10,440,false],['approach',1,10000,30,360,false],['planet-density',0,1000,1,440,true],['warp',3,1000,2,300,false],['lifecycle',4,1000,100,440,false],['lifecycle-battle',4,1000,0,440,false],['four-fleets',5,1000,10,640,false],['shared-scope',5,1000,16,640,true]]) {
    if(process.argv[3]&&!name.includes(process.argv[3]))continue;
    const metrics=await cdp.evaluate(`(async()=>{
      const {createScenarioEngine:createEngine}=await import('../demo-ship-flight-poc/scenarios.mjs');
      const e=await createEngine(document.querySelector('canvas'),{count:${count},scenario:${scenario},period:30});
      const endTime=${scenario===4?(name==='lifecycle-battle'?'e.sequence.battleAt+20':'e.sequence.duration'):seconds};
      for(let frame=1;frame<=endTime*120;frame++) {
        e.step(frame/120,1/120);
        if(frame%120===0){e.render({distance:${distance}});await e.device.queue.onSubmittedWorkDone();await new Promise(requestAnimationFrame);}
      }
      e.setDensityVisible(${density});
      for(let frame=0;frame<60;frame++){e.step(endTime+frame/120,1/120);e.render({distance:${distance}});await new Promise(requestAnimationFrame);}
      await e.device.queue.onSubmittedWorkDone();window.captureEngine=e;
      return {errors:e.errors,profile:e.profiler.latest,time:e.now,duration:e.sequence?.duration};
    })()`);
    console.log(name,JSON.stringify(metrics));
    if(metrics.errors.length)throw new Error(metrics.errors.join('\n'));
    const capture=await cdp.send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:1200,height:800,scale:1}});
    await writeFile(path.join(output,`${name}.png`),Buffer.from(capture.data,'base64'));
    await cdp.evaluate('window.captureEngine.destroy()');
  }
}finally{cdp?.close();chrome?.kill();await server.close();}
