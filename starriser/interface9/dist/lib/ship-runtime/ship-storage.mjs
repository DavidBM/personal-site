import {populationCopies} from './population-copy.mjs';
import {spatialStorage} from './spatial-schedule.mjs';
import {correctionWords} from './correction-gpu.mjs';
import {EVENT_POSE_WORDS} from './event-gpu.mjs';
import {filterGeometryBytes} from './contact-cache.mjs';

// Allocation capacity is independent of the populated shader address space.
// Bind only populated bytes: arrayLength and cached offsets still mean count.
export function shipStorageSizes(count) {
  count=Math.max(1,count);const spatial=spatialStorage(count);
  return {a:count*192,b:count*192,history:count*768,geometry:filterGeometryBytes(count),
    heads:(spatial.headWords+1)*4,links:(spatial.linkWords+count*EVENT_POSE_WORDS+correctionWords(count))*4};
}
function validateCapacity(capacity,count) {
  if(!Number.isInteger(capacity)||capacity<Math.max(1,count)||capacity>10000)throw new Error('Ship storage capacity must cover the population, up to 10000');
}
function destroyBundle(bundle){for(const buffer of Object.values(bundle.buffers))buffer.destroy();}
function makeBundle(device,capacity,sizes,count) {
  const buffers={},allocated=shipStorageSizes(capacity);
  try {
    for(const [name,size] of Object.entries(allocated))buffers[name]=device.createBuffer({label:`ships ${name} / ${capacity}`,size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});
  }catch(error){destroyBundle({buffers});throw error;}
  const bindings=Object.fromEntries(Object.entries(buffers).map(([name,buffer])=>[name,{buffer,size:sizes[name]}]));
  return {count,capacity,buffers,bindings,bytes:Object.values(allocated).reduce((sum,n)=>sum+n,0)};
}
export function createShipStorage(device,count) {
  validateCapacity(count,1);
  let sizes=shipStorageSizes(count),lastCopyBytes=0;
  let current=makeBundle(device,count,sizes,count),retired=null,pending=null,closed=false,revision=0,copiedBytes=0,peakBytes=current.bytes,error=null;
  function replace(nextCount,capacity,prepareBindings,initialize,customCopies) {
    if(closed)return false;
    validateCapacity(capacity,nextCount);
    if((capacity===current.capacity&&nextCount===count)||retired)return false;
    const nextSizes=shipStorageSizes(nextCount),next=makeBundle(device,capacity,nextSizes,nextCount);let commit,migrated=0;
    const copies=copyPlan(count,nextCount,sizes,customCopies);
    try {
      commit=prepareBindings(next);
      const encoder=device.createCommandEncoder({label:'resize ship storage'});
      for(const [name,from,to,size] of copies)if(size>0)encoder.copyBufferToBuffer(current.buffers[name],from,next.buffers[name],to,size);
      migrated=initialize?.(encoder,next)??0;
      device.queue.submit([encoder.finish()]);
    }catch(error){destroyBundle(next);throw error;}
    // The prepared commit only installs bindings. All consumers submitted before
    // the copy keep their original resources until this queue fence completes.
    retired=current;current=next;count=nextCount;sizes=nextSizes;commit();revision++;lastCopyBytes=copies.reduce((sum,row)=>sum+row[3],migrated);copiedBytes+=lastCopyBytes;peakBytes=Math.max(peakBytes,current.bytes+retired.bytes);
    const previous=retired;
    pending=device.queue.onSubmittedWorkDone().catch(reason=>{error=String(reason);}).then(()=>{
      if(retired===previous){destroyBundle(previous);retired=null;}pending=null;
    });
    return true;
  }
  function grow(nextCount,capacity,prepareBindings,initialize) {
    if(closed)return false;
    if(!Number.isInteger(nextCount)||nextCount<=count||nextCount>10000)throw Error('Population growth must append representatives, up to 10000');
    return replace(nextCount,capacity,prepareBindings,initialize);
  }
  function compact(nextCount,capacity,prepare,initialize) {
    if(!Number.isInteger(nextCount)||nextCount<0||nextCount>=count)throw Error('Compaction must retire populated slots');
    return replace(nextCount,capacity,prepare,initialize,[]);
  }
  return {compact,resize:(capacity,prepare)=>replace(count,capacity,prepare),grow,get current(){return current;},get pending(){return pending;},get sizes(){return sizes;},
    get status(){return {count,capacity:current.capacity,revision,pending:Number(retired!==null),residentBytes:closed?0:current.bytes,retiredBytes:retired?.bytes??0,peakBytes,copiedBytes,lastCopyBytes,error};},
    destroy(){if(closed)return;closed=true;destroyBundle(current);if(retired)destroyBundle(retired);retired=null;}};
}

function copyPlan(before,after,sizes,custom) {
  if(custom)return custom;
  return before===after?Object.entries(sizes).map(([name,size])=>[name,0,0,size]):populationCopies(before,after);
}
