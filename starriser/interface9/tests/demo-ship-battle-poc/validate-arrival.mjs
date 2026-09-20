import {createNavigationEngine} from './navigation-engine.mjs';
import {CLASS_BY_TYPE,CLASSES} from './classes.mjs';
export async function validateArrival(ctx,canvas) {
  const count=Number(ctx.params.count??1000),e=await createNavigationEngine(canvas,{count,scenario:1,period:30});
  try {
    const deadlines=[...e.routes.records.entries()].map(([index,record])=>({group:Math.floor(index/2),at:Math.ceil(record.request.end*120)}));
    const last=Math.max(...deadlines.map(d=>d.at)),results=[];
    for(let frame=1;frame<=last;frame++) {
      e.step(frame/120,1/120);
      const due=deadlines.filter(d=>d.at===frame);if(due.length===0)continue;
      const state=await e.read(e.state),f=new Float32Array(state),w=new Uint32Array(state);
      for(const deadline of due) {
        let live=0,arrived=0;
        for(let i=0;i<count;i++) {
          if(w[i*48+21]*32+((w[i*48+20]>>8)&255)!==deadline.group||w[i*48+22]===0)continue;
          live++;arrived+=Number(f[i*48+35]===1);
        }
        results.push({group:deadline.group,class:CLASSES[CLASS_BY_TYPE[deadline.group%32]].name,deadline:frame/120,live,arrived});
      }
      if(results.length%8===0)console.log(`Arrival audit ${count}: ${results.length}/64 groups, t=${(frame/120).toFixed(1)}`);
    }
    ctx.metric('arrival_windows',{count,results});
    ctx.assert(results.length===64,'every directed type group has an observed deadline outcome');
    ctx.assert(results.every(r=>r.arrived===r.live),'all visual ships reach their class orbit region within the authored healthy-network window');
    e.render({distance:440});await e.device.queue.onSubmittedWorkDone();ctx.assert(e.errors.length===0,'long arrival replay remains free of GPU errors');
  }finally{e.destroy();}
}
