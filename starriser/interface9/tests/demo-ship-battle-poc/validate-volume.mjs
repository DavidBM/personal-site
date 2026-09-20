import {classOf} from './classes.mjs';
import {createEngine} from './engine.mjs';
import {GRID_SIDE,GRID_CELLS} from './spacing.mjs';

// Matrix oracle, independent of the shader's quaternion cross-product rotation.
function transform(p,angle,center) {
  const c=Math.cos(angle),s=Math.sin(angle);
  return [center[0]+p[0]*c+p[2]*s,center[1]+p[1],center[2]-p[0]*s+p[2]*c];
}
function sample(field,p) {
  const g=p.map(x=>x/4+GRID_SIDE/2),base=g.map(Math.floor),f=g.map((x,a)=>x-base[a]);let result=0;
  for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++) {
    const weight=(x?f[0]:1-f[0])*(y?f[1]:1-f[1])*(z?f[2]:1-f[2]);
    result+=field[base[0]+x+GRID_SIDE*(base[1]+y)+GRID_SIDE**2*(base[2]+z)]*weight/1024;
  }
  return result;
}
function interiorMinimum(field,angle,center) {
  let minimum=Infinity;
  for(let x=-9;x<=9;x+=3)for(let y=-3;y<=3;y+=3)for(let z=-24;z<=24;z+=3) {
    minimum=Math.min(minimum,sample(field,transform([x,y,z],angle,center)));
  }
  return minimum;
}
export async function validateVolume(ctx,canvas) {
  ctx.assert(GRID_SIDE<=64,'battle pressure grid never exceeds 64 cells per axis');
  const e=await createEngine(canvas,{count:64});
  try {
    const initial=new Float32Array(await e.read(e.state));
    for(let i=0;i<64;i++)initial.set([1000,1000,1000],i*48);
    const index=e.director.groups[31*8+4];let minimum=Infinity;
    for(const [angle,center] of [[0,[0,0,0]],[.73,[73,10,-15]],[1.4,[-60,-20,30]]]) {
      initial.set(center,index*48);initial.set([0,Math.sin(angle/2),0,Math.cos(angle/2)],index*48+12);
      e.device.queue.writeBuffer(e.state,0,initial);e.step(0,0);
      const field=new Uint32Array(await e.read(e.density));
      ctx.assert(field.subarray(0,GRID_CELLS).reduce((a,b)=>a+b,0)===classOf(31).weight*1024,'isolated colossus preserves exact density mass under translation and rotation');
      minimum=Math.min(minimum,interiorMinimum(field,angle,center));
      ctx.assert(sample(field,transform([0,0,45],angle,center))===0,'volume deposition stays local to the hull');
    }
    ctx.assert(minimum>=31,'colossus interior is continuously in the red density range between the old sparse sample bands');
    ctx.metric('colossus_minimum_interior_density',minimum);
    e.command({revision:1,fleet:0,type:31,remaining:0});e.step(.01,.01);
    ctx.assert(new Uint32Array(await e.read(e.density)).every(x=>x===0),'destroyed capital leaves no phantom density');
    const battleship=e.director.groups[30*8+4];initial.set([0,0,0],battleship*48);initial.set([0,0,0,1],battleship*48+12);
    e.device.queue.writeBuffer(e.state,0,initial);e.step(.02,0);
    const battleshipField=new Uint32Array(await e.read(e.density));
    ctx.assert(sample(battleshipField,[0,0,0])>=31,'a single battleship directly creates red density');
    ctx.assert(battleshipField.reduce((a,b)=>a+b,0)===classOf(30).weight*1024,'battleship preserves its volume-scaled mass');
    ctx.assert(e.errors.length===0,'cooperative hull-density pass validates');
  }finally{e.destroy();}
}
