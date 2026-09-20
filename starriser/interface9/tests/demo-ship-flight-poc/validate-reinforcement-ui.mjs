import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {startServer} from '../scripts/serve.mjs';
import {connectCdp,getPageWebSocketUrl,launchChromium} from '../scripts/cdp.mjs';
const output=path.resolve(process.argv[2]??'/tmp/galaxy-reinforcement-ui');await mkdir(output,{recursive:true});
const server=await startServer(0,{distDir:process.argv[3]});let chrome,cdp;
try {
  chrome=await launchChromium({headless:false,insecureOrigin:`http://127.0.0.1:${server.port}`});
  cdp=await connectCdp(await getPageWebSocketUrl(chrome.debugPort));await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  await cdp.send('Page.navigate',{url:`http://127.0.0.1:${server.port}/tests/demo-ship-flight-poc/index.html?scenario=2&count=1000`});
  await cdp.waitForFunction('window.flightLab?.time>.25');
  await cdp.evaluate(`document.querySelector('#pause').click();window.populationPaused=window.flightLab.time;`);
  await cdp.evaluate(`(async()=>{const e=window.flightLab.engine;window.populationBefore=Array.from(new Uint32Array(await e.read(e.state,e.count*192)));})()`);
  await cdp.evaluate(`document.querySelector('#reinforce').click()`);
  await cdp.waitForFunction('window.flightLab.engine.count===1099&&!window.flightLab.engine.shipStorage.status.pending');
  const born=await cdp.evaluate(`(async()=>{
    const e=window.flightLab.engine,w=new Uint32Array(await e.read(e.state,e.count*192)),progress=await e.readProgress();
    return {time:e.now,paused:window.populationPaused,unchanged:window.populationBefore.every((x,i)=>w[i]===x),
      count:e.count,alive:e.director.alive,types:Array.from(new Set(Array.from({length:99},(_,i)=>(w[(i+1000)*48+20]>>>8)&255))),
      progress:progress.groups.reduce((sum,g)=>sum+g.live,0),storage:e.shipStorage.status};
  })()`);
  assert.equal(born.time,born.paused);assert(born.unchanged);assert.equal(born.count,1099);assert.equal(born.alive,1099);assert.equal(born.progress,1099);assert.equal(born.types.length,6);
  await cdp.evaluate(`document.querySelector('#destroy').click()`);
  await cdp.waitForFunction('window.flightLab.engine.director.alive===500');
  await cdp.evaluate(`document.querySelector('#reinforce').click()`);
  await cdp.waitForFunction('window.flightLab.engine.count===1198&&!window.flightLab.engine.shipStorage.status.pending');
  await cdp.evaluate(`document.querySelector('#pack-storage').click()`);
  await cdp.waitForFunction('window.flightLab.engine.packing.status.batches>0&&!window.flightLab.engine.packing.status.pending');
  await cdp.evaluate(`document.querySelector('#pause').click()`);
  await cdp.waitForFunction('window.flightLab.time>window.populationPaused+.5');
  const running=await cdp.evaluate(`(async()=>{
    const e=window.flightLab.engine,raw=await e.read(e.state,e.count*192),w=new Uint32Array(raw),f=new Float32Array(raw);let targets=0,valid=true;
    for(let i=0;i<e.count;i++)if(w[i*48+22]===1&&f[i*48+16]>0){const target=(f[i*48+16]-1)*48;targets++;valid&&=w[target+22]===1&&e.director.canTarget(w[i*48+21],w[target+21]);}
    return {count:e.count,alive:e.director.alive,ids:new Set(Array.from({length:e.count},(_,i)=>w[i*48+23])).size,targets,valid,
      errors:[...e.errors,document.querySelector('#error').textContent].filter(Boolean)};
  })()`);
  assert.equal(running.ids,1198);assert.equal(running.alive,599);assert(running.targets>0&&running.valid);assert.deepEqual(running.errors,[]);
  await cdp.evaluate(`document.querySelector('#loss').click()`);
  await cdp.waitForFunction('window.flightLab.engine.director.alive===580');
  const afterLoss=await cdp.evaluate(`({logical:Array.from({length:32},(_,type)=>window.flightLab.engine.director.roster.logicalCount(0,type)).reduce((a,b)=>a+b,0),errors:[...window.flightLab.engine.errors,document.querySelector('#error').textContent].filter(Boolean)})`);
  assert.equal(afterLoss.logical,1584);assert.deepEqual(afterLoss.errors,[]);
  await cdp.evaluate(`document.querySelector('#focus-target').click()`);
  const followed=await cdp.evaluate(`(()=>{const e=window.flightLab.engine,h=e.followedShip;return {id:h.id,physical:e.slotLayout.physical[h.index],slot:h.slot,fleet:e.director.population.keys[h.index]>>>13,enabled:document.querySelector('#follow').checked};})()`);
  assert(followed.enabled&&followed.fleet===1&&followed.slot===followed.physical);
  await cdp.evaluate(`document.querySelector('#follow').checked=false`);
  const capture=await cdp.send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(output,'reinforcements.png'),Buffer.from(capture.data,'base64'));
  const result={born,running,afterLoss,followed};await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{cdp?.close();chrome?.kill();await server.close();}
