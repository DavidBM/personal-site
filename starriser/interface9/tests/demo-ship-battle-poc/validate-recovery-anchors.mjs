import {createEngine} from './engine.mjs';
import {createDirectorRecovery} from '../demo-ship-flight-poc/director-recovery.mjs';
export async function validateRecoveryAnchors(ctx,canvas) {
  const e=await createEngine(canvas,{count:1000,reserveFraction:.5});
  try {
    const value=createDirectorRecovery(e,1).snapshot;
    value.placements[0]={position:[5000,5000,5000],velocity:[0,0,0],spread:0};
    value.placements[1]={position:[7000,7000,7000],velocity:[0,0,0],spread:0};
    e.installSnapshot(value,e.lifetime);const first=new Float32Array(await e.read(e.state));
    ctx.assert(first[0]===5000,'absent second-cohort journey uses the primary recovery anchor');
    e.enqueueEvent({commands:[{fleet:0,admit:1,cohort:1,journey:{mode:'local',revision:1,at:1,end:1,exit:[0,0,0]}}]});e.flushEvents();
    const next=createDirectorRecovery(e,2).snapshot;next.placements[0]=value.placements[0];next.placements[1]=value.placements[1];
    e.installSnapshot(next,e.lifetime);const raw=await e.read(e.state),f=new Float32Array(raw),w=new Uint32Array(raw),split=e.director.roster.split[0],size=e.director.roster.sizes[0];
    ctx.assert(Array.from({length:size},(_,ordinal)=>w[ordinal*48+22]===1&&f[ordinal*48]===(ordinal<split?5000:7000)).every(Boolean),'independent admitted cohort ranges select their own GPU recovery anchors');
    ctx.assert(e.errors.length===0,'distinct recovery anchors produce valid GPU state');
  }finally{e.destroy();}
}
