import {BATTLE_ORDER_WORDS} from '../../../lib/ship-runtime/visual-battle.mjs';
import {SCENE_LAB} from '../../../lib/ship-runtime/flight-layout.mjs';

const PHASE={pincer:0,pass:1,pursue:2,evade:3,orbit:4,regroup:5};
/** Event/lifetime/admission changes only. One 192-byte write; no CPU ship work. */
export function createSceneBattles(capacity,ports){
  const previous=new Array(capacity),targets=new Array(capacity);
  const lives=new Uint32Array(capacity),sizes=new Uint32Array(capacity),own=new Uint32Array(capacity);
  const ownSizes=new Uint32Array(capacity);
  const data=new ArrayBuffer(BATTLE_ORDER_WORDS*4),f=new Float32Array(data),w=new Uint32Array(data);
  function unchanged(slot,b,opponent,serial,count){
    if(previous[slot]!==b||own[slot]!==serial||ownSizes[slot]!==count)return false;
    const life=opponent?.serialBase??0,size=opponent?.shipCount??0;
    return targets[slot]===opponent&&lives[slot]===life&&sizes[slot]===size;
  }
  function writeOpponent(opponent,tactic){
    w[4]=0xffffffff;if(!opponent)return;
    const types=ports.types(opponent.id);
    const heavy=types.find(row=>row.kind===tactic.targetClass)??types[types.length-1];
    const light=types.find(row=>row.kind===tactic.bomberTargetClass)??types[0];
    // A merged, noncontiguous class row cannot be used as one ordinal range.
    // Its first stable member is enough; never scan ships to build a target list.
    const range=row=>row ? [row.ordinal,row.lastOrdinal==null?row.count:1] : [0,opponent.shipCount];
    w.set([opponent.slot,opponent.serialBase,...range(heavy)],4);w.set(range(light),20);
  }
  function writeOrder(fleet,b,opponent){
    const tactic=b.tactics[b.side];
    for(const row of ports.types(fleet.id))w.set([row.ordinal,row.count,row.lastOrdinal==null?row.count:1,0],24+row.kind*4);
    w.set([fleet.serialBase,b.id,b.revision,PHASE[tactic.manoeuvre]],0);writeOpponent(opponent,tactic);
    w[22]=Number(b.stage==='engaged');
    f.set([b.center.x*SCENE_LAB,b.center.y*SCENE_LAB,b.center.z*SCENE_LAB,b.radius*SCENE_LAB],8);
    f.set([b.axis.x,b.axis.y,b.axis.z,b.side===0?1:-1],12);
    f.set([Math.max(0,(fleet.nowMs-b.phaseAt)/1000),b.phaseDuration/1000,(b.pursuitSpeed??0)*SCENE_LAB,0],16);
  }
  function remember(slot,b,opponent,serial){
    previous[slot]=b;targets[slot]=opponent;lives[slot]=opponent?.serialBase??0;
    sizes[slot]=opponent?.shipCount??0;own[slot]=serial;
  }
  function sync(fleet){
    const slot=fleet.slot??0,b=fleet.state?.battle;
    if(!b&&!previous[slot])return;
    const opponent=b?.stage==='engaged'?ports.fleet(b.opponent):null;
    const count=fleet.shipCount??0;
    if(unchanged(slot,b,opponent,fleet.serialBase,count))return;
    ownSizes[slot]=count;
    remember(slot,b,opponent,fleet.serialBase);w.fill(0);
    if(b)writeOrder(fleet,b,opponent);
    ports.upload(slot,data);
  }
  return {sync,reset(){previous.fill(undefined);targets.fill(undefined);lives.fill(0);sizes.fill(0);own.fill(0);ownSizes.fill(0);},
    remove(slot){previous[slot]=undefined;targets[slot]=undefined;w.fill(0);ports.upload(slot,data);}};
}

const sphereCache=new WeakMap();
/** Three great circles make a legible sphere without a translucent fill pass.
 * Geometry is event-owned; repeated overlay refreshes reuse the same points. */
export function battleSphereRoutes(fleet){
  const b=fleet.state?.battle;if(!b)return [];
  const cached=sphereCache.get(b);if(cached?.[0]?.slot===fleet.slot)return cached;
  const center=b.center,r=b.radius,rows=[];
  const origin=[center.x,center.y,center.z];
  for(let axis=0;axis<3;axis++){
    const points=[];
    for(let i=0;i<=48;i++){
      const a=i*Math.PI/24,c=Math.cos(a)*r,s=Math.sin(a)*r;
      const p=origin.slice();p[(axis+1)%3]+=c;p[(axis+2)%3]+=s;points.push(p);
    }
    rows.push({slot:fleet.slot,points,color:b.stage==='engaged'?[1,.45,.16]:[1,.75,.25],
      destination:[center.x,center.y,center.z],status:'battle',guide:true});
  }
  sphereCache.set(b,rows);return rows;
}
