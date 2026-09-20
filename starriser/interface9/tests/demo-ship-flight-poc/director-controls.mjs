import {bindReclamation} from './reclamation-controls.mjs';
import {bindRegrouping} from './regrouping-controls.mjs';
import {bindReinforcements} from './reinforcement-controls.mjs';
const FLEET_NAMES=['Blue','Orange','Green','Purple','Gold','Teal','Pink','Silver'];
import {authorTactic} from '../demo-ship-battle-poc/tactics.mjs';
import {CLASSES,CLASS_BY_TYPE,TYPES,classMask} from '../demo-ship-battle-poc/classes.mjs';
// UI-only mock backend commands; no pose writes or combat outcome calculation.
export function bindDirectorControls(getEngine,onError) {
  const element=id=>document.getElementById(id);
  bindReinforcements(getEngine,onError);bindReclamation(getEngine,onError);bindRegrouping(getEngine,onError);
  let lastTime=0,nextCycle=8,lastRevision=-1;
  for(const [index,kind] of CLASSES.entries()) {
    const option=document.createElement('option');option.value=String(index);option.textContent=kind.name;element('type').append(option);element('tactic-class').append(option.cloneNode(true));
  }
  function send(fields) {
    const engine=getEngine();if(!engine?.director)return;
    try {engine.enqueueEvent({commands:[{fleet:Number(element('fleet').value),...fields}]});onError('');}
    catch(error){onError(error.message);}
  }
  function nextTarget() {
    element('type').value=String((Number(element('type').value)+1)%CLASSES.length);
    send({attackClass:Number(element('type').value)});nextCycle=lastTime+8;
  }
  function syncSummary(engine) {
    const fleet=Number(element('fleet').value),groups=engine.director.groups;
    const counts=new Array(CLASSES.length).fill(0);
    for(let t=0;t<TYPES;t++)counts[CLASS_BY_TYPE[t]]+=groups[(fleet*TYPES+t)*8];
    element('class-summary').textContent=CLASSES.map((c,i)=>`${c.name}: ${counts[i]} · ${2*c.extent[2]} long · ${c.speed} speed`).join('  |  ');
    const mask=groups[fleet*TYPES*8+2],same=Array.from({length:TYPES},(_,t)=>groups[(fleet*TYPES+t)*8+2]===mask).every(Boolean);
    const target=CLASSES.findIndex((_,i)=>classMask(i)===mask);
    if(same&&target>=0)element('type').value=String(target);
    const totals=Array.from({length:engine.director.fleetCount},(_,i)=>i).map(f=>Array.from({length:TYPES},(_,t)=>groups[(f*TYPES+t)*8]).reduce((a,b)=>a+b,0));
    element('fleet-counts').textContent=`Alive: ${totals.map((n,i)=>`${FLEET_NAMES[i]} ${n}`).join(" · ")}. Loss reports affect the selected fleet only.`;
    element('target-order').textContent=`${FLEET_NAMES[fleet]} targets ${same&&target>=0?CLASSES[target].name:'mixed classes'}`;
  }
  function reportLoss() {
    const engine=getEngine();if(!engine)return;
    if(engine.director.population.revision===0){send({survivalFraction:.8});return;}
    const fleet=Number(element('fleet').value);
    const commands=Array.from({length:TYPES},(_,type)=>({fleet,type,remaining:Math.round(engine.director.roster.logicalCount(fleet,type)*.8)}));
    try{engine.enqueueEvent({commands});onError('');}catch(error){onError(error.message);}
  }
  function focusTarget() {
    const e=getEngine();if(!e?.director)return;
    const fleet=Number(element('fleet').value),kind=Number(element('type').value);
    const enemy=Array.from({length:e.director.fleetCount},(_,i)=>i).find(i=>e.director.canTarget(fleet,i));if(enemy===undefined)return;
    const type=CLASS_BY_TYPE.findIndex((c,t)=>c===kind&&e.director.groups[(enemy*TYPES+t)*8]>0);
    if(type<0)return;
    const ordinal=Array.from({length:e.director.roster.sizeFor(enemy,type)},(_,i)=>i).find(i=>e.director.roster.isLive(enemy,type,i));
    const physical=e.slotLayout.data[(enemy*TYPES+type)*256+ordinal]-1;
    const handle=e.captureShip(e.slotLayout.logical[physical]);if(e.followShip(handle))element('follow').checked=true;
  }
  async function applyTactic() {
    const engine=getEngine();if(!engine?.director)return;
    const fleet=Number(element('fleet').value),kind=element('tactic-class').value;
    const types=Array.from({length:TYPES},(_,t)=>t).filter(t=>kind==='all'||CLASS_BY_TYPE[t]===Number(kind));
    try {
      for(const type of types) {
        const prior=engine.director.intents[fleet*TYPES+type].tactic;
        const options={fleet,type,name:element('tactic').value,splits:Number(element('splits').value),at:lastTime,revision:(prior?.revision??0)+1};
        if(engine.authorTactic)await engine.authorTactic(options);else send({type,tactic:authorTactic(options)});
      }
    }catch(error){onError(error.message);}
  }
  element('apply-tactic').onclick=applyTactic;
  element('join').onclick=()=>send({joined:true});element('leave').onclick=()=>send({joined:false});
  element('strategy').onchange=()=>send({strategy:element('strategy').value});
  element('attack').onclick=()=>send({attackClass:Number(element('type').value)});
  element('next-target').onclick=nextTarget;element('cycle-targets').onchange=()=>{if(element('cycle-targets').checked)send({attackClass:Number(element('type').value)});nextCycle=lastTime+8;};
  element('focus-target').onclick=focusTarget;
  element('loss').onclick=reportLoss;element('destroy').onclick=()=>send({survivalFraction:0});
  element('density').onchange=()=>getEngine()?.setDensityEnabled?.(element('density').checked);
  element('planets').onchange=()=>getEngine()?.setPlanetsEnabled?.(element('planets').checked);
  element('show-density').onchange=()=>getEngine()?.setDensityVisible?.(element('show-density').checked);
  element('target-links').onchange=()=>getEngine()?.setTargetLinks?.(element('target-links').checked);
  element('fleet').onchange=()=>{getEngine()?.setSelectedFleet?.(Number(element('fleet').value));lastRevision=-1;};
  function reset(engine) {
    element('battle-controls').hidden=!engine.director;
    element('battle-disclosure').hidden=!engine.director;element('battle-disclosure').open=!engine.sequence;
    element('timeline').hidden=!engine.sequence;
    element('timeline-events').replaceChildren();
    for(const event of engine.sequence?.events??[]){const item=document.createElement('span');item.id=`event-${event.id}`;item.textContent=`${event.effectiveAt}s ${event.label} · `;element('timeline-events').append(item);}
    element('fleet').replaceChildren(...FLEET_NAMES.slice(0,engine.director.fleetCount).map((name,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=name;return option;}));
    element('fleet').value='0';element('strategy').value='pass';element('type').value='0';
    element('density').checked=true;element('planets').checked=true;
    element('show-density').checked=false;element('target-links').checked=true;element('cycle-targets').checked=false;
    lastTime=0;nextCycle=8;lastRevision=-1;
  }
  function updateTimeline(sequence,time) {
    element('timeline-now').textContent=` · ${Math.min(time,sequence.duration).toFixed(1)} / ${sequence.duration}s · ${sequence.history.at(-1)?.label??'Preparing'}`;
    for(const event of sequence.history){const item=element(`event-${event.id}`);item.style.color=event.late?'#ffc481':'#70d8b0';item.title=`Applied at ${event.appliedAt.toFixed(3)}s`;}
  }
  function update(time) {
    const engine=getEngine();if(!engine?.director)return;
    lastTime=time;if(engine.sequence)updateTimeline(engine.sequence,time);
    if(element('cycle-targets').checked&&time>=nextCycle)nextTarget();
    if(lastRevision!==engine.director.revision){syncSummary(engine);lastRevision=engine.director.revision;}
  }
  return {reset,update};
}
